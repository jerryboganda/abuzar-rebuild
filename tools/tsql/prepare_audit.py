"""PREPARE every translated statement / DataWindow / procedure call against a PostgreSQL database that has the schema applied.
usage (from the repo root): AUDIT_DATABASE_URL=postgresql://user:pass@host/db python -I tools/tsql/prepare_audit.py
AUDIT_OUT names the file the failure list is written to (default prepare_fails.json)."""
import json, os, psycopg
from collections import Counter
from pathlib import Path

sql = json.loads(Path("web/public/data/sql.json").read_text(encoding="utf-8"))
conn = psycopg.connect(os.environ["AUDIT_DATABASE_URL"], autocommit=True)
cur = conn.cursor()
fails = []
ok = 0
for section in ("stmt", "dw", "proc"):
    for name, entry in sql.get(section, {}).items():
        text = entry.get("sql") or entry.get("call")
        if not text:
            continue
        try:
            cur.execute("PREPARE audit AS " + text)
            cur.execute("DEALLOCATE audit")
            ok += 1
        except Exception as e:
            fails.append({"section": section, "name": name, "error": str(e).strip().split("\n")[0][:300]})
            try:
                cur.execute("DEALLOCATE audit")
            except Exception:
                pass
cur.close()
conn.close()
print("ok", ok, "fails", len(fails))
c = Counter((f["section"], f["error"].split("at or near")[-1][:80]) for f in fails)
for k, n in c.most_common(25):
    print(n, k)
Path(os.environ.get("AUDIT_OUT", "prepare_fails.json")).write_text(json.dumps(fails, indent=1), encoding="utf-8")
print("--- first 40 ---")
for f in fails[:40]:
    print(f["section"], f["name"], "::", f["error"][:180])
