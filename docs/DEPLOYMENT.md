# Production deployment — main PC (192.168.18.39)

Installed and verified on 2026-11-06. The main computer serves the rebuilt application; every PC in the
pharmacy (including the main computer) uses the same web application and database, with full operations rights
as per each user's login in the application itself.

## What is installed

| Piece | Where / how |
|---|---|
| PostgreSQL 17.11 | already present; data dir `C:\PostgreSQL\17\data`; databases: `waseela` (production), `trader` + `trader_write_test` (verification clones), `postgres` |
| Production database | **`waseela`** — byte copy of the clean migrated clone (`saleledger` 588,865 / `saledetail` 1,306,102 / `item` 28,966; 9 real users `ADMIN, SAMEER, DR ZEESHAN, ZUBAIR ARIF, SHAZIB, SAJID, HAMID ALI, ALI, FARYAD`; zero test rows). Made read-only-ish by usage only; the old PowerBuilder system is untouched and keeps its own SQL Server data |
| Application server | `C:\Waseela\server\trader-server.exe` (signed, `CN=Waseela ERP`), binds `0.0.0.0:8787`, shared-token protected |
| Static web app | `C:\Waseela\web` (built from tagged source at HEAD) |
| Configuration | `C:\Waseela\server\start-server.ps1` sets `DATABASE_URL`, `BIND`, `API_TOKEN`, `STATIC_DIR`, `FS_ROOT=C:\Waseela\files` (exports, label files, backups), `MAX_SESSIONS=80`, adds `C:\PostgreSQL\17\bin` to `PATH` (for `pg_dump`). Wrapper waits for PostgreSQL (127.0.0.1:5432) up to 10 minutes before starting |
| API token | `C:\Waseela\server\TOKEN.txt` (Administrators + SYSTEM only) |
| Auto-start | Scheduled task **"Waseela Data Server"**: at system start-up, runs as SYSTEM with highest privileges, hidden; wrapper waits for PostgreSQL, then starts the server |
| Firewall | Windows Defender Firewall rule **"Waseela Data Server (TCP 8787)"**: inbound TCP 8787, profile Private/Domain |
| File area | `C:\Waseela\files` — application file functions (export/import/labels/backup) |
| Logs | `C:\Waseela\logs\server.log` (Administrators + SYSTEM) |

## How to use it from any PC (including the main computer)

Open a browser (Edge) at:

```
http://192.168.18.39:8787/?token=<API_TOKEN>
```

The token is in `C:\Waseela\server\TOKEN.txt` (open as Administrator on the main PC). Log in with the
username/password of the old application — they are carried over unchanged (9 users above). Change the
administrator password after the first login (the seeded `admin` credentials only exist on empty databases;
this database has the real users).

Each PC needs the browser only; nothing else to install. Add the token page to the browser favourites.

## Verify / operate (on the main PC, as Administrator)

* status: `Get-Process trader-server`; port: `netstat -ano | findstr :8787`
* health: `http://192.168.18.39:8787/api/health` → `{"db":true,"ok":true,"sessions":N}`
* start now: `schtasks /run /tn "Waseela Data Server"`
* stop: `schtasks /end /tn "Waseela Data Server"` (kills the PowerShell wrapper; also stop the `trader-server.exe` child if it lingers)
* the PostgreSQL service `postgresql-x64-17` is **Automatic**, but note PostgreSQL currently runs as a
  manually started postmaster (data dir is PostgreSQL-account ACL, even Administrators are denied);
  if the new app shows `db:false` after a reboot, start PostgreSQL the same way it is started today,
  then `schtasks /run /tn "Waseela Data Server"`.
* backup: *Maintenance > Database Utilities > Backup Database* inside the app works (`pg_dump -Fc` to the
  chosen folder; `pg_dump` is on the server's `PATH`). Restore: `pg_restore -d waseela <file>`.

## Pharmacy PCs — one-time setup

1. Install the code-signing certificate so the installer/server run without warnings:
   `certutil -addstore Root Waseela-ERP.cer` and `certutil -addstore TrustedPublisher Waseela-ERP.cer`
   (`Waseela-ERP.cer` is attached to the `build-11` release; public key only).
2. Open Edge at `http://192.168.18.39:8787/?token=<API_TOKEN>`; keep it as a favourite.
3. Printers: normal report printing uses the browser's print dialog (works per PC). **Raw/thermal printing
   (TSC label printers, fiscal printer) is sent by the server**, i.e. it prints from the main PC — attach
   those printers to the main PC (as the fiscal listener is today).

## What is verified (2026-11-06)

* `trader-server.exe` signed; `/api/health` → `{"db":true,"ok":true}`; page loads (HTTP 200).
* Token is enforced: `/api/*` without the token → rejected (health check is open).
* Session opened; `select usercode, username from dbo.users` returns the 9 real users;
  `select count(*) from dbo.saleledger` → 588,865; session closed.
* Fresh `db/pg/*.sql` apply verified on a scratch database (0 errors); the production `waseela` database
  is a direct copy and was verified the same way.
* Installer smoke-tested on this PC; CI green on the release commit for all five jobs.

## Known limits / open decisions

* **Data is a snapshot.** `waseela` matches the old system as of the migration (sale date 2025-01-01,
  transaction date 2025-01-04 — the accounting period was apparently frozen when the clone was taken).
  Anything entered in the old PowerBuilder application after that freeze is *not* in `waseela`.
  Before go-live the owner must either accept the snapshot (old system retired at the freeze point)
  or order a fresh re-migration of the delta. This is the one remaining decision before cutover.
* The old PowerBuilder application and its SQL Server instance keep running untouched; do not decommission
  them until the snapshot decision is made and a period of parallel running is accepted.
* The rebuilt application has no licence checks (owner decision 2026-11-02), server-side rights are not
  enforced yet (client-side only, as the original), and passwords are stored as in the original schema.
* HTTPS is not configured (LAN traffic is HTTP with a shared token). For wider/untrusted networks,
  put the server behind a reverse proxy with TLS first.
* The local PostgreSQL superuser password and test ADMIN password are public by the owner's accepted
  decision (test-only credentials, localhost).
