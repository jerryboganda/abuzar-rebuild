#!/usr/bin/env python3
"""Compare recovered legacy DataWindow definitions with the rebuilt set.

The legacy source in recovered/datawindows_json is the ground truth exported by
the original PowerBuilder engine.  The rebuild stores the same model shape in
rebuild/data/src/dw/*.json.gz.  This tool reports definitions that were never
migrated and object/column-level differences in the ones that were.

usage:
  python tools/parity/compare-dw.py [--json out.json] [--md out.md]
"""
import argparse
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LEGACY = os.path.join(ROOT, '..', 'recovered', 'datawindows_json')
REBUILD = os.path.join(ROOT, 'data', 'src', 'dw')
OUT_DEFAULT = os.path.join(ROOT, '..', 'deploy', 'parity', 'dw-compare.json')


def load_legacy():
    out = {}
    for path in glob.glob(os.path.join(LEGACY, '*', '*.json')):
        lib = os.path.basename(os.path.dirname(path))
        name = os.path.splitext(os.path.basename(path))[0]
        try:
            with open(path, encoding='utf-8') as fh:
                out.setdefault(name, []).append((lib, json.load(fh)))
        except Exception as exc:  # noqa: BLE001
            print(f'legacy read failed {path}: {exc}', file=sys.stderr)
    return out


def load_rebuild():
    out = {}
    for path in glob.glob(os.path.join(REBUILD, '*.json.gz')):
        lib = os.path.basename(path).split('.')[0]
        try:
            with gzip.open(path, 'rt', encoding='utf-8') as fh:
                data = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            print(f'rebuild read failed {path}: {exc}', file=sys.stderr)
            continue
        for name, dw in data.items():
            out.setdefault(name, []).append((lib, dw))
    return out


def clean_obj(obj):
    """Comparable part of a DataWindow object (ignore html-only extras)."""
    keys = (
        'name', 'type', 'band', 'text', 'x', 'y', 'width', 'height',
        'visible', 'color', 'background.mode', 'background.color',
        'border', 'alignment', 'font.face', 'font.height', 'font.weight',
        'font.italic', 'font.underline', 'format', 'expression',
        'tabsequence', 'protect', 'tooltip.text', 'dddw.name',
        'dddw.displaycolumn', 'dddw.datacolumn', 'dddw.limit',
        'dddw.percentwidth', 'dddw.allowempty', 'dddw.autosize',
        'checkbox.on', 'checkbox.off', 'radiobuttons.columns',
        'values', 'initial', 'edit.codetable', 'edit.autoselect',
        'edit.autoskip', 'edit.focusrectangle', 'edit.limit',
        'edit.format', 'edit.case', 'edit.required', 'edit.mask',
        'edit.spin', 'edit.spinrange', 'edit.validatecode', 'edit.style',
    )
    out = {}
    for key in keys:
        if key in obj:
            out[key] = obj[key]
    return out


def column_key(col):
    return col.get('name') or col.get('dbname') or ''


