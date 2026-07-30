use std::{collections::VecDeque, path::PathBuf, sync::mpsc::Sender};

use serde::Deserialize;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoopProxy},
    window::WindowId,
};
use wry::{BackgroundThrottlingPolicy, PageLoadEvent, WebView, WebViewBuilder};

use super::modules::ModuleHost;

#[cfg(target_os = "linux")]
use gtk::prelude::*;
#[cfg(target_os = "linux")]
use winit::event_loop::ControlFlow;
#[cfg(not(target_os = "linux"))]
use winit::window::Window;
#[cfg(target_os = "linux")]
use wry::WebViewBuilderExtUnix;

const RUNTIME_HTML: &str = r#"<!doctype html><meta charset="utf-8"><title>ass runtime</title>"#;

#[derive(Debug)]
pub struct Evaluation {
    pub source: String,
    pub mode: EvaluationMode,
    pub module_path: Option<PathBuf>,
    pub module_root: Option<PathBuf>,
    pub isolated: bool,
    pub response: Sender<EvaluationEvent>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvaluationMode {
    Script,
    Module,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationResult {
    pub success: bool,
    pub display: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvaluationEvent {
    Console { level: String, text: String },
    Result(EvaluationResult),
}

#[derive(Debug)]
pub enum UserEvent {
    Ready,
    Evaluate(Evaluation),
    Message(String),
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
        text: String,
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
    pending: Option<(u64, Sender<EvaluationEvent>)>,
    initial: Option<Evaluation>,
    module_host: ModuleHost,
    exit_code: i32,
}

impl Runtime {
    pub fn new(proxy: EventLoopProxy<UserEvent>, initial: Option<Evaluation>) -> Self {
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
        let mut builder = WebViewBuilder::new()
            .with_visible(false)
            .with_background_throttling(BackgroundThrottlingPolicy::Disabled)
            .with_initialization_script(include_str!("../../packages/bridge/dist/core/core.js"))
            .with_initialization_script(include_str!(
                "../../packages/bridge/dist/isolated-realm/isolated-realm.js"
            ))
            .with_custom_protocol("ass".to_owned(), move |_webview_id, request| {
                protocol_host.handle(request)
            })
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
            self.pending = Some((id, evaluation.response));
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
            module_url.as_deref(),
        );
        self.pending = Some((id, evaluation.response));

        if let Err(error) = self
            .webview
            .as_ref()
            .expect("ready runtime must have a webview")
            .evaluate_script(&script)
        {
            let (_, response) = self.pending.take().expect("pending evaluation");
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
    /// - [`EvaluationEvent`] through the active evaluation response channel
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
                let Some((pending_id, response)) = self.pending.take() else {
                    eprintln!("ass: unexpected result from webview");
                    return;
                };
                if id != pending_id {
                    eprintln!("ass: result id mismatch: expected {pending_id}, received {id}");
                }
                self.module_host.unmount(pending_id);
                let _ = response.send(EvaluationEvent::Result(EvaluationResult {
                    success,
                    display,
                }));
                self.dispatch_next();
            }
            BridgeMessage::Console { level, text } => {
                if let Some((_, response)) = self.pending.as_ref() {
                    let _ = response.send(EvaluationEvent::Console { level, text });
                } else if matches!(level.as_str(), "warn" | "error") {
                    eprintln!("{text}");
                } else {
                    println!("{text}");
                }
            }
            BridgeMessage::Uncaught { text } => {
                if let Some((_, response)) = self.pending.as_ref() {
                    let _ = response.send(EvaluationEvent::Console {
                        level: "error".to_owned(),
                        text,
                    });
                } else {
                    eprintln!("{text}");
                }
            }
        }
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
    module_url: Option<&str>,
) -> String {
    let encoded_source = serde_json::to_string(source).expect("strings always serialize");
    let encoded_module_url = serde_json::to_string(&module_url).expect("strings always serialize");
    let evaluation = if isolated {
        format!(
            "window.__ass.evaluateIsolated({encoded_source}, {}, {encoded_module_url})",
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
  .then(() => {evaluation})
  .then(
    outcome => window.__ass.send({{ kind: "result", id: {id}, success: outcome.success, display: outcome.display }}),
    error => window.__ass.send({{ kind: "result", id: {id}, success: false, display: window.__ass.inspect(error) }})
  );"#
        )
    } else {
        format!(
            r#"Promise.resolve()
  .then(() => {evaluation})
  .then(
    value => window.__ass.send({{ kind: "result", id: {id}, success: true, display: window.__ass.inspect(value) }}),
    error => window.__ass.send({{ kind: "result", id: {id}, success: false, display: window.__ass.inspect(error) }})
  );"#
        )
    }
}

#[cfg(test)]
#[path = "runtime_test.rs"]
mod tests;
