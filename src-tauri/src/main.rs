// Desktop shell: starts the data server inside the process (127.0.0.1 only) and shows the UI in the webview.
// The database connection comes from DATABASE_URL or from `trader.conf` next to the executable (first line).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;

fn database_url() -> Option<String> {
    if let Ok(u) = std::env::var("DATABASE_URL") {
        return Some(u);
    }
    let exe = std::env::current_exe().ok()?;
    let conf = exe.parent()?.join("trader.conf");
    std::fs::read_to_string(conf).ok().map(|s| s.lines().next().unwrap_or("").trim().to_string()).filter(|s| !s.is_empty())
}

fn main() {
    // the desktop application may use every path, like the original did
    std::env::set_var("FS_UNRESTRICTED", "1");
    let url = database_url().unwrap_or_else(|| "postgres://postgres@127.0.0.1:5432/trader".to_string());
    let bind: SocketAddr = std::env::var("BIND").ok().and_then(|b| b.parse().ok()).unwrap_or_else(|| "127.0.0.1:8787".parse().unwrap());
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    rt.spawn(async move {
        let state = trader_server::AppState::new(url);
        let app = trader_server::router(state).layer(tower_http::cors::CorsLayer::permissive());
        match tokio::net::TcpListener::bind(bind).await {
            Ok(l) => {
                let _ = axum_serve(l, app).await;
            }
            Err(e) => eprintln!("cannot listen on {bind}: {e}"),
        }
    });
    tauri::Builder::default().run(tauri::generate_context!()).expect("error while running the Trader application");
}

async fn axum_serve(listener: tokio::net::TcpListener, app: trader_server::HttpRouter) -> std::io::Result<()> {
    trader_server::serve(listener, app).await
}
// build marker: final item-list startup fix
// build marker: final pbSet visibility fix
