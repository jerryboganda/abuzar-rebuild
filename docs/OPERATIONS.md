# Installing and running Trader

## What you need
* PostgreSQL 17 (on the same machine or on a server in the network), a database for the company, e.g. `trader`.
* The Windows installer or the programs of a release (GitHub release of the private repository; built by `.github/workflows/release.yml`).

## First installation
1. Create the database and apply the scripts of `db/pg/` in file order:
   ```
   createdb trader
   for f in db/pg/*.sql; do psql -d trader -f "$f"; done      # PowerShell: Get-ChildItem db\pg\*.sql | Sort-Object Name | ForEach-Object { psql -d trader -f $_.FullName }
   ```
   Errors from `90_seed.sql` are reported as warnings (`seed skipped: ...`): they are statements of the original upgrade scripts that no longer fit the
   final schema.  `40_` - `70_` contain 603 fully translated procedures, 35 partial ones and a few stubs (SQL Server administration, linked-server transfer).
2. Tell the program where the database is: first line of `trader.conf` next to `trader-desktop.exe`
   (`postgres://user:password@host:5432/trader`) or the `DATABASE_URL` variable.
3. Start `trader-desktop.exe`.  Log in as **admin / admin** and change the password in the user administration window.

## Several computers
Run `trader-server.exe` on one machine with `DATABASE_URL`, `BIND=0.0.0.0:8787`, `STATIC_DIR` (the `web/dist` folder), `API_TOKEN=<secret>` and open
`http://server:8787/?token=<secret>` in a browser.  Without `API_TOKEN` anyone who can reach the port can run SQL as the application: keep it on localhost or
behind a firewall.  The file functions (export, import, label files) work on the server machine inside `FS_ROOT`.

## Backups
The original backed up with SQL Server `BACKUP DATABASE` from inside the program.  Use `pg_dump -Fc trader > trader.dump` (scheduled with the Windows task
scheduler) and `pg_restore -d trader trader.dump`.  The start-up check for a SQL Server backup is switched off by `95_bootstrap.sql`.

## Audit trail
`dbo.audit_log` records every change of users, rights, preferences, accounts, customers, suppliers and items (old and new row as JSON, application user,
time); passwords are never copied.  Query it with SQL, e.g. `select at, app_user, operation, table_name, new_row from dbo.audit_log order by audit_id desc`.

## Known limits (see ROADMAP.md for the full list)
* Not available: fingerprint readers, scanners, the SQL Server administration windows (DBCC, jobs), the cross-site data transfer windows (linked servers).
* The pixel layout was derived from the definitions; without the original running next to it, small differences in fonts and spacing are possible.
* A new database has no chart of accounts beyond what the migration data created: set up accounts and the system accounts (Preferences) first.
