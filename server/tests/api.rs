//! Integration tests against a real PostgreSQL (DATABASE_URL); skipped when it is not set.
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;
use trader_server::{router, AppState};

async fn call(app: &axum::Router, path: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder().method("POST").uri(path).header("content-type", "application/json").body(Body::from(body.to_string())).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn app() -> Option<axum::Router> {
    std::env::var("DATABASE_URL").ok().map(|u| router(AppState::new(u)))
}

#[tokio::test]
async fn session_transaction_semantics() {
    let Some(app) = app() else { return };
    let (_, s) = call(&app, "/api/session", json!({})).await;
    let sid = s["sid"].as_str().unwrap().to_string();
    let (_, r) = call(&app, "/api/exec", json!({"sid": sid, "sql": "create temp table t(a int primary key, b citext, c numeric(12,2), d timestamp)"})).await;
    assert!(r.get("error").is_none(), "{r}");
    let (_, r) = call(&app, "/api/exec", json!({"sid": sid, "sql": "insert into t values ($1,$2,$3,$4)", "params": [1, "O'Brien", "12.50", "2026-11-02 10:30:00.000"]})).await;
    assert_eq!(r["rowcount"], 1, "{r}");
    // a failing statement (duplicate key) must not abort the transaction: SQL Server semantics
    let (_, r) = call(&app, "/api/exec", json!({"sid": sid, "sql": "insert into t values ($1,$2,$3,$4)", "params": [1, "dup", "1", null]})).await;
    assert_eq!(r["error"]["code"], "23505", "{r}");
    let (_, r) = call(&app, "/api/exec", json!({"sid": sid, "sql": "insert into t values ($1,$2,$3,$4)", "params": [2, "second", "2.25", null]})).await;
    assert_eq!(r["rowcount"], 1, "{r}");
    // citext comparison is case-insensitive; numeric comes back exact; types are reported
    let (_, r) = call(&app, "/api/query", json!({"sid": sid, "sql": "select a, b, c, d from t where b = $1 order by a", "params": ["o'brien"]})).await;
    assert_eq!(r["rows"], json!([["1", "O'Brien", "12.50", "2026-11-02 10:30:00"]]), "{r}");
    assert_eq!(r["columns"][2]["type"], "numeric");
    assert_eq!(r["columns"][1]["type"], "citext");
    // list parameter
    let (_, r) = call(&app, "/api/query", json!({"sid": sid, "sql": "select count(*) from t where a = any($1)", "params": [[1, 2, 3]]})).await;
    assert_eq!(r["rows"], json!([["2"]]), "{r}");
    // rollback undoes both inserts
    call(&app, "/api/rollback", json!({"sid": sid})).await;
    let (_, r) = call(&app, "/api/query", json!({"sid": sid, "sql": "select count(*) from t"})).await;
    assert_eq!(r["rows"], json!([["0"]]), "{r}");
    call(&app, "/api/close", json!({"sid": sid})).await;
    let (st, _) = call(&app, "/api/query", json!({"sid": sid, "sql": "select 1"})).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn procedure_call_returns_outputs_and_result_sets() {
    let Some(app) = app() else { return };
    let (_, s) = call(&app, "/api/session", json!({"autocommit": true})).await;
    let sid = s["sid"].as_str().unwrap().to_string();
    let ddl = "create or replace function dbo.t_proc(a integer, out return_value integer, out rs1 refcursor) language plpgsql as $f$ begin return_value := a * 2; open rs1 for select i, 'x' || i as t from generate_series(1, 3) i; end $f$";
    let (_, r) = call(&app, "/api/exec", json!({"sid": sid, "sql": ddl})).await;
    assert!(r.get("error").is_none(), "{r}");
    let (_, r) = call(&app, "/api/call", json!({"sid": sid, "sql": "SELECT * FROM dbo.t_proc(a => $1)", "params": [21]})).await;
    assert_eq!(r["row"][0], "42", "{r}");
    assert_eq!(r["resultsets"][0]["rows"], json!([["1", "x1"], ["2", "x2"], ["3", "x3"]]), "{r}");
    call(&app, "/api/exec", json!({"sid": sid, "sql": "drop function dbo.t_proc(integer)"})).await;
}

#[tokio::test]
async fn autocommit_session_commits_each_statement() {
    let Some(app) = app() else { return };
    let (_, s) = call(&app, "/api/session", json!({"autocommit": true})).await;
    let sid = s["sid"].as_str().unwrap().to_string();
    call(&app, "/api/exec", json!({"sid": sid, "sql": "create temp table u(a int)"})).await;
    call(&app, "/api/exec", json!({"sid": sid, "sql": "insert into u values (1)"})).await;
    call(&app, "/api/rollback", json!({"sid": sid})).await; // nothing to roll back
    let (_, r) = call(&app, "/api/query", json!({"sid": sid, "sql": "select count(*) from u"})).await;
    assert_eq!(r["rows"], json!([["1"]]), "{r}");
}
