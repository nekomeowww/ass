use std::sync::{Arc, Mutex, mpsc};

type Job = Box<dyn FnOnce() + Send + 'static>;

const MAX_QUEUED_JOBS: usize = 1_024;
const MAX_WORKERS: usize = 16;
const MIN_WORKERS: usize = 4;

#[derive(Clone)]
pub(crate) struct NativeExecutor {
    sender: mpsc::SyncSender<Job>,
}

impl Default for NativeExecutor {
    fn default() -> Self {
        let workers = std::thread::available_parallelism()
            .map_or(MIN_WORKERS, usize::from)
            .clamp(MIN_WORKERS, MAX_WORKERS);
        Self::new("ass-native", workers, MAX_QUEUED_JOBS)
    }
}

impl NativeExecutor {
    pub(crate) fn new(name: &str, workers: usize, queued_jobs: usize) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Job>(queued_jobs);
        let receiver = Arc::new(Mutex::new(receiver));
        for index in 0..workers {
            let receiver = receiver.clone();
            std::thread::Builder::new()
                .name(format!("{name}-{index}"))
                .spawn(move || worker(receiver))
                .expect("native worker thread starts");
        }
        Self { sender }
    }

    pub(crate) fn submit(&self, job: impl FnOnce() + Send + 'static) -> Result<(), SubmitError> {
        self.sender
            .try_send(Box::new(job))
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => SubmitError::Full,
                mpsc::TrySendError::Disconnected(_) => SubmitError::Stopped,
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SubmitError {
    Full,
    Stopped,
}

fn worker(receiver: Arc<Mutex<mpsc::Receiver<Job>>>) {
    loop {
        let job = receiver.lock().expect("native work queue lock").recv();
        let Ok(job) = job else {
            return;
        };
        job();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::NativeExecutor;

    #[test]
    fn executes_submitted_work() {
        let executor = NativeExecutor::default();
        let (sender, receiver) = mpsc::channel();
        executor
            .submit(move || sender.send(42).expect("test receiver remains open"))
            .expect("work queue accepts a job");
        assert_eq!(receiver.recv().expect("worker sends a result"), 42);
    }
}
