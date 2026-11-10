//! HTTP relay to the local FBR fiscal service.
//!
//! The original posted each invoice's JSON to the FBR IMS component on the shop's own computer
//! (`http://localhost:8524/api/IMSFiscal/...`): the FiscalizationApp through PowerBuilder's Inet object, the stored
//! procedure SP_RequestHttpWebService through MSXML2.ServerXMLHttp.  The UI runtime cannot call that service itself
//! (a browser page has no access to it), so the server sends the request.  Like the fiscal relay, it only reaches this
//! computer or the local network, and only plain `http://` GET / POST as the originals did.
use std::time::Duration;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Instant};

use crate::fiscal::local_target;
use crate::AppState;

const MAX_BODY: usize = 1 << 20;
const MAX_RESPONSE: usize = 4 << 20;

#[derive(Deserialize)]
pub struct InetReq {
    pub url: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub content_type: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct InetResp {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn failed(error: impl std::fmt::Display) -> Json<InetResp> {
    Json(InetResp { ok: false, status: None, body: None, error: Some(error.to_string()) })
}

/// `http://host[:port]/path?query` -> (host, port, authority for the Host header, request target)
pub fn parse_url(url: &str) -> Result<(String, u16, String, String), String> {
    let url = url.trim();
    let rest = match url.get(..7) {
        Some(p) if p.eq_ignore_ascii_case("http://") => &url[7..],
        _ => return Err("only http:// addresses are supported".into()),
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.is_empty() || authority.contains('@') {
        return Err("invalid address".into());
    }
    let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
        let close = v6.find(']').ok_or("invalid address")?;
        let after = &v6[close + 1..];
        let port = match after.strip_prefix(':') {
            Some(p) => p.parse::<u16>().map_err(|_| "invalid port")?,
            None if after.is_empty() => 80,
            None => return Err("invalid address".into()),
        };
        (v6[..close].to_string(), port)
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|_| "invalid port")?),
            None => (authority.to_string(), 80),
        }
    };
    if host.is_empty() || port == 0 {
        return Err("invalid address".into());
    }
    let tail = tail.split('#').next().unwrap_or("");
    let target = if tail.is_empty() {
        "/".to_string()
    } else if tail.starts_with('?') {
        format!("/{tail}")
    } else {
        tail.to_string()
    };
    Ok((host, port, authority.to_string(), encode_target(&target)))
}

/// percent-encode what may not appear in a request line (blanks, quotes, braces, non-ASCII), as WinINet and MSXML do
/// with an address that carries raw JSON parameters
pub fn encode_target(target: &str) -> String {
    let mut out = String::with_capacity(target.len());
    for b in target.bytes() {
        let keep = b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&b);
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// status code and body of a complete HTTP/1.x response (Content-Length, chunked or read to the end)
pub fn parse_response(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("incomplete response")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.split_whitespace();
    if !parts.next().is_some_and(|v| v.starts_with("HTTP/")) {
        return Err("not an HTTP response".into());
    }
    let status: u16 = parts.next().and_then(|s| s.parse().ok()).ok_or("invalid status line")?;
    let mut length: Option<usize> = None;
    let mut chunked = false;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let (name, value) = (name.trim().to_ascii_lowercase(), value.trim());
            if name == "content-length" {
                length = value.parse().ok();
            } else if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            }
        }
    }
    let rest = &raw[split + 4..];
    if chunked {
        return Ok((status, dechunk(rest)?));
    }
    Ok((status, match length {
        Some(n) => rest[..n.min(rest.len())].to_vec(),
        None => rest.to_vec(),
    }))
}

fn dechunk(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let eol = data.windows(2).position(|w| w == b"\r\n").ok_or("incomplete chunk")?;
        let size_text = String::from_utf8_lossy(&data[..eol]);
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16).map_err(|_| "invalid chunk size")?;
        data = &data[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if data.len() < size {
            return Err("incomplete chunk".into());
        }
        out.extend_from_slice(&data[..size]);
        data = data.get(size + 2..).unwrap_or(&[]);
    }
}

/// a response is complete once its declared length (or the closing chunk) has arrived; otherwise it ends with the connection
fn complete(raw: &[u8]) -> bool {
    let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") else { return false };
    let head = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
    let body = &raw[split + 4..];
    if head.contains("transfer-encoding:") && head.contains("chunked") {
        return body.ends_with(b"0\r\n\r\n");
    }
    head.split("\r\n")
        .find_map(|l| l.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()))
        .is_some_and(|n| body.len() >= n)
}

