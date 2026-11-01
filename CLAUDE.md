# Rebuild repository rules
- Private repository. Never make it public. Never commit vendor passwords, backup passwords, hard-coded server credentials or customer data.
- Recovered scripts are redacted by `tools/redact.py` before they enter this repo; never copy values from the unredacted parent project.
- No Rust/MSVC/PostgreSQL locally: Rust + database validation runs in GitHub Actions. Node and Python run locally.
- Licensing/activation of the original is not reproduced; the rebuild has its own licensing decision.
- Status of parity work: `docs/PARITY.md` (generated, numbers come from tools, not from memory).
