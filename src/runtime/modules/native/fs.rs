use std::{
    fs,
    io::{self, Write},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    codec::{decode_base64, encode_base64},
    error::{NativeError, NativeResult, parse},
};

pub(super) fn execute(operation: &str, args: Value) -> NativeResult {
    let op = format!("fs.{operation}");
    match operation {
        "readFile" => read_file(parse(args, &op)?),
        "writeFile" => write_file(parse(args, &op)?),
        "readdir" => readdir(parse(args, &op)?),
        "stat" => stat(parse(args, &op)?, false),
        "lstat" => stat(parse(args, &op)?, true),
        "mkdir" => mkdir(parse(args, &op)?),
        "rm" => rm(parse(args, &op)?),
        "unlink" => unlink(parse(args, &op)?),
        "rename" => rename(parse(args, &op)?),
        "copyFile" => copy_file(parse(args, &op)?),
        "access" => access(parse(args, &op)?),
        "realpath" => realpath(parse(args, &op)?),
        _ => Err(NativeError::unknown_operation(&op)),
    }
}

#[derive(Deserialize)]
struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
struct WriteFileArgs {
    append: Option<bool>,
    data: String,
    path: String,
}

#[derive(Deserialize)]
struct MkdirArgs {
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
struct RmArgs {
    force: Option<bool>,
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
struct TwoPathArgs {
    from: String,
    to: String,
}

fn read_file(args: PathArgs) -> NativeResult {
    fs::read(&args.path)
        .map(|bytes| json!({ "base64": encode_base64(bytes) }))
        .map_err(|error| NativeError::io(error, "read", Some(args.path)))
}

fn write_file(args: WriteFileArgs) -> NativeResult {
    let bytes = decode_base64(&args.data).map_err(|error| NativeError {
        code: "ERR_INVALID_ARG_VALUE".to_owned(),
        message: format!("invalid base64 file data: {error}"),
        path: Some(args.path.clone()),
        syscall: Some("write".to_owned()),
    })?;
    let result = if args.append.unwrap_or(false) {
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&args.path)
            .and_then(|mut file| file.write_all(&bytes))
    } else {
        fs::write(&args.path, bytes)
    };
    result
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "write", Some(args.path)))
}

fn readdir(args: PathArgs) -> NativeResult {
    fs::read_dir(&args.path)
        .and_then(|entries| {
            let mut entries = entries
                .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
                .collect::<io::Result<Vec<_>>>()?;
            entries.sort();
            Ok(entries)
        })
        .map(|entries| json!(entries))
        .map_err(|error| NativeError::io(error, "scandir", Some(args.path)))
}

fn stat(args: PathArgs, symbolic: bool) -> NativeResult {
    let result = if symbolic {
        fs::symlink_metadata(&args.path)
    } else {
        fs::metadata(&args.path)
    };
    result
        .map(|metadata| {
            serde_json::to_value(metadata_value(&metadata)).expect("metadata serializes")
        })
        .map_err(|error| {
            NativeError::io(
                error,
                if symbolic { "lstat" } else { "stat" },
                Some(args.path),
            )
        })
}

fn mkdir(args: MkdirArgs) -> NativeResult {
    let result = if args.recursive.unwrap_or(false) {
        fs::create_dir_all(&args.path)
    } else {
        fs::create_dir(&args.path)
    };
    result
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "mkdir", Some(args.path)))
}

fn rm(args: RmArgs) -> NativeResult {
    let result = match fs::symlink_metadata(&args.path) {
        Ok(metadata) if metadata.is_dir() && args.recursive.unwrap_or(false) => {
            fs::remove_dir_all(&args.path)
        }
        Ok(metadata) if metadata.is_dir() => fs::remove_dir(&args.path),
        Ok(_) => fs::remove_file(&args.path),
        Err(error) if error.kind() == io::ErrorKind::NotFound && args.force.unwrap_or(false) => {
            Ok(())
        }
        Err(error) => Err(error),
    };
    result
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "rm", Some(args.path)))
}

fn unlink(args: PathArgs) -> NativeResult {
    fs::remove_file(&args.path)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "unlink", Some(args.path)))
}

fn rename(args: TwoPathArgs) -> NativeResult {
    fs::rename(&args.from, &args.to)
        .map(|()| Value::Null)
        .map_err(|error| NativeError::io(error, "rename", Some(args.from)))
}

fn copy_file(args: TwoPathArgs) -> NativeResult {
    fs::copy(&args.from, &args.to)
        .map(|_| Value::Null)
        .map_err(|error| NativeError::io(error, "copyfile", Some(args.from)))
}

fn access(args: PathArgs) -> NativeResult {
    fs::metadata(&args.path)
        .map(|_| Value::Null)
        .map_err(|error| NativeError::io(error, "access", Some(args.path)))
}

fn realpath(args: PathArgs) -> NativeResult {
    fs::canonicalize(&args.path)
        .map(|path| json!(path.to_string_lossy()))
        .map_err(|error| NativeError::io(error, "realpath", Some(args.path)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataValue {
    atime_ms: f64,
    birthtime_ms: f64,
    is_directory: bool,
    is_file: bool,
    is_symbolic_link: bool,
    mtime_ms: f64,
    size: u64,
}

fn metadata_value(metadata: &fs::Metadata) -> MetadataValue {
    MetadataValue {
        atime_ms: system_time_ms(metadata.accessed()),
        birthtime_ms: system_time_ms(metadata.created()),
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symbolic_link: metadata.file_type().is_symlink(),
        mtime_ms: system_time_ms(metadata.modified()),
        size: metadata.len(),
    }
}

fn system_time_ms(value: io::Result<SystemTime>) -> f64 {
    value
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |duration| duration.as_secs_f64() * 1000.0)
}
