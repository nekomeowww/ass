use std::{
    borrow::Cow,
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, RwLock},
};

use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use wry::http::{Request, Response, StatusCode, header};

use crate::processors::transpile;

const MODULE_SCHEME: &str = "ass";
const MODULE_HOST: &str = "module";

#[derive(Clone, Default)]
pub struct ModuleHost {
    mounts: Arc<RwLock<HashMap<u64, ModuleMount>>>,
}

#[derive(Clone)]
struct ModuleMount {
    root: PathBuf,
}

impl ModuleHost {
    pub fn mount(
        &self,
        id: u64,
        entry_path: &Path,
        root_hint: Option<&Path>,
    ) -> Result<String, String> {
        let entry = fs::canonicalize(entry_path).map_err(|error| {
            format!(
                "failed to resolve module entry {}: {error}",
                entry_path.display()
            )
        })?;
        let hinted_root = root_hint
            .map(fs::canonicalize)
            .transpose()
            .map_err(|error| format!("failed to resolve module root: {error}"))?;
        let root = if let Some(root) = hinted_root.filter(|root| entry.starts_with(root)) {
            root
        } else {
            entry
                .parent()
                .expect("a module entry always has a parent")
                .to_path_buf()
        };
        let relative = entry
            .strip_prefix(&root)
            .expect("module entry must be inside its selected root");
        let encoded_path = encode_relative_path(relative)?;

        self.mounts
            .write()
            .map_err(|_| "module mount registry is poisoned".to_owned())?
            .insert(id, ModuleMount { root });

        Ok(format!(
            "{MODULE_SCHEME}://{MODULE_HOST}/{id}/{encoded_path}"
        ))
    }

    pub fn unmount(&self, id: u64) {
        if let Ok(mut mounts) = self.mounts.write() {
            mounts.remove(&id);
        }
    }

    /// Serves one WebView module request from its request-scoped filesystem mount.
    ///
    /// Triggering workflow:
    ///
    /// JavaScript `import()`
    ///   -> [`wry::WebViewBuilder::with_custom_protocol`]
    ///     -> `ass://module/<evaluation-id>/<path>`
    ///       -> [`ModuleHost::handle`]
    ///
    /// Upstream:
    /// - WebView native ESM module fetching
    ///
    /// Downstream:
    /// - [`fs::read`] and, for TypeScript files, [`transpile::transpile_typescript`]
    pub fn handle(&self, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
        match self.load(request.uri().path()) {
            Ok(module) => response(StatusCode::OK, module.content_type, module.bytes),
            Err(error) => response(
                error.status,
                "text/plain; charset=utf-8",
                error.message.into_bytes().into(),
            ),
        }
    }

    fn load(&self, request_path: &str) -> Result<LoadedModule, LoadError> {
        let (id, encoded_path) = parse_request_path(request_path)?;
        let mount = self
            .mounts
            .read()
            .map_err(|_| LoadError::internal("module mount registry is poisoned"))?
            .get(&id)
            .cloned()
            .ok_or_else(|| LoadError::not_found(format!("unknown module mount {id}")))?;
        let relative = percent_decode_str(encoded_path)
            .decode_utf8()
            .map_err(|_| LoadError::bad_request("module path is not valid UTF-8"))?;
        let candidate = mount.root.join(relative.as_ref());
        let canonical = fs::canonicalize(&candidate).map_err(|error| {
            LoadError::not_found(format!(
                "failed to resolve {}: {error}",
                candidate.display()
            ))
        })?;
        if !canonical.starts_with(&mount.root) {
            return Err(LoadError::forbidden("module path escapes its mounted root"));
        }

        let bytes = fs::read(&canonical).map_err(|error| {
            LoadError::not_found(format!("failed to read {}: {error}", canonical.display()))
        })?;
        if transpile::is_typescript_path(&canonical) {
            let source = String::from_utf8(bytes)
                .map_err(|_| LoadError::bad_request("TypeScript source is not valid UTF-8"))?;
            let output = transpile::transpile_typescript(&source, Some(&canonical))
                .map_err(LoadError::unprocessable)?;
            return Ok(LoadedModule {
                bytes: output.into_bytes().into(),
                content_type: "text/javascript; charset=utf-8",
            });
        }

        Ok(LoadedModule {
            content_type: content_type(&canonical),
            bytes: bytes.into(),
        })
    }
}

struct LoadedModule {
    bytes: Cow<'static, [u8]>,
    content_type: &'static str,
}

struct LoadError {
    status: StatusCode,
    message: String,
}

impl LoadError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    fn unprocessable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, message)
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

fn parse_request_path(path: &str) -> Result<(u64, &str), LoadError> {
    let path = path.trim_start_matches('/');
    let (id, relative) = path
        .split_once('/')
        .ok_or_else(|| LoadError::bad_request("module URL is missing a path"))?;
    let id = id
        .parse()
        .map_err(|_| LoadError::bad_request("module URL has an invalid mount id"))?;
    if relative.is_empty() {
        return Err(LoadError::bad_request("module URL is missing a file path"));
    }
    Ok((id, relative))
}

fn encode_relative_path(path: &Path) -> Result<String, String> {
    let mut encoded = Vec::new();
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err(format!("unsupported module path {}", path.display()));
        };
        let segment = segment
            .to_str()
            .ok_or_else(|| format!("module path is not valid UTF-8: {}", path.display()))?;
        encoded.push(utf8_percent_encode(segment, NON_ALPHANUMERIC).to_string());
    }
    Ok(encoded.join("/"))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("js" | "mjs" | "cjs" | "jsx") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn response(
    status: StatusCode,
    content_type: &'static str,
    body: Cow<'static, [u8]>,
) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(body)
        .expect("static module response headers are valid")
}
