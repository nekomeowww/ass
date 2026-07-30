use std::path::PathBuf;

use clap::{ArgAction, Parser, Subcommand};

pub(crate) mod commands;
pub(crate) mod shared;

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Manage the reusable background WebView runtime.
    Daemon {
        #[command(subcommand)]
        action: DaemonCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum DaemonCommand {
    /// Start the daemon in the background.
    Start,
    /// Report whether the daemon is running.
    Status,
    /// Stop the running daemon.
    Stop,
    /// Run the daemon in the foreground. Used internally by `start`.
    #[command(hide = true)]
    Serve,
}

#[derive(Debug, Parser)]
#[command(
    name = "ass",
    version,
    about = "Run JavaScript and TypeScript in the system WebView"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Evaluate a script.
    #[arg(short = 'e', long = "eval", value_name = "CODE", conflicts_with_all = ["print", "file"])]
    pub eval: Option<String>,

    /// Evaluate an expression and print its result.
    #[arg(short = 'p', long = "print", value_name = "CODE", conflicts_with_all = ["eval", "file"])]
    pub print: Option<String>,

    /// Parse eval, print, stdin, or REPL input as TypeScript.
    #[arg(long = "ts", action = ArgAction::SetTrue)]
    pub typescript: bool,

    /// Force ES module mode. Usually inferred from syntax or .mjs/.mts.
    #[arg(short = 'm', long = "module", action = ArgAction::SetTrue)]
    pub module: bool,

    /// Execute one-shot input in the reusable background WebView.
    #[arg(long, action = ArgAction::SetTrue)]
    pub reuse: bool,

    /// Script file. TypeScript extensions are transpiled with oxc.
    #[arg(value_name = "FILE")]
    pub file: Option<PathBuf>,
}
