#!/usr/bin/env python3
"""Compare the visible captions of the original and rebuilt screens.

old-nonreport/NNN_*.json is the Win32 control inventory captured from the
running original; new-nonreport/NNN_*.json is the DOM/DataWindow inventory of
the rebuild.  For every paired screen this reports captions (buttons, labels,
tabs, check boxes) that exist on one side and not the other, which is the
fastest way to find a feature that was never rendered.

usage: python tools/parity/compare-controls.py [--json out.json] [--limit N]
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCREENS = os.path.join(ROOT, '..', 'deploy', 'parity', 'screen-parity')
OLD = os.path.join(SCREENS, 'old-nonreport')
NEW = os.path.join(SCREENS, 'new-nonreport')
OUT_DEFAULT = os.path.join(ROOT, '..', 'deploy', 'parity', 'control-compare.json')

# Win32 classes that carry user-visible captions.
OLD_CAPTION_CLASSES = {
    'Button', 'Edit', 'ComboBox', 'Static', 'FNUDO3125',
    'PBTabControl32_100', 'SysTabControl32', 'pbdw125',
}

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


def old_captions(path):
    with open(path, encoding='utf-8-sig') as fh:
        data = json.load(fh)
    out = []
    for c in data.get('controls', []):
        if not c.get('visible'):
            continue
        if c.get('class') not in OLD_CAPTION_CLASSES:
            continue
        text = c.get('text')
        if useful(text):
            out.append(norm(text))
    # menu captions are shared by every screen and are compared separately
    # (orig-menu.tsv vs menu-compare.json); including them here would drown the
    # per-screen window-control diff.
    return out


def new_captions(path):
    with open(path, encoding='utf-8-sig') as fh:
        data = json.load(fh)
    out = []

    def walk_control(c):
        if c.get('visible') is False:
            return
        text = c.get('text')
        if useful(text):
            out.append(norm(text))
        for child in (c.get('children') or []) + (c.get('controls') or []):
            walk_control(child)
        dw = c.get('dw') or {}
        for obj in dw.get('objects') or []:
            if obj.get('visible') == '0':
                continue
            t = obj.get('text')
            if useful(t):
                out.append(norm(t))
            # column headings are usually separate text objects, already added
        for col in dw.get('columns') or []:
            name = col.get('name')
            if useful(name) and re.search(r'[A-Za-z]', str(name)):
                out.append(norm(name))

    for w in data.get('windows') or []:
        walk_control(w)
    return out


def pair():
    old = {}
    new = {}
    for path in glob.glob(os.path.join(OLD, '*.json')):
        m = re.match(r'(\d+)_', os.path.basename(path))
        if m:
            old[m.group(1)] = path
    for path in glob.glob(os.path.join(NEW, '*.json')):
        m = re.match(r'(\d+)_', os.path.basename(path))
        if m:
            new[m.group(1)] = path
    return old, new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=OUT_DEFAULT)
    ap.add_argument('--limit', type=int, default=40)
    args = ap.parse_args()
    old, new = pair()
    report = []
    for num in sorted(set(old) & set(new)):
        try:
            o = old_captions(old[num])
            n = new_captions(new[num])
        except Exception as exc:  # noqa: BLE001
            print(f'read failed {num}: {exc}', file=sys.stderr)
            continue
        okeys = {key(x) for x in o}
        nkeys = {key(x) for x in n}
        missing = []
        seen = set()
        for text in o:
            k = key(text)
            if k in nkeys or k in seen:
                continue
            seen.add(k)
            missing.append(text)
        extra = []
        seen = set()
        for text in n:
            k = key(text)
            if k in okeys or k in seen:
                continue
            seen.add(k)
            extra.append(text)
        report.append({
            'num': num,
            'old_file': os.path.basename(old[num]),
            'new_file': os.path.basename(new[num]),
            'old_captions': len(o),
            'new_captions': len(n),
            'missing_in_rebuild': missing,
            'extra_in_rebuild': extra,
        })
    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=1, ensure_ascii=False)
    print(f'paired screens: {len(report)}')
    total_missing = sum(len(x['missing_in_rebuild']) for x in report)
    screens_with_missing = [x for x in report if x['missing_in_rebuild']]
    print(f'screens with missing captions: {len(screens_with_missing)}')
    print(f'missing captions: {total_missing}')
    for x in sorted(screens_with_missing, key=lambda y: len(y['missing_in_rebuild']), reverse=True)[: args.limit]:
        print(f"\n{x['num']} {x['old_file']}")
        for text in x['missing_in_rebuild'][:12]:
            print('   -', text[:140])


if __name__ == '__main__':
    raise SystemExit(main())
