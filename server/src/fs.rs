//! File and printer access for the file functions of PowerScript (fileopen, filewrite, filedelete ...) and for raw label printing.
//!
//! The original application read and wrote files on the user's machine.  The desktop shell runs this server on the same machine
//! and allows every path (`FS_UNRESTRICTED=1`); a standalone server confines all paths to `FS_ROOT` (default `./files`).

use std::path::{Component, Path, PathBuf};

use axum::Json;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

fn root() -> Option<PathBuf> {
    if std::env::var("FS_UNRESTRICTED").is_ok() {
        return None;
    }
    Some(PathBuf::from(std::env::var("FS_ROOT").unwrap_or_else(|_| "files".to_string())))
}

/// map a client path (Windows style or not) to a real path
pub fn resolve(p: &str) -> Result<PathBuf, String> {
    let mut norm = p.replace('\\', "/");
    if norm.len() >= 2 && norm.as_bytes()[1] == b':' {
        norm = norm[2..].to_string(); // drive letter
    }
    match root() {
        None => Ok(PathBuf::from(norm)),
        Some(r) => {
            let mut out = r.clone();
            for c in Path::new(&norm).components() {
                match c {
                    Component::Normal(s) => out.push(s),
                    Component::ParentDir => return Err("path escapes the file area".into()),
                    _ => {}
                }
            }
            Ok(out)
        }
    }
}

#[derive(Deserialize)]
pub struct PathReq {
    path: String,
}

#[derive(Deserialize)]
pub struct WriteReq {
    path: String,
    data: String,
    #[serde(default)]
    append: bool,
}

#[derive(Deserialize)]
pub struct CopyReq {
    from: String,
    to: String,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Deserialize)]
pub struct RawReq {
    printer: String,
    data: String,
}

fn err(m: impl ToString) -> Json<Value> {
    Json(json!({"error": {"code": "FS", "message": m.to_string()}}))
}

pub async fn read(Json(r): Json<PathReq>) -> Json<Value> {
    match resolve(&r.path) {
        Ok(p) => match tokio::fs::read(&p).await {
            Ok(b) => Json(json!({"exists": true, "data": base64::engine::general_purpose::STANDARD.encode(b)})),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Json(json!({"exists": false})),
            Err(e) => err(e),
        },
        Err(e) => err(e),
    }
}

pub async fn write(Json(r): Json<WriteReq>) -> Json<Value> {
    let bytes = match base64::engine::general_purpose::STANDARD.decode(&r.data) {
        Ok(b) => b,
        Err(e) => return err(e),
    };
    match resolve(&r.path) {
        Ok(p) => {
            if let Some(dir) = p.parent() {
                let _ = tokio::fs::create_dir_all(dir).await;
            }
            use tokio::io::AsyncWriteExt;
            let f = tokio::fs::OpenOptions::new().create(true).write(true).append(r.append).truncate(!r.append).open(&p).await;
            match f {
                Ok(mut f) => match f.write_all(&bytes).await {
                    Ok(_) => Json(json!({"ok": true, "size": bytes.len()})),
                    Err(e) => err(e),
                },
                Err(e) => err(e),
            }
        }
        Err(e) => err(e),
    }
}

pub async fn exists(Json(r): Json<PathReq>) -> Json<Value> {
    match resolve(&r.path) {
        Ok(p) => match tokio::fs::metadata(&p).await {
            Ok(m) => Json(json!({"exists": true, "dir": m.is_dir(), "size": m.len()})),
            Err(_) => Json(json!({"exists": false})),
        },
        Err(e) => err(e),
    }
}

pub async fn delete(Json(r): Json<PathReq>) -> Json<Value> {
    match resolve(&r.path) {
        Ok(p) => match tokio::fs::remove_file(&p).await {
            Ok(_) => Json(json!({"ok": true})),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Json(json!({"ok": false})),
            Err(e) => err(e),
        },
        Err(e) => err(e),
    }
}

pub async fn copy(Json(r): Json<CopyReq>) -> Json<Value> {
    match (resolve(&r.from), resolve(&r.to)) {
        (Ok(a), Ok(b)) => {
            if !r.overwrite && tokio::fs::metadata(&b).await.is_ok() {
                return Json(json!({"ok": false}));
            }
            match tokio::fs::copy(&a, &b).await {
                Ok(_) => Json(json!({"ok": true})),
                Err(e) => err(e),
            }
        }
        (Err(e), _) | (_, Err(e)) => err(e),
    }
}

/// send raw bytes (TSPL / ESC-POS) to a printer queue
pub async fn print_raw(Json(r): Json<RawReq>) -> Json<Value> {
    let bytes = match base64::engine::general_purpose::STANDARD.decode(&r.data) {
        Ok(b) => b,
        Err(e) => return err(e),
    };
    match tokio::task::spawn_blocking(move || raw_to_printer(&r.printer, &bytes)).await {
        Ok(Ok(())) => Json(json!({"ok": true})),
        Ok(Err(e)) => err(e),
        Err(e) => err(e),
    }
}

#[cfg(windows)]
fn raw_to_printer(printer: &str, data: &[u8]) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Printing::{ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W};
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() };
    let name = wide(printer);
    let doc = wide("Trader");
    let datatype = wide("RAW");
    unsafe {
        let mut h: *mut core::ffi::c_void = null_mut();
        if OpenPrinterW(name.as_ptr(), &mut h, null_mut()) == 0 {
            return Err(format!("cannot open printer {printer}"));
        }
        let info = DOC_INFO_1W { pDocName: doc.as_ptr() as *mut u16, pOutputFile: null_mut(), pDatatype: datatype.as_ptr() as *mut u16 };
        let result = if StartDocPrinterW(h, 1, &info) == 0 {
            Err("StartDocPrinter failed".to_string())
        } else {
            let mut written = 0u32;
            StartPagePrinter(h);
            let ok = WritePrinter(h, data.as_ptr() as *const core::ffi::c_void, data.len() as u32, &mut written);
            EndPagePrinter(h);
            EndDocPrinter(h);
            if ok == 0 {
                Err("WritePrinter failed".to_string())
            } else {
                Ok(())
            }
        };
        ClosePrinter(h);
        result
    }
}

#[cfg(not(windows))]
fn raw_to_printer(printer: &str, _data: &[u8]) -> Result<(), String> {
    Err(format!("raw printing to {printer} is only available on Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confined_paths() {
        std::env::remove_var("FS_UNRESTRICTED");
        std::env::set_var("FS_ROOT", "area");
        assert_eq!(resolve("C:\\data\\a.txt").unwrap(), PathBuf::from("area/data/a.txt"));
        assert!(resolve("..\\x").is_err());
        assert!(resolve("a/../../x").is_err());
    }
}
