use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    path::PathBuf,
    sync::mpsc::Sender,
};

use serde::Deserialize;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoopProxy},
    window::WindowId,
};
use wry::{BackgroundThrottlingPolicy, PageLoadEvent, WebView, WebViewBuilder};

use super::modules::{
    ModuleHost, NativeExecutor, NativeHost, NativeResult, SubmitError, os_initialization_script,
    process_initialization_script, rewrite_node_specifiers,
};

#[cfg(target_os = "linux")]
use gtk::prelude::*;
#[cfg(target_os = "linux")]
use winit::event_loop::ControlFlow;
#[cfg(not(target_os = "linux"))]
use winit::window::Window;
#[cfg(target_os = "linux")]
use wry::WebViewBuilderExtUnix;

const RUNTIME_HTML: &str = r#"<!doctype html><meta charset="utf-8"><title>ass runtime</title>"#;
const MAIN_REALM_ID: u64 = 0;

#[derive(Debug)]
pub struct Evaluation {
    pub source: String,
    pub mode: EvaluationMode,
    pub module_path: Option<PathBuf>,
    pub module_root: Option<PathBuf>,
    pub isolated: bool,
    pub wait_for_referenced_resources: bool,
    pub response: Sender<EvaluationEvent>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvaluationMode {
    Script,
    Module,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UncaughtPolicy {
    ExitRuntime,
    ReportAndContinue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationResult {
    pub success: bool,
    pub display: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvaluationEvent {
    Console { level: String, text: String },
    Exit(i32),
    Result(EvaluationResult),
}

#[derive(Debug)]
pub enum UserEvent {
    Ready,
    Evaluate(Evaluation),
    Message(String),
    NativeResult {
        call: u64,
        realm: u64,
        result: NativeResult,
    },
    Exit(i32),
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum BridgeMessage {
    Result {
        id: u64,
        success: bool,
        display: String,
    },
    Console {
        level: String,
        text: String,
    },
    Uncaught {
        realm: u64,
        text: String,
    },
    Native {
        v: u8,
        call: u64,
        realm: u64,
        op: String,
        args: serde_json::Value,
    },
    Exit {
        code: i32,
        realm: u64,
    },
}

pub struct Runtime {
    proxy: EventLoopProxy<UserEvent>,
    #[cfg(not(target_os = "linux"))]
    window: Option<Window>,
    #[cfg(target_os = "linux")]
    window: Option<gtk::Window>,
    webview: Option<WebView>,
    ready: bool,
    next_id: u64,
    queued: VecDeque<Evaluation>,
    pending: Option<(u64, u64, Sender<EvaluationEvent>)>,
    initial: Option<Evaluation>,
    module_host: ModuleHost,
    native_host: NativeHost,
    native_executor: NativeExecutor,
    process_executor: NativeExecutor,
    tls_executor: NativeExecutor,
    uncaught_policy: UncaughtPolicy,
    exit_code: i32,
}

impl Runtime {
    pub fn new(
        proxy: EventLoopProxy<UserEvent>,
        initial: Option<Evaluation>,
        uncaught_policy: UncaughtPolicy,
    ) -> Self {
        Self {
            proxy,
            window: None,
            webview: None,
            ready: false,
            next_id: 1,
            queued: VecDeque::new(),
            pending: None,
            initial,
            module_host: ModuleHost::default(),
            native_host: NativeHost::default(),
            native_executor: NativeExecutor::default(),
            process_executor: NativeExecutor::new("ass-process", 4, 128),
            tls_executor: NativeExecutor::new("ass-tls", 8, 256),
            uncaught_policy,
            exit_code: 0,
        }
    }

    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }

    fn create_webview(&mut self, _event_loop: &ActiveEventLoop) -> Result<(), String> {
        if self.webview.is_some() {
            return Ok(());
        }

        let message_proxy = self.proxy.clone();
        let ready_proxy = self.proxy.clone();
        let initial = self.initial.take();
        let initial_id = initial.as_ref().map(|_| {
            let id = self.next_id;
            self.next_id += 1;
            id
        });
        let initial_module_url = match (initial_id, initial.as_ref()) {
            (Some(id), Some(evaluation)) => self.module_url(id, evaluation)?,
            _ => None,
        };
        let protocol_host = self.module_host.clone();
        let binary_host = self.native_host.clone();
        let binary_executor = self.native_executor.clone();
        let mut builder = WebViewBuilder::new()
            .with_visible(false)
            .with_background_throttling(BackgroundThrottlingPolicy::Disabled)
            .with_initialization_script(process_initialization_script())
            .with_initialization_script(os_initialization_script())
            .with_initialization_script(include_str!("../../packages/bridge/dist/core/core.js"))
            .with_initialization_script(include_str!(
                "../../packages/bridge/dist/isolated-realm/isolated-realm.js"
            ))
            .with_asynchronous_custom_protocol(
                "ass".to_owned(),
                move |_webview_id, request, responder| {
                    if NativeHost::is_binary_request(&request) {
                        binary_host.respond_binary(request, responder, &binary_executor);
                    } else {
                        responder.respond(protocol_host.handle(request));
                    }
                },
            )
            .with_ipc_handler(move |request| {
                let _ = message_proxy.send_event(UserEvent::Message(request.body().clone()));
            })
            .with_on_page_load_handler(move |event, _url| {
                if matches!(event, PageLoadEvent::Finished) {
                    let _ = ready_proxy.send_event(UserEvent::Ready);
                }
            })
            .with_html(RUNTIME_HTML);
        if let (Some(id), Some(evaluation)) = (initial_id, initial.as_ref()) {
            builder = builder.with_initialization_script(evaluation_script(
                id,
                &evaluation.source,
                evaluation.mode,
                evaluation.isolated,
                evaluation.wait_for_referenced_resources,
                initial_module_url.as_deref(),
            ));
        }

        #[cfg(not(target_os = "linux"))]
        let (window, webview) = {
            let attributes = Window::default_attributes()
                .with_title("ass")
                .with_visible(false)
                .with_inner_size(winit::dpi::LogicalSize::new(1, 1));
            let window = _event_loop
                .create_window(attributes)
                .map_err(|error| format!("failed to create runtime window: {error}"))?;
            let webview = builder
                .build(&window)
                .map_err(|error| format!("failed to create system webview: {error}"))?;
            (window, webview)
        };

        #[cfg(target_os = "linux")]
        let (window, webview) = {
            let window = gtk::Window::new(gtk::WindowType::Toplevel);
            window.set_title("ass");
            window.set_default_size(1, 1);
            let container = gtk::Fixed::new();
            window.add(&container);
            container.show();
            let webview = builder
                .build_gtk(&container)
                .map_err(|error| format!("failed to create system webview: {error}"))?;
            (window, webview)
        };

        self.window = Some(window);
        self.webview = Some(webview);
        if let (Some(id), Some(evaluation)) = (initial_id, initial) {
            self.pending = Some((
                id,
                native_realm_id(id, evaluation.isolated),
                evaluation.response,
            ));
        }
        Ok(())
    }

    fn dispatch_next(&mut self) {
        if !self.ready || self.pending.is_some() {
            return;
        }
        let Some(evaluation) = self.queued.pop_front() else {
            return;
        };
        let id = self.next_id;
        self.next_id += 1;
        let module_url = match self.module_url(id, &evaluation) {
            Ok(module_url) => module_url,
            Err(error) => {
                let _ = evaluation
                    .response
                    .send(EvaluationEvent::Result(EvaluationResult {
                        success: false,
                        display: error,
                    }));
                self.dispatch_next();
                return;
            }
        };
        let script = evaluation_script(
            id,
            &evaluation.source,
            evaluation.mode,
            evaluation.isolated,
            evaluation.wait_for_referenced_resources,
            module_url.as_deref(),
        );
        self.native_host
            .open_realm(native_realm_id(id, evaluation.isolated));
        self.pending = Some((
            id,
            native_realm_id(id, evaluation.isolated),
            evaluation.response,
        ));

        if let Err(error) = self
            .webview
            .as_ref()
            .expect("ready runtime must have a webview")
            .evaluate_script(&script)
        {
            let (_, realm, response) = self.pending.take().expect("pending evaluation");
            if realm != MAIN_REALM_ID {
                self.native_host.close_realm(realm);
            }
            self.module_host.unmount(id);
            let _ = response.send(EvaluationEvent::Result(EvaluationResult {
                success: false,
                display: format!("failed to submit JavaScript: {error}"),
            }));
            self.dispatch_next();
        }
    }

    fn module_url(&self, id: u64, evaluation: &Evaluation) -> Result<Option<String>, String> {
        if !matches!(evaluation.mode, EvaluationMode::Module) {
            return Ok(None);
        }
        evaluation
            .module_path
            .as_deref()
            .map(|path| {
                self.module_host
                    .mount(id, path, evaluation.module_root.as_deref())
            })
            .transpose()
    }

    /// Routes a decoded WebView bridge message to the active evaluation channel.
    ///
    /// Triggering workflow:
    ///
    /// `WebViewBuilder::with_ipc_handler`
    ///   -> [`UserEvent::Message`]
    ///     -> [`BridgeMessage`]
    ///       -> [`Runtime::handle_message`]
    ///
    /// Upstream:
    /// - [`Runtime::user_event`]
    ///
    /// Downstream:
    /// - [`EvaluationEvent`], [`NativeExecutor::submit`], or native realm cleanup
    fn handle_message(&mut self, message: &str) {
        let parsed = match serde_json::from_str::<BridgeMessage>(message) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!("ass: invalid message from webview: {error}");
                return;
            }
        };

        match parsed {
            BridgeMessage::Result {
                id,
                success,
                display,
            } => {
                let Some((pending_id, _, _)) = self.pending.as_ref() else {
                    if id < self.next_id {
                        return;
                    }
                    eprintln!("ass: unexpected result from webview");
                    return;
                };
                if id != *pending_id {
                    if id < *pending_id {
                        return;
                    }
                    eprintln!("ass: result id mismatch: expected {pending_id}, received {id}");
                    return;
                }
                let (pending_id, realm, response) =
                    self.pending.take().expect("pending result checked above");
                if realm != MAIN_REALM_ID {
                    self.native_host.close_realm(realm);
                }
                self.module_host.unmount(pending_id);
                let _ = response.send(EvaluationEvent::Result(EvaluationResult {
                    success,
                    display,
                }));
                self.dispatch_next();
            }
            BridgeMessage::Console { level, text } => {
                if let Some((_, _, response)) = self.pending.as_ref() {
                    let _ = response.send(EvaluationEvent::Console { level, text });
                } else if matches!(level.as_str(), "warn" | "error") {
                    eprintln!("{text}");
                } else {
                    println!("{text}");
                }
            }
            BridgeMessage::Uncaught { realm, text } => {
                let Some((id, pending_realm, response)) = self.pending.take() else {
                    eprintln!("{text}");
                    if realm == MAIN_REALM_ID && self.uncaught_policy == UncaughtPolicy::ExitRuntime
                    {
                        let _ = self.proxy.send_event(UserEvent::Exit(1));
                    }
                    return;
                };
                if realm != pending_realm {
                    self.pending = Some((id, pending_realm, response));
                    return;
                }
                if realm != MAIN_REALM_ID || self.uncaught_policy == UncaughtPolicy::ExitRuntime {
                    self.native_host.close_realm(realm);
                    self.module_host.unmount(id);
                }
                let _ = response.send(EvaluationEvent::Result(EvaluationResult {
                    success: false,
                    display: text,
                }));
                self.dispatch_next();
            }
            BridgeMessage::Native {
                v,
                call,
                realm,
                op,
                args,
            } => {
                if v != 1 {
                    self.resolve_native(
                        call,
                        realm,
                        Err(super::modules::native_error(
                            "ERR_ASS_PROTOCOL_VERSION",
                            format!("unsupported native protocol version {v}"),
                        )),
                    );
                    return;
                }
                if realm != MAIN_REALM_ID
                    && self.pending.as_ref().map(|(_, realm, _)| *realm) != Some(realm)
                {
                    return;
                }
                let proxy = self.proxy.clone();
                let native_host = self.native_host.clone();
                let executor = match op.as_str() {
                    "child_process.exec" => &self.process_executor,
                    "tls.connect" | "tls.handshake" => &self.tls_executor,
                    _ => &self.native_executor,
                };
                let submit = executor.submit(move || {
                    let result =
                        catch_unwind(AssertUnwindSafe(|| native_host.execute(realm, &op, args)))
                            .unwrap_or_else(|_| {
                                Err(super::modules::native_error(
                                    "ERR_ASS_NATIVE_PANIC",
                                    format!("native operation {op} panicked"),
                                ))
                            });
                    let _ = proxy.send_event(UserEvent::NativeResult {
                        call,
                        realm,
                        result,
                    });
                });
                if let Err(error) = submit {
                    let (code, message) = match error {
                        SubmitError::Full => (
                            "ERR_ASS_NATIVE_QUEUE_FULL",
                            "native operation queue is full",
                        ),
                        SubmitError::Stopped => (
                            "ERR_ASS_NATIVE_EXECUTOR_STOPPED",
                            "native operation executor has stopped",
                        ),
                    };
                    self.resolve_native(
                        call,
                        realm,
                        Err(super::modules::native_error(code, message)),
                    );
                }
            }
            BridgeMessage::Exit { code, realm } => {
                if realm != MAIN_REALM_ID
                    && self.pending.as_ref().map(|(_, realm, _)| *realm) != Some(realm)
                {
                    return;
                }
                let Some((id, _, response)) = self.pending.take() else {
                    if realm == MAIN_REALM_ID {
                        let _ = self.proxy.send_event(UserEvent::Exit(code.rem_euclid(256)));
                    }
                    return;
                };
                self.native_host.close_realm(realm);
                self.module_host.unmount(id);
                let _ = response.send(EvaluationEvent::Exit(code.rem_euclid(256)));
                self.dispatch_next();
            }
        }
    }

    /// Resolves one asynchronous Rust operation in its owning WebView realm.
    ///
    /// Triggering workflow:
    ///
    /// [`NativeExecutor::submit`]
    ///   -> [`NativeHost::execute`]
    ///     -> [`UserEvent::NativeResult`]
    ///     -> [`Runtime::user_event`]
    ///       -> [`Runtime::resolve_native`]
    ///
    /// Upstream:
    /// - background native operation worker
    ///
    /// Downstream:
    /// - JavaScript `window.__ass.resolveNative`
    fn resolve_native(&self, call: u64, realm: u64, result: NativeResult) {
        if realm != MAIN_REALM_ID
            && self.pending.as_ref().map(|(_, realm, _)| *realm) != Some(realm)
        {
            return;
        }
        let (success, value) = match result {
            Ok(value) => (true, value),
            Err(error) => (
                false,
                serde_json::to_value(error).expect("native errors always serialize"),
            ),
        };
        let encoded = serde_json::to_string(&value).expect("JSON values always serialize");
        let script = format!("window.__ass.resolveNative({call}, {success}, {encoded})");
        if let Err(error) = self
            .webview
            .as_ref()
            .expect("an active realm must have a webview")
            .evaluate_script(&script)
        {
            eprintln!("ass: failed to resolve native operation: {error}");
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.native_host.close_all();
    }
}

impl ApplicationHandler<UserEvent> for Runtime {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(target_os = "linux")]
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(10),
        ));
        if let Err(error) = self.create_webview(event_loop) {
            eprintln!("ass: {error}");
            self.exit_code = 1;
            event_loop.exit();
        }
    }

    /// Dispatches native user events into runtime state transitions.
    ///
    /// Triggering workflow:
    ///
    /// [`EventLoopProxy::send_event`]
    ///   -> [`UserEvent`]
    ///     -> `ApplicationHandler::user_event`
    ///       -> [`Runtime::user_event`]
    ///
    /// Upstream:
    /// - WebView IPC, daemon clients, and the local input controller
    ///
    /// Downstream:
    /// - [`Runtime::dispatch_next`], [`Runtime::handle_message`], or [`ActiveEventLoop::exit`]
    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Ready => {
                self.ready = true;
                self.dispatch_next();
            }
            UserEvent::Evaluate(evaluation) => {
                self.queued.push_back(evaluation);
                self.dispatch_next();
            }
            UserEvent::Message(message) => self.handle_message(&message),
            UserEvent::NativeResult {
                call,
                realm,
                result,
            } => self.resolve_native(call, realm, result),
            UserEvent::Exit(code) => {
                self.exit_code = code;
                event_loop.exit();
            }
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        #[cfg(target_os = "linux")]
        {
            while gtk::events_pending() {
                gtk::main_iteration_do(false);
            }
            _event_loop.set_control_flow(ControlFlow::WaitUntil(
                std::time::Instant::now() + std::time::Duration::from_millis(10),
            ));
        }
    }
}

