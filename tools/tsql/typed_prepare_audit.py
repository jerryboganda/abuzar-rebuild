"""Typed PREPARE audit for the 30 parameter-inference entries.

The runtime substitutes typed literals, so a statement that only fails because
PostgreSQL cannot infer `$n` is not a runtime defect.  This script rebuilds the
parameter list with the DataWindow argument types and runs a typed PREPARE.
usage (from the repo root): AUDIT_DATABASE_URL=postgresql://user:pass@host/db python -I tools/tsql/typed_prepare_audit.py
AUDIT_FAILS names the file the untyped audit failures were written to (default prepare_fails.json,
the AUDIT_OUT of prepare_audit.py). RESEARCH_SRC names the research project directory
(default the parent directory's parent, i.e. the folder containing this repo's parent).
"""
import json
import os
import sys
from pathlib import Path

repo = str(Path(__file__).resolve().parents[2])
src = os.environ.get("RESEARCH_SRC") or os.environ.get("RESEARCH_PROJECT") or str(Path(repo).parent)
sys.path.insert(0, os.path.join(repo, "tools"))

from tsql.build import prepare
import importlib.util

spec = importlib.util.spec_from_file_location("stmts", os.path.join(repo, "tools", "tsql", "stmts.py"))
stmts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stmts)

import psycopg

fails_path = os.environ.get("AUDIT_FAILS") or os.environ.get("FINAL_FAILS") or "prepare_fails.json"
fails = json.loads(Path(fails_path).read_text(encoding="utf-8"))
sql = json.loads(Path(os.path.join(repo, "web/public/data/sql.json")).read_text(encoding="utf-8"))


def is_param(e):
    return any(k in e for k in (
        "could not determine data type", "inconsistent types deduced",
        "operator is not unique", "operator does not exist",
    ))


targets = [f for f in fails if is_param(f["error"])]
print("parameter entries:", len(targets))

# DataWindow argument name -> declared type
dw_args = {}
for f in Path(src, "recovered", "datawindows_json").rglob("*.json"):
    name = f.stem
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        continue
    t = d.get("table") or {}
    items = ((t.get("arguments") or {}).get("_items") or [])
    out = {}
    for it in items:
        if isinstance(it, dict) and isinstance(it.get("_items"), list) and len(it["_items"]) >= 2:
            out[str(it["_items"][0]).lower()] = str(it["_items"][1]).lower()
    if out:
        dw_args.setdefault(name.lower(), out)

TYPE = {
    "number": "numeric",
    "numeric": "numeric",
    "decimal": "numeric",
    "real": "numeric",
    "double": "numeric",
    "integer": "integer",
    "long": "bigint",
    "string": "text",
    "char": "text",
    "date": "date",
    "datetime": "timestamp",
    "timestamp": "timestamp",
    "boolean": "boolean",
}


def prefix_type(name):
    n = name.lower()
    if n.startswith(("ai_", "li_", "ii_")):
        return "integer"
    if n.startswith(("al_", "ll_", "il_")):
        return "bigint"
    if n.startswith(("ad_", "ld_", "id_")):
        return "numeric"
    if n.startswith(("adt_", "ldt_")):
        return "timestamp"
    if n.startswith(("as_", "ls_", "is_")):
        return "text"
    return "text"


# Rebuild the translator once so DataWindow bind order is known exactly.
tables, cat, tr, parsed = prepare(src, repo)
translated = {}
for d in stmts.dw_items(os.path.join(src, "recovered", "datawindows_json")):
    translated.setdefault(d["id"].split("/")[-1].lower(), d)

problems = []
typed_ok = []

conn = psycopg.connect(os.environ["AUDIT_DATABASE_URL"], autocommit=True)
cur = conn.cursor()

for f in targets:
    section, name = f["section"], f["name"]
    entry = sql[section][name]
    text = entry.get("sql")
    if not text:
        problems.append((name, "no SQL"))
        continue
    binds = None
    if section == "dw":
        d = translated.get(name.lower())
        if d:
            try:
                raw = d["raw"]
                args = d["args"]
                if d["dwkind"] == "pbselect":
                    raw2, extra = stmts.pbselect_to_tsql(raw)
                    raw = raw2
                    args = {**args, **extra}
                bt = {k: "D" for k, v in args.items() if v in ("datetime", "date", "time", "timestamp")}
                out_sql, binds, into = stmts.translate_text(tr, raw, bt)
            except Exception as e:
                problems.append((name, "translate: " + str(e)[:120]))
                continue
        else:
            problems.append((name, "no recovered definition"))
            continue
    if binds is None:
        binds = [str(p).lower() for p in entry.get("params", [])]

    types = []
    for b in binds:
        b = str(b).lower()
        t = None
        if section == "dw":
            t = dw_args.get(name.lower(), {}).get(b)
        if t is None:
            t = prefix_type(b)
        base = t[:-4] if t.endswith("list") else t
        types.append(TYPE.get(base, base if base in ("integer", "bigint", "numeric", "text", "date", "timestamp", "boolean") else "text"))

    # keep types aligned with the statement's actual placeholders
    n = len(entry.get("params", []))
    if len(types) != n:
        types = [prefix_type(p) for p in entry.get("params", [])]

    sig = ", ".join(types) if types else ""
    try:
        cur.execute(f"PREPARE audit ({sig}) AS {text}" if types else f"PREPARE audit AS {text}")
        cur.execute("DEALLOCATE audit")
        typed_ok.append((section, name, sig))
    except Exception as e:
        problems.append((name, str(e).split("\n")[0][:180]))
        try:
            cur.execute("DEALLOCATE audit")
        except Exception:
            pass

cur.close()
conn.close()
print("typed PREPARE ok:", len(typed_ok), "/", len(targets))
for sec, name, sig in typed_ok:
    print("OK", sec, name, "(", sig, ")")
print("problems:", len(problems))
for name, err in problems:
    print("FAIL", name, "::", err)
