#!/usr/bin/env python3
"""Pair the original report captures with the rebuilt ones and diff captions.

The original crawler wrote screens.json with the menu path of each report and
numbered files; the rebuild capture JSONs carry their own `path`.  This pairs
them by normalised path, then reports captured paths without a pair and the
visible captions that exist on one side only.

usage: python tools/parity/compare-reports.py [--json out.json]
"""
import argparse
import glob
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCREENS = os.path.join(ROOT, '..', 'deploy', 'parity', 'screen-parity')
OUT_DEFAULT = os.path.join(ROOT, '..', 'deploy', 'parity', 'report-compare.json')
OLD_DIRS = ['old-reports', 'old-reports-b', 'old-reports-c']
NEW_DIRS = ['new-reports', 'new-reports-b', 'new-reports-c']
TAG = re.compile(r'<[^>]+>')


def norm(text):
    text = TAG.sub(' ', str(text or ''))
    text = text.replace('&', '').replace('\u2013', '-').replace('\u2014', '-')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def key(text):
    return norm(text).casefold()


def useful(text):
    t = norm(text)
    if len(t) < 2:
        return False
    if re.fullmatch(r'[-+]?\d+(?:[.,]\d+)?', t):
        return False
    if re.fullmatch(r'[\W_]+', t):
        return False
    return True


def old_inventory(path):
    with open(path, encoding='utf-8-sig') as fh:
        data = json.load(fh)
    texts = []
    for c in data.get('controls', []):
        if c.get('visible') is False:
            continue
        if useful(c.get('text')):
            texts.append(norm(c.get('text')))
    for w in data.get('windows', []):
        if useful(w.get('title')):
            texts.append(norm(w.get('title')))
    return texts


def new_inventory(path):
    with open(path, encoding='utf-8-sig') as fh:
        data = json.load(fh)
    texts = []

    def walk(c):
        if c.get('visible') is False:
            return
        if useful(c.get('text')):
            texts.append(norm(c.get('text')))
        for ch in (c.get('children') or []) + (c.get('controls') or []):
            walk(ch)
        dw = c.get('dw') or {}
        for o in dw.get('objects') or []:
            if o.get('visible') == '0':
                continue
            if useful(o.get('text')):
                texts.append(norm(o.get('text')))
        for col in dw.get('columns') or []:
            if useful(col.get('name')):
                texts.append(norm(col.get('name')))

    for w in data.get('windows') or []:
        walk(w)
    return texts


def collect_old():
    out = {}
    for d in OLD_DIRS:
        p = os.path.join(SCREENS, d, 'screens.json')
        if not os.path.exists(p):
            continue
        try:
            rows = json.load(open(p, encoding='utf-8-sig'))
        except Exception:
            continue
        for row in rows:
            path = row.get('path')
            n = row.get('n')
            if not path or not n:
                continue
            prefix = f'{int(n):03d}_'
            files = glob.glob(os.path.join(SCREENS, d, prefix + '*.json'))
            files = [f for f in files if not re.search(r'_s\d+\.json$', f)]
            if files:
                out.setdefault(norm(path), (d, files[0], row))
    return out


def collect_new():
    out = {}
    for d in NEW_DIRS:
        for p in glob.glob(os.path.join(SCREENS, d, '*.json')):
            if p.endswith('screens.json') or re.search(r'_s\d+\.json$', p):
                continue
            try:
                data = json.load(open(p, encoding='utf-8-sig'))
            except Exception:
                continue
            if isinstance(data, dict) and data.get('path'):
                out.setdefault(norm(data['path']), (d, p, data))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=OUT_DEFAULT)
    args = ap.parse_args()
    old = collect_old()
    new = collect_new()
    report = {'old': len(old), 'new': len(new), 'pairs': [], 'old_only': [], 'new_only': []}
    for path in sorted(set(old) | set(new)):
        if path not in new:
            report['old_only'].append(path)
            continue
        if path not in old:
            report['new_only'].append(path)
            continue
        od, of, orow = old[path]
        nd, nf, ndata = new[path]
        try:
            otexts = old_inventory(of)
            ntexts = new_inventory(nf)
        except Exception as exc:  # noqa: BLE001
            report['pairs'].append({'path': path, 'error': str(exc)})
            continue
        okeys = {key(t) for t in otexts}
        nkeys = {key(t) for t in ntexts}
        missing = []
        seen = set()
        for t in otexts:
            k = key(t)
            if k in nkeys or k in seen:
                continue
            seen.add(k)
            missing.append(t)
        extra = []
        seen = set()
        for t in ntexts:
            k = key(t)
            if k in okeys or k in seen:
                continue
            seen.add(k)
            extra.append(t)
        report['pairs'].append({
            'path': path,
            'old_dir': od,
            'new_dir': nd,
            'old_file': os.path.basename(of),
            'new_file': os.path.basename(nf),
            'old_captions': len(otexts),
            'new_captions': len(ntexts),
            'missing_in_rebuild': missing,
            'extra_in_rebuild': extra,
            'opened': ndata.get('opened'),
        })
    with open(args.json, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=1, ensure_ascii=False)
    print('old paths', report['old'], 'new paths', report['new'], 'pairs', len(report['pairs']))
    print('old only', len(report['old_only']), 'new only', len(report['new_only']))
    for p in report['old_only'][:10]:
        print('  OLD ONLY', p)
    for p in report['new_only'][:10]:
        print('  NEW ONLY', p)
    with_missing = [p for p in report['pairs'] if p.get('missing_in_rebuild')]
    print('pairs with old captions missing in rebuild', len(with_missing))
    for p in sorted(with_missing, key=lambda x: len(x['missing_in_rebuild']), reverse=True)[:15]:
        print(' ', p['path'], len(p['missing_in_rebuild']))
        for t in p['missing_in_rebuild'][:8]:
            print('     -', t[:120])


if __name__ == '__main__':
    raise SystemExit(main())
