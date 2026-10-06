use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::{Arc, Mutex},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};
use wry::{
    RequestAsyncResponder,
    http::{Method, Request, Response, StatusCode, header},
};

use super::{
    NativeExecutor,
    error::{NativeError, NativeResult, parse},
};

const PREFIX: &str = "/__ass_binary__/";
const MAX_PENDING_READS: usize = 1024;

#[derive(Clone)]
pub(super) struct BinaryReads(Arc<Mutex<State>>);

struct State {
    realms: HashSet<u64>,
    pending: HashMap<String, PendingRead>,
}

struct PendingRead {
    realm: u64,
    path: String,
}

#[derive(Deserialize)]
struct ReadArgs {
    path: String,
}

impl Default for BinaryReads {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(State {
            realms: HashSet::from([0]),
            pending: HashMap::new(),
        })))
    }
}

impl BinaryReads {
    pub(super) fn open_realm(&self, realm: u64) {
        self.0
            .lock()
            .expect("binary reads lock")
            .realms
            .insert(realm);
    }

    pub(super) fn close_realm(&self, realm: u64) {
        let mut state = self.0.lock().expect("binary reads lock");
        state.realms.remove(&realm);
        state.pending.retain(|_, read| read.realm != realm);
    }

    pub(super) fn close_all(&self) {
        let mut state = self.0.lock().expect("binary reads lock");
        state.realms.clear();
        state.pending.clear();
    }

    pub(super) fn prepare(&self, realm: u64, args: Value) -> NativeResult {
        let ReadArgs { path } = parse(args, "fs.readFileBytes")?;
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|error| {
            NativeError::new("EIO", format!("cannot create binary read token: {error}"))
        })?;
        let token = URL_SAFE_NO_PAD.encode(random);
        let mut state = self.0.lock().expect("binary reads lock");
        if !state.realms.contains(&realm) {
            return Err(closed_realm());
        }
        if state.pending.len() >= MAX_PENDING_READS {
            return Err(NativeError::new(
                "ERR_ASS_NATIVE_QUEUE_FULL",
                "binary read queue is full",
            ));
        }
        state
            .pending
            .insert(token.clone(), PendingRead { realm, path });
        // Wry maps custom schemes to http(s) origins on WebView2.
        let origin = if cfg!(target_os = "windows") {
            "http://ass.module"
        } else {
            "ass://module"
        };
        Ok(json!({ "__assBinaryUrl": format!("{origin}{PREFIX}{token}") }))
    }

    pub(super) fn handles(request: &Request<Vec<u8>>) -> bool {
        request.uri().path().starts_with(PREFIX)
    }

    /// Delivers a one-use, realm-owned file read without JSON/Base64 payloads.
    ///
    /// Triggering workflow:
    ///
    /// `core.resolveNative` -> `fetch(__assBinaryUrl)`
    ///   -> `WebViewBuilder::with_asynchronous_custom_protocol`
    ///   -> [`Self::respond`] -> [`NativeExecutor::submit`] -> [`fs::read`]
    ///
    /// Upstream: `NativeHost::respond_binary`.
    /// Downstream: `RequestAsyncResponder::respond`, then the pending JS promise.
    pub(super) fn respond(
        &self,
        request: Request<Vec<u8>>,
        responder: RequestAsyncResponder,
        executor: &NativeExecutor,
    ) {
        if request.method() != Method::GET {
            responder.respond(error_response(
                StatusCode::METHOD_NOT_ALLOWED,
                NativeError::new("EINVAL", "binary reads require GET"),
            ));
            return;
        }
        let token = request
            .uri()
            .path()
            .strip_prefix(PREFIX)
            .unwrap_or_default();
        let read = self
            .0
            .lock()
            .expect("binary reads lock")
            .pending
            .remove(token);
        let Some(read) = read else {
            responder.respond(error_response(
                StatusCode::NOT_FOUND,
                NativeError::new("EBADF", "binary read token is invalid or expired"),
            ));
            return;
        };
        // Retain the responder if the bounded executor rejects the job.
        let responder = Arc::new(Mutex::new(Some(responder)));
        let worker_responder = responder.clone();
        let reads = self.clone();
        let submitted = executor.submit(move || {
            let result = reads.read(read);
            let response = match result {
                Ok(bytes) => response(StatusCode::OK, "application/octet-stream", bytes),
                Err(error) => error_response(StatusCode::BAD_REQUEST, error),
            };
            worker_responder
                .lock()
                .expect("binary responder lock")
                .take()
                .expect("single response")
                .respond(response);
        });
        if submitted.is_err() {
            responder
                .lock()
                .expect("binary responder lock")
                .take()
                .expect("unqueued response")
                .respond(error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    NativeError::new(
                        "ERR_ASS_NATIVE_QUEUE_FULL",
                        "native operation queue is unavailable",
                    ),
                ));
        }
    }

    fn read(&self, read: PendingRead) -> Result<Vec<u8>, NativeError> {
        self.check_realm(read.realm)?;
        let bytes = fs::read(&read.path)
            .map_err(|error| NativeError::io(error, "read", Some(read.path)))?;
        // A running OS read cannot be interrupted, but cancelled realms receive no data.
        self.check_realm(read.realm)?;
        Ok(bytes)
    }

    fn check_realm(&self, realm: u64) -> Result<(), NativeError> {
        if self
            .0
            .lock()
            .expect("binary reads lock")
            .realms
            .contains(&realm)
        {
            Ok(())
        } else {
            Err(closed_realm())
        }
    }
}

fn closed_realm() -> NativeError {
    NativeError::new("ERR_ASS_REALM_CLOSED", "binary read realm is closed")
}

fn error_response(status: StatusCode, error: NativeError) -> Response<Vec<u8>> {
    response(
        status,
        "application/json",
        serde_json::to_vec(&error).expect("native errors serialize"),
    )
}

fn response(status: StatusCode, content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(bytes)
        .expect("static binary response headers")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_realm_revokes_pending_and_late_reads() {
        let reads = BinaryReads::default();
        reads.open_realm(7);
        let first = reads.prepare(7, json!({"path":"unused"})).unwrap();
        let second = reads.prepare(0, json!({"path":"unused"})).unwrap();
        assert_ne!(first, second);
        reads.close_realm(7);
        assert_eq!(reads.0.lock().unwrap().pending.len(), 1);
        assert_eq!(
            reads.prepare(7, json!({"path":"unused"})).unwrap_err().code,
            "ERR_ASS_REALM_CLOSED"
        );
        assert_eq!(
            reads
                .read(PendingRead {
                    realm: 7,
                    path: "unused".into()
                })
                .unwrap_err()
                .code,
            "ERR_ASS_REALM_CLOSED"
        );
        reads.close_all();
        assert!(reads.0.lock().unwrap().pending.is_empty());
    }

    #[test]
    fn missing_file_preserves_native_error_fields() {
        let reads = BinaryReads::default();
        let error = reads
            .read(PendingRead {
                realm: 0,
                path: "/definitely/missing/ass-binary-read".into(),
            })
            .unwrap_err();
        assert_eq!(error.code, "ENOENT");
        assert_eq!(error.syscall.as_deref(), Some("read"));
        assert_eq!(
            error.path.as_deref(),
            Some("/definitely/missing/ass-binary-read")
        );
    }
}
