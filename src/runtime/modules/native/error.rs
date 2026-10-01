use std::io;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NativeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub syscall: Option<String>,
}

pub(crate) type NativeResult = Result<Value, NativeError>;

impl NativeError {
    pub(super) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            path: None,
            syscall: None,
        }
    }

    pub(super) fn invalid_arguments(op: &str, error: impl std::fmt::Display) -> Self {
        Self {
            code: "ERR_INVALID_ARG_VALUE".to_owned(),
            message: format!("invalid arguments for {op}: {error}"),
            path: None,
            syscall: Some(op.to_owned()),
        }
    }

    pub(super) fn io(error: io::Error, syscall: &str, path: Option<String>) -> Self {
        let code = error
            .raw_os_error()
            .and_then(os_error_code)
            .unwrap_or_else(|| match error.kind() {
                io::ErrorKind::NotFound => "ENOENT",
                io::ErrorKind::PermissionDenied => "EACCES",
                io::ErrorKind::AlreadyExists => "EEXIST",
                io::ErrorKind::InvalidInput => "EINVAL",
                io::ErrorKind::IsADirectory => "EISDIR",
                io::ErrorKind::NotADirectory => "ENOTDIR",
                io::ErrorKind::DirectoryNotEmpty => "ENOTEMPTY",
                io::ErrorKind::AddrInUse => "EADDRINUSE",
                io::ErrorKind::AddrNotAvailable => "EADDRNOTAVAIL",
                io::ErrorKind::BrokenPipe => "EPIPE",
                io::ErrorKind::ConnectionAborted => "ECONNABORTED",
                io::ErrorKind::ConnectionRefused => "ECONNREFUSED",
                io::ErrorKind::ConnectionReset => "ECONNRESET",
                io::ErrorKind::HostUnreachable => "EHOSTUNREACH",
                io::ErrorKind::NetworkDown => "ENETDOWN",
                io::ErrorKind::NetworkUnreachable => "ENETUNREACH",
                io::ErrorKind::NotConnected => "ENOTCONN",
                io::ErrorKind::TimedOut => "ETIMEDOUT",
                io::ErrorKind::WouldBlock => "EAGAIN",
                _ => "EIO",
            });
        let message = path.as_ref().map_or_else(
            || format!("{code}: {error}, {syscall}"),
            |path| format!("{code}: {error}, {syscall} '{path}'"),
        );
        Self {
            code: code.to_owned(),
            message,
            path,
            syscall: Some(syscall.to_owned()),
        }
    }

    pub(super) fn unknown_operation(op: &str) -> Self {
        Self {
            code: "ERR_ASS_UNKNOWN_OP".to_owned(),
            message: format!("unknown native operation {op}"),
            path: None,
            syscall: Some(op.to_owned()),
        }
    }
}

