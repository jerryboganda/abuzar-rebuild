//! Periodic database jobs of the original installation.
//!
//! The original ran the maintenance procedures below as SQL Server Agent jobs (read from the shop's `msdb`, 2026-11-25).  PostgreSQL has no Agent and the rebuild
//! ran none of them: new purchases and sales never reached `stockledger` (the table behind the stock-in-hand-on-a-back-date, stock register and packing-wise trading
//! reports; `sp_stockledger` copies the posted documents newer than its last row), customers' promotion discounts were not switched on and off, and the attendance
//! time-out and stock verification never ran.
//!
//! Off unless the environment asks for it, because the jobs write to the database.  Two ways:
//!   * `JOBS=schedule`: the jobs the **Job Schedule window** activates.  The window writes `dbo.sysjobs` / `dbo.sysjobschedules` (through `sp_ActivateJob` /
//!     `sp_AdjustJobSchedule`, as it did on SQL Server Agent); once a minute the runner reads the enabled jobs that have a recurring schedule (seconds, minutes or hours)
//!     and runs the procedure of each known job when its interval has passed since the last run (the first run one interval after the server started).  Nothing runs
//!     until somebody activates a job in that window.
//!   * `JOBS=all` or a list (`JOBS=stockledger,applysalepromotions`): fixed jobs on the original's intervals, whatever the tables say.
//! Both can be combined (`JOBS=schedule,stockledger`).  Each run uses its own connection; a failure is logged and tried again next time.
//! `JOBS_SCALE=<n>` divides every interval (and the poll) by n (a test run).

use std::time::Duration;

use sqlx::postgres::PgConnection;
use sqlx::{Connection, Row};

/// (name used in `JOBS`, procedure, seconds between runs): the enabled local jobs of the original
const JOBS: &[(&str, &str, u64)] = &[
    ("applysalepromotions", "dbo.sp_applysalepromotions", 10 * 60),
    ("autotimeoutattendance", "dbo.sp_autotimeout_attendance", 10 * 60),
    ("stockledger", "dbo.sp_stockledger", 2 * 60 * 60),
    ("autostockverification", "dbo.sp_autostockverification", 8 * 60 * 60),
];

/// jobs of the Job Schedule window (name in `dbo.sysjobs`, lower case) the runner knows how to run
const SCHEDULED: &[(&str, &str)] = &[
    ("autoapplysalepromotions", "dbo.sp_applysalepromotions"),
    ("autoemployeetimout", "dbo.sp_autotimeout_attendance"),
    ("tsql_job_stockledger", "dbo.sp_stockledger"),
    ("autostockverification", "dbo.sp_autostockverification"),
];

/// the procedure of a scheduled job, by its name in `dbo.sysjobs` (any case)
pub fn procedure_for(job: &str) -> Option<&'static str> {
    let name = job.trim().to_lowercase();
    SCHEDULED.iter().find(|(n, _)| *n == name).map(|(_, procedure)| *procedure)
}

/// seconds between two runs of a SQL Server Agent schedule: `freq_subday_type` 2 = seconds, 4 = minutes, 8 = hours; anything else (a daily "once at" time) is not recurring
pub fn interval_seconds(subday_type: i32, interval: i32) -> Option<u64> {
    let unit: u64 = match subday_type {
        2 => 1,
        4 => 60,
        8 => 3600,
        _ => return None,
    };
    if interval <= 0 {
        return None;
    }
    Some(unit * interval as u64)
}

/// the jobs a `JOBS` value asks for
pub fn selected(value: &str) -> Vec<(&'static str, &'static str, u64)> {
    let wanted: Vec<String> = value.split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
    let all = wanted.iter().any(|w| w == "all");
    JOBS.iter().filter(|job| all || wanted.iter().any(|w| w.as_str() == job.0)).copied().collect()
}

/// starts the selected jobs; returns how many
pub fn start(database_url: String, value: &str, scale: u64) -> usize {
    let jobs = selected(value);
    let scheduled = value.split(',').any(|s| s.trim().eq_ignore_ascii_case("schedule"));
    if scheduled {
        start_scheduled(database_url.clone(), scale);
    }
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
    jobs.len() + usize::from(scheduled)
}

/// runs what the Job Schedule window activated, see the module comment
fn start_scheduled(database_url: String, scale: u64) {
    let poll = Duration::from_secs((60 / scale.max(1)).max(1));
    tokio::spawn(async move {
        let mut last: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();
        loop {
            tokio::time::sleep(poll).await;
            let due = match enabled_jobs(&database_url).await {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::warn!("job schedule: reading dbo.sysjobs failed: {e}");
                    continue;
                }
            };
            for (name, subday_type, interval) in due {
                let (Some(procedure), Some(seconds)) = (procedure_for(&name), interval_seconds(subday_type, interval)) else { continue };
                let every = Duration::from_secs((seconds / scale.max(1)).max(1));
                let since = *last.entry(name.clone()).or_insert_with(std::time::Instant::now);
                if since.elapsed() < every {
                    continue;
                }
                last.insert(name.clone(), std::time::Instant::now());
                match run(&database_url, procedure).await {
                    Ok(()) => tracing::info!("job {name}: {procedure} done"),
                    Err(e) => tracing::warn!("job {name}: {procedure} failed: {e}"),
                }
            }
        }
    });
}

/// (job name, freq_subday_type, freq_subday_interval) of the enabled jobs that have a schedule
async fn enabled_jobs(url: &str) -> Result<Vec<(String, i32, i32)>, sqlx::Error> {
    let mut conn = PgConnection::connect(url).await?;
    let rows = sqlx::query(
        "SELECT sj.name::text AS name, sjs.freq_subday_type::int4 AS subday_type, sjs.freq_subday_interval::int4 AS subday_interval          FROM dbo.sysjobs AS sj JOIN dbo.sysjobschedules AS sjs ON sjs.job_id = sj.job_id WHERE sj.enabled = 1",
    )
    .fetch_all(&mut conn)
    .await;
    let _ = conn.close().await;
    rows?
        .iter()
        .map(|r| Ok((r.try_get::<String, _>("name")?, r.try_get::<i32, _>("subday_type")?, r.try_get::<i32, _>("subday_interval")?)))
        .collect()
}

async fn run(url: &str, procedure: &str) -> Result<(), sqlx::Error> {
    let mut conn = PgConnection::connect(url).await?;
    let outcome = sqlx::query(&format!("SELECT {procedure}()")).execute(&mut conn).await.map(|_| ());
    let _ = conn.close().await;
    outcome
}

#[cfg(test)]
mod tests {
    use super::{interval_seconds, procedure_for, selected};

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

    #[test]
    fn the_schedule_window_names_map_to_procedures_and_intervals() {
        assert_eq!(procedure_for("TSQL_Job_StockLedger"), Some("dbo.sp_stockledger"));
        assert_eq!(procedure_for(" AutoApplySalePromotions "), Some("dbo.sp_applysalepromotions"));
        assert_eq!(procedure_for("autobackupclient"), None);
        assert_eq!(interval_seconds(8, 2), Some(7200));
        assert_eq!(interval_seconds(4, 10), Some(600));
        assert_eq!(interval_seconds(2, 30), Some(30));
        assert_eq!(interval_seconds(1, 24), None);
        assert_eq!(interval_seconds(8, 0), None);
    }
}
