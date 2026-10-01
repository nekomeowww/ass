use std::{
    collections::BTreeMap,
    env,
    io::{self, IsTerminal},
    path::PathBuf,
};

use serde::Serialize;
use serde_json::json;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSnapshot {
    arch: &'static str,
    argv: Vec<String>,
    argv0: String,
    cwd: String,
    env: BTreeMap<String, String>,
    exec_path: String,
    gid: Option<u32>,
    groups: Vec<u32>,
    pid: u32,
    platform: &'static str,
    ppid: u32,
    release: serde_json::Value,
    #[serde(rename = "stderrIsTTY")]
    stderr_is_tty: bool,
    #[serde(rename = "stdinIsTTY")]
    stdin_is_tty: bool,
    #[serde(rename = "stdoutIsTTY")]
    stdout_is_tty: bool,
    uid: Option<u32>,
    version: String,
    versions: serde_json::Value,
}

pub(crate) fn initialization_script() -> String {
    let snapshot = snapshot();
    let encoded = serde_json::to_string(&snapshot).expect("process snapshot always serializes");
    format!("globalThis.__assProcessSnapshot = {encoded};")
}

fn snapshot() -> ProcessSnapshot {
    let argv = env::args().collect::<Vec<_>>();
    let exec_path = env::current_exe().unwrap_or_else(|_| PathBuf::from(&argv[0]));
    let version = env!("CARGO_PKG_VERSION");
    ProcessSnapshot {
        arch: node_arch(),
        argv0: argv.first().cloned().unwrap_or_else(|| "ass".to_owned()),
        argv,
        cwd: env::current_dir()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        env: env::vars().collect(),
        exec_path: exec_path.to_string_lossy().into_owned(),
        gid: effective_gid(),
        groups: supplementary_groups(),
        pid: std::process::id(),
        platform: node_platform(),
        ppid: parent_process_id(),
        release: json!({ "name": "ass", "sourceUrl": env!("CARGO_PKG_REPOSITORY") }),
        stderr_is_tty: io::stderr().is_terminal(),
        stdin_is_tty: io::stdin().is_terminal(),
        stdout_is_tty: io::stdout().is_terminal(),
        uid: effective_uid(),
        version: format!("v{version}"),
        versions: json!({ "ass": version, "node": "24.0.0" }),
    }
}

pub(super) fn node_arch() -> &'static str {
    match env::consts::ARCH {
        "x86_64" => "x64",
        "x86" => "ia32",
        "aarch64" => "arm64",
        "arm" => "arm",
        "riscv64" => "riscv64",
        "s390x" => "s390x",
        "powerpc64" => "ppc64",
        other => other,
    }
}

pub(super) fn node_platform() -> &'static str {
    match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

#[cfg(unix)]
fn parent_process_id() -> u32 {
    // SAFETY: getppid has no preconditions and does not dereference memory.
    unsafe { libc::getppid() as u32 }
}

#[cfg(not(unix))]
fn parent_process_id() -> u32 {
    0
}

#[cfg(unix)]
fn effective_uid() -> Option<u32> {
    // SAFETY: geteuid has no preconditions and does not dereference memory.
    Some(unsafe { libc::geteuid() })
}

#[cfg(not(unix))]
fn effective_uid() -> Option<u32> {
    None
}

#[cfg(unix)]
fn effective_gid() -> Option<u32> {
    // SAFETY: getegid has no preconditions and does not dereference memory.
    Some(unsafe { libc::getegid() })
}

#[cfg(not(unix))]
fn effective_gid() -> Option<u32> {
    None
}

#[cfg(unix)]
fn supplementary_groups() -> Vec<u32> {
    let count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if count <= 0 {
        return Vec::new();
    }
    let mut groups = vec![0; count as usize];
    // SAFETY: groups has space for exactly count gid_t values.
    let written = unsafe { libc::getgroups(count, groups.as_mut_ptr()) };
    if written < 0 {
        Vec::new()
    } else {
        groups.truncate(written as usize);
        groups
    }
}

#[cfg(not(unix))]
fn supplementary_groups() -> Vec<u32> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{node_arch, node_platform, snapshot};

    #[test]
    fn exposes_node_style_platform_names() {
        assert!(!node_arch().is_empty());
        assert!(!node_platform().is_empty());
        if cfg!(target_os = "macos") {
            assert_eq!(node_platform(), "darwin");
        }
    }

    #[test]
    fn preserves_tty_acronym_in_the_bridge_snapshot() {
        let value = serde_json::to_value(snapshot()).expect("process snapshot serializes");
        assert!(value.get("stdinIsTTY").is_some());
        assert!(value.get("stdoutIsTTY").is_some());
        assert!(value.get("stderrIsTTY").is_some());
    }
}
