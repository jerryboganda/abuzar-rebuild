//! Trader application server.
//!
//! A thin, typed gateway between the UI runtime and PostgreSQL.  The original application was a two-tier client that talked
//! to SQL Server directly, with one connection and one implicit transaction per transaction object (`sqlca`, `lt_...`).
//! A *session* here is exactly that: a dedicated connection with the same transaction behaviour:
//!   * `autocommit = false`: the first statement starts a transaction that lasts until COMMIT / ROLLBACK
//!   * a failing statement only undoes itself (SQL Server semantics), implemented with a savepoint per statement
//! Statements arrive with `$n` placeholders and JSON parameters and are executed with the simple query protocol, so every
//! result is returned in text form together with its PostgreSQL type name (the client decodes by type).

pub mod sqlsub;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::postgres::PgConnection;
use sqlx::{Column, Connection, Executor, Row, TypeInfo, ValueRef};
use tokio::sync::Mutex;

pub struct Session {
    conn: PgConnection,
    /// oid -> type name for the types sqlx does not know (citext, refcursor ...)
    types: HashMap<u32, String>,
    autocommit: bool,
    in_tx: bool,
    last_used: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub database_url: Arc<String>,
    pub sessions: Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
}

impl AppState {
    pub fn new(database_url: String) -> Self {
        Self { database_url: Arc::new(database_url), sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// drop sessions that were idle for longer than `idle`
    pub async fn reap(&self, idle: Duration) {
        let mut map = self.sessions.lock().await;
        let mut dead = Vec::new();
        for (k, s) in map.iter() {
            if let Ok(g) = s.try_lock() {
                if g.last_used.elapsed() > idle {
                    dead.push(k.clone());
                }
            }
        }
        for k in dead {
            map.remove(&k);
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("unknown session")]
    NoSession,
    #[error("{0}")]
    Bad(String),
    #[error("{message}")]
    Db { code: String, message: String, detail: Option<String> },
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            ApiError::NoSession => (StatusCode::UNAUTHORIZED, json!({"error": {"code": "NOSESSION", "message": self.to_string()}})),
            ApiError::Bad(m) => (StatusCode::BAD_REQUEST, json!({"error": {"code": "BAD", "message": m}})),
            ApiError::Db { code, message, detail } => (StatusCode::OK, json!({"error": {"code": code, "message": message, "detail": detail}})),
        };
        (status, Json(body)).into_response()
    }
}

fn db_err(e: sqlx::Error) -> ApiError {
    match e {
        sqlx::Error::Database(d) => ApiError::Db { code: d.code().map(|c| c.to_string()).unwrap_or_default(), message: d.message().to_string(), detail: None },
        other => ApiError::Db { code: "XX000".into(), message: other.to_string(), detail: None },
    }
}

#[derive(Deserialize, Default)]
struct OpenReq {
    #[serde(default)]
    autocommit: bool,
}

#[derive(Deserialize)]
struct StmtReq {
    sid: String,
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[derive(Deserialize)]
struct SidReq {
    sid: String,
}

#[derive(Serialize)]
struct ColumnInfo {
    name: String,
    #[serde(rename = "type")]
    ty: String,
}

async fn health(State(st): State<AppState>) -> Json<Value> {
    let db = match PgConnection::connect(&st.database_url).await {
        Ok(mut c) => c.ping().await.is_ok(),
        Err(_) => false,
    };
    Json(json!({"ok": true, "db": db, "sessions": st.sessions.lock().await.len()}))
}

async fn open_session(State(st): State<AppState>, Json(req): Json<OpenReq>) -> Result<Json<Value>, ApiError> {
    let mut conn = PgConnection::connect(&st.database_url).await.map_err(db_err)?;
    conn.execute("SET standard_conforming_strings = on; SET search_path TO dbo, public;").await.map_err(db_err)?;
    let sid = uuid::Uuid::new_v4().to_string();
    let mut types = HashMap::new();
    for row in sqlx::query_as::<_, (i64, String)>("select oid::int8, typname::text from pg_type").fetch_all(&mut conn).await.map_err(db_err)? {
        types.insert(row.0 as u32, row.1);
    }
    let s = Session { conn, types, autocommit: req.autocommit, in_tx: false, last_used: Instant::now() };
    st.sessions.lock().await.insert(sid.clone(), Arc::new(Mutex::new(s)));
    Ok(Json(json!({ "sid": sid })))
}

async fn session(st: &AppState, sid: &str) -> Result<Arc<Mutex<Session>>, ApiError> {
    st.sessions.lock().await.get(sid).cloned().ok_or(ApiError::NoSession)
}

/// PostgreSQL type name of a result column: sqlx names the builtin types, the rest is looked up by oid
fn type_name(types: &HashMap<u32, String>, ti: &sqlx::postgres::PgTypeInfo) -> String {
    let n = ti.name().to_lowercase();
    if n != "?" {
        return n;
    }
    let d = format!("{ti:?}");
    d.find("Oid(")
        .and_then(|i| {
            let rest = &d[i + 4..];
            rest.find(')').and_then(|j| rest[..j].parse::<u32>().ok())
        })
        .and_then(|oid| types.get(&oid).cloned())
        .unwrap_or(n)
}

/// run `f` as one statement with SQL Server statement-level atomicity
async fn run_statement(s: &mut Session, sql: String, want_rows: bool) -> Result<(Vec<ColumnInfo>, Vec<Vec<Value>>, u64), ApiError> {
    s.last_used = Instant::now();
    let tx_mode = !s.autocommit;
    if tx_mode && !s.in_tx {
        s.conn.execute("BEGIN").await.map_err(db_err)?;
        s.in_tx = true;
    }
    if tx_mode {
        s.conn.execute("SAVEPOINT stmt").await.map_err(db_err)?;
    }
    let result = if want_rows {
        match s.conn.fetch_all(sql.as_str()).await {
            Ok(rows) => {
                let mut cols: Vec<ColumnInfo> = Vec::new();
                if let Some(r) = rows.first() {
                    cols = r.columns().iter().map(|c| ColumnInfo { name: c.name().to_string(), ty: type_name(&s.types, c.type_info()) }).collect();
                }
                let mut data = Vec::with_capacity(rows.len());
                for r in &rows {
                    let mut row = Vec::with_capacity(cols.len());
                    for i in 0..cols.len() {
                        let raw = r.try_get_raw(i).map_err(db_err)?;
                        if raw.is_null() {
                            row.push(Value::Null);
                        } else {
                            let text = raw.as_str().map_err(|e| ApiError::Bad(e.to_string()))?;
                            row.push(Value::String(text.to_string()));
                        }
                    }
                    data.push(row);
                }
                let n = data.len() as u64;
                Ok((cols, data, n))
            }
            Err(e) => Err(db_err(e)),
        }
    } else {
        match s.conn.execute(sql.as_str()).await {
            Ok(r) => Ok((Vec::new(), Vec::new(), r.rows_affected())),
            Err(e) => Err(db_err(e)),
        }
    };
    if tx_mode {
        match &result {
            Ok(_) => {
                s.conn.execute("RELEASE SAVEPOINT stmt").await.map_err(db_err)?;
            }
            Err(_) => {
                // undo only this statement; the transaction stays usable
                let _ = s.conn.execute("ROLLBACK TO SAVEPOINT stmt").await;
                let _ = s.conn.execute("RELEASE SAVEPOINT stmt").await;
            }
        }
    }
    result
}

async fn query(State(st): State<AppState>, Json(req): Json<StmtReq>) -> Result<Json<Value>, ApiError> {
    let sql = sqlsub::substitute(&req.sql, &req.params).map_err(|e| ApiError::Bad(e.to_string()))?;
    let sess = session(&st, &req.sid).await?;
    let mut s = sess.lock().await;
    let (cols, rows, _) = run_statement(&mut s, sql, true).await?;
    Ok(Json(json!({ "columns": cols, "rows": rows })))
}

async fn exec(State(st): State<AppState>, Json(req): Json<StmtReq>) -> Result<Json<Value>, ApiError> {
    let sql = sqlsub::substitute(&req.sql, &req.params).map_err(|e| ApiError::Bad(e.to_string()))?;
    let sess = session(&st, &req.sid).await?;
    let mut s = sess.lock().await;
    let (_, _, n) = run_statement(&mut s, sql, false).await?;
    Ok(Json(json!({ "rowcount": n })))
}

/// Call a translated stored procedure (`SELECT * FROM dbo.sp(...)`): the first row holds the status / INOUT values and one
/// refcursor per result set; every cursor that was opened is fetched completely and closed (see docs/SQL-TRANSLATION.md).
async fn call(State(st): State<AppState>, Json(req): Json<StmtReq>) -> Result<Json<Value>, ApiError> {
    let sql = sqlsub::substitute(&req.sql, &req.params).map_err(|e| ApiError::Bad(e.to_string()))?;
    let sess = session(&st, &req.sid).await?;
    let mut s = sess.lock().await;
    // cursors only live inside a transaction: autocommit sessions get one for the duration of the call
    let own_tx = s.autocommit;
    if own_tx {
        s.conn.execute("BEGIN").await.map_err(db_err)?;
    }
    let res = call_inner(&mut s, sql).await;
    if own_tx {
        let end = if res.is_ok() { "COMMIT" } else { "ROLLBACK" };
        let _ = s.conn.execute(end).await;
    }
    res.map(Json)
}

async fn call_inner(s: &mut Session, sql: String) -> Result<Value, ApiError> {
    let (cols, rows, _) = run_statement(s, sql, true).await?;
    let mut result_sets = Vec::new();
    if let Some(row) = rows.first() {
        for (i, c) in cols.iter().enumerate() {
            if c.ty == "refcursor" {
                if let Value::String(name) = &row[i] {
                    let q = format!("\"{}\"", name.replace('"', "\"\""));
                    let (rc, rr, _) = run_statement(s, format!("FETCH ALL FROM {q}"), true).await?;
                    let _ = s.conn.execute(format!("CLOSE {q}").as_str()).await;
                    result_sets.push(json!({ "column": c.name, "columns": rc, "rows": rr }));
                    continue;
                }
            }
        }
    }
    Ok(json!({ "columns": cols, "row": rows.first(), "resultsets": result_sets }))
}

async fn end_tx(st: &AppState, sid: &str, sql: &str) -> Result<Json<Value>, ApiError> {
    let sess = session(st, sid).await?;
    let mut s = sess.lock().await;
    s.last_used = Instant::now();
    if s.in_tx {
        s.conn.execute(sql).await.map_err(db_err)?;
        s.in_tx = false;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn commit(State(st): State<AppState>, Json(req): Json<SidReq>) -> Result<Json<Value>, ApiError> {
    end_tx(&st, &req.sid, "COMMIT").await
}

async fn rollback(State(st): State<AppState>, Json(req): Json<SidReq>) -> Result<Json<Value>, ApiError> {
    end_tx(&st, &req.sid, "ROLLBACK").await
}

async fn close(State(st): State<AppState>, Json(req): Json<SidReq>) -> Result<Json<Value>, ApiError> {
    if let Some(s) = st.sessions.lock().await.remove(&req.sid) {
        // dropping the connection rolls back any open transaction
        drop(s);
    }
    Ok(Json(json!({ "ok": true })))
}

pub use axum::Router as HttpRouter;

/// serve `app` on `listener` (used by the desktop shell, which owns the process and the runtime)
pub async fn serve(listener: tokio::net::TcpListener, app: Router) -> std::io::Result<()> {
    axum::serve(listener, app).await
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/session", post(open_session))
        .route("/api/query", post(query))
        .route("/api/exec", post(exec))
        .route("/api/call", post(call))
        .route("/api/commit", post(commit))
        .route("/api/rollback", post(rollback))
        .route("/api/close", post(close))
        .with_state(state)
}
