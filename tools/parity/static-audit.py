"""Static completeness audit of the rebuild against the recovered PowerBuilder definitions.

Reports, without opening a screen:
  * control classes used by the application that the DOM renderer cannot create
  * control events that have a script but are never fired by the UI host
  * DataWindow object types present in the 8,740 definitions
  * windows whose controls use a native type with no renderer
Run from the rebuild repository:
  python -I tools/parity/static-audit.py C:\\Projects\\Abuzar
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Projects\Abuzar")
HERE = Path(__file__).resolve().parent
REBUILD = HERE.parent.parent

obj_root = ROOT / "recovered" / "objects"
scr_root = ROOT / "recovered" / "scripts"
dw_root = ROOT / "recovered" / "datawindows"

# ---------------------------------------------------------------- objects
native_of = {}
controls_of = defaultdict(list)  # object name -> [(control name, native)]
object_kind = {}
def add_object(d, lib):
    name = str(d.get("name", "")).lower()
    if not name:
        return
    kind = d.get("kind") or "object"
    object_kind[name] = kind
    def walk(c, owner):
        cn = str(c.get("name", "")).lower()
        anc = str(c.get("ancestor", "")).lower()
        if cn:
            native_of[cn] = anc
            controls_of[owner].append((cn, anc))
            walk_children(c, cn)
    def walk_children(c, owner):
        for cc in c.get("controls") or []:
            walk(cc, owner)
    for c in d.get("controls") or []:
        walk(c, name)
    native_of.setdefault(name, str(d.get("ancestor") or kind).lower())

obj_files = list(obj_root.rglob("*.json"))
for f in obj_files:
    try:
        d = json.loads(f.read_text(encoding="utf-8-sig"))
    except Exception:
        continue
    if isinstance(d, dict):
        add_object(d, f.parent.name)

# scripts: owner.event headers
event_re = re.compile(r"^//\s+([A-Za-z0-9_\-]+)\.([A-Za-z0-9_]+)\(\)", re.M)
events = defaultdict(set)
for f in scr_root.rglob("*.pbs"):
    text = f.read_text(encoding="utf-8", errors="replace")
    for owner, ev in event_re.findall(text):
        events[owner.lower()].add(ev.lower())

# UI-fired events
ui_src = "\n".join((REBUILD / "web" / "src" / "ui" / n).read_text(encoding="utf-8") for n in ["dom-ui.ts", "dwview.ts"])
nat_src = "\n".join(p.read_text(encoding="utf-8") for p in (REBUILD / "web" / "src" / "runtime" / "native").glob("*.ts"))
fired = set(re.findall(r"""fire\((?:[^,()]|\([^)]*\))*,\s*['"]([a-z_0-9]+)['"]""", ui_src + "\n" + nat_src))
fired |= set(re.findall(r"""\.fire\([^,]+,\s*['"]([a-z_0-9]+)['"]""", nat_src))
# every event name mentioned to rt.fire in any form (multiline, template)
fired |= set(re.findall(r"""fire\([^;]{0,160}?['"]([a-z_0-9]+)['"]""", ui_src + "\n" + nat_src, re.S))

standard_events = {
    "clicked", "doubleclicked", "rbuttondown", "rbuttonup", "getfocus", "losefocus",
    "modified", "itemchanged", "itemfocuschanged", "selectionchanging", "selectionchanged",
    "rowfocuschanged", "rowfocuschanging", "editchanged", "dragdrop", "dragenter", "dragleave",
    "dragwithin", "beginlabeledit", "endlabeledit", "begindrag", "beginrightdrag", "sort",
    "columnclick", "expanded", "collapsed", "pictureclicked", "constructor", "destructor",
    "create", "destroy", "open", "close", "closequery", "activate", "deactivate", "resize",
    "key", "timer", "ue_enterkey", "ue_dwnkey", "retrievestart", "retrieveend", "updatestart",
    "updateend", "dberror", "sqlpreview", "printstart", "printend", "printpage",
}

# supported control types from makeControl
dom = (REBUILD / "web" / "src" / "ui" / "dom-ui.ts").read_text(encoding="utf-8")
m = re.search(r"makeControl\(c: PBObject\): CtlView \| null \{(.*?)\n  \}\n", dom, re.S)
switch_src = m.group(1) if m else ""
supported = set(re.findall(r"case '([a-z0-9_]+)'", switch_src))
# native factory map
win_src = (REBUILD / "web" / "src" / "runtime" / "native" / "windowing.ts").read_text(encoding="utf-8")
supported |= set(re.findall(r"nat\.set\(\s*'([a-z0-9_]+)'", win_src))

native_types = Counter()
for owner, cs in controls_of.items():
    for cn, anc in cs:
        native_types[anc] += 1

unsupported = sorted((t, n) for t, n in native_types.items() if t and t not in supported)
print("== control types ==")
print("used:", len(native_types), "supported by renderer:", len(supported))
print("unsupported (type, count):", unsupported)

# events with a script but never fired
print("\n== control events ==")
by_type = defaultdict(set)
for owner, evs in events.items():
    t = native_of.get(owner)
    if not t or t in ("window", "menu", "application", "function", "structure", "userobject"):
        continue
    for ev in evs:
        if ev in standard_events:
            by_type[t].add(ev)
missing_events = {}
for t, evs in sorted(by_type.items()):
    miss = sorted(e for e in evs if e not in fired)
    if miss:
        missing_events[t] = miss
for t, evs in missing_events.items():
    print(f"  {t}: {', '.join(evs)}")

# per-window control types unsupported
print("\n== windows with unsupported controls ==")
for w in sorted(controls_of):
    bad = sorted({anc for _, anc in controls_of[w] if anc and anc not in supported})
    if bad:
        print(f"  {w}: {', '.join(bad)}")

# DataWindow object types
print("\n== DataWindow object types ==")
dw_types = Counter()
dw_files = list(dw_root.rglob("*.json"))
for f in dw_files:
    try:
        d = json.loads(f.read_text(encoding="utf-8-sig"))
    except Exception:
        continue
    objs = d.get("objects") or []
    for o in objs:
        if isinstance(o, dict):
            dw_types[str(o.get("type", "")).lower()] += 1
print("definitions:", len(dw_files))
print(dict(dw_types.most_common()))

# control event counts
print("\n== event scripts by native type (top) ==")
for t, evs in sorted(by_type.items(), key=lambda kv: -len(kv[1]))[:25]:
    print(f"  {t}: {len(evs)} events, {sum(1 for _ in [0])}")
