use std::{
    collections::HashMap,
    io::{self, Read, Write},
    net::{Shutdown, TcpListener, TcpStream, UdpSocket},
    process::{Child, ChildStdin},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{Receiver, SyncSender, TryRecvError, TrySendError, sync_channel},
    },
    thread,
};

use serde::Deserialize;
use serde_json::{Value, json};

use super::error::{NativeError, NativeResult, parse};

pub(super) enum TlsStream {
    Client(rustls::StreamOwned<rustls::ClientConnection, TcpStream>),
    Server(rustls::StreamOwned<rustls::ServerConnection, TcpStream>),
}

#[derive(Clone, Default)]
pub(super) struct ResourceTable {
    inner: Arc<ResourceTableInner>,
}

#[derive(Default)]
struct ResourceTableInner {
    next_id: AtomicU64,
    resources: Mutex<HashMap<u64, OwnedResource>>,
}

struct OwnedResource {
    owner: u64,
    referenced: bool,
    resource: Resource,
}

#[derive(Clone)]
pub(super) enum Resource {
    ChildProcess(Arc<ChildProcessResource>),
    TcpListener(Arc<TcpListenerResource>),
    TcpStream(Arc<TcpStreamResource>),
    TlsAccepted(Arc<TlsAcceptedResource>),
    TlsListener(Arc<TlsListenerResource>),
    TlsStream(Arc<TlsStreamResource>),
    UdpSocket(Arc<UdpSocketResource>),
}

pub(super) struct ChildProcessResource {
    pub(super) child: Mutex<Child>,
    pub(super) closed: AtomicBool,
    pub(super) stderr: Option<ChildPipeReader>,
    pub(super) stdin: Option<ChildStdinWriter>,
    pub(super) stdout: Option<ChildPipeReader>,
}

pub(super) struct ChildStdinWriter {
    error: Arc<Mutex<Option<NativeError>>>,
    sender: SyncSender<ChildStdinCommand>,
}

enum ChildStdinCommand {
    Close,
    Write(Vec<u8>),
}

impl ChildStdinWriter {
    pub(super) fn try_write(&self, bytes: Vec<u8>) -> Result<bool, NativeError> {
        self.check_error()?;
        match self.sender.try_send(ChildStdinCommand::Write(bytes)) {
            Ok(()) => Ok(true),
            Err(TrySendError::Full(_)) => Ok(false),
            Err(TrySendError::Disconnected(_)) => self
                .check_error()
                .and_then(|()| Err(NativeError::new("EPIPE", "child stdin writer is closed"))),
        }
    }

    pub(super) fn try_close(&self) -> Result<bool, NativeError> {
        self.check_error()?;
        match self.sender.try_send(ChildStdinCommand::Close) {
            Ok(()) => Ok(true),
            Err(TrySendError::Full(_)) => Ok(false),
            Err(TrySendError::Disconnected(_)) => Ok(true),
        }
    }

    fn check_error(&self) -> Result<(), NativeError> {
        self.error
            .lock()
            .expect("child stdin error lock")
            .clone()
            .map_or(Ok(()), Err)
    }
}

pub(super) struct ChildPipeReader {
    receiver: Mutex<Receiver<ChildPipeEvent>>,
}

pub(super) enum ChildPipeEvent {
    Data(Vec<u8>),
    Eof,
    Error(io::Error),
}

impl ChildPipeReader {
    pub(super) fn try_read(&self) -> Result<Option<ChildPipeEvent>, NativeError> {
        match self.receiver.lock().expect("child pipe lock").try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(NativeError::new(
                "EIO",
                "child pipe reader stopped unexpectedly",
            )),
        }
    }
}

pub(super) struct TcpListenerResource {
    pub(super) closed: AtomicBool,
    pub(super) listener: TcpListener,
}

pub(super) struct TcpStreamResource {
    pub(super) closed: AtomicBool,
    pub(super) stream: TcpStream,
}

