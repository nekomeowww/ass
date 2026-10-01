use std::{
    collections::HashMap,
    io::{self, Read},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    codec::{decode_base64, encode_base64},
    error::{NativeError, NativeResult, parse},
    resources::{ChildPipeEvent, ChildProcessResource, Resource, ResourceTable},
};

pub(super) fn execute(
    resources: &ResourceTable,
    realm: u64,
    operation: &str,
    args: Value,
) -> NativeResult {
    let op = format!("child_process.{operation}");
    match operation {
        "exec" => exec(parse(args, &op)?),
        "spawn" => spawn(resources, realm, parse(args, &op)?),
        "read" => read(resources, realm, parse(args, &op)?),
        "write" => write(resources, realm, parse(args, &op)?),
        "closeStdin" => close_stdin(resources, realm, parse(args, &op)?),
        "wait" => wait(resources, realm, parse(args, &op)?),
        "kill" => kill(resources, realm, parse(args, &op)?),
        "close" => close(resources, realm, parse(args, &op)?),
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecArgs {
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    max_buffer: Option<usize>,
    timeout: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnArgs {
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    file: String,
    stderr: Option<String>,
    stdin: Option<String>,
    stdout: Option<String>,
}

#[derive(Deserialize)]
struct ResourceArgs {
    resource: u64,
}

#[derive(Deserialize)]
struct ReadArgs {
    resource: u64,
    stream: String,
}

#[derive(Deserialize)]
struct WriteArgs {
    data: String,
    resource: u64,
}

fn exec(args: ExecArgs) -> NativeResult {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c", &args.command]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", &args.command]);
        command
    };
    configure_command(&mut command, args.cwd, args.env);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| NativeError::io(error, "spawn", None))?;
    let max_buffer = args.max_buffer.unwrap_or(1024 * 1024);
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take().expect("piped child stdout");
    let stderr = child.stderr.take().expect("piped child stderr");
    let stdout_overflow = overflow.clone();
    let stderr_overflow = overflow.clone();
    let stdout = thread::spawn(move || read_bounded(stdout, max_buffer, stdout_overflow));
    let stderr = thread::spawn(move || read_bounded(stderr, max_buffer, stderr_overflow));
    let deadline = args
        .timeout
        .filter(|timeout| *timeout > 0)
        .map(|timeout| Instant::now() + Duration::from_millis(timeout));
    let mut timed_out = false;
    let status = loop {
        if overflow.load(Ordering::Acquire) || deadline.is_some_and(|value| Instant::now() >= value)
        {
            timed_out = !overflow.load(Ordering::Acquire);
            let _ = terminate_exec_child(&mut child);
            break child
                .wait()
                .map_err(|error| NativeError::io(error, "wait", None))?;
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| NativeError::io(error, "wait", None))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout
        .join()
        .map_err(|_| NativeError::new("ERR_ASS_NATIVE_PANIC", "stdout reader panicked"))?
        .map_err(|error| NativeError::io(error, "read", None))?;
    let stderr = stderr
        .join()
        .map_err(|_| NativeError::new("ERR_ASS_NATIVE_PANIC", "stderr reader panicked"))?
        .map_err(|error| NativeError::io(error, "read", None))?;
    let overflow = overflow.load(Ordering::Acquire);
    let killed = overflow || timed_out;
    Ok(json!({
        "code": status.code(),
        "errorCode": if overflow { Some("ERR_CHILD_PROCESS_STDIO_MAXBUFFER") } else { None },
        "killed": killed,
        "signal": if killed { Some("SIGTERM") } else { None },
        "stderr": encode_base64(stderr),
        "stdout": encode_base64(stdout),
        "success": status.success() && !killed,
    }))
}

#[cfg(unix)]
fn terminate_exec_child(child: &mut std::process::Child) -> io::Result<()> {
    // SAFETY: `child.id()` is the live process identifier returned by spawn,
    // and `kill` does not retain the pointer-free integer arguments.
    let result = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn terminate_exec_child(child: &mut std::process::Child) -> io::Result<()> {
    child.kill()
}

fn read_bounded(
    mut reader: impl Read,
    limit: usize,
    overflow: Arc<AtomicBool>,
) -> io::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let length = reader.read(&mut buffer)?;
        if length == 0 {
            return Ok(output);
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..length.min(remaining)]);
        if length > remaining {
            overflow.store(true, Ordering::Release);
        }
    }
}

fn spawn(resources: &ResourceTable, realm: u64, args: SpawnArgs) -> NativeResult {
    let mut command = Command::new(&args.file);
    command.args(args.args);
    configure_command(&mut command, args.cwd, args.env);
    command.stdin(stdio(args.stdin.as_deref()));
    command.stdout(stdio(args.stdout.as_deref()));
    command.stderr(stdio(args.stderr.as_deref()));
    let child = command
        .spawn()
        .map_err(|error| NativeError::io(error, "spawn", Some(args.file)))?;
    let (resource, pid) = resources.insert_child(realm, child);
    Ok(json!({ "pid": pid, "resource": resource }))
}

