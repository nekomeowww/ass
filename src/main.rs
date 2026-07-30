mod cli;
mod processors;
mod runtime;

fn main() -> std::process::ExitCode {
    cli::shared::run()
}