pub(super) struct UdpSocketResource {
    pub(super) closed: AtomicBool,
    pub(super) socket: UdpSocket,
}

pub(super) struct TlsListenerResource {
    pub(super) closed: AtomicBool,
    pub(super) config: Arc<rustls::ServerConfig>,
    pub(super) listener: TcpListener,
}

pub(super) struct TlsAcceptedResource {
    pub(super) closed: AtomicBool,
    pub(super) config: Arc<rustls::ServerConfig>,
    pub(super) socket: TcpStream,
}

pub(super) struct TlsStreamResource {
    pub(super) closed: AtomicBool,
    pub(super) stream: Mutex<TlsStream>,
}

impl ResourceTable {
    pub(super) fn insert_child(&self, owner: u64, mut child: Child) -> (u64, u32) {
        let pid = child.id();
        let resource = ChildProcessResource {
            stderr: child.stderr.take().map(child_pipe_reader),
            stdin: child.stdin.take().map(child_stdin_writer),
            stdout: child.stdout.take().map(child_pipe_reader),
            child: Mutex::new(child),
            closed: AtomicBool::new(false),
        };
        (
            self.insert(owner, Resource::ChildProcess(Arc::new(resource))),
            pid,
        )
    }

    pub(super) fn insert_listener(&self, owner: u64, listener: TcpListener) -> u64 {
        self.insert(
            owner,
            Resource::TcpListener(Arc::new(TcpListenerResource {
                closed: AtomicBool::new(false),
                listener,
            })),
        )
    }

    pub(super) fn insert_stream(&self, owner: u64, stream: TcpStream) -> u64 {
        self.insert(
            owner,
            Resource::TcpStream(Arc::new(TcpStreamResource {
                closed: AtomicBool::new(false),
                stream,
            })),
        )
    }

    pub(super) fn insert_udp_socket(&self, owner: u64, socket: UdpSocket) -> u64 {
        self.insert(
            owner,
            Resource::UdpSocket(Arc::new(UdpSocketResource {
                closed: AtomicBool::new(false),
                socket,
            })),
        )
    }

    pub(super) fn insert_tls_listener(
        &self,
        owner: u64,
        listener: TcpListener,
        config: Arc<rustls::ServerConfig>,
    ) -> u64 {
        self.insert(
            owner,
            Resource::TlsListener(Arc::new(TlsListenerResource {
                closed: AtomicBool::new(false),
                config,
                listener,
            })),
        )
    }

    pub(super) fn insert_tls_stream(&self, owner: u64, stream: TlsStream) -> u64 {
        self.insert(
            owner,
            Resource::TlsStream(Arc::new(TlsStreamResource {
                closed: AtomicBool::new(false),
                stream: Mutex::new(stream),
            })),
        )
    }

    pub(super) fn insert_tls_accepted(
        &self,
        owner: u64,
        socket: TcpStream,
        config: Arc<rustls::ServerConfig>,
    ) -> u64 {
        self.insert(
            owner,
            Resource::TlsAccepted(Arc::new(TlsAcceptedResource {
                closed: AtomicBool::new(false),
                config,
                socket,
            })),
        )
    }

    pub(super) fn replace_with_tls_stream(
        &self,
        owner: u64,
        id: u64,
        stream: TlsStream,
    ) -> Result<(), NativeError> {
        let mut resources = self.inner.resources.lock().expect("resource table lock");
        let Some(resource) = resources
            .get_mut(&id)
            .filter(|resource| resource.owner == owner)
        else {
            let resource = Resource::TlsStream(Arc::new(TlsStreamResource {
                closed: AtomicBool::new(false),
                stream: Mutex::new(stream),
            }));
            close_resource(&resource);
            return Err(resource_error(id));
        };
        resource.resource = Resource::TlsStream(Arc::new(TlsStreamResource {
            closed: AtomicBool::new(false),
            stream: Mutex::new(stream),
        }));
        Ok(())
    }

