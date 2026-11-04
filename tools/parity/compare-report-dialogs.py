"""Compare the visible captions of the first-stage report dialogs, old vs rebuild.

Old capture: deploy/parity/screen-parity/old-reports (and old-reports-b)
New capture: deploy/parity/screen-parity/new-reports (and new-reports-b)
Both store one JSON per menu path; the report argument/format dialog is a
top-level window in the old capture and a modal window in the rebuild capture.
The comparison is on normalized visible text, not on pixels: it finds a missing
label or button on a report dialog without needing the same screenshot crop.
"""
import json
import glob
import os
import re
import sys
from collections import Counter

ROOT = r"C:\Projects\Abuzar\deploy\parity\screen-parity"


def clean(t):
    return re.sub(r"\s+", " ", str(t or "").replace("&", "")).strip()


def norm(t):
    return clean(t).lower()


def load_dir(path):
    out = {}
    screens = {}
    sf = os.path.join(path, "screens.json")
    if os.path.exists(sf):
        try:
            for row in json.load(open(sf, encoding="utf-8-sig")):
                screens[int(row.get("n", 0))] = row.get("path")
        except Exception:
            pass
    for f in glob.glob(os.path.join(path, "*.json")):
        if os.path.basename(f) == "screens.json":
            continue
        if re.search(r"_s\d+\.json$", os.path.basename(f)):
            continue
        try:
            d = json.load(open(f, encoding="utf-8-sig"))
        except Exception:
            continue
        p = d.get("path")
        if not p:
            m = re.match(r"(\d{3})_", os.path.basename(f))
            if m:
                p = screens.get(int(m.group(1)))
        if p:
            out[norm(p)] = (f, d)
    return out


def walk_controls(controls):
    out = []
    for c in controls or []:
        if c.get("visible", True) and clean(c.get("text")):
            out.append(clean(c.get("text")))
        out.extend(walk_controls(c.get("children")))
    return out


def texts(d):
    out = []
    for w in d.get("windows", []):
        # old: winControls; new: controls
        out.extend(walk_controls(w.get("winControls")))
        out.extend(walk_controls(w.get("controls")))
    return out


old = {}
for sub in ("old-reports", "old-reports-b"):
    old.update(load_dir(os.path.join(ROOT, sub)))
new = {}
for sub in ("new-reports", "new-reports-b"):
    new.update(load_dir(os.path.join(ROOT, sub)))

paired = 0
missing_total = 0
extra_total = 0
rows = []
for p in sorted(set(old) & set(new)):
    _, od = old[p]
    _, nd = new[p]
    ot = texts(od)
    nt = texts(nd)
    # multiplicity matters for repeated grid headers, so compare counters
    oc, nc = Counter(norm(x) for x in ot), Counter(norm(x) for x in nt)
    missing = list((oc - nc).elements())
    extra = list((nc - oc).elements())
    paired += 1
    missing_total += len(missing)
    extra_total += len(extra)
    if missing or extra:
        rows.append((len(missing) + len(extra), p, missing[:8], extra[:8]))

print(f"paired report dialogs: {paired}")
print(f"missing captions: {missing_total}  extra captions: {extra_total}")
for n, p, miss, extra in sorted(rows, reverse=True)[:25]:
    print(f"\n[{n}] {p}")
    if miss:
        print("  missing:", miss)
    if extra:
        print("  extra  :", extra)
