import json, os, re
root = r'C:\Projects\Abuzar\deploy\parity\screen-parity'
def load(name):
    p = os.path.join(root, name, 'screens.json')
    return json.load(open(p, encoding='utf-8-sig'))
a = load('old-reports'); b = load('old-reports-b'); c = load('old-reports-c')
def norm(p): return (p or '').replace('&', '').strip().lower()
seen = {norm(x['path']) for x in a}
out = []
n = 69
for group, rows in (('b', b), ('c', c)):
    for row in rows:
        p = row.get('path')
        if not p: continue
        k = norm(p)
        if k in seen:
            print('duplicate skipped', group, row.get('n'), p)
            continue
        seen.add(k)
        out.append({'n': n, 'path': p, 'from': group, 'orig': row.get('n')})
        n += 1
p = os.path.join(root, 'screens-bc.json')
json.dump(out, open(p, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('wrote', p, 'entries', len(out), 'last n', out[-1]['n'] if out else None)
for x in out[:5] + out[-3:]: print(x['n'], x['from'], x['orig'], x['path'][:100])