def compare(legacy, rebuild):
    report = {
        'legacy_count': len(legacy),
        'rebuild_count': len(rebuild),
        'missing_in_rebuild': [],
        'extra_in_rebuild': [],
        'duplicate_names': [],
        'differences': [],
    }

    for name in sorted(set(legacy) | set(rebuild)):
        old_list = legacy.get(name, [])
        new_list = rebuild.get(name, [])
        if not old_list:
            report['extra_in_rebuild'].append({
                'name': name,
                'rebuild_libs': [lib for lib, _ in new_list],
            })
            continue
        if not new_list:
            report['missing_in_rebuild'].append({
                'name': name,
                'legacy_libs': [lib for lib, _ in old_list],
            })
            continue
        if len(old_list) > 1 or len(new_list) > 1:
            report['duplicate_names'].append({
                'name': name,
                'legacy': [lib for lib, _ in old_list],
                'rebuild': [lib for lib, _ in new_list],
            })
        old_lib, old = old_list[0]
        new_lib, new = new_list[0]
        diff = {'name': name, 'legacy_lib': old_lib, 'rebuild_lib': new_lib}

        old_cols = {column_key(c): c for c in old.get('table', {}).get('columns', [])}
        new_cols = {column_key(c): c for c in new.get('table', {}).get('columns', [])}
        missing_cols = [c for c in old_cols if c not in new_cols]
        extra_cols = [c for c in new_cols if c not in old_cols]
        col_changes = []
        for key in sorted(set(old_cols) & set(new_cols)):
            oc, nc = old_cols[key], new_cols[key]
            fields = {}
            for f in ('type', 'dbname', 'update', 'key', 'initial', 'values'):
                if str(oc.get(f, '')) != str(nc.get(f, '')):
                    fields[f] = [oc.get(f), nc.get(f)]
            if fields:
                col_changes.append({'column': key, 'fields': fields})
        if missing_cols or extra_cols or col_changes:
            diff['columns'] = {
                'missing_in_rebuild': missing_cols,
                'extra_in_rebuild': extra_cols,
                'changed': col_changes,
            }

        old_objs = {o.get('name', ''): clean_obj(o) for o in old.get('objects', [])}
        new_objs = {o.get('name', ''): clean_obj(o) for o in new.get('objects', [])}
        missing_objs = [o for o in old_objs if o not in new_objs]
        extra_objs = [o for o in new_objs if o not in old_objs]
        obj_changes = []
        for key in sorted(set(old_objs) & set(new_objs)):
            oc, nc = old_objs[key], new_objs[key]
            fields = {}
            for f in sorted(set(oc) | set(nc)):
                if str(oc.get(f, '')) != str(nc.get(f, '')):
                    fields[f] = [oc.get(f), nc.get(f)]
            if fields:
                obj_changes.append({'object': key, 'fields': fields})
        if missing_objs or extra_objs or obj_changes:
            diff['objects'] = {
                'missing_in_rebuild': missing_objs,
                'extra_in_rebuild': extra_objs,
                'changed': obj_changes,
            }

        # Band heights matter for row density.
        band_changes = []
        for band in ('header', 'detail', 'footer', 'summary'):
            oh = str(old.get('bands', {}).get(band, {}).get('height', ''))
            nh = str(new.get('bands', {}).get(band, {}).get('height', ''))
            if oh != nh:
                band_changes.append({'band': band, 'old': oh, 'new': nh})
        if band_changes:
            diff['band_heights'] = band_changes

        if len(diff) > 3:
            report['differences'].append(diff)

    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=OUT_DEFAULT)
    ap.add_argument('--md', default='')
    ap.add_argument('--limit', type=int, default=40)
    args = ap.parse_args()

    legacy = load_legacy()
    rebuild = load_rebuild()
    report = compare(legacy, rebuild)

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=1, sort_keys=True)

    print(f"legacy definitions : {report['legacy_count']}")
    print(f"rebuild definitions: {report['rebuild_count']}")
    print(f"missing in rebuild : {len(report['missing_in_rebuild'])}")
    print(f"extra in rebuild   : {len(report['extra_in_rebuild'])}")
    print(f"changed            : {len(report['differences'])}")
    print('--- missing ---')
    for item in report['missing_in_rebuild'][: args.limit]:
        print(' ', item['name'], f"({','.join(item['legacy_libs'])})")
    print('--- changed (largest) ---')
    def weight(d):
        return (len(d.get('columns', {}).get('missing_in_rebuild', [])) * 3
                + len(d.get('objects', {}).get('missing_in_rebuild', [])) * 2
                + len(d.get('objects', {}).get('changed', []))
                + len(d.get('columns', {}).get('changed', [])))
    for item in sorted(report['differences'], key=weight, reverse=True)[: args.limit]:
        print(f"  {item['name']:<48} cols-={len(item.get('columns', {}).get('missing_in_rebuild', []))} "
              f"objs-={len(item.get('objects', {}).get('missing_in_rebuild', []))} "
              f"objs~={len(item.get('objects', {}).get('changed', []))} "
              f"cols~={len(item.get('columns', {}).get('changed', []))}")

    if args.md:
        with open(args.md, 'w', encoding='utf-8') as fh:
            fh.write('# DataWindow parity\n\n')
            fh.write(f"- legacy: {report['legacy_count']}\n")
            fh.write(f"- rebuild: {report['rebuild_count']}\n")
            fh.write(f"- missing: {len(report['missing_in_rebuild'])}\n")
            fh.write(f"- changed: {len(report['differences'])}\n")
            fh.write('\n## Missing\n\n')
            for item in report['missing_in_rebuild']:
                name = item['name']
                libs = ', '.join(item['legacy_libs'])
                fh.write('- `' + name + '` (' + libs + ')\n')
            fh.write('\n## Largest differences\n\n')
            for item in sorted(report['differences'], key=weight, reverse=True):
                name = item['name']
                detail = json.dumps(item, ensure_ascii=False)[:1200]
                fh.write('- `' + name + '`: ' + detail + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
