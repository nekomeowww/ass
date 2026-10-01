use std::{
    io,
    net::{SocketAddr, UdpSocket},
    sync::{Arc, atomic::Ordering},
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    codec::{decode_base64, encode_base64},
    error::{NativeError, NativeResult, parse},
    resources::{Resource, ResourceTable, UdpSocketResource},
};

pub(super) fn execute(
    resources: &ResourceTable,
    realm: u64,
    operation: &str,
    args: Value,
) -> NativeResult {
    let op = format!("dgram.{operation}");
    match operation {
        "bind" => bind(resources, realm, parse(args, &op)?),
        "connect" => connect(resources, realm, parse(args, &op)?),
        "receive" => receive(resources, realm, parse(args, &op)?),
        "send" => send(resources, realm, parse(args, &op)?),
        "setBroadcast" => set_broadcast(resources, realm, parse(args, &op)?),
        "setTtl" => set_ttl(resources, realm, parse(args, &op)?),
        "close" => close(resources, realm, parse(args, &op)?),
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

#[derive(Deserialize)]
struct BindArgs {
    address: String,
    port: u16,
}

#[derive(Deserialize)]
struct ConnectArgs {
    address: String,
    port: u16,
    resource: u64,
}

#[derive(Deserialize)]
struct ResourceArgs {
    resource: u64,
}

#[derive(Deserialize)]
struct SendArgs {
    address: Option<String>,
    data: String,
    port: Option<u16>,
    resource: u64,
}

#[derive(Deserialize)]
struct BooleanArgs {
    resource: u64,
    value: bool,
}

#[derive(Deserialize)]
struct TtlArgs {
    resource: u64,
    value: u32,
}

fn bind(resources: &ResourceTable, realm: u64, args: BindArgs) -> NativeResult {
    let socket = UdpSocket::bind((args.address.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "bind", Some(args.address.clone())))?;
    socket
        .set_nonblocking(true)
        .map_err(|error| NativeError::io(error, "fcntl", None))?;
    let address = socket
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let resource = resources.insert_udp_socket(realm, socket);
    Ok(json!({ "address": address_value(address), "resource": resource }))
}

fn connect(resources: &ResourceTable, realm: u64, args: ConnectArgs) -> NativeResult {
    let socket = socket(resources, realm, args.resource)?;
    socket
        .socket
        .connect((args.address.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "connect", Some(args.address.clone())))?;
    let remote = socket
        .socket
        .peer_addr()
        .map_err(|error| NativeError::io(error, "getpeername", None))?;
    Ok(json!({ "remote": address_value(remote) }))
}

fn receive(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let socket = socket(resources, realm, args.resource)?;
    let mut buffer = vec![0_u8; 65_536];
    if socket.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    match socket.socket.recv_from(&mut buffer) {
        Ok((length, remote)) => {
            buffer.truncate(length);
            Ok(json!({
                "base64": encode_base64(buffer),
                "pending": false,
                "remote": address_value(remote),
                "size": length,
            }))
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(json!({ "pending": true }))
        }
        Err(error) => Err(NativeError::io(error, "recvfrom", None)),
    }
}

fn send(resources: &ResourceTable, realm: u64, args: SendArgs) -> NativeResult {
    let socket = socket(resources, realm, args.resource)?;
    let bytes = decode_base64(&args.data)
        .map_err(|error| NativeError::invalid_arguments("dgram.send", error))?;
    let result = match (args.address, args.port) {
        (Some(address), Some(port)) => socket.socket.send_to(&bytes, (address.as_str(), port)),
        (None, None) => socket.socket.send(&bytes),
        _ => {
            return Err(NativeError::invalid_arguments(
                "dgram.send",
                "address and port must be provided together",
            ));
        }
    };
    result
        .map(|bytes| json!({ "bytesWritten": bytes }))
        .map_err(|error| NativeError::io(error, "send", None))
}

fn set_broadcast(resources: &ResourceTable, realm: u64, args: BooleanArgs) -> NativeResult {
    socket(resources, realm, args.resource)?
        .socket
        .set_broadcast(args.value)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "setsockopt", None))
}

fn set_ttl(resources: &ResourceTable, realm: u64, args: TtlArgs) -> NativeResult {
    socket(resources, realm, args.resource)?
        .socket
        .set_ttl(args.value)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "setsockopt", None))
}

fn close(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    resources.close(realm, args.resource)?;
    Ok(Value::Null)
}

fn socket(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<Arc<UdpSocketResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::UdpSocket(socket) => Ok(socket),
        Resource::ChildProcess(_)
        | Resource::TcpListener(_)
        | Resource::TcpStream(_)
        | Resource::TlsAccepted(_)
        | Resource::TlsListener(_)
        | Resource::TlsStream(_) => Err(NativeError {
            code: "ERR_INVALID_HANDLE_TYPE".to_owned(),
            message: format!("native resource {id} is not a UDP socket"),
            path: None,
            syscall: Some("resource".to_owned()),
        }),
    }
}

fn address_value(address: SocketAddr) -> Value {
    json!({
        "address": address.ip().to_string(),
        "family": if address.is_ipv4() { "IPv4" } else { "IPv6" },
        "port": address.port(),
    })
}

fn closed_error(id: u64) -> NativeError {
    NativeError {
        code: "ERR_ASS_RESOURCE_CLOSED".to_owned(),
        message: format!("native resource {id} was closed"),
        path: None,
        syscall: Some("resource".to_owned()),
    }
}
