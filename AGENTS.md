# Instructions for coding agents

Rebuild of the PowerBuilder 12.5 "Trader App v1" as Tauri 2 + Rust (axum + sqlx) + PostgreSQL 17, 100% parity with the original.

1. Read `docs/HANDOFF.md` first (state, rules, how to verify, open items), then `CLAUDE.md`, `README.md`, `docs/PARITY.md`, `docs/FIDELITY.md`.
2. This repository is **public**: never commit credentials, vendor backup/media passwords, the app login, customer data or vendor binaries.  Never push the parent folder `C:\Projects\Abuzar` (public, holds vendor binaries).
3. Rust/database validation runs in GitHub Actions; non-browser Node and Python checks can run locally. Browser validation follows the project execution policy below, including browser jobs in CI.
4. Never `git add -A`; add explicit paths.  Do not hand-edit generated files (`db/pg/40-70`, `data/sql/*.json`): change the generator in `tools/tsql/` and regenerate.
5. Follow the autonomous decision policy below; keep status lines short; report measured numbers, never estimates.

## GitHub Actions and repository visibility (user-directed, 2026-11-08)

1. **Use GitHub Actions for the maximum possible number of tasks** in
   `jerryboganda/abuzar-rebuild`: Rust, PostgreSQL, type, lint, unit, static,
   generator-freshness and build checks, packaging, and any other task that can
   run there instead of locally. Prefer a CI job over a local run whenever the
   local toolchain is missing or the job is heavy. Browser jobs still follow the
   project execution policy below (one consolidated final pass), unless the user
   says otherwise.
2. **Keep this repository public, always.** Never make it private. It must
   keep holding no vendor binaries, backups, credentials or customer data
   (everything pushed is world-readable). The parent repo `C:\Projects\Abuzar`
   stays unpushed.
3. Pushing a branch to run Actions uses the already-active GitHub account only;
   never switch accounts or change credentials. If a push is refused, record the
   blocker and continue other work.

## UI standard (user-directed, 2026-11-08; supersedes any earlier "Modern is optional")

Modern is the **compulsory** product UI, not an optional preview, and must be
enterprise-grade and fully functional for a live multi-million-dollar business.
Every window must have a Modern presentation with **100% structural parity of
the UI/UX frontend** with the original (Classic) - structure, not design: the
same controls and control types (a dropdown stays a dropdown, an input stays an
input), the same order, the same arrangement and proportions (two fields sharing
a row 50/50, one a dropdown and one a text field, stay two fields sharing a row
about 50/50 in the same order), the same visible and hidden fields, tabs, groups
and actions, and the same validation, masks, wording and behaviour. Visual
design (colours, fonts, spacing, icons, elevation) is free to be modern.
Any Classic/Modern difference in structure or behaviour is a defect to fix in
Modern, never a check to relax.
The only exceptions are the user-approved ones listed in `docs/HANDOFF.md`,
**Approved parity exceptions** (first: Pack Purchase, 2026-11-11).

**Exempt from parity: PDF, print and report output.** Printed documents,
PDF/report layouts, labels and print design may be redesigned freely into
modern-grade graphics and super-enhanced. Only their data content must stay
correct (the same data, totals and business meaning); their look and layout need
no parity. This does not cover on-screen report-criteria and print-settings
dialogs, which keep structural parity like any other window. Classic is the reference baseline and the runtime fallback when a layout
fails validation. Modern becomes the default startup when the parity evidence
exists (structure-parity gate, completed browser pass, business acceptance of the
transaction screens); until then Classic stays the startup so live data is never
exposed to an unverified screen. Never claim parity or acceptance without that
evidence.

## Project execution policy (user-directed, 2026-11-08)

These two rules apply to future work in this project and supersede older
per-slice browser-testing and routine confirmation instructions in plans,
handoffs and checklists.

1. **Code first; one final browser pass.** Do not run browser tests during
   implementation: no Playwright/browser smoke runs, focused browser suites,
   screenshot regressions or repeated visual-verification loops. Do not
   indirectly trigger them through wrapper commands or CI during this phase.
   Continue writing the necessary tests and fixtures, but defer their browser
   execution until the entire agreed code scope is implemented, not merely
   one window, family or slice. Then run one consolidated final browser pass
   covering the planned acceptance matrix and fix the issues it identifies.
   Do not start additional browser passes without explicit user authorization.
   Keep browser-affecting fixes made after that pass marked as not browser-
   reverified; never claim all issues are fixed or 100% verified without
   supporting evidence. Non-browser checks (types, lint, unit/static checks
   and builds) remain available for code correctness under existing toolchain
   restrictions. This changes browser-test timing, not acceptance standards.
2. **Resolve questions up front; use recommended defaults afterward.**
   Review the existing requirements and saved decisions first. Resolve truly
   necessary clarification at the outset rather than interrupting each slice;
   no new clarification is needed for these two rules. For subsequent routine
   choices, select the best-supported recommended option, record consequential
   assumptions in the existing plan/handoff, and proceed without asking for
   incremental confirmation. Do not reopen settled decisions. This is not
   authorization to bypass required safety/permission prompts, switch accounts,
   use otherwise unauthorized credentials, perform destructive actions, or
   make unrequested commits, pushes or deployments. If a necessary action is
   blocked by required authorization or cannot safely be inferred, record the
   blocker and continue independent work; ask only when that approval or
   essential user-only information is unavoidable.
