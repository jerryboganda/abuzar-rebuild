//! Fiscal-service relay.
//!
//! The original client opened a raw TCP socket to a local fiscal service and sent `S<invoice code>`.
//! A browser cannot open raw TCP, so the desktop/server process performs that hop instead.  The
//! endpoint is also used as a connection probe (`data` empty) so the UI can show the original
//! "Connection refused" path when no fiscal service is running.
//!
//! The service sits on the same machine or on the local network, as it did for the original client: a
//! host that resolves to a public address is refused, so the relay cannot be used to reach the internet.
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpStream};
use tokio::time::timeout;

use crate::AppState;

/// `S<invoice code>` is a few bytes long; anything bigger is not a fiscal request
const MAX_REQUEST: usize = 4096;

#[derive(Deserialize)]
pub struct FiscalReq {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub data: String,
}

#[derive(Serialize)]
pub struct FiscalResp {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn failed(error: impl std::fmt::Display) -> Json<FiscalResp> {
    Json(FiscalResp { ok: false, response: None, error: Some(error.to_string()) })
}

/// loopback, private (RFC 1918 / unique local) and link-local addresses
fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_loopback() || a.is_private() || a.is_link_local(),
        IpAddr::V6(a) => {
            let first = a.segments()[0];
            a.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// the address to connect to: the first one of the host that is local, none when any of them is public
async fn local_target(host: &str, port: u16) -> Result<SocketAddr, String> {
    let addrs: Vec<SocketAddr> = match timeout(Duration::from_secs(5), lookup_host((host, port))).await {
        Ok(Ok(it)) => it.collect(),
        Ok(Err(e)) => return Err(format!("Connection refused: {e}")),
        Err(_) => return Err("Connection refused: name lookup timed out".into()),
    };
    if addrs.is_empty() {
        return Err("Connection refused: unknown host".into());
    }
    if addrs.iter().any(|a| !is_local(a.ip())) {
        return Err("Fiscalization machine must be on this computer or the local network".into());
    }
    Ok(addrs[0])
}

pub async fn fiscal(_: State<AppState>, Json(req): Json<FiscalReq>) -> Json<FiscalResp> {
    let host = req.host.trim();
    if host.is_empty() || host.len() > 253 || req.port == 0 {
        return failed("Fiscalization machine/port is not configured");
    }
    if req.data.len() > MAX_REQUEST {
        return failed("Fiscalization request is too large");
    }
    let addr = match local_target(host, req.port).await {
        Ok(a) => a,
        Err(e) => return failed(e),
    };
    let stream = match timeout(Duration::from_secs(5), TcpStream::connect(addr)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return failed(format!("Connection refused: {e}")),
        Err(_) => return failed("Connection refused: timed out"),
    };
    // Probe only: the UI calls this from of_connect.
    if req.data.is_empty() {
        return Json(FiscalResp { ok: true, response: None, error: None });
    }
    let mut stream = stream;
    match timeout(Duration::from_secs(5), stream.write_all(req.data.as_bytes())).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return failed(format!("Unable to send to fiscal service: {e}")),
        Err(_) => return failed("Unable to send to fiscal service: timed out"),
    }
    let mut buf = vec![0u8; 8192];
    let n = match timeout(Duration::from_secs(10), stream.read(&mut buf)).await {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => return failed(format!("Unable to read from fiscal service: {e}")),
        Err(_) => return failed("Fiscal service did not answer in time"),
    };
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    Json(FiscalResp { ok: true, response: Some(text), error: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn local_addresses_are_allowed() {
        for a in ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.20", "169.254.3.4", "::1", "fd12:3456::1", "fe80::1"] {
            assert!(is_local(ip(a)), "{a}");
        }
    }

    #[test]
    fn public_addresses_are_refused() {
        for a in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2001:4860:4860::8888"] {
            assert!(!is_local(ip(a)), "{a}");
        }
    }

    #[tokio::test]
    async fn a_public_literal_is_refused_before_any_connection() {
        let r = local_target("8.8.8.8", 9).await;
        assert!(r.unwrap_err().contains("local network"));
    }

    #[tokio::test]
    async fn loopback_resolves_to_itself() {
        assert_eq!(local_target("127.0.0.1", 9).await.unwrap().port(), 9);
    }
}
