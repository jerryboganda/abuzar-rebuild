import json, os, glob
D = r'C:\Projects\Abuzar\deploy\parity\screen-audit-2026-11-05'
files = sorted(glob.glob(os.path.join(D, '*.json')))
print('file\topened\twindows\ttabs\tfields\tprobed\tskipped\terrors\tmessages')
tot = {'fields':0,'probed':0,'skip':0,'err':0}
bad = []
for p in files:
    if os.path.basename(p) == 'summary.json': continue
    try: j = json.load(open(p, encoding='utf-8'))
    except Exception: continue
    fs = j.get('fields') or []
    probed = sum(1 for f in fs if not f.get('skipped') and not f.get('error'))
    skip = sum(1 for f in fs if f.get('skipped'))
    err = sum(1 for f in fs if f.get('error'))
    msgs = len(j.get('messages') or [])
    tot['fields'] += len(fs); tot['probed'] += probed; tot['skip'] += skip; tot['err'] += err
    print(f"{os.path.basename(p)[:60]}\t{j.get('opened')}\t{len(j.get('windows') or [])}\t{len(j.get('tabs') or [])}\t{len(fs)}\t{probed}\t{skip}\t{err}\t{msgs}")
    if fs and probed == 0: bad.append((os.path.basename(p), len(fs), skip, err, msgs))
print('TOTAL', tot)
print('ZERO-PROBED SCREENS', len(bad))
for b in bad: print('  ', b)
