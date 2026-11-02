"""Builds the toolbar sprite (web/public/toolbar.png) and the name list (web/src/ui/toolbar-icons.ts) from screenshots of the original.

Every sheet of the original shows its toolbar: one 16x16 picture per menu item that has a `toolbaritemname`, in `toolbaritemorder`.  The menu class of a
sheet comes from the window title (win_menus.json: title -> menu class, from the recovered window classes) and its toolbar items from
toolbar_menus.json (web/tools/toolbar-dump.ts); the pictures are cut out of the screenshot (icons.py) and named by position.
usage: python -I build_sprite.py <shots dir> <log files...> --menus win_menus.json --toolbars toolbar_menus.json --out <web dir>
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import icons  # noqa: E402

BG = (240, 240, 240)
# pictures whose captured (disabled) rendering has a different silhouette than the enabled bitmap: resource found by eye on a contact sheet
FORCE = {'clear': 1266}
OVERRIDE = {'find': 1048}


def sheets(logs):
    """shot id -> sheet title, from the crawl logs"""
    out = {}
    for log in logs:
        for line in open(log, encoding='utf-8-sig', errors='replace'):
            m = re.match(r'\d+\t(\d+)\tsheet=\[([^\]]*)\]', line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


def richness(grid):
    """how colourful a picture is: enabled pictures beat the grey disabled ones"""
    n = 0
    for row in grid:
        for c in row:
            n += max(c) - min(c)
    return n


def main():
    args = sys.argv[1:]
    opt = {}
    pos = []
    i = 0
    while i < len(args):
        if args[i].startswith('--'):
            opt[args[i][2:]] = args[i + 1]
            i += 2
        else:
            pos.append(args[i])
            i += 1
    shots_dir, logs = pos[0], pos[1:]
    titles = sheets(logs)
    win = json.load(open(opt['menus']))
    tbs = json.load(open(opt['toolbars']))
    menus_by_title = {}
    for cls, (title, menu) in win.items():
        menus_by_title.setdefault(title, set()).add(menu)
    best = {}  # stock name -> (richness, grid)
    chosen = {}  # stock name -> resource id found by comparing with the capture
    report = []
    for path in sorted(glob.glob(os.path.join(shots_dir, '*.png'))):
        name = os.path.basename(path)
        m = re.match(r'(\d+)_', name)
        if not m or '_dlg' in name or '_new' in name:
            continue
        title = titles.get(m.group(1), '')
        cands = [c for c in menus_by_title.get(title, ()) if c in tbs]
        if not cands:
            report.append((name, 'no menu for title %r' % title))
            continue
        w, h, rows = icons.read_png(path)
        try:
            y0, found = icons.toolbar_icons(w, h, rows)
        except StopIteration:
            report.append((name, 'no toolbar'))
            continue
        found = [(x, a) for x, a in found if a is not None]
        n = len(found)
        done = False
        for c in sorted(cands):
            items = tbs[c]
            variants = [
                [i for i in items if i['vis']],
                [i for i in items if i['stock']],  # script makes hidden items visible later
            ]
            for v in variants:
                v = sorted(enumerate(v), key=lambda e: (e[1]['bar'], e[1]['order'], e[0]))
                v = [e[1] for e in v]
                if n in (len(v), len(v) + 1):
                    for (x, a), it in zip(found, v):
                        grid = a[1]
                        key = it['stock'].replace('!', '').lower()
                        r = richness(grid)
                        if key not in best or r > best[key][0]:
                            best[key] = (r, grid)
                    if n == len(v) + 1:
                        grid = found[-1][1][1]
                        r = richness(grid)
                        if 'exit' not in best or r > best['exit'][0]:
                            best['exit'] = (r, grid)
                    report.append((name, 'ok via %s (%d icons)' % (c, n)))
                    done = True
                    break
            if done:
                break
        if not done:
            report.append((name, 'icon count %d does not fit %s' % (n, [(c, len(tbs[c])) for c in cands])))
    # a disabled picture (grey) is replaced by the resource bitmap of PBVM125.dll with the same silhouette: its colours are the enabled ones
    res = icons.resources(opt['dll'])
    res_art = {}
    for rid, px in res.items():
        a = icons.art(px, px[0][0])
        if a:
            res_art[rid] = (a[1], px[0][0])
    for key, (r, grid) in list(best.items()):
        if key in FORCE:
            px = res[FORCE[key]]
            a = icons.art(px, px[0][0])
            best[key] = (r, [[BG if c == px[0][0] else c for c in row] for row in a[1]])
            chosen[key] = FORCE[key]
            report.append((key, 'resource %s (forced)' % FORCE[key]))
            continue
        mask = [[c != BG for c in row] for row in grid]
        cands = []
        for rid, (g2, tr) in res_art.items():
            if len(g2) != len(grid) or len(g2[0]) != len(grid[0]):
                continue
            inter = union = 0
            diff = 0
            for ra, rb, ca_row in zip(mask, g2, grid):
                for ma, cb, ca in zip(ra, rb, ca_row):
                    mb = cb != tr
                    inter += ma and mb
                    union += ma or mb
                    if ma and mb:
                        diff += sum(abs(p - q) for p, q in zip(ca, cb))
            iou = inter / union if union else 0
            if iou >= 0.9:
                cands.append((iou, diff / max(1, inter), rid))
        if cands:
            # silhouettes are not unique (square pictures): among the ones that fit, the colours of an enabled picture decide; a grey one takes the first
            colourful = richness(grid) > 2500
            top = min(cands, key=lambda c: (c[1], -c[0])) if colourful else max(cands, key=lambda c: c[0])
            g2, tr = res_art[top[2]]
            best[key] = (r, [[BG if c == tr else c for c in row] for row in g2])
            chosen[key] = top[2] if colourful else None
            report.append((key, 'resource %s (silhouette %.2f, colour distance %.0f, %d candidates)' % (top[2], top[0], top[1], len(cands))))
        else:
            report.append((key, 'kept the captured picture'))
    # every stock name of PBVM125.dll (name table next to the picture ids), with what the screenshots showed taking precedence
    table = {n.lower().rstrip('!'): rid for n, rid in json.load(open(opt['names']))}
    # the toolbar of the original shows a different picture than the name table for these (checked on screen: the pencil is `Search!`)
    for key, rid in OVERRIDE.items():
        report.append((key, 'screen shows resource %s, the name table says %s: the screen wins' % (rid, table.get(key))))
        table[key] = rid
    for key in best:
        table.setdefault(key, None)
    names = sorted(k for k, rid in table.items() if rid in res or k in best)
    cell = 16
    sheet_w = cell * max(1, len(names))
    rows_out = [[BG] * sheet_w for _ in range(cell)]
    alpha = [[0] * sheet_w for _ in range(cell)]
    for k, nm in enumerate(names):
        rid = table.get(nm)
        if rid in res:
            px = res[rid]
            tr = px[0][0]
            grid = px
        else:
            grid = best[nm][1]
            tr = BG
        gh, gw = len(grid), len(grid[0])
        ox = k * cell + max(0, (cell - gw) // 2)
        oy = max(0, (cell - gh) // 2)
        for y in range(min(gh, cell)):
            for x in range(min(gw, cell)):
                c = grid[y][x]
                if c != tr:
                    rows_out[oy + y][ox + x] = c
                    alpha[oy + y][ox + x] = 255
    out = opt['out']
    icons.write_png(os.path.join(out, 'public', 'toolbar.png'), sheet_w, cell, rows_out, alpha)
    with open(os.path.join(out, 'src', 'ui', 'toolbar-icons.ts'), 'w', encoding='utf8') as f:
        f.write("// Toolbar pictures of the original: names of the 16x16 cells of the sprite (public/toolbar.png); generated by tools/orig/build_sprite.py.\n")
        f.write('export const ICON_NAMES: string[] = %s\n' % json.dumps(names))
    for r in report:
        print(*r)
    print('pictures', len(names), names)


main()