#[cfg(unix)]
fn os_error_code(code: i32) -> Option<&'static str> {
    Some(match code {
        libc::EACCES => "EACCES",
        libc::EADDRINUSE => "EADDRINUSE",
        libc::EADDRNOTAVAIL => "EADDRNOTAVAIL",
        libc::EAFNOSUPPORT => "EAFNOSUPPORT",
        libc::EALREADY => "EALREADY",
        libc::EBADF => "EBADF",
        libc::EBUSY => "EBUSY",
        libc::ECONNABORTED => "ECONNABORTED",
        libc::ECONNREFUSED => "ECONNREFUSED",
        libc::ECONNRESET => "ECONNRESET",
        libc::EDESTADDRREQ => "EDESTADDRREQ",
        libc::EEXIST => "EEXIST",
        libc::EFAULT => "EFAULT",
        libc::EFBIG => "EFBIG",
        libc::EHOSTUNREACH => "EHOSTUNREACH",
        libc::EINPROGRESS => "EINPROGRESS",
        libc::EINTR => "EINTR",
        libc::EINVAL => "EINVAL",
        libc::EIO => "EIO",
        libc::EISCONN => "EISCONN",
        libc::EISDIR => "EISDIR",
        libc::EMFILE => "EMFILE",
        libc::EMLINK => "EMLINK",
        libc::EMSGSIZE => "EMSGSIZE",
        libc::ENAMETOOLONG => "ENAMETOOLONG",
        libc::ENETDOWN => "ENETDOWN",
        libc::ENETUNREACH => "ENETUNREACH",
        libc::ENFILE => "ENFILE",
        libc::ENOBUFS => "ENOBUFS",
        libc::ENODEV => "ENODEV",
        libc::ENOENT => "ENOENT",
        libc::ENOMEM => "ENOMEM",
        libc::ENOSPC => "ENOSPC",
        libc::ENOTCONN => "ENOTCONN",
        libc::ENOTDIR => "ENOTDIR",
        libc::ENOTEMPTY => "ENOTEMPTY",
        libc::ENOTSOCK => "ENOTSOCK",
        libc::ENOTTY => "ENOTTY",
        libc::ENXIO => "ENXIO",
        libc::EOPNOTSUPP => "EOPNOTSUPP",
        libc::EPERM => "EPERM",
        libc::EPIPE => "EPIPE",
        libc::EPROTONOSUPPORT => "EPROTONOSUPPORT",
        libc::EPROTOTYPE => "EPROTOTYPE",
        libc::ERANGE => "ERANGE",
        libc::EROFS => "EROFS",
        libc::ESPIPE => "ESPIPE",
        libc::ETIMEDOUT => "ETIMEDOUT",
        libc::EXDEV => "EXDEV",
        _ => return None,
    })
}

#[cfg(windows)]
fn os_error_code(code: i32) -> Option<&'static str> {
    Some(match code {
        2 | 3 => "ENOENT",
        5 => "EACCES",
        32 => "EBUSY",
        80 | 183 => "EEXIST",
        109 => "EPIPE",
        10013 => "EACCES",
        10022 => "EINVAL",
        10035 => "EAGAIN",
        10036 => "EINPROGRESS",
        10037 => "EALREADY",
        10038 => "ENOTSOCK",
        10039 => "EDESTADDRREQ",
        10040 => "EMSGSIZE",
        10041 => "EPROTOTYPE",
        10042 => "ENOPROTOOPT",
        10043 => "EPROTONOSUPPORT",
        10047 => "EAFNOSUPPORT",
        10048 => "EADDRINUSE",
        10049 => "EADDRNOTAVAIL",
        10050 => "ENETDOWN",
        10051 => "ENETUNREACH",
        10053 => "ECONNABORTED",
        10054 => "ECONNRESET",
        10055 => "ENOBUFS",
        10056 => "EISCONN",
        10057 => "ENOTCONN",
        10060 => "ETIMEDOUT",
        10061 => "ECONNREFUSED",
        10065 => "EHOSTUNREACH",
        _ => return None,
    })
}

#[cfg(not(any(unix, windows)))]
fn os_error_code(_code: i32) -> Option<&'static str> {
    None
}

pub(super) fn parse<T: DeserializeOwned>(args: Value, op: &str) -> Result<T, NativeError> {
    serde_json::from_value(args).map_err(|error| NativeError::invalid_arguments(op, error))
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::NativeError;

    #[test]
    fn preserves_common_network_error_codes() {
        let cases = [
            (io::ErrorKind::ConnectionRefused, "ECONNREFUSED"),
            (io::ErrorKind::ConnectionReset, "ECONNRESET"),
            (io::ErrorKind::AddrInUse, "EADDRINUSE"),
            (io::ErrorKind::TimedOut, "ETIMEDOUT"),
        ];
        for (kind, expected) in cases {
            let error = NativeError::io(io::Error::from(kind), "connect", None);
            assert_eq!(error.code, expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn prefers_the_raw_os_error_code() {
        let error = NativeError::io(
            io::Error::from_raw_os_error(libc::ECONNREFUSED),
            "connect",
            None,
        );
        assert_eq!(error.code, "ECONNREFUSED");
    }
}
