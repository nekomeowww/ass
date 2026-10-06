mod binary;
mod child_process;
mod codec;
mod dgram;
mod dns;
mod error;
mod executor;
mod fs;
mod net;
mod os;
mod process;
mod resources;
mod tls;

use serde_json::Value;

pub(crate) use error::{NativeError, NativeResult};
pub(crate) use executor::{NativeExecutor, SubmitError};
pub(crate) use os::initialization_script as os_initialization_script;
pub(crate) use process::initialization_script as process_initialization_script;

#[derive(Clone, Default)]
pub(crate) struct NativeHost {
    resources: resources::ResourceTable,
    binary_reads: binary::BinaryReads,
}

pub(crate) fn error(code: impl Into<String>, message: impl Into<String>) -> NativeError {
    NativeError::new(code, message)
}

/// Dispatches one typed asynchronous operation onto a native capability module.
///
/// Triggering workflow:
///
/// JavaScript `globalThis.__assNativeCall`
///   -> WebView `window.ipc.postMessage`
///     -> `BridgeMessage::Native`
///       -> [`execute`]
///
/// Upstream:
/// - `Runtime::handle_message`
///
/// Downstream:
/// - Typed capability dispatchers such as [`fs::execute`], [`net::execute`],
///   [`tls::execute`], or [`child_process::execute`]
impl NativeHost {
    pub(crate) fn execute(&self, realm: u64, op: &str, args: Value) -> NativeResult {
        match op.split_once('.') {
            Some(("fs", "readFileBytes")) => self.binary_reads.prepare(realm, args),
            Some(("fs", operation)) => fs::execute(operation, args),
            Some(("child_process", operation)) => {
                child_process::execute(&self.resources, realm, operation, args)
            }
            Some(("dns", operation)) => dns::execute(operation, args),
            Some(("dgram", operation)) => dgram::execute(&self.resources, realm, operation, args),
            Some(("net", operation)) => net::execute(&self.resources, realm, operation, args),
            Some(("resource", operation)) => {
                resources::execute(&self.resources, realm, operation, args)
            }
            Some(("tls", operation)) => tls::execute(&self.resources, realm, operation, args),
            _ => Err(NativeError::unknown_operation(op)),
        }
    }

    pub(crate) fn close_realm(&self, realm: u64) {
        self.binary_reads.close_realm(realm);
        self.resources.close_owner(realm);
    }

    pub(crate) fn open_realm(&self, realm: u64) {
        self.binary_reads.open_realm(realm);
    }

    pub(crate) fn is_binary_request(request: &wry::http::Request<Vec<u8>>) -> bool {
        binary::BinaryReads::handles(request)
    }

    /// Routes `core.resolveNative`'s binary fetch through the native worker pool.
    ///
    /// Triggering workflow:
    /// `WebViewBuilder::with_asynchronous_custom_protocol` -> [`Self::respond_binary`]
    ///   -> `BinaryReads::respond` -> `RequestAsyncResponder::respond`.
    pub(crate) fn respond_binary(
        &self,
        request: wry::http::Request<Vec<u8>>,
        responder: wry::RequestAsyncResponder,
        executor: &NativeExecutor,
    ) {
        self.binary_reads.respond(request, responder, executor);
    }

    pub(crate) fn close_all(&self) {
        self.binary_reads.close_all();
        self.resources.close_all();
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::NativeHost;

    #[test]
    fn rejects_unknown_operations() {
        let error = NativeHost::default()
            .execute(1, "fs.nope", json!({}))
            .unwrap_err();
        assert_eq!(error.code, "ERR_ASS_UNKNOWN_OP");
    }

    #[test]
    fn reports_node_style_not_found_errors() {
        let error = NativeHost::default()
            .execute(
                1,
                "fs.readFile",
                json!({ "path": "/definitely/missing/ass-node-builtins-test" }),
            )
            .unwrap_err();
        assert_eq!(error.code, "ENOENT");
        assert_eq!(error.syscall.as_deref(), Some("read"));
    }
}
