#[cfg(unix)]
mod unix {
    use std::{
        fs::{self, DirBuilder},
        io::{BufRead, BufReader, Write},
        os::unix::{
            fs::DirBuilderExt,
            net::{UnixListener, UnixStream},
            process::CommandExt,
        },
        path::PathBuf,
        process::{Command, Stdio},
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
            mpsc,
        },
        thread::{self, JoinHandle},
        time::{Duration, Instant},
    };

    use serde::{Deserialize, Serialize};
    use winit::event_loop::EventLoopProxy;

    use crate::runtime::{Evaluation, EvaluationEvent, EvaluationMode, UserEvent};

    const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    enum DaemonRequest {
        Evaluate {
            source: String,
            module: bool,
            module_path: Option<PathBuf>,
            module_root: Option<PathBuf>,
            print_result: bool,
        },
        Ping,
        Stop,
    }

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    enum DaemonResponse {
        Output { stream: String, text: String },
        Exit { code: i32 },
        Pong { pid: u32 },
    }

    pub struct ServerHandle {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl ServerHandle {
        pub fn shutdown(mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    pub fn serve(proxy: EventLoopProxy<UserEvent>) -> Result<ServerHandle, String> {
        let socket = socket_path();
        let directory = socket
            .parent()
            .expect("daemon socket always has a parent directory");
        let mut builder = DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder
            .create(directory)
            .map_err(|error| format!("failed to create daemon directory: {error}"))?;

        if socket.exists() {
            if ping().is_ok() {
                return Err("daemon is already running".to_owned());
            }
            fs::remove_file(&socket)
                .map_err(|error| format!("failed to remove stale daemon socket: {error}"))?;
        }

        let listener = UnixListener::bind(&socket)
            .map_err(|error| format!("failed to bind {}: {error}", socket.display()))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("failed to configure daemon socket: {error}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let active = Arc::new(AtomicUsize::new(0));
        let listener_stop = stop.clone();
        let listener_active = active.clone();
        let thread = thread::spawn(move || {
            let mut last_activity = Instant::now();
            while !listener_stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        last_activity = Instant::now();
                        let proxy = proxy.clone();
                        let stop = listener_stop.clone();
                        let active = listener_active.clone();
                        active.fetch_add(1, Ordering::Relaxed);
                        thread::spawn(move || {
                            handle_connection(stream, proxy, stop);
                            active.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if listener_active.load(Ordering::Relaxed) == 0
                            && last_activity.elapsed() >= IDLE_TIMEOUT
                        {
                            let _ = proxy.send_event(UserEvent::Exit(0));
                            listener_stop.store(true, Ordering::Relaxed);
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => {
                        eprintln!("ass: daemon listener failed: {error}");
                        let _ = proxy.send_event(UserEvent::Exit(1));
                        break;
                    }
                }
            }
            let _ = fs::remove_file(socket);
        });

        Ok(ServerHandle {
            stop,
            thread: Some(thread),
        })
    }

    /// Handles one daemon client request and streams its runtime events back.
    ///
    /// Triggering workflow:
    ///
    /// [`UnixListener::accept`]
    ///   -> [`serve`]
    ///     -> `DaemonRequest::Evaluate`
    ///       -> [`handle_connection`]
    ///
    /// Upstream:
    /// - [`serve`]
    ///
    /// Downstream:
    /// - [`UserEvent::Evaluate`]
    fn handle_connection(
        mut stream: UnixStream,
        proxy: EventLoopProxy<UserEvent>,
        stop: Arc<AtomicBool>,
    ) {
        let request = {
            let mut line = String::new();
            let mut reader = BufReader::new(&stream);
            if reader.read_line(&mut line).is_err() {
                return;
            }
            match serde_json::from_str::<DaemonRequest>(&line) {
                Ok(request) => request,
                Err(error) => {
                    let _ = write_response(
                        &mut stream,
                        &DaemonResponse::Output {
                            stream: "stderr".to_owned(),
                            text: format!("ass: invalid daemon request: {error}"),
                        },
                    );
                    let _ = write_response(&mut stream, &DaemonResponse::Exit { code: 1 });
                    return;
                }
            }
        };

        match request {
            DaemonRequest::Ping => {
                let _ = write_response(
                    &mut stream,
                    &DaemonResponse::Pong {
                        pid: std::process::id(),
                    },
                );
            }
            DaemonRequest::Stop => {
                let _ = write_response(&mut stream, &DaemonResponse::Exit { code: 0 });
                stop.store(true, Ordering::Relaxed);
                let _ = proxy.send_event(UserEvent::Exit(0));
            }
            DaemonRequest::Evaluate {
                source,
                module,
                module_path,
                module_root,
                print_result,
            } => {
                let (response, receiver) = mpsc::channel();
                let mode = if module {
                    EvaluationMode::Module
                } else {
                    EvaluationMode::Script
                };
                if proxy
                    .send_event(UserEvent::Evaluate(Evaluation {
                        source,
                        mode,
                        module_path,
                        module_root,
                        isolated: true,
                        response,
                    }))
                    .is_err()
                {
                    let _ = write_response(
                        &mut stream,
                        &DaemonResponse::Output {
                            stream: "stderr".to_owned(),
                            text: "ass: daemon runtime stopped".to_owned(),
                        },
                    );
                    let _ = write_response(&mut stream, &DaemonResponse::Exit { code: 1 });
                    return;
                }

                while let Ok(event) = receiver.recv() {
                    match event {
                        EvaluationEvent::Console { level, text } => {
                            let output = DaemonResponse::Output {
                                stream: if matches!(level.as_str(), "warn" | "error") {
                                    "stderr".to_owned()
                                } else {
                                    "stdout".to_owned()
                                },
                                text,
                            };
                            if write_response(&mut stream, &output).is_err() {
                                break;
                            }
                        }
                        EvaluationEvent::Result(result) => {
                            if result.success {
                                if print_result {
                                    let _ = write_response(
                                        &mut stream,
                                        &DaemonResponse::Output {
                                            stream: "stdout".to_owned(),
                                            text: result.display,
                                        },
                                    );
                                }
                            } else {
                                let _ = write_response(
                                    &mut stream,
                                    &DaemonResponse::Output {
                                        stream: "stderr".to_owned(),
                                        text: result.display,
                                    },
                                );
                            }
                            let _ = write_response(
                                &mut stream,
                                &DaemonResponse::Exit {
                                    code: i32::from(!result.success),
                                },
                            );
                            break;
                        }
                    }
                }
            }
        }
    }

    pub fn evaluate(
        source: String,
        module: bool,
        module_path: Option<PathBuf>,
        module_root: Option<PathBuf>,
        print_result: bool,
    ) -> Result<i32, String> {
        ensure_started()?;
        let mut stream = UnixStream::connect(socket_path())
            .map_err(|error| format!("failed to connect to daemon: {error}"))?;
        write_request(
            &mut stream,
            &DaemonRequest::Evaluate {
                source,
                module,
                module_path,
                module_root,
                print_result,
            },
        )?;
        read_client_responses(stream)
    }

    pub fn start() -> Result<u32, String> {
        if let Ok(pid) = ping() {
            return Ok(pid);
        }
        let executable = std::env::current_exe()
            .map_err(|error| format!("failed to locate ass executable: {error}"))?;
        let mut command = Command::new(executable);
        command
            .args(["daemon", "serve"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: this callback only invokes the async-signal-safe `setsid` syscall between
        // `fork` and `exec`, and converts errno without touching shared application state.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        command
            .spawn()
            .map_err(|error| format!("failed to start daemon: {error}"))?;

        for _ in 0..100 {
            if let Ok(pid) = ping() {
                return Ok(pid);
            }
            thread::sleep(Duration::from_millis(20));
        }
        Err("daemon did not become ready".to_owned())
    }

    pub fn status() -> Result<u32, String> {
        ping()
    }

    pub fn stop() -> Result<(), String> {
        let mut stream = UnixStream::connect(socket_path())
            .map_err(|error| format!("daemon is not running: {error}"))?;
        write_request(&mut stream, &DaemonRequest::Stop)?;
        let _ = read_client_responses(stream)?;
        Ok(())
    }

    fn ensure_started() -> Result<(), String> {
        start().map(|_| ())
    }

    fn ping() -> Result<u32, String> {
        let mut stream = UnixStream::connect(socket_path())
            .map_err(|error| format!("daemon is not running: {error}"))?;
        write_request(&mut stream, &DaemonRequest::Ping)?;
        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .map_err(|error| format!("failed to read daemon status: {error}"))?;
        match serde_json::from_str::<DaemonResponse>(&line) {
            Ok(DaemonResponse::Pong { pid }) => Ok(pid),
            Ok(_) => Err("daemon returned an unexpected status response".to_owned()),
            Err(error) => Err(format!("failed to decode daemon status: {error}")),
        }
    }

    fn read_client_responses(stream: UnixStream) -> Result<i32, String> {
        for line in BufReader::new(stream).lines() {
            let line = line.map_err(|error| format!("failed to read daemon response: {error}"))?;
            match serde_json::from_str::<DaemonResponse>(&line)
                .map_err(|error| format!("failed to decode daemon response: {error}"))?
            {
                DaemonResponse::Output { stream, text } if stream == "stderr" => {
                    eprintln!("{text}");
                }
                DaemonResponse::Output { text, .. } => println!("{text}"),
                DaemonResponse::Exit { code } => return Ok(code),
                DaemonResponse::Pong { .. } => {}
            }
        }
        Err("daemon closed the connection without an exit status".to_owned())
    }

    fn write_request(stream: &mut UnixStream, request: &DaemonRequest) -> Result<(), String> {
        serde_json::to_writer(&mut *stream, request)
            .map_err(|error| format!("failed to encode daemon request: {error}"))?;
        stream
            .write_all(b"\n")
            .map_err(|error| format!("failed to send daemon request: {error}"))
    }

    fn write_response(stream: &mut UnixStream, response: &DaemonResponse) -> std::io::Result<()> {
        serde_json::to_writer(&mut *stream, response).map_err(std::io::Error::other)?;
        stream.write_all(b"\n")?;
        stream.flush()
    }

    fn socket_path() -> PathBuf {
        // SAFETY: `geteuid` has no preconditions and does not retain pointers.
        let user = unsafe { libc::geteuid() };
        std::env::temp_dir()
            .join(format!("ass-{user}-{}", env!("CARGO_PKG_VERSION")))
            .join("daemon.sock")
    }
}

#[cfg(unix)]
pub use unix::*;

#[cfg(not(unix))]
mod unsupported {
    use winit::event_loop::EventLoopProxy;

    use crate::runtime::UserEvent;

    pub struct ServerHandle;

    impl ServerHandle {
        pub fn shutdown(self) {}
    }

    pub fn serve(_proxy: EventLoopProxy<UserEvent>) -> Result<ServerHandle, String> {
        Err("daemon mode is not yet supported on this platform".to_owned())
    }
    pub fn evaluate(
        _source: String,
        _module: bool,
        _module_path: Option<std::path::PathBuf>,
        _module_root: Option<std::path::PathBuf>,
        _print_result: bool,
    ) -> Result<i32, String> {
        Err("daemon mode is not yet supported on this platform".to_owned())
    }
    pub fn start() -> Result<u32, String> {
        Err("daemon mode is not yet supported on this platform".to_owned())
    }
    pub fn status() -> Result<u32, String> {
        Err("daemon mode is not yet supported on this platform".to_owned())
    }
    pub fn stop() -> Result<(), String> {
        Err("daemon mode is not yet supported on this platform".to_owned())
    }
}

#[cfg(not(unix))]
pub use unsupported::*;
