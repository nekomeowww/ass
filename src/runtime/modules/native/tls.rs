use std::{
    io::{self, BufReader, Cursor, Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};

use rustls::{
    ClientConfig, ClientConnection, RootCertStore, ServerConfig, ServerConnection, StreamOwned,
    pki_types::{CertificateDer, PrivateKeyDer, ServerName},
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    codec::{decode_base64, encode_base64},
    error::{NativeError, NativeResult, parse},
    resources::{
        Resource, ResourceTable, TlsAcceptedResource, TlsListenerResource, TlsStream,
        TlsStreamResource,
    },
};

pub(super) fn execute(
    resources: &ResourceTable,
    realm: u64,
    operation: &str,
    args: Value,
) -> NativeResult {
    let op = format!("tls.{operation}");
    match operation {
        "connect" => connect(resources, realm, parse(args, &op)?),
        "listen" => listen(resources, realm, parse(args, &op)?),
        "accept" => accept(resources, realm, parse(args, &op)?),
        "handshake" => handshake(resources, realm, parse(args, &op)?),
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
    alpn_protocols: Option<Vec<String>>,
    ca: Option<String>,
    cert: Option<String>,
    host: String,
    key: Option<String>,
    port: u16,
    servername: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListenArgs {
    alpn_protocols: Option<Vec<String>>,
    cert: String,
    host: String,
    key: String,
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
    let mut roots = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    if let Some(ca) = args.ca {
        for certificate in certificates(&ca)? {
            roots
                .add(certificate)
                .map_err(|error| tls_error("add CA", error))?;
        }
    }
    let builder = ClientConfig::builder().with_root_certificates(roots);
    let mut config = match (args.cert, args.key) {
        (Some(cert), Some(key)) => builder
            .with_client_auth_cert(certificates(&cert)?, private_key(&key)?)
            .map_err(|error| tls_error("configure client certificate", error))?,
        (None, None) => builder.with_no_client_auth(),
        _ => {
            return Err(NativeError::invalid_arguments(
                "tls.connect",
                "cert and key must be provided together",
            ));
        }
    };
    config.alpn_protocols = alpn_protocols(args.alpn_protocols);
    let servername = args.servername.unwrap_or_else(|| args.host.clone());
    let server_name = ServerName::try_from(servername.clone())
        .map_err(|error| tls_error("validate server name", error))?;
    let connection = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|error| tls_error("create client connection", error))?;
    let socket = TcpStream::connect((args.host.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "connect", Some(args.host.clone())))?;
    configure_handshake_socket(&socket)?;
    let mut stream = StreamOwned::new(connection, socket);
    complete_client_handshake(&mut stream)?;
    configure_stream_socket(&stream.sock)?;
    let local = stream
        .sock
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let remote = stream
        .sock
        .peer_addr()
        .map_err(|error| NativeError::io(error, "getpeername", None))?;
    let metadata = client_metadata(&stream.conn);
    let resource = resources.insert_tls_stream(realm, TlsStream::Client(stream));
    Ok(
        json!({ "local": address_value(local), "remote": address_value(remote), "resource": resource, "tls": metadata }),
    )
}

fn listen(resources: &ResourceTable, realm: u64, args: ListenArgs) -> NativeResult {
    let mut config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificates(&args.cert)?, private_key(&args.key)?)
        .map_err(|error| tls_error("configure server certificate", error))?;
    config.alpn_protocols = alpn_protocols(args.alpn_protocols);
    let listener = TcpListener::bind((args.host.as_str(), args.port))
        .map_err(|error| NativeError::io(error, "listen", Some(args.host.clone())))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| NativeError::io(error, "fcntl", None))?;
    let address = listener
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let resource = resources.insert_tls_listener(realm, listener, Arc::new(config));
    Ok(json!({ "address": address_value(address), "resource": resource }))
}

