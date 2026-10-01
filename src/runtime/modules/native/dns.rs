use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

use serde::Deserialize;
use serde_json::{Value, json};

use super::error::{NativeError, NativeResult, parse};

pub(super) fn execute(operation: &str, args: Value) -> NativeResult {
    let op = format!("dns.{operation}");
    match operation {
        "lookup" => lookup(parse(args, &op)?),
        "lookupService" => lookup_service(parse(args, &op)?),
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

#[derive(Deserialize)]
struct LookupArgs {
    family: Option<u8>,
    hostname: String,
}

#[derive(Deserialize)]
struct LookupServiceArgs {
    address: String,
    port: u16,
}

fn lookup(args: LookupArgs) -> NativeResult {
    let addresses = (args.hostname.as_str(), 0)
        .to_socket_addrs()
        .map_err(|error| lookup_error(error.to_string(), &args.hostname))?;
    let mut addresses = addresses
        .map(|address| address.ip())
        .filter(|address| match args.family.unwrap_or(0) {
            4 => address.is_ipv4(),
            6 => address.is_ipv6(),
            _ => true,
        })
        .collect::<Vec<_>>();
    addresses.sort_by_key(ToString::to_string);
    addresses.dedup();
    if addresses.is_empty() {
        return Err(lookup_error("no matching addresses", &args.hostname));
    }
    Ok(json!(
        addresses
            .into_iter()
            .map(|address| json!({
                "address": address.to_string(),
                "family": if address.is_ipv4() { 4 } else { 6 },
            }))
            .collect::<Vec<_>>()
    ))
}

fn lookup_error(message: impl Into<String>, hostname: &str) -> NativeError {
    NativeError {
        code: "ENOTFOUND".to_owned(),
        message: format!("getaddrinfo ENOTFOUND {hostname}: {}", message.into()),
        path: Some(hostname.to_owned()),
        syscall: Some("getaddrinfo".to_owned()),
    }
}

#[cfg(unix)]
fn lookup_service(args: LookupServiceArgs) -> NativeResult {
    use std::{ffi::CStr, mem::size_of};

    let ip = args
        .address
        .parse::<IpAddr>()
        .map_err(|error| NativeError {
            code: "ERR_INVALID_ARG_VALUE".to_owned(),
            message: format!("invalid IP address '{}': {error}", args.address),
            path: Some(args.address.clone()),
            syscall: Some("getnameinfo".to_owned()),
        })?;
    let socket = SocketAddr::new(ip, args.port);
    let mut host: [libc::c_char; 1025] = [0; 1025];
    let mut service: [libc::c_char; 32] = [0; 32];
    let result = match socket {
        SocketAddr::V4(address) => {
            // SAFETY: zero is a valid baseline for sockaddr_in before assigning required fields.
            let mut native: libc::sockaddr_in = unsafe { std::mem::zeroed() };
            native.sin_family = libc::AF_INET as libc::sa_family_t;
            native.sin_port = address.port().to_be();
            native.sin_addr = libc::in_addr {
                s_addr: u32::from_ne_bytes(address.ip().octets()),
            };
            // SAFETY: native is a fully initialized sockaddr_in and buffers are writable.
            unsafe {
                libc::getnameinfo(
                    (&native as *const libc::sockaddr_in).cast(),
                    size_of::<libc::sockaddr_in>() as libc::socklen_t,
                    host.as_mut_ptr(),
                    host.len() as libc::socklen_t,
                    service.as_mut_ptr(),
                    service.len() as libc::socklen_t,
                    0,
                )
            }
        }
        SocketAddr::V6(address) => {
            // SAFETY: zero is a valid baseline for sockaddr_in6 before assigning required fields.
            let mut native: libc::sockaddr_in6 = unsafe { std::mem::zeroed() };
            native.sin6_family = libc::AF_INET6 as libc::sa_family_t;
            native.sin6_port = address.port().to_be();
            native.sin6_flowinfo = address.flowinfo();
            native.sin6_addr = libc::in6_addr {
                s6_addr: address.ip().octets(),
            };
            native.sin6_scope_id = address.scope_id();
            // SAFETY: native is a fully initialized sockaddr_in6 and buffers are writable.
            unsafe {
                libc::getnameinfo(
                    (&native as *const libc::sockaddr_in6).cast(),
                    size_of::<libc::sockaddr_in6>() as libc::socklen_t,
                    host.as_mut_ptr(),
                    host.len() as libc::socklen_t,
                    service.as_mut_ptr(),
                    service.len() as libc::socklen_t,
                    0,
                )
            }
        }
    };
    if result != 0 {
        // SAFETY: gai_strerror returns a null-terminated static string for result.
        let message = unsafe { CStr::from_ptr(libc::gai_strerror(result)) }
            .to_string_lossy()
            .into_owned();
        return Err(NativeError {
            code: "ENOTFOUND".to_owned(),
            message: format!("getnameinfo ENOTFOUND {}: {message}", args.address),
            path: Some(args.address),
            syscall: Some("getnameinfo".to_owned()),
        });
    }
    // SAFETY: successful getnameinfo writes null-terminated strings into both buffers.
    let hostname = unsafe { CStr::from_ptr(host.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    // SAFETY: successful getnameinfo writes null-terminated strings into both buffers.
    let service = unsafe { CStr::from_ptr(service.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    Ok(json!({ "hostname": hostname, "service": service }))
}

#[cfg(not(unix))]
fn lookup_service(args: LookupServiceArgs) -> NativeResult {
    Err(NativeError {
        code: "ERR_ASS_UNSUPPORTED".to_owned(),
        message: "dns.lookupService is not implemented on this platform".to_owned(),
        path: Some(args.address),
        syscall: Some("getnameinfo".to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::execute;

    #[test]
    fn resolves_localhost() {
        let result = execute("lookup", json!({ "family": 0, "hostname": "localhost" }))
            .expect("localhost resolves");
        assert!(
            result
                .as_array()
                .is_some_and(|addresses| !addresses.is_empty())
        );
    }
}