    fn insert(&self, owner: u64, resource: Resource) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.inner
            .resources
            .lock()
            .expect("resource table lock")
            .insert(
                id,
                OwnedResource {
                    owner,
                    referenced: true,
                    resource,
                },
            );
        id
    }

    pub(super) fn has_referenced(&self, owner: u64) -> bool {
        self.inner
            .resources
            .lock()
            .expect("resource table lock")
            .values()
            .any(|resource| resource.owner == owner && resource.referenced)
    }

    pub(super) fn set_referenced(
        &self,
        owner: u64,
        id: u64,
        referenced: bool,
    ) -> Result<(), NativeError> {
        let mut resources = self.inner.resources.lock().expect("resource table lock");
        let resource = resources
            .get_mut(&id)
            .filter(|resource| resource.owner == owner)
            .ok_or_else(|| resource_error(id))?;
        resource.referenced = referenced;
        Ok(())
    }

    pub(super) fn get(&self, owner: u64, id: u64) -> Result<Resource, NativeError> {
        let resources = self.inner.resources.lock().expect("resource table lock");
        let resource = resources
            .get(&id)
            .filter(|resource| resource.owner == owner)
            .ok_or_else(|| resource_error(id))?;
        Ok(resource.resource.clone())
    }

    pub(super) fn close(&self, owner: u64, id: u64) -> Result<(), NativeError> {
        let resource = {
            let mut resources = self.inner.resources.lock().expect("resource table lock");
            if resources
                .get(&id)
                .is_none_or(|resource| resource.owner != owner)
            {
                return Err(resource_error(id));
            }
            resources.remove(&id).expect("resource ownership checked")
        };
        close_resource(&resource.resource);
        Ok(())
    }

    pub(super) fn close_owner(&self, owner: u64) {
        let removed = {
            let mut resources = self.inner.resources.lock().expect("resource table lock");
            let ids = resources
                .iter()
                .filter_map(|(id, resource)| (resource.owner == owner).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| resources.remove(&id))
                .collect::<Vec<_>>()
        };
        for resource in removed {
            close_resource(&resource.resource);
        }
    }

    pub(super) fn close_all(&self) {
        let removed = {
            let mut resources = self.inner.resources.lock().expect("resource table lock");
            resources
                .drain()
                .map(|(_, resource)| resource)
                .collect::<Vec<_>>()
        };
        for resource in removed {
            close_resource(&resource.resource);
        }
    }
}

fn child_pipe_reader(mut pipe: impl Read + Send + 'static) -> ChildPipeReader {
    const PIPE_QUEUE_CAPACITY: usize = 8;
    let (sender, receiver) = sync_channel(PIPE_QUEUE_CAPACITY);
    thread::Builder::new()
        .name("ass-child-pipe".to_owned())
        .spawn(move || {
            let mut buffer = vec![0_u8; 64 * 1024];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) => {
                        let _ = sender.send(ChildPipeEvent::Eof);
                        return;
                    }
                    Ok(length) => {
                        if sender
                            .send(ChildPipeEvent::Data(buffer[..length].to_vec()))
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(error) => {
                        let _ = sender.send(ChildPipeEvent::Error(error));
                        return;
                    }
                }
            }
        })
        .expect("child pipe reader starts");
    ChildPipeReader {
        receiver: Mutex::new(receiver),
    }
}

fn child_stdin_writer(mut pipe: ChildStdin) -> ChildStdinWriter {
    const PIPE_QUEUE_CAPACITY: usize = 8;
    let (sender, receiver) = sync_channel(PIPE_QUEUE_CAPACITY);
    let error = Arc::new(Mutex::new(None));
    let writer_error = error.clone();
    thread::Builder::new()
        .name("ass-child-stdin".to_owned())
        .spawn(move || {
            while let Ok(command) = receiver.recv() {
                let result = match command {
                    ChildStdinCommand::Close => return,
                    ChildStdinCommand::Write(bytes) => {
                        pipe.write_all(&bytes).and_then(|()| pipe.flush())
                    }
                };
                if let Err(value) = result {
                    *writer_error.lock().expect("child stdin error lock") =
                        Some(NativeError::io(value, "write", None));
                    return;
                }
            }
        })
        .expect("child stdin writer starts");
    ChildStdinWriter { error, sender }
}

