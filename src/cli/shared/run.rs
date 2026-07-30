use std::{
    fs,
    io::{self, BufRead, IsTerminal, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    sync::mpsc,
    thread,
};

use crate::{
    cli::{Cli, Command as CliCommand, DaemonCommand, commands::daemon},
    processors::transpile,
    runtime::{Evaluation, EvaluationEvent, EvaluationMode, EvaluationResult, Runtime, UserEvent},
};
use clap::Parser;
use winit::event_loop::{EventLoop, EventLoopProxy};

enum InputMode {
    Once {
        source: String,
        path: Option<PathBuf>,
        root: Option<PathBuf>,
        typescript: bool,
        module: bool,
        print_result: bool,
    },
    Repl {
        typescript: bool,
        module: bool,
    },
}

pub(crate) fn run() -> ExitCode {
    let mut cli = Cli::parse();
    if let Some(command) = cli.command.take() {
        return run_daemon_command(command);
    }
    let reuse = cli.reuse;
    let mode = match input_mode(cli) {
        Ok(mode) => mode,
        Err(error) => {
            eprintln!("ass: {error}");
            return ExitCode::FAILURE;
        }
    };

    if reuse {
        return run_reused(mode);
    }

    #[cfg(target_os = "linux")]
    if let Err(error) = gtk::init() {
        eprintln!("ass: failed to initialize GTK: {error}");
        return ExitCode::FAILURE;
    }

    let event_loop = match EventLoop::<UserEvent>::with_user_event().build() {
        Ok(event_loop) => event_loop,
        Err(error) => {
            eprintln!("ass: failed to initialize event loop: {error}");
            return ExitCode::FAILURE;
        }
    };
    let proxy = event_loop.create_proxy();
    let (initial_evaluation, controller) = match mode {
        InputMode::Once {
            source,
            path,
            root,
            typescript,
            module,
            print_result,
        } => {
            let source = match prepare_once_source(source, path.as_deref(), typescript, module) {
                Ok(source) => source,
                Err(error) => {
                    eprintln!("ass: {error}");
                    return ExitCode::FAILURE;
                }
            };
            let (response, receiver) = mpsc::channel();
            let evaluation = Evaluation {
                source,
                mode: evaluation_mode(module),
                module_path: if module { path } else { None },
                module_root: if module { root } else { None },
                isolated: false,
                response,
            };
            let controller = thread::spawn(move || {
                let code = finish_once(receiver, print_result);
                let _ = proxy.send_event(UserEvent::Exit(code));
            });
            (Some(evaluation), controller)
        }
        InputMode::Repl { typescript, module } => {
            let controller = thread::spawn(move || {
                let code = run_repl(&proxy, typescript, module);
                let _ = proxy.send_event(UserEvent::Exit(code));
            });
            (None, controller)
        }
    };
    let mut runtime = Runtime::new(event_loop.create_proxy(), initial_evaluation);

    if let Err(error) = event_loop.run_app(&mut runtime) {
        eprintln!("ass: event loop failed: {error}");
        return ExitCode::FAILURE;
    }
    let exit_code = runtime.exit_code();
    drop(runtime);
    let _ = controller.join();
    ExitCode::from(exit_code as u8)
}

/// Dispatches daemon lifecycle commands before any WebView is initialized.
///
/// Triggering workflow:
///
/// [`Cli::parse`]
///   -> [`CliCommand::Daemon`]
///     -> `daemon.start|status|stop|serve`
///       -> [`run_daemon_command`]
///
/// Upstream:
/// - [`run`]
///
/// Downstream:
/// - [`daemon::start`], [`daemon::status`], [`daemon::stop`], or [`run_daemon_server`]
fn run_daemon_command(command: CliCommand) -> ExitCode {
    let CliCommand::Daemon { action } = command;
    let result = match action {
        DaemonCommand::Start => daemon::start().map(|pid| {
            println!("ass daemon running (pid {pid})");
        }),
        DaemonCommand::Status => daemon::status().map(|pid| {
            println!("ass daemon running (pid {pid})");
        }),
        DaemonCommand::Stop => daemon::stop().map(|()| {
            println!("ass daemon stopped");
        }),
        DaemonCommand::Serve => return run_daemon_server(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ass: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run_daemon_server() -> ExitCode {
    #[cfg(target_os = "linux")]
    if let Err(error) = gtk::init() {
        eprintln!("ass: failed to initialize GTK: {error}");
        return ExitCode::FAILURE;
    }

    let event_loop = match EventLoop::<UserEvent>::with_user_event().build() {
        Ok(event_loop) => event_loop,
        Err(error) => {
            eprintln!("ass: failed to initialize daemon event loop: {error}");
            return ExitCode::FAILURE;
        }
    };
    let server = match daemon::serve(event_loop.create_proxy()) {
        Ok(server) => server,
        Err(error) => {
            eprintln!("ass: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut runtime = Runtime::new(event_loop.create_proxy(), None);
    let result = event_loop.run_app(&mut runtime);
    let exit_code = runtime.exit_code();
    drop(runtime);
    server.shutdown();

    if let Err(error) = result {
        eprintln!("ass: daemon event loop failed: {error}");
        ExitCode::FAILURE
    } else {
        ExitCode::from(exit_code as u8)
    }
}

fn run_reused(mode: InputMode) -> ExitCode {
    let InputMode::Once {
        source,
        path,
        root,
        typescript,
        module,
        print_result,
    } = mode
    else {
        eprintln!("ass: --reuse requires -e, -p, a file, or piped input");
        return ExitCode::FAILURE;
    };
    let source = match prepare_once_source(source, path.as_deref(), typescript, module) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("ass: {error}");
            return ExitCode::FAILURE;
        }
    };
    let module_path = if module { path } else { None };
    let module_root = if module { root } else { None };
    match daemon::evaluate(source, module, module_path, module_root, print_result) {
        Ok(code) => ExitCode::from(code as u8),
        Err(error) => {
            eprintln!("ass: {error}");
            ExitCode::FAILURE
        }
    }
}

fn input_mode(cli: Cli) -> Result<InputMode, String> {
    if let Some(source) = cli.eval {
        let module = cli.module || transpile::is_module_source(&source, cli.typescript);
        return Ok(InputMode::Once {
            source,
            path: None,
            root: None,
            typescript: cli.typescript,
            module,
            print_result: false,
        });
    }
    if let Some(source) = cli.print {
        let module = cli.module || transpile::is_module_source(&source, cli.typescript);
        return Ok(InputMode::Once {
            source,
            path: None,
            root: None,
            typescript: cli.typescript,
            module,
            print_result: true,
        });
    }
    if let Some(path) = cli.file {
        let path = fs::canonicalize(&path)
            .map_err(|error| format!("failed to resolve {}: {error}", path.display()))?;
        let source = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        let typescript = cli.typescript || transpile::is_typescript_path(&path);
        let module =
            cli.module || is_module_path(&path) || transpile::is_module_source(&source, typescript);
        let root = std::env::current_dir()
            .and_then(fs::canonicalize)
            .ok()
            .filter(|root| path.starts_with(root))
            .or_else(|| path.parent().map(Path::to_path_buf));
        return Ok(InputMode::Once {
            source,
            path: Some(path),
            root,
            typescript,
            module,
            print_result: false,
        });
    }
    if !io::stdin().is_terminal() {
        let mut source = String::new();
        io::stdin()
            .read_to_string(&mut source)
            .map_err(|error| format!("failed to read stdin: {error}"))?;
        let module = cli.module || transpile::is_module_source(&source, cli.typescript);
        return Ok(InputMode::Once {
            source,
            path: None,
            root: None,
            typescript: cli.typescript,
            module,
            print_result: false,
        });
    }
    Ok(InputMode::Repl {
        typescript: cli.typescript,
        module: cli.module,
    })
}

fn is_module_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("mjs" | "mts")
    )
}

fn finish_once(receiver: mpsc::Receiver<EvaluationEvent>, print_result: bool) -> i32 {
    loop {
        match receiver.recv() {
            Ok(EvaluationEvent::Console { level, text }) => print_console(&level, &text),
            Ok(EvaluationEvent::Result(result)) if result.success => {
                if print_result {
                    println!("{}", result.display);
                }
                return 0;
            }
            Ok(EvaluationEvent::Result(result)) => {
                eprintln!("{}", result.display);
                return 1;
            }
            Err(_) => {
                eprintln!("ass: runtime stopped before evaluation completed");
                return 1;
            }
        }
    }
}

fn print_console(level: &str, text: &str) {
    if matches!(level, "warn" | "error") {
        eprintln!("{text}");
    } else {
        println!("{text}");
    }
}

fn run_repl(proxy: &EventLoopProxy<UserEvent>, typescript: bool, module: bool) -> i32 {
    println!(
        "ass {} — system WebView JavaScript{}",
        env!("CARGO_PKG_VERSION"),
        if typescript { "/TypeScript" } else { "" }
    );
    println!("Type .exit or press Ctrl-D to leave.");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    loop {
        print!("> ");
        let _ = io::stdout().flush();
        let Some(line) = lines.next() else {
            println!();
            return 0;
        };
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("ass: failed to read input: {error}");
                return 1;
            }
        };
        if line.trim() == ".exit" {
            return 0;
        }
        if line.trim().is_empty() {
            continue;
        }
        let line_is_module = module || transpile::is_module_source(&line, typescript);
        let source = match transpile::transpile_repl(&line, typescript) {
            Ok(source) => source,
            Err(error) => {
                eprintln!("ass: {error}");
                continue;
            }
        };
        match evaluate(proxy, source, evaluation_mode(line_is_module)) {
            Ok(result) if result.success => println!("{}", result.display),
            Ok(result) => eprintln!("{}", result.display),
            Err(error) => {
                eprintln!("ass: {error}");
                return 1;
            }
        }
    }
}

fn prepare_source(source: String, path: Option<&Path>, typescript: bool) -> Result<String, String> {
    if typescript {
        transpile::transpile_typescript(&source, path)
    } else {
        Ok(source)
    }
}

fn prepare_once_source(
    source: String,
    path: Option<&Path>,
    typescript: bool,
    module: bool,
) -> Result<String, String> {
    if module && path.is_some() {
        Ok(source)
    } else {
        prepare_source(source, path, typescript)
    }
}

fn evaluation_mode(module: bool) -> EvaluationMode {
    if module {
        EvaluationMode::Module
    } else {
        EvaluationMode::Script
    }
}

fn evaluate(
    proxy: &EventLoopProxy<UserEvent>,
    source: String,
    mode: EvaluationMode,
) -> Result<EvaluationResult, String> {
    let (response, receiver) = mpsc::channel();
    proxy
        .send_event(UserEvent::Evaluate(Evaluation {
            source,
            mode,
            module_path: None,
            module_root: None,
            isolated: false,
            response,
        }))
        .map_err(|_| "runtime stopped before evaluation was submitted".to_owned())?;
    loop {
        match receiver.recv() {
            Ok(EvaluationEvent::Console { level, text }) => print_console(&level, &text),
            Ok(EvaluationEvent::Result(result)) => return Ok(result),
            Err(_) => return Err("runtime stopped before evaluation completed".to_owned()),
        }
    }
}