fn evaluation_script(
    id: u64,
    source: &str,
    mode: EvaluationMode,
    isolated: bool,
    wait_for_referenced_resources: bool,
    module_url: Option<&str>,
) -> String {
    let realm = native_realm_id(id, isolated);
    let rewritten_source = rewrite_node_specifiers(source, id);
    let encoded_source =
        serde_json::to_string(&rewritten_source).expect("strings always serialize");
    let encoded_module_url = serde_json::to_string(&module_url).expect("strings always serialize");
    let buffer_module_url = format!("ass://module/{id}/__ass_builtin__/buffer");
    let encoded_buffer_module_url =
        serde_json::to_string(&buffer_module_url).expect("module URLs always serialize");
    let wait_for_referenced_resources = if wait_for_referenced_resources {
        "true"
    } else {
        "false"
    };
    let evaluation = if isolated {
        format!(
            "window.__ass.evaluateIsolated({encoded_source}, {}, {encoded_module_url}, {id})",
            matches!(mode, EvaluationMode::Module)
        )
    } else {
        match mode {
            EvaluationMode::Script => format!("(0, eval)({encoded_source})"),
            EvaluationMode::Module if module_url.is_some() => {
                format!("import({encoded_module_url})")
            }
            EvaluationMode::Module => format!(
                r#"(() => {{
    const url = URL.createObjectURL(new Blob([{encoded_source}], {{ type: "text/javascript" }}));
    return import(url).finally(() => URL.revokeObjectURL(url));
  }})()"#
            ),
        }
    };
    if isolated {
        format!(
            r#"Promise.resolve()
  .then(() => import({encoded_buffer_module_url}))
  .then(module => {{ globalThis.Buffer ??= module.Buffer; return {evaluation}; }})
  .then(async outcome => {{ await window.__ass.waitForNativeIdle({realm}, {wait_for_referenced_resources}); return outcome; }})
  .then(
    outcome => window.__ass.send({{ kind: "result", id: {id}, success: outcome.success, display: outcome.display }}),
    error => window.__ass.send({{ kind: "result", id: {id}, success: false, display: window.__ass.inspect(error) }})
  );"#
        )
    } else {
        format!(
            r#"Promise.resolve()
  .then(() => import({encoded_buffer_module_url}))
  .then(module => {{ globalThis.Buffer ??= module.Buffer; return {evaluation}; }})
  .then(async value => {{ await window.__ass.waitForNativeIdle({realm}, {wait_for_referenced_resources}); return value; }})
  .then(
    value => window.__ass.send({{ kind: "result", id: {id}, success: true, display: window.__ass.inspect(value) }}),
    error => window.__ass.send({{ kind: "result", id: {id}, success: false, display: window.__ass.inspect(error) }})
  );"#
        )
    }
}

const fn native_realm_id(evaluation_id: u64, isolated: bool) -> u64 {
    if isolated {
        evaluation_id
    } else {
        MAIN_REALM_ID
    }
}

#[cfg(test)]
#[path = "runtime_test.rs"]
mod tests;