fn read(resources: &ResourceTable, realm: u64, args: ReadArgs) -> NativeResult {
    let process = process(resources, realm, args.resource)?;
    let reader = match args.stream.as_str() {
        "stdout" => process.stdout.as_ref(),
        "stderr" => process.stderr.as_ref(),
        _ => {
            return Err(NativeError::invalid_arguments(
                "child_process.read",
                "stream must be stdout or stderr",
            ));
        }
    }
    .ok_or_else(|| stream_error(args.resource, &args.stream))?;
    match reader.try_read()? {
        Some(ChildPipeEvent::Data(buffer)) => {
            Ok(json!({ "base64": encode_base64(buffer), "eof": false, "pending": false }))
        }
        Some(ChildPipeEvent::Eof) => Ok(json!({ "base64": "", "eof": true, "pending": false })),
        Some(ChildPipeEvent::Error(error)) => Err(NativeError::io(error, "read", None)),
        None => Ok(json!({ "eof": false, "pending": true })),
    }
}

fn write(resources: &ResourceTable, realm: u64, args: WriteArgs) -> NativeResult {
    let process = process(resources, realm, args.resource)?;
    let bytes = decode_base64(&args.data)
        .map_err(|error| NativeError::invalid_arguments("child_process.write", error))?;
    let stdin = process
        .stdin
        .as_ref()
        .ok_or_else(|| stream_error(args.resource, "stdin"))?;
    let length = bytes.len();
    let queued = stdin.try_write(bytes)?;
    Ok(json!({
        "bytesWritten": if queued { length } else { 0 },
        "pending": !queued,
    }))
}

fn close_stdin(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let process = process(resources, realm, args.resource)?;
    let stdin = process
        .stdin
        .as_ref()
        .ok_or_else(|| stream_error(args.resource, "stdin"))?;
    Ok(json!({ "pending": !stdin.try_close()? }))
}

fn wait(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let process = process(resources, realm, args.resource)?;
    if process.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    let status = process
        .child
        .lock()
        .expect("child process lock")
        .try_wait()
        .map_err(|error| NativeError::io(error, "wait", None))?;
    Ok(status.map_or_else(
        || json!({ "pending": true }),
        |status| json!({ "code": status.code(), "pending": false, "success": status.success() }),
    ))
}

fn kill(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let process = process(resources, realm, args.resource)?;
    process
        .child
        .lock()
        .expect("child process lock")
        .kill()
        .map(|()| json!({ "killed": true }))
        .map_err(|error| NativeError::io(error, "kill", None))
}

fn close(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    resources.close(realm, args.resource)?;
    Ok(Value::Null)
}

fn configure_command(
    command: &mut Command,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) {
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = env {
        command.envs(env);
    }
}

fn stdio(value: Option<&str>) -> Stdio {
    match value.unwrap_or("pipe") {
        "ignore" => Stdio::null(),
        "inherit" => Stdio::inherit(),
        _ => Stdio::piped(),
    }
}

fn process(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<Arc<ChildProcessResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::ChildProcess(process) => Ok(process),
        _ => Err(NativeError {
            code: "ERR_INVALID_HANDLE_TYPE".to_owned(),
            message: format!("native resource {id} is not a child process"),
            path: None,
            syscall: Some("resource".to_owned()),
        }),
    }
}

fn stream_error(id: u64, stream: &str) -> NativeError {
    NativeError {
        code: "ERR_INVALID_HANDLE_TYPE".to_owned(),
        message: format!("child process resource {id} has no piped {stream}"),
        path: None,
        syscall: Some(stream.to_owned()),
    }
}

fn closed_error(id: u64) -> NativeError {
    NativeError {
        code: "ERR_ASS_RESOURCE_CLOSED".to_owned(),
        message: format!("child process resource {id} was closed"),
        path: None,
        syscall: Some("wait".to_owned()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{ExecArgs, exec};

    #[test]
    fn exec_enforces_timeout() {
        let result = exec(ExecArgs {
            command: "trap 'exit 42' TERM; while :; do :; done".to_owned(),
            cwd: None,
            env: None,
            max_buffer: Some(1024),
            timeout: Some(10),
        })
        .expect("timeout should retain the child result");
        assert_eq!(result["code"], 42);
        assert_eq!(result["killed"], true);
        assert_eq!(result["signal"], "SIGTERM");
    }

    #[test]
    fn exec_enforces_max_buffer() {
        let result = exec(ExecArgs {
            command: "printf 123456789".to_owned(),
            cwd: None,
            env: None,
            max_buffer: Some(4),
            timeout: None,
        })
        .expect("maxBuffer should retain captured output");
        assert_eq!(result["errorCode"], "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
        assert_eq!(result["stdout"], "MTIzNA==");
    }
}
