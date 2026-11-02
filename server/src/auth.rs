//! Optional shared-token protection of the API for LAN use (environment variable `API_TOKEN`).
//!
//! The desktop shell binds the server to localhost and runs without a token.  A server that listens on the network sets the
//! variable; every `/api/*` request except the health check then has to carry the same value in the `x-api-token` header.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

#[derive(Clone)]
pub struct Token(pub Arc<String>);

/// compares without stopping at the first differing byte
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub async fn check(State(token): State<Token>, req: Request, next: Next) -> Result<Response, StatusCode> {
    let path = req.uri().path();
    if !path.starts_with("/api/") || path == "/api/health" {
        return Ok(next.run(req).await);
    }
    let given = req.headers().get("x-api-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    if same(given.as_bytes(), token.0.as_bytes()) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    async fn status(app: Router, path: &str, token: Option<&str>) -> StatusCode {
        let mut b = axum::http::Request::builder().uri(path);
        if let Some(t) = token {
            b = b.header("x-api-token", t);
        }
        app.oneshot(b.body(Body::empty()).unwrap()).await.unwrap().status()
    }

    #[tokio::test]
    async fn api_needs_the_token_but_health_and_pages_do_not() {
        let app = || {
            Router::new()
                .route("/api/data", get(|| async { "x" }))
                .route("/api/health", get(|| async { "ok" }))
                .route("/index.html", get(|| async { "page" }))
                .layer(axum::middleware::from_fn_with_state(Token(Arc::new("s3cret".into())), check))
        };
        assert_eq!(status(app(), "/api/data", None).await, StatusCode::UNAUTHORIZED);
        assert_eq!(status(app(), "/api/data", Some("wrong")).await, StatusCode::UNAUTHORIZED);
        assert_eq!(status(app(), "/api/data", Some("s3cret")).await, StatusCode::OK);
        assert_eq!(status(app(), "/api/health", None).await, StatusCode::OK);
        assert_eq!(status(app(), "/index.html", None).await, StatusCode::OK);
    }
}
