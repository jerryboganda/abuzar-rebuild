# Instructions for coding agents

Rebuild of the PowerBuilder 12.5 "Trader App v1" as Tauri 2 + Rust (axum + sqlx) + PostgreSQL 17, 100% parity with the original.

1. Read `docs/HANDOFF.md` first (state, rules, how to verify, open items), then `CLAUDE.md`, `README.md`, `docs/PARITY.md`, `docs/FIDELITY.md`.
2. This repository is **public**: never commit credentials, vendor backup/media passwords, the app login, customer data or vendor binaries.  Never push the parent folder `C:\Projects\Abuzar` (public, holds vendor binaries).
3. Validation runs in GitHub Actions (`gh workflow run ci.yml`, one run at a time, ~25 min); Node and Python tests run locally (`python -I tools/tsql/selftest.py`, `node --test web/tests/`, `node web/tools/smoke-windows.ts`).
4. Never `git add -A`; add explicit paths.  Do not hand-edit generated files (`db/pg/40-70`, `data/sql/*.json`): change the generator in `tools/tsql/` and regenerate.
5. Ask the user (a short question with a recommended option) when a decision is theirs; keep status lines short; report measured numbers, never estimates.