fn accept(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let listener = listener(resources, realm, args.resource)?;
    if listener.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    match listener.listener.accept() {
        Ok((socket, _)) => {
            socket
                .set_nonblocking(false)
                .map_err(|error| NativeError::io(error, "fcntl", None))?;
            configure_handshake_socket(&socket)?;
            let resource = resources.insert_tls_accepted(realm, socket, listener.config.clone());
            Ok(json!({ "pending": false, "resource": resource }))
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

fn handshake(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let accepted = accepted(resources, realm, args.resource)?;
    if accepted.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    let socket = accepted
        .socket
        .try_clone()
        .map_err(|error| NativeError::io(error, "dup", None))?;
    let remote = socket
        .peer_addr()
        .map_err(|error| NativeError::io(error, "getpeername", None))?;
    let connection = ServerConnection::new(accepted.config.clone())
        .map_err(|error| tls_error("create server connection", error))?;
    let mut stream = StreamOwned::new(connection, socket);
    complete_server_handshake(&mut stream)?;
    configure_stream_socket(&stream.sock)?;
    if accepted.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    let local = stream
        .sock
        .local_addr()
        .map_err(|error| NativeError::io(error, "getsockname", None))?;
    let metadata = server_metadata(&stream.conn);
    resources.replace_with_tls_stream(realm, args.resource, TlsStream::Server(stream))?;
    Ok(
        json!({ "local": address_value(local), "remote": address_value(remote), "resource": args.resource, "tls": metadata }),
    )
}

fn read(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    let mut buffer = vec![0_u8; 64 * 1024];
    if stream.closed.load(Ordering::Acquire) {
        return Err(closed_error(args.resource));
    }
    let result = {
        let mut stream = stream.stream.lock().expect("TLS stream lock");
        match &mut *stream {
            TlsStream::Client(stream) => stream.read(&mut buffer),
            TlsStream::Server(stream) => stream.read(&mut buffer),
        }
    };
    match result {
        Ok(0) => Ok(json!({ "base64": "", "eof": true })),
        Ok(length) => {
            buffer.truncate(length);
            Ok(json!({ "base64": encode_base64(buffer), "eof": false }))
        }
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
            Ok(json!({ "base64": "", "eof": true }))
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
        .map_err(|error| NativeError::invalid_arguments("tls.write", error))?;
    let mut stream = stream.stream.lock().expect("TLS stream lock");
    let result = match &mut *stream {
        TlsStream::Client(stream) => write_nonblocking(stream, &bytes),
        TlsStream::Server(stream) => write_nonblocking(stream, &bytes),
    };
    match result {
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

fn write_nonblocking(stream: &mut impl Write, bytes: &[u8]) -> io::Result<usize> {
    let length = stream.write(bytes)?;
    match stream.flush() {
        Ok(()) => Ok(length),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(length),
        Err(error) => Err(error),
    }
}

fn shutdown_write(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    let mut stream = stream.stream.lock().expect("TLS stream lock");
    let result = match &mut *stream {
        TlsStream::Client(stream) => {
            stream.conn.send_close_notify();
            stream
                .flush()
                .and_then(|()| stream.sock.shutdown(Shutdown::Write))
        }
        TlsStream::Server(stream) => {
            stream.conn.send_close_notify();
            stream
                .flush()
                .and_then(|()| stream.sock.shutdown(Shutdown::Write))
        }
    };
    result
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "shutdown", None))
}

fn set_no_delay(resources: &ResourceTable, realm: u64, args: BooleanArgs) -> NativeResult {
    let stream = stream(resources, realm, args.resource)?;
    let stream = stream.stream.lock().expect("TLS stream lock");
    let result = match &*stream {
        TlsStream::Client(stream) => stream.sock.set_nodelay(args.value),
        TlsStream::Server(stream) => stream.sock.set_nodelay(args.value),
    };
    result
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "setsockopt", None))
}

fn close(resources: &ResourceTable, realm: u64, args: ResourceArgs) -> NativeResult {
    resources.close(realm, args.resource)?;
    Ok(Value::Null)
}

fn certificates(encoded: &str) -> Result<Vec<CertificateDer<'static>>, NativeError> {
    let bytes = decode_base64(encoded)
        .map_err(|error| NativeError::invalid_arguments("tls certificate", error))?;
    let mut reader = BufReader::new(Cursor::new(bytes.clone()));
    let certificates = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| tls_error("parse certificate", error))?;
    Ok(if certificates.is_empty() {
        vec![CertificateDer::from(bytes)]
    } else {
        certificates
    })
}

