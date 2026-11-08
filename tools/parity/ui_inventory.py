"""Inventory redacted UI definitions without connecting to an application/database.

Run from the rebuild:
  python -I tools\\parity\\ui_inventory.py --out <session-artifact.json>

The result is a static baseline, not a runtime coverage or print-template claim.
Only allowlisted presentation metadata is emitted; SQL, script bodies, record
values, control defaults, and credentials are never copied to the report.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROCESSING = ("freeform", "grid", "label", "graph", "crosstab", "composite", "ole", "richtext")


def read_json(path):
    raw = path.read_bytes()
    decoded = gzip.decompress(raw) if path.suffix == ".gz" else raw
    result = json.loads(decoded.decode("utf-8-sig"))
    if not isinstance(result, dict):
        raise ValueError(f"{path.name}: expected a JSON object")
    return result, raw


def fields(node):
    return {str(f["name"]).lower(): f.get("value") for f in node.get("fields", [])}


def merge_controls(base, overrides):
    result = {str(c["name"]).lower(): copy.deepcopy(c) for c in base}
    for override in overrides:
        key = str(override["name"]).lower()
        previous = result.get(key, {})
        values = {str(f["name"]).lower(): f for f in previous.get("fields", [])}
        values.update({str(f["name"]).lower(): f for f in override.get("fields", [])})
        result[key] = {
            **previous,
            **override,
            "fields": list(values.values()),
            "controls": merge_controls(previous.get("controls", []), override.get("controls", [])),
        }
    return list(result.values())


def resolve_controls(name, classes, cache, visiting):
    if name in cache:
        return cache[name]
    if name in visiting:
        raise ValueError(f"Inheritance cycle at {name}")
    node = classes[name]["node"]
    ancestor = str(node.get("ancestor") or "").lower()
    visiting.add(name)
    inherited = resolve_controls(ancestor, classes, cache, visiting) if ancestor in classes else []
    result = merge_controls(inherited, node.get("controls", []))
    visiting.remove(name)
    cache[name] = result
    return result


def control_rows(controls, prefix=""):
    for control in controls:
        name = str(control["name"]).lower()
        path = f"{prefix}.{name}" if prefix else name
        props = fields(control)
        row = {
            "path": path,
            "declaredAncestor": str(control.get("ancestor") or "").lower(),
            "datawindow": str(props.get("dataobject") or "").lower(),
            "initialVisibility": props.get("visible"),
            "initialEnabled": props.get("enabled"),
            "tabOrder": props.get("taborder"),
            "modernStatus": "not-started",
        }
        yield row
        yield from control_rows(control.get("controls", []), path)


def menu_rows(items, path):
    for item in items:
        child = f"{path}.{str(item['name']).lower()}"
        children = item.get("items", [])
        yield {"id": child, "leaf": not children, "runtimeVisibility": "unverified"}
        yield from menu_rows(children, child)


ASSIGN = re.compile(r"""(?:([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*\.\s*)?dataobject\s*=\s*["']([A-Za-z0-9_]+)["']""", re.I)
LITERAL = re.compile(r"""["']([A-Za-z_][A-Za-z0-9_]*)["']""")


def script_target(identifier):
    """Category of the object a script assigns a DataWindow to, from the assignment target alone."""
    name = (identifier or "").split(".")[-1].lower()
    if not name:
        return "implicit"
    if "print" in name:
        return "print"
    if "report" in name or name.startswith("rpt"):
        return "report"
    if re.match(r"^(l|i|a|g)?ds_|^lds|^ids", name):
        return "datastore"
    if name.startswith(("dw_", "adw_", "idw_", "ldw_")):
        return "control"
    return "other"


def script_references(source, names):
    """Static DataWindow references found in the redacted scripts (assignment targets and any other literal use)."""
    root = source / "scripts"
    uses = {name: Counter() for name in names}
    literal = set()
    digest = hashlib.sha256()
    files = 0
    if root.is_dir():
        for path in sorted(root.rglob("*.pbs")):
            text = path.read_bytes()
            digest.update(path.relative_to(root).as_posix().encode("utf-8") + b"\0" + text)
            files += 1
            decoded = text.decode("utf-8", errors="replace")
            for match in ASSIGN.finditer(decoded):
                name = match.group(2).lower()
                if name in uses:
                    uses[name][script_target(match.group(1))] += 1
            for match in LITERAL.finditer(decoded):
                name = match.group(1).lower()
                if name in uses:
                    literal.add(name)
    return uses, literal, files, digest.hexdigest() if files else None


def inventory(root):
    source = root / "data" / "src"
    digest = hashlib.sha256()

    def load(path):
        value, raw = read_json(path)
        digest.update(path.relative_to(source).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(raw)
        return value

    classes = {}
    for path in sorted((source / "objects").rglob("*.json")):
        node = load(path)
        name = str(node["name"]).lower()
        if name in classes:
            raise ValueError(f"Ambiguous duplicate class: {name}")
        classes[name] = {
            "node": node,
            "library": path.relative_to(source / "objects").parts[0],
            "kind": node.get("kind") or path.parent.name,
        }
    if not classes:
        raise ValueError("No object definitions found in data/src/objects")

    cache = {}
    windows = []
    for name, entry in sorted(classes.items()):
        if entry["kind"] != "window":
            continue
        node = entry["node"]
        rows = list(control_rows(resolve_controls(name, classes, cache, set())))
        windows.append({
            "id": name,
            "library": entry["library"],
            "ancestor": node.get("ancestor"),
            "controls": rows,
            "staticDatawindows": sorted({r["datawindow"] for r in rows if r["datawindow"]}),
            "runtimeReachability": "unverified",
            "roleCoverage": "unverified",
            "classicEvidence": [],
            "modernStatus": "not-started",
        })

    dw_index = load(source / "dw" / "_index.json")
    definitions = {}
    shadowed = []
    for path in sorted((source / "dw").glob("*.json.gz")):
        if path.name.startswith("_"):
            continue
        bundle = load(path)
        for original_name, definition in sorted(bundle.items()):
            name = original_name.lower()
            library = path.name.removesuffix(".json.gz")
            if dw_index.get(name) != library:
                shadowed.append({"id": name, "library": library, "selectedLibrary": dw_index.get(name)})
                continue
            if name in definitions:
                raise ValueError(f"Duplicate indexed DataWindow: {name}")
            dw = definition.get("datawindow", {})
            processing = int(dw.get("processing") or 0)
            table = definition.get("table", {})
            objects = definition.get("objects", [])
            definitions[name] = {
                "id": name,
                "library": library,
                "processing": PROCESSING[processing] if 0 <= processing < len(PROCESSING) else "unknown",
                "columns": [{"name": c["name"], "type": c.get("type")} for c in table.get("columns", [])],
                "objects": [
                    {"name": o.get("name"), "type": o.get("type"), "band": o.get("band")}
                    for o in objects
                ],
                "nestedReports": sorted({o["dataobject"].lower() for o in objects if o.get("type") == "report" and o.get("dataobject")}),
                "documentUse": "unclassified",
                "modernStatus": "not-started",
            }
    if not definitions:
        raise ValueError("No DataWindow bundles found in data/src/dw")

    uses, literal, script_files, script_digest = script_references(source, definitions.keys())
    for name, definition in definitions.items():
        counted = dict(sorted(uses[name].items()))
        definition["scriptUse"] = {"assignedTo": counted, "referencedInScripts": name in literal}
    # Static evidence only: where a window control names the DataWindow, and whether that control starts visible.
    # This is not a document classification; dynamic assignments in scripts are not visible here.
    for definition in definitions.values():
        definition["staticUse"] = {"visibleControls": 0, "hiddenControls": 0, "nestedInReports": 0}
    for window in windows:
        for row in window["controls"]:
            target = definitions.get(row["datawindow"]) if row["datawindow"] else None
            if target is not None:
                target["staticUse"]["hiddenControls" if row["initialVisibility"] is False else "visibleControls"] += 1
    for definition in list(definitions.values()):
        for nested in definition["nestedReports"]:
            if nested in definitions:
                definitions[nested]["staticUse"]["nestedInReports"] += 1

    menus = []
    for path in sorted((source / "menu_trees").rglob("*.json")):
        node = load(path)
        menus.append({
            "id": str(node["name"]).lower(),
            "items": list(menu_rows(node.get("items", []), str(node["name"]).lower())),
        })

    referenced = {n for w in windows for n in w["staticDatawindows"]}
    referenced.update(n for d in definitions.values() for n in d["nestedReports"])
    missing = sorted(referenced - definitions.keys())
    return {
        "schemaVersion": 1,
        "sourceDigest": digest.hexdigest(),
        "scriptDigest": script_digest,
        "scope": "static-redacted-definitions",
        "limitations": [
            "Definition counts are not implemented-screen or printable-document counts.",
            "Runtime script changes, callers, authorization, labels, and role coverage need scenario evidence.",
            "Window inheritance is merged; custom control-class internals still need runtime expansion.",
            "DataWindows include screen grids, dropdowns, and reports; document use is not guessed from names.",
            "Only static control/nested-report references are checked for missing definitions.",
        ],
        "counts": {
            "classes": len(classes),
            "windows": len(windows),
            "windowControlPaths": sum(len(w["controls"]) for w in windows),
            "datawindows": len(definitions),
            "indexedDatawindows": len(dw_index),
            "shadowedDefinitions": len(shadowed),
            "missingIndexedDatawindows": len(dw_index.keys() - definitions.keys()),
            "datawindowColumns": sum(len(d["columns"]) for d in definitions.values()),
            "menus": len(menus),
            "menuItems": sum(len(m["items"]) for m in menus),
            "staticMissingDatawindows": len(missing),
            "modernVerified": 0,
            "datawindowsOnVisibleControls": sum(1 for d in definitions.values() if d["staticUse"]["visibleControls"]),
            "datawindowsOnlyOnHiddenControls": sum(1 for d in definitions.values() if not d["staticUse"]["visibleControls"] and d["staticUse"]["hiddenControls"]),
            "datawindowsNestedOnly": sum(1 for d in definitions.values() if not d["staticUse"]["visibleControls"] and not d["staticUse"]["hiddenControls"] and d["staticUse"]["nestedInReports"]),
            "datawindowsWithoutStaticUse": sum(1 for d in definitions.values() if not any(d["staticUse"].values())),
            "scriptFiles": script_files,
            "datawindowsAssignedInScripts": sum(1 for d in definitions.values() if d["scriptUse"]["assignedTo"]),
            "datawindowsAssignedToReportTargets": sum(1 for d in definitions.values() if d["scriptUse"]["assignedTo"].get("report")),
            "datawindowsAssignedToPrintTargets": sum(1 for d in definitions.values() if d["scriptUse"]["assignedTo"].get("print")),
            "datawindowsAssignedToDatastores": sum(1 for d in definitions.values() if d["scriptUse"]["assignedTo"].get("datastore")),
            "datawindowsWithNoStaticOrScriptUse": sum(1 for d in definitions.values() if not any(d["staticUse"].values()) and not d["scriptUse"]["assignedTo"] and not d["scriptUse"]["referencedInScripts"]),
            "processing": dict(sorted(Counter(d["processing"] for d in definitions.values()).items())),
        },
        "missingStaticDatawindows": missing,
        "missingIndexedDatawindows": sorted(dw_index.keys() - definitions.keys()),
        "shadowedDefinitions": shadowed,
        "windows": windows,
        "datawindows": [definitions[n] for n in sorted(definitions)],
        "menus": menus,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = inventory(args.root.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceDigest": result["sourceDigest"], **result["counts"]}, indent=2))


if __name__ == "__main__":
    main()