pub async fn request(req: InetReq) -> InetResp {
    let fail = |e: String| InetResp { ok: false, status: None, body: None, error: Some(e) };
    let method = if req.method.trim().is_empty() { "GET".to_string() } else { req.method.trim().to_ascii_uppercase() };
    if method != "GET" && method != "POST" {
        return fail("only GET and POST are supported".into());
    }
    if req.body.len() > MAX_BODY {
        return fail("request is too large".into());
    }
    let (host, port, authority, target) = match parse_url(&req.url) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let addr = match local_target(&host, port).await {
        Ok(a) => a,
        Err(e) => return fail(e),
    };
    let mut stream = match timeout(Duration::from_secs(5), TcpStream::connect(addr)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return fail(format!("Cannot connect: {e}")),
        Err(_) => return fail("Cannot connect: timed out".into()),
    };
    let mut head = format!("{method} {target} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\nAccept: */*\r\n");
    if method == "POST" {
        let ct = req.content_type.as_deref().unwrap_or("application/json");
        head.push_str(&format!("Content-Type: {ct}\r\nContent-Length: {}\r\n", req.body.len()));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    if method == "POST" {
        out.extend_from_slice(req.body.as_bytes());
    }
    match timeout(Duration::from_secs(10), stream.write_all(&out)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return fail(format!("Unable to send the request: {e}")),
        Err(_) => return fail("Unable to send the request: timed out".into()),
    }
    // the IMS service contacts FBR before it answers
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut raw = Vec::new();
    let mut buf = vec![0u8; 16384];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match timeout(left, stream.read(&mut buf)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_RESPONSE {
                    return fail("response is too large".into());
                }
                if complete(&raw) {
                    break;
                }
            }
            Ok(Err(e)) => return fail(format!("Unable to read the response: {e}")),
            Err(_) => return fail("The service did not answer in time".into()),
        }
    }
    match parse_response(&raw) {
        Ok((status, body)) => InetResp { ok: true, status: Some(status), body: Some(String::from_utf8_lossy(&body).to_string()), error: None },
        Err(e) => fail(e),
    }
}

pub async fn inet(_: State<AppState>, Json(req): Json<InetReq>) -> Json<InetResp> {
    if req.url.trim().is_empty() {
        return failed("no address");
    }
    Json(request(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn urls() {
        let (h, p, a, t) = parse_url("http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel").unwrap();
        assert_eq!((h.as_str(), p, a.as_str(), t.as_str()), ("localhost", 8524, "localhost:8524", "/api/IMSFiscal/GetInvoiceNumberByModel"));
        let (h, p, _, t) = parse_url("HTTP://127.0.0.1?x=1").unwrap();
        assert_eq!((h.as_str(), p, t.as_str()), ("127.0.0.1", 80, "/?x=1"));
        let (h, p, _, _) = parse_url("http://[::1]:9000/").unwrap();
        assert_eq!((h.as_str(), p), ("::1", 9000));
        assert!(parse_url("https://localhost/").is_err());
        assert!(parse_url("http://user@localhost/").is_err());
        assert!(parse_url("http://localhost:x/").is_err());
    }

    #[test]
    fn raw_json_in_a_get_address_is_encoded() {
        assert_eq!(encode_target("/api/Get?{\"A\":\"b c\"}"), "/api/Get?%7B%22A%22:%22b%20c%22%7D");
    }

    #[test]
    fn responses() {
        let r = parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloEXTRA").unwrap();
        assert_eq!(r, (200, b"hello".to_vec()));
        let r = parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"In\r\n3;x=1\r\nv\"}\r\n0\r\n\r\n").unwrap();
        assert_eq!(r, (200, b"{\"Inv\"}".to_vec()));
        let r = parse_response(b"HTTP/1.0 500 Internal\r\n\r\nall of it").unwrap();
        assert_eq!(r, (500, b"all of it".to_vec()));
        assert!(parse_response(b"garbage").is_err());
        assert!(complete(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
        assert!(!complete(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nok"));
    }

    #[tokio::test]
    async fn posts_json_to_a_local_service_and_returns_its_answer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 4096];
            while !String::from_utf8_lossy(&got).contains("\"Items\":[]}") {
                let n = s.read(&mut buf).await.unwrap();
                got.extend_from_slice(&buf[..n]);
            }
            let reply = "{\"InvoiceNumber\":\"900001ABC\",\"Code\":\"100\",\"Response\":\"Fiscal Invoice Number generated successfully.\"}";
            s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{reply}", reply.len()).as_bytes()).await.unwrap();
            String::from_utf8(got).unwrap()
        });
        let r = request(InetReq {
            url: format!("http://127.0.0.1:{port}/api/IMSFiscal/GetInvoiceNumberByModel"),
            method: "POST".into(),
            body: "{\"USIN\":\"7\",\"Items\":[]}".into(),
            content_type: None,
        })
        .await;
        let sent = server.await.unwrap();
        assert!(sent.starts_with("POST /api/IMSFiscal/GetInvoiceNumberByModel HTTP/1.1\r\n"));
        assert!(sent.contains("Content-Type: application/json\r\n") && sent.contains("Content-Length: 23\r\n"));
        assert!(r.ok && r.status == Some(200));
        assert!(r.body.unwrap().starts_with("{\"InvoiceNumber\":\"900001ABC\",\"Code\":\"100\""));
    }

    #[tokio::test]
    async fn a_public_address_is_refused() {
        let r = request(InetReq { url: "http://8.8.8.8/".into(), method: "GET".into(), body: String::new(), content_type: None }).await;
        assert!(!r.ok && r.error.unwrap().contains("local network"));
    }
}
