use std::net::SocketAddr;
use std::time::Duration;

use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use trader_server::{router, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let database_url = std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is not set"))?;
    let bind: SocketAddr = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:8787".into()).parse()?;
    let state = AppState::new(database_url);

    let reaper = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            reaper.reap(Duration::from_secs(8 * 3600)).await;
        }
    });

    let mut app = router(state).layer(TraceLayer::new_for_http());
    if let Ok(dir) = std::env::var("STATIC_DIR") {
        app = app.fallback_service(ServeDir::new(dir));
    }
    // the desktop shell talks to 127.0.0.1; allow cross-origin only for a dev UI served from another port
    if std::env::var("DEV_CORS").is_ok() {
        app = app.layer(CorsLayer::permissive());
    }
    tracing::info!("listening on http://{bind}");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
