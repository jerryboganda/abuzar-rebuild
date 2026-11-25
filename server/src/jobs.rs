//! Periodic database jobs of the original installation.
//!
//! The original ran the maintenance procedures below as SQL Server Agent jobs (read from the shop's `msdb`, 2026-11-25).  PostgreSQL has no Agent and the rebuild
//! ran none of them: new purchases and sales never reached `stockledger` (the table behind the stock-in-hand-on-a-back-date, stock register and packing-wise trading
//! reports; `sp_stockledger` copies the posted documents newer than its last row), customers' promotion discounts were not switched on and off, and the attendance
//! time-out and stock verification never ran.
//!
//! Off unless the environment asks for it, because the jobs write to the database: `JOBS=all` or a list (`JOBS=stockledger,applysalepromotions`).  Each job runs its
//! procedure on its own connection once every interval (the original's schedule), first run after one interval; a failure is logged and tried again next time.
//! `JOBS_SCALE=<n>` divides every interval by n (a test run).

use std::time::Duration;

use sqlx::postgres::PgConnection;
use sqlx::Connection;

/// (name used in `JOBS`, procedure, seconds between runs): the enabled local jobs of the original
const JOBS: &[(&str, &str, u64)] = &[
    ("applysalepromotions", "dbo.sp_applysalepromotions", 10 * 60),
    ("autotimeoutattendance", "dbo.sp_autotimeout_attendance", 10 * 60),
    ("stockledger", "dbo.sp_stockledger", 2 * 60 * 60),
    ("autostockverification", "dbo.sp_autostockverification", 8 * 60 * 60),
];

/// the jobs a `JOBS` value asks for
pub fn selected(value: &str) -> Vec<(&'static str, &'static str, u64)> {
    let wanted: Vec<String> = value.split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
    let all = wanted.iter().any(|w| w == "all");
    JOBS.iter().filter(|job| all || wanted.iter().any(|w| w.as_str() == job.0)).copied().collect()
}

/// starts the selected jobs; returns how many
pub fn start(database_url: String, value: &str, scale: u64) -> usize {
    let jobs = selected(value);
    for (name, procedure, seconds) in jobs.iter().copied() {
        let url = database_url.clone();
        let every = Duration::from_secs((seconds / scale.max(1)).max(1));
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(every).await;
                match run(&url, procedure).await {
                    Ok(()) => tracing::info!("job {name}: {procedure} done"),
                    Err(e) => tracing::warn!("job {name}: {procedure} failed: {e}"),
                }
            }
        });
    }
    jobs.len()
}

async fn run(url: &str, procedure: &str) -> Result<(), sqlx::Error> {
    let mut conn = PgConnection::connect(url).await?;
    let outcome = sqlx::query(&format!("SELECT {procedure}()")).execute(&mut conn).await.map(|_| ());
    let _ = conn.close().await;
    outcome
}

#[cfg(test)]
mod tests {
    use super::selected;

    #[test]
    fn nothing_runs_unless_asked_for() {
        assert!(selected("").is_empty());
        assert!(selected(" , ").is_empty());
        assert!(selected("unknown").is_empty());
    }

    #[test]
    fn a_list_or_all_picks_the_jobs() {
        assert_eq!(selected("stockledger").len(), 1);
        assert_eq!(selected("StockLedger, applysalepromotions").len(), 2);
        assert_eq!(selected("all").len(), 4);
    }
}