#[derive(Deserialize)]
struct ResourceArgs {
    resource: u64,
}

#[derive(Deserialize)]
struct SetReferencedArgs {
    referenced: bool,
    resource: u64,
}

pub(super) fn execute(
    resources: &ResourceTable,
    realm: u64,
    operation: &str,
    args: Value,
) -> NativeResult {
    let op = format!("resource.{operation}");
    match operation {
        "hasReferenced" => Ok(json!({ "referenced": resources.has_referenced(realm) })),
        "setReferenced" => {
            let args: SetReferencedArgs = parse(args, &op)?;
            resources.set_referenced(realm, args.resource, args.referenced)?;
            Ok(Value::Null)
        }
        "isReferenced" => {
            let args: ResourceArgs = parse(args, &op)?;
            let resources = resources
                .inner
                .resources
                .lock()
                .expect("resource table lock");
            let referenced = resources
                .get(&args.resource)
                .filter(|resource| resource.owner == realm)
                .ok_or_else(|| resource_error(args.resource))?
                .referenced;
            Ok(json!({ "referenced": referenced }))
        }
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

fn close_resource(resource: &Resource) {
    match resource {
        Resource::ChildProcess(process) => {
            process.closed.store(true, Ordering::Release);
            if let Ok(mut child) = process.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        Resource::TcpListener(listener) => listener.closed.store(true, Ordering::Release),
        Resource::TcpStream(stream) => {
            stream.closed.store(true, Ordering::Release);
            let _ = stream.stream.shutdown(Shutdown::Both);
        }
        Resource::TlsAccepted(stream) => {
            stream.closed.store(true, Ordering::Release);
            let _ = stream.socket.shutdown(Shutdown::Both);
        }
        Resource::TlsListener(listener) => listener.closed.store(true, Ordering::Release),
        Resource::TlsStream(stream) => {
            stream.closed.store(true, Ordering::Release);
            if let Ok(mut tls) = stream.stream.lock() {
                match &mut *tls {
                    TlsStream::Client(stream) => {
                        let _ = stream.sock.shutdown(Shutdown::Both);
                    }
                    TlsStream::Server(stream) => {
                        let _ = stream.sock.shutdown(Shutdown::Both);
                    }
                }
            }
        }
        Resource::UdpSocket(socket) => socket.closed.store(true, Ordering::Release),
    }
}

fn resource_error(id: u64) -> NativeError {
    NativeError {
        code: "ERR_ASS_RESOURCE_CLOSED".to_owned(),
        message: format!("native resource {id} is closed or belongs to another realm"),
        path: None,
        syscall: Some("resource".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::ResourceTable;

    #[test]
    fn resources_are_owned_by_their_realm() {
        let table = ResourceTable::default();
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
        let id = table.insert_listener(7, listener);
        assert!(table.get(7, id).is_ok());
        assert!(table.get(8, id).is_err());
        table.close_owner(7);
        assert!(table.get(7, id).is_err());
    }

    #[test]
    fn referenced_resources_are_tracked_per_realm() {
        let table = ResourceTable::default();
        let first = table.insert_listener(7, TcpListener::bind(("127.0.0.1", 0)).unwrap());
        let _second = table.insert_listener(8, TcpListener::bind(("127.0.0.1", 0)).unwrap());
        assert!(table.has_referenced(7));
        table.set_referenced(7, first, false).unwrap();
        assert!(!table.has_referenced(7));
        assert!(table.has_referenced(8));
    }
}
