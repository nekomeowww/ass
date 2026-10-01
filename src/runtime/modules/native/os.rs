use std::{env, ffi::CStr, path::PathBuf};

use serde::Serialize;

use super::process::{node_arch, node_platform};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CpuSnapshot {
    model: String,
    speed: u32,
    times: CpuTimes,
}

#[derive(Serialize)]
struct CpuTimes {
    idle: u64,
    irq: u64,
    nice: u64,
    sys: u64,
    user: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OsSnapshot {
    arch: &'static str,
    cpus: Vec<CpuSnapshot>,
    endianness: &'static str,
    free_mem: u64,
    home_dir: String,
    hostname: String,
    load_average: [f64; 3],
    machine: String,
    platform: &'static str,
    priority: i32,
    release: String,
    temp_dir: String,
    total_mem: u64,
    type_name: String,
    uptime: f64,
    user_info: UserInfo,
    version: String,
}

#[derive(Serialize)]
struct UserInfo {
    gid: i64,
    homedir: String,
    shell: String,
    uid: i64,
    username: String,
}

pub(crate) fn initialization_script() -> String {
    let encoded = serde_json::to_string(&snapshot()).expect("OS snapshot always serializes");
    format!("globalThis.__assOsSnapshot = {encoded};")
}

fn snapshot() -> OsSnapshot {
    let home_dir = home_dir();
    let (type_name, release, version, machine) = system_identity();
    let cpu_count = std::thread::available_parallelism().map_or(1, usize::from);
    let cpus = (0..cpu_count)
        .map(|_| CpuSnapshot {
            model: machine.clone(),
            speed: 0,
            times: CpuTimes {
                idle: 0,
                irq: 0,
                nice: 0,
                sys: 0,
                user: 0,
            },
        })
        .collect();
    OsSnapshot {
        arch: node_arch(),
        cpus,
        endianness: if cfg!(target_endian = "little") {
            "LE"
        } else {
            "BE"
        },
        free_mem: free_memory(),
        home_dir: home_dir.clone(),
        hostname: hostname(),
        load_average: load_average(),
        machine,
        platform: node_platform(),
        priority: current_priority(),
        release,
        temp_dir: env::temp_dir().to_string_lossy().into_owned(),
        total_mem: total_memory(),
        type_name,
        uptime: uptime(),
        user_info: UserInfo {
            gid: effective_gid(),
            homedir: home_dir,
            shell: env::var("SHELL").unwrap_or_default(),
            uid: effective_uid(),
            username: env::var("USER")
                .or_else(|_| env::var("USERNAME"))
                .unwrap_or_default(),
        },
        version,
    }
}

fn home_dir() -> String {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(unix)]
fn hostname() -> String {
    let mut buffer = [0_i8; 256];
    // SAFETY: buffer is writable for its full length and gethostname writes at most that length.
    if unsafe { libc::gethostname(buffer.as_mut_ptr(), buffer.len()) } == 0 {
        // Ensure a terminator even when the platform truncates the hostname.
        buffer[buffer.len() - 1] = 0;
        // SAFETY: buffer is explicitly null-terminated above.
        unsafe { CStr::from_ptr(buffer.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    }
}

#[cfg(not(unix))]
fn hostname() -> String {
    env::var("COMPUTERNAME").unwrap_or_default()
}

#[cfg(unix)]
fn system_identity() -> (String, String, String, String) {
    // SAFETY: zeroed utsname is a valid output buffer for uname.
    let mut value: libc::utsname = unsafe { std::mem::zeroed() };
    // SAFETY: value points to writable storage for one utsname.
    if unsafe { libc::uname(&mut value) } != 0 {
        return (
            String::new(),
            String::new(),
            String::new(),
            node_arch().to_owned(),
        );
    }
    let field = |value: &[libc::c_char]| {
        // SAFETY: uname fields are fixed-size null-terminated C strings.
        unsafe { CStr::from_ptr(value.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    };
    (
        field(&value.sysname),
        field(&value.release),
        field(&value.version),
        field(&value.machine),
    )
}

#[cfg(not(unix))]
fn system_identity() -> (String, String, String, String) {
    (
        env::consts::OS.to_owned(),
        String::new(),
        String::new(),
        node_arch().to_owned(),
    )
}

#[cfg(unix)]
fn load_average() -> [f64; 3] {
    let mut values = [0.0; 3];
    // SAFETY: values has space for three doubles.
    if unsafe { libc::getloadavg(values.as_mut_ptr(), values.len() as i32) } < 0 {
        [0.0; 3]
    } else {
        values
    }
}

#[cfg(not(unix))]
fn load_average() -> [f64; 3] {
    [0.0; 3]
}

#[cfg(target_os = "linux")]
fn total_memory() -> u64 {
    sysconf_memory(libc::_SC_PHYS_PAGES)
}

#[cfg(target_os = "macos")]
fn total_memory() -> u64 {
    let mut value = 0_u64;
    let mut length = std::mem::size_of::<u64>();
    let mut mib = [libc::CTL_HW, libc::HW_MEMSIZE];
    // SAFETY: value and length describe writable storage for a u64 result.
    if unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            (&mut value as *mut u64).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } == 0
    {
        value
    } else {
        0
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn total_memory() -> u64 {
    0
}

#[cfg(not(unix))]
fn total_memory() -> u64 {
    0
}

#[cfg(target_os = "linux")]
fn free_memory() -> u64 {
    sysconf_memory(libc::_SC_AVPHYS_PAGES)
}

#[cfg(not(target_os = "linux"))]
fn free_memory() -> u64 {
    0
}

#[cfg(target_os = "linux")]
fn sysconf_memory(name: libc::c_int) -> u64 {
    // SAFETY: sysconf has no pointer preconditions.
    let pages = unsafe { libc::sysconf(name) };
    // SAFETY: sysconf has no pointer preconditions.
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if pages > 0 && page_size > 0 {
        (pages as u64).saturating_mul(page_size as u64)
    } else {
        0
    }
}

#[cfg(target_os = "linux")]
fn uptime() -> f64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|value| value.split_whitespace().next()?.parse().ok())
        .unwrap_or(0.0)
}

#[cfg(target_os = "macos")]
fn uptime() -> f64 {
    let mut boot_time: libc::timeval = libc::timeval {
        tv_sec: 0,
        tv_usec: 0,
    };
    let mut length = std::mem::size_of::<libc::timeval>();
    let mut mib = [libc::CTL_KERN, libc::KERN_BOOTTIME];
    // SAFETY: boot_time and length describe writable storage for a timeval result.
    let result = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            (&mut boot_time as *mut libc::timeval).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        return 0.0;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64());
    (now - boot_time.tv_sec as f64 - boot_time.tv_usec as f64 / 1_000_000.0).max(0.0)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn uptime() -> f64 {
    0.0
}

#[cfg(unix)]
fn current_priority() -> i32 {
    // SAFETY: getpriority has no pointer preconditions.
    unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) }
}

#[cfg(not(unix))]
fn current_priority() -> i32 {
    0
}

#[cfg(unix)]
fn effective_uid() -> i64 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() as i64 }
}

#[cfg(not(unix))]
fn effective_uid() -> i64 {
    -1
}

#[cfg(unix)]
fn effective_gid() -> i64 {
    // SAFETY: getegid has no preconditions.
    unsafe { libc::getegid() as i64 }
}

#[cfg(not(unix))]
fn effective_gid() -> i64 {
    -1
}

#[cfg(test)]
mod tests {
    use super::snapshot;

    #[test]
    fn snapshot_has_a_cpu_and_platform_identity() {
        let snapshot = snapshot();
        assert!(!snapshot.cpus.is_empty());
        assert!(!snapshot.arch.is_empty());
        assert!(!snapshot.platform.is_empty());
    }
}
