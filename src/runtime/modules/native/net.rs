use std::{
    io::{self, Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::atomic::Ordering,
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    codec::{decode_base64, encode_base64},
    error::{NativeError, NativeResult, parse},
    resources::{Resource, ResourceTable, TcpListenerResource, TcpStreamResource},
};

pub(super) fn execute(
    resources: &ResourceTable,
    realm: u64,
    operation: &str,
    args: Value,
) -> NativeResult {
    let op = format!("net.{operation}");
    match operation {
        "connect" => connect(resources, realm, parse(args, &op)?),
        "listen" => listen(resources, realm, parse(args, &op)?),
        "accept" => accept(resources, realm, parse(args, &op)?),
        "read" => read(resources, realm, parse(args, &op)?),
        "write" => write(resources, realm, parse(args, &op)?),
        "shutdownWrite" => shutdown_write(resources, realm, parse(args, &op)?),
        "setNoDelay" => set_no_delay(resources, realm, parse(args, &op)?),
        "close" => close(resources, realm, parse(args, &op)?),
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectArgs {
    host: String,
    no_delay: Option<bool>,
    port: u16,
}

#[derive(Deserialize)]
struct ListenArgs {
    host: String,
    port: u16,
}

#[derive(Deserialize)]
struct ResourceArgs {
    resource: u64,
}

#[derive(Deserialize)]
struct WriteArgs {
    data: String,
    resource: u64,
}

#[derive(Deserialize)]
struct BooleanArgs {
    resource: u64,
    value: bool,
}

fn connect(resources: &ResourceTable, realm: u64, args: ConnectArgs) -> NativeResult {
    let stream = TcpStream::connect((args.host.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "connect", Some(args.host.clone())))?;
    stream
        .set_nodelay(args.no_delay.unwrap_or(false))
        .map_err(|error| NativeError::io(error, "setsockopt", None))?;
    stream
        .set_nonblocking(true)
        .map_err(|error| NativeError::io(error, "fcntl", None))?;
    let local = stream
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let remote = stream
        .peer_addr()
        .map_err(|error| NativeError::io(error, "getpeername", None))?;
    let resource = resources.insert_stream(realm, stream);
    Ok(json!({
        "local": address_value(local),
        "remote": address_value(remote),
        "resource": resource,
    }))
}

fn listen(resources: &ResourceTable, realm: u64, args: ListenArgs) -> NativeResult {
    let listener = TcpListener::bind((args.host.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "listen", Some(args.host.clone())))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| NativeError::io(error, "fcntl", None))?;
    let address = listener
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let resource = resources.insert_listener(realm, listener);
    Ok(json!({ "address": address_value(address), "resource": resource }))
}

fn accept(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let listener = listener(resources, realm, args.resource)?;
    if listener.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    match listener.listener.accept() {
        Ok((stream, remote)) => {
            stream
                .set_nonblocking(true)
                .map_err(|error| NativeError::io(error, "fcntl", None))?;
            let local = stream
                .local_addr()
                .map_err(|error| NativeError::io(error, "getsockname", None))?;
            let resource = resources.insert_stream(realm, stream);
            Ok(json!({
                "local": address_value(local),
                "pending": false,
                "remote": address_value(remote),
                "resource": resource,
            }))
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(json!({ "pending": true }))
        }
        Err(error) => Err(NativeError::io(error, "accept", None)),
    }
}

fn read(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    let mut buffer = vec![0_u8; 64 * 1024];
    if stream.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    let mut socket = &stream.stream;
    match socket.read(&mut buffer) {
        Ok(0) => Ok(json!({ "base64": "", "eof": true })),
        Ok(length) => {
            buffer.truncate(length);
            Ok(json!({ "base64": encode_base64(buffer), "eof": false }))
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(json!({ "eof": false, "pending": true }))
        }
        Err(error) => Err(NativeError::io(error, "read", None)),
    }
}

fn write(resources: &ResourceTable, realm: u64, args: WriteArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    let bytes = decode_base64(&args.data)
        .map_err(|error| NativeError::invalid_arguments("net.write", error))?;
    let mut socket = &stream.stream;
    match socket.write(&bytes) {
        Ok(length) => Ok(json!({ "bytesWritten": length, "pending": false })),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(json!({ "bytesWritten": 0, "pending": true }))
        }
        Err(error) => Err(NativeError::io(error, "write", None)),
    }
}

fn shutdown_write(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    stream
        .stream
        .shutdown(Shutdown::Write)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "shutdown", None))
}

fn set_no_delay(resources: &ResourceTable, realm: u64, args: BooleanArgs) -> NativeResult {
    stream(resources, realm, args.resource)?
        .stream
        .set_nodelay(args.value)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "setsockopt", None))
}

fn close(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    resources.close(realm, args.resource)?;
    Ok(Value::Null)
}

fn listener(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<std::sync::Arc<TcpListenerResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::TcpListener(listener) => Ok(listener),
        Resource::ChildProcess(_)
        | Resource::TcpStream(_)
        | Resource::TlsAccepted(_)
        | Resource::TlsListener(_)
        | Resource::TlsStream(_)
        | Resource::UdpSocket(_) => Err(type_error(id, "TCP listener")),
    }
}

fn stream(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<std::sync::Arc<TcpStreamResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::TcpStream(stream) => Ok(stream),
        Resource::ChildProcess(_)
        | Resource::TcpListener(_)
        | Resource::TlsAccepted(_)
        | Resource::TlsListener(_)
        | Resource::TlsStream(_)
        | Resource::UdpSocket(_) => Err(type_error(id, "TCP stream")),
    }
}

fn address_value(address: SocketAddr) -> Value {
    json!({
        "address": address.ip().to_string(),
        "family": if address.is_ipv4() { "IPv4" } else { "IPv6" },
        "port": address.port(),
    })
}

fn type_error(id: u64, expected: &str) -> NativeError {
    NativeError {
        code: "ERR_INVALID_HANDLE_TYPE".to_owned(),
        message: format!("native resource {id} is not a {expected}"),
        path: None,
        syscall: Some("resource".to_owned()),
    }
}

fn closed_error(id: u64) -> NativeError {
    NativeError {
        code: "ERR_ASS_RESOURCE_CLOSED".to_owned(),
        message: format!("native resource {id} was closed"),
        path: None,
        syscall: Some("resource".to_owned()),
    }
}