fn private_key(encoded: &str) -> Result<PrivateKeyDer<'static>, NativeError> {
    let bytes = decode_base64(encoded)
        .map_err(|error| NativeError::invalid_arguments("tls private key", error))?;
    let mut reader = BufReader::new(Cursor::new(bytes));
    rustls_pemfile::private_key(&mut reader)
        .map_err(|error| tls_error("parse private key", error))?
        .ok_or_else(|| NativeError::invalid_arguments("tls private key", "no private key found"))
}

fn alpn_protocols(protocols: Option<Vec<String>>) -> Vec<Vec<u8>> {
    protocols
        .unwrap_or_default()
        .into_iter()
        .map(String::into_bytes)
        .collect()
}

fn configure_handshake_socket(socket: &TcpStream) -> Result<(), NativeError> {
    socket
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| NativeError::io(error, "setsockopt", None))?;
    socket
        .set_write_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| NativeError::io(error, "setsockopt", None))
}

fn configure_stream_socket(socket: &TcpStream) -> Result<(), NativeError> {
    socket
        .set_read_timeout(None)
        .map_err(|error| NativeError::io(error, "setsockopt", None))?;
    socket
        .set_write_timeout(None)
        .map_err(|error| NativeError::io(error, "setsockopt", None))?;
    socket
        .set_nonblocking(true)
        .map_err(|error| NativeError::io(error, "fcntl", None))
}

fn complete_client_handshake(
    stream: &mut StreamOwned<ClientConnection, TcpStream>,
) -> Result<(), NativeError> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while stream.conn.is_handshaking() {
        match stream.conn.complete_io(&mut stream.sock) {
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) && Instant::now() < deadline => {}
            Err(error) => return Err(tls_error("TLS client handshake", error)),
        }
        if Instant::now() >= deadline {
            return Err(NativeError::new(
                "ETIMEDOUT",
                "TLS client handshake exceeded 10 seconds",
            ));
        }
    }
    Ok(())
}

fn complete_server_handshake(
    stream: &mut StreamOwned<ServerConnection, TcpStream>,
) -> Result<(), NativeError> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while stream.conn.is_handshaking() {
        match stream.conn.complete_io(&mut stream.sock) {
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) && Instant::now() < deadline => {}
            Err(error) => return Err(tls_error("TLS server handshake", error)),
        }
        if Instant::now() >= deadline {
            return Err(NativeError::new(
                "ETIMEDOUT",
                "TLS server handshake exceeded 10 seconds",
            ));
        }
    }
    Ok(())
}

fn client_metadata(connection: &ClientConnection) -> Value {
    metadata(
        connection.alpn_protocol(),
        connection.peer_certificates(),
        connection
            .protocol_version()
            .map(|version| format!("{version:?}")),
    )
}

fn server_metadata(connection: &ServerConnection) -> Value {
    metadata(
        connection.alpn_protocol(),
        connection.peer_certificates(),
        connection
            .protocol_version()
            .map(|version| format!("{version:?}")),
    )
}

fn metadata(
    alpn: Option<&[u8]>,
    certificates: Option<&[CertificateDer<'_>]>,
    protocol: Option<String>,
) -> Value {
    json!({
        "alpnProtocol": alpn.map(|value| String::from_utf8_lossy(value).into_owned()),
        "peerCertificate": certificates.and_then(|values| values.first()).map(encode_base64),
        "protocol": protocol,
    })
}

fn listener(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<Arc<TlsListenerResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::TlsListener(listener) => Ok(listener),
        _ => Err(type_error(id, "TLS listener")),
    }
}

fn accepted(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<Arc<TlsAcceptedResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::TlsAccepted(accepted) => Ok(accepted),
        _ => Err(type_error(id, "accepted TLS connection")),
    }
}

fn stream(
    resources: &ResourceTable,
    realm: u64,
    id: u64,
) -> Result<Arc<TlsStreamResource>, NativeError> {
    match resources.get(realm, id)? {
        Resource::TlsStream(stream) => Ok(stream),
        _ => Err(type_error(id, "TLS stream")),
    }
}

fn address_value(address: SocketAddr) -> Value {
    json!({ "address": address.ip().to_string(), "family": if address.is_ipv4() { "IPv4" } else { "IPv6" }, "port": address.port() })
}

fn tls_error(action: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError {
        code: "ERR_TLS_HANDSHAKE".to_owned(),
        message: format!("{action} failed: {error}"),
        path: None,
        syscall: Some("tls".to_owned()),
    }
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
