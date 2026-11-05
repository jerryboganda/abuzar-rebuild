import json, os, sys
OLD = r'C:\Projects\Abuzar\recovered\objects'
NEW = r'C:\Projects\Abuzar\rebuild\data\src\objects'

def load(root):
    out = {}
    for base, _, files in os.walk(root):
        for f in files:
            if not f.endswith('.json'): continue
            p = os.path.join(base, f)
            try:
                j = json.load(open(p, encoding='utf-8-sig'))
            except Exception as e:
                continue
            name = str(j.get('name') or os.path.splitext(f)[0]).lower()
            out.setdefault(name, {'path': p, 'json': j})
    return out

def walk_controls(c, prefix=''):
    name = c.get('name') or c.get('field') or ''
    p = prefix + '/' + name if name else prefix
    yield p, c
    for ch in c.get('controls') or []:
        yield from walk_controls(ch, p)

old = load(OLD); new = load(NEW)
old_menus = {k:v for k,v in old.items() if '/menu/' in v['path'].replace('\\','/').lower()}
new_menus = {k:v for k,v in new.items() if '/menu/' in v['path'].replace('\\','/').lower()}

missing_menus = sorted(set(old_menus) - set(new_menus))
print('old menus', len(old_menus), 'new menus', len(new_menus), 'missing menu files', len(missing_menus))
for m in missing_menus[:50]: print('  MISSING MENU', m, old_menus[m]['path'])

missing_items = []
extra_items = []
for name, ov in old_menus.items():
    if name not in new_menus: continue
    oi = {p for p,c in walk_controls({'name':'','controls':ov['json'].get('controls') or []})}
    ni = {p for p,c in walk_controls({'name':'','controls':new_menus[name]['json'].get('controls') or []})}
    for p in sorted(oi - ni): missing_items.append((name, p))
    for p in sorted(ni - oi): extra_items.append((name, p))

print('missing menu items', len(missing_items), 'extra', len(extra_items))
for name,p in missing_items[:120]: print('  MISSING ITEM', name, p)
for name,p in extra_items[:20]: print('  EXTRA ITEM', name, p)

# window -> menu reference comparison + script presence
def scripts(root, group, kind, name):
    # recovered scripts / rebuild scripts are flat by owning component
    return None

missing_refs = []
for name, ov in old.items():
    if '/window/' not in ov['path'].replace('\\','/').lower(): continue
    oj = ov['json']
    m = next((f.get('value') for f in oj.get('fields') or [] if f.get('name') == 'menuname'), None)
    if not m: continue
    if str(m).lower() not in new_menus:
        missing_refs.append((name, m))
print('window menu references not present in new menus', len(missing_refs))
for w,m in missing_refs[:40]: print('  REF', w, '->', m)
