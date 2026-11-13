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

* **Data versus the live classic database (measured 2026-11-11).** Every common table (751) was compared with the live
  SQL Server 2022 database `FazalDinPP19DataBaseV2` by row count and numeric sums: 9,636,312 rows, the newest sale is still
  2025-01-01 in both, and `saleledger` 588,865 / `saledetail` 1,306,102 / `item` 28,966 are identical. The classic had gained
  four `CustomerGroupCategory` rows (groups 2, 5, 11, 12 in category 1) since the migration; they were copied into `waseela`.
  Two harmless differences remain by design: `_Utn` (the rebuild's own session counter is one ahead) and `SysTextCatalog.CatalogLength`
  (the original's licence-catalog length counters, bumped by each classic start; the rebuild has no licence checks).
  Anything entered in the classic after 2026-11-11 is not in `waseela`; repeat `deploy/parity/Compare-AllCounts.py` against
  `waseela` before the final cutover to see the delta of the day.
* **Sort order upgraded in place (2026-11-11).** `db/upgrade/2026-11-10-sqlserver-order.sql` was applied to `waseela` after a full
  backup (`C:\Waseela\files\backups\waseela-pre-upgrade-2026-11-11.dump`, 286 MB, 7,053 entries): 29 seconds, one transaction, server stopped
  for about two minutes with no user connected. Afterwards all 332 large text columns order exactly as on the classic and the
  data comparison above is unchanged. Rollback: stop the server, `pg_restore` the dump into a new database (3 foreign keys with orphan rows report errors,
  see `OPERATIONS.md`), rename it to `waseela`, start the server.
* **Build 12 deployed (2026-11-11).** Tag `v0.12.0` (commit `aaa1c2b7`; its application code is the commit CI verified green, `3e0f4962`):
  `C:\Waseela\server\trader-server.exe` (built by the release workflow, signed `CN=Waseela ERP`) and the static web files in `C:\Waseela\web`
  (built from the tag with `build-static.ts`; 3,023 files). Swapped in about ten seconds with the server stopped and nobody connected;
  afterwards `/api/health` is `db:true`, the token is enforced (401 without it), item names, sale counts, the `STR` function and the new
  `/api/inet` endpoint answer correctly. Copies of the previous files: `C:\Waseela\server\trader-server.exe.build11` and the folder
  `C:\Waseela\web.build11`. **The build-11 web folder is not a usable fallback**: it holds 42 of the 80 modules the app needs
  (`dom-ui.js` imports `message-buttons.js`, which it lacks), so its page stays blank; build 11 was only ever checked for HTTP 200. The real fallback
  while the rebuild is being accepted is the old PowerBuilder application on SQL Server, which was not touched.
  The first real login was very slow. Measured on a scratch copy with a CPU profile (2026-11-11): the browser asked the server for 1,491 class files
  during the login and 1,482 of them do not exist (menu items such as `m_file`, built-in classes such as `checkbox`): about 7 seconds on this PC, far more over
  the network or with browser extensions. `JsonClassLoader` now reads `data/classes/_index.json` (the 2,830 class files that exist) and never asks for
  the others: 9 requests, login 4.4 seconds. Swapped into `C:\Waseela\web` the same day (`src/main.js`, `src/runtime/loader.js`; the previous versions are
  kept as `*.before-login-fix`). The rest of the login is 25 queries, two of them the item list of 27,818 rows (about 1.2 seconds each). Not checked here: the screens beyond the login
  (needs the owner's staff login), printers and the FBR component.
* **Web update 2026-11-11 (commit `af244ca0`): Modern header and simplified Pack Purchase.** Static files built from a clean worktree of the commit
  with `build-static.ts` and copied over `C:\Waseela\web\src` and `index.html` (server not restarted; users reload the page). Previous files:
  `C:\Waseela\web.before-header-2026-11-11` (`src` and `index.html`). CI at that point: database, server and web jobs passed (desktop still running); the presentation and
  e2e browser jobs now run only on manual dispatch (user decision, final browser pass). The change shows in the Modern interface only; not browser-checked.
  Rollback: copy the backup `src` and `index.html` back over `C:\Waseela\web`.
  Same day, commit `79386ba8` (header matched to the approved mockup) copied the same way; the same backup is the rollback. The Modern interface
  opens only with `&presentation=1` in the address.
* **Web update 2026-11-12 (commit `3b560b01`): whole-app Modern design (approved mockup v4).** Sign-in screen, Home dashboard, shell,
  cards, Pack Purchase companion, dialogs, dark mode and phone/tablet layouts. Built from a clean worktree with `build-static.ts` and copied over
  `C:\Waseela\web\src` and `index.html` (server not restarted; users reload). Rollback: the 2026-11-11 backup `C:\Waseela\web.before-header-2026-11-11`.
  Browser-checked on the local test copy `waseela_rehearsal`; Modern still opens only with `&presentation=1`.
  Same day, commit `debf8f60` (Reports and Items pages, Preferences layout, rights switch matrix, status bar, Pack Purchase quick-add) copied the same way; same rollback.
  Same day, commit `606e9f1e` (Cash Sale point-of-sale layout, quick-add fields, FBR/godown status, report header, classic-content skin, Groups error fix) copied the same way; same rollback.
  Same day, commit `12ee4612` (List/Detail toggle, Cash/Credit switch, docked report criteria, phone header) copied the same way; same rollback.
  Same day, commit `2499efeb` (the 13 list windows, Groups among them, get the approved Modern List layout) copied the same way; same rollback.
  Ports 8787 and 8790 serve the new files.
  2026-11-14, commit `09987657` (rest of mockup v4: header search/pop-ups, sign-in figures, Cash Sale payment card, Pack Purchase
  buttons, Users & rights page, Item Export/Print, closable Home) copied the same way; same rollback.  At copy time the data server
  (task "Waseela Data Server") was not running: its last run, started 2026-11-13 22:38, had been stopped (result 0x41306); it was left
  stopped pending the owner.  The newer main commits `1113bfb6` and `a679efa1` (another session) are not in this copy.
  The owner then had the data server started again (2026-11-14).  Same day, commit `ef1a3103` (main, which also carries the other
  session's `1113bfb6`, `a679efa1`, `ca6a0193`) copied the same way: card payments, the AcceptText-in-ItemChanged fix (customer choice on
  Credit Sale), masked DataWindow password cells; same rollback.  The live database got the card setup the same day (account 326,
  rights 582-585, payment preferences; see docs/HANDOFF.md), backup first: C:/Waseela/files/backups/waseela-pre-cardsetup-2026-11-14.dump.
* The old PowerBuilder application and its SQL Server instance keep running untouched; do not decommission
  them until the snapshot decision is made and a period of parallel running is accepted.
* The rebuilt application has no licence checks (owner decision 2026-11-02), server-side rights are not
  enforced yet (client-side only, as the original), and passwords are stored as in the original schema.
* HTTPS is not configured (LAN traffic is HTTP with a shared token). For wider/untrusted networks,
  put the server behind a reverse proxy with TLS first.
* The local PostgreSQL superuser password and test ADMIN password are public by the owner's accepted
  decision (test-only credentials, localhost).

# Internet deployment — pharmacy.polytronx.com (VPS 185.252.233.186)

Installed 2026-11-14 at the owner's request, from commit `394a40fa` (CI green). The files live in `deploy/pharmacy/`
(copies of what runs on the server, without secrets).

| Piece | Where / how |
|---|---|
| Host | Ubuntu 24.04, shared with the owner's other sites; `ssh vps` (key `~/.ssh/id_ed25519`) |
| Stack | `/opt/pharmacy/compose.yml` (project `pharmacy`): `pharmacy-db` (postgres:17, volume `pharmacy_pgdata`, internal network only) and `pharmacy-app` (image `pharmacy-app:394a40fa`, built on the server from `deploy/pharmacy/Dockerfile` with the repo clone `/opt/pharmacy/src`; port 8787 not published) |
| Secrets | `/opt/pharmacy/.env` (root only): image tag, PostgreSQL superuser and app-role passwords (random) |
| Web data | `web/public/data` is not in git, so `/opt/pharmacy/web-data` (copy of `C:\Waseela\web\data`, 2,938 files) is mounted read-only at `/srv/web/data` |
| Database | `waseela`, restored 2026-11-14 from a `pg_dump` of the PC's live database (`/opt/pharmacy/restore/`); all 764 tables have the same row count as the PC (9,636,343 rows). App role `waseela` (DML + execute, no DDL), database time zone Asia/Karachi (the server's sessions use UTC, as on the PC). `fk_purledger_taxcategory_taxcategorycode` re-added `NOT VALID` (one purchase row with tax category 87, same on the PC) |
| Proxy | Nginx Proxy Manager container, hand-written host `/opt/docker/nginx-proxy-manager/data/nginx/proxy_host/pharmacy-manual.conf` (not in the NPM database); Let's Encrypt certificate `pharmacy.polytronx.com` (webroot, renewed by the server's existing root cron `certbot renew`) |
| Access | Owner decision 2026-11-14: no API token; the whole site sits behind one basic-auth login (`/opt/docker/nginx-proxy-manager/data/access/pharmacy.htpasswd`, credentials chosen by the owner), then the application's own user login |
| Backup | `/etc/cron.d/pharmacy-backup` runs `/opt/pharmacy/backup.sh` daily 22:40 UTC: `pg_dump -Fc` to `/opt/pharmacy/backups`, 14 days kept; log `/var/log/pharmacy-backup.log` |

Verified 2026-11-14: without or with a wrong login every path answers 401; with the login `/api/health` is `db:true`, a session
opens and queries `dbo.users` (9 rows); http redirects to https; the Modern sign-in page loads from the server (through an SSH
tunnel) with no console errors. Not checked: signing in as a staff user and working screens (needs a staff login), printers
(raw/thermal printing is sent by the server, which has no printers) and FBR (the fiscal service is not on the VPS).

**Two databases.** The PC (`C:\Waseela`, 192.168.18.39) and the VPS each have their own copy since 2026-11-14; entries made in one
do not appear in the other. Decide which one the staff use.

Operate (on the server): `cd /opt/pharmacy && docker compose ps | logs app | restart app`. Update the app: `git -C src fetch &&
git -C src checkout <commit>`, `docker build -f Dockerfile -t pharmacy-app:<commit> src`, set `APP_TAG` in `.env`,
`docker compose up -d app`; refresh `web-data` when the generated data changes. Restore: `docker exec -i pharmacy-db pg_restore
-U postgres -d <new db> --no-owner --no-acl < dump`, then the grants from this section.
