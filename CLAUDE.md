# Rebuild repository rules
- Public repository since 2026-11-04 (the user's permanent decision, so GitHub Actions is free; it was private before). Never commit vendor passwords, backup passwords, hard-coded server credentials, customer data or vendor binaries - everything pushed here is world-readable.
- Recovered scripts are redacted by `tools/redact.py` before they enter this repo; never copy values from the unredacted parent project.
- No Rust/MSVC/PostgreSQL locally: Rust + database validation runs in GitHub Actions. Node and Python run locally.
- Licensing/activation of the original is not reproduced; the rebuild has its own licensing decision.
- Status of parity work: `docs/PARITY.md` (generated, numbers come from tools, not from memory).
