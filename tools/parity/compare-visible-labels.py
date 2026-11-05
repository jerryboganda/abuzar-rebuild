import json, os, re, glob
OLD = r'C:\Projects\Abuzar\deploy\parity\screen-parity\old-nonreport'
NEW = r'C:\Projects\Abuzar\deploy\parity\screen-parity\new-nonreport'
def key(p):
    b=os.path.basename(p); m=re.match(r'(\d{3})', b); return m.group(1) if m else b
def norm(s):
    s=re.sub(r'&','',str(s or ''))
    s=re.sub(r'<TAB>|\t',' ',s)
    s=re.sub(r'\s+',' ',s).strip().lower()
    return s
def old_texts(p):
    j=json.load(open(p,encoding='utf-8-sig')); out=[]
    for c in j.get('winControls') or []:
        if not c.get('visible',True): continue
        t=norm(c.get('text'))
        if len(t)<2: continue
        cls=str(c.get('class') or '')
        if any(x in cls for x in ('FNHELP','MDIClient','FNFIXEDBAR','FNWND')): continue
        out.append((t, cls))
    return out
pairs=[]
olds={key(p):p for p in glob.glob(os.path.join(OLD,'*.json'))}
news={key(p):p for p in glob.glob(os.path.join(NEW,'*.json'))}
for k in sorted(set(olds)&set(news)):
    try:
        j=json.load(open(news[k],encoding='utf-8-sig'))
        body=norm(' '.join(str(w.get('bodyText') or '') for w in j.get('windows') or []))
    except Exception as e:
        print('ERR',k,e); continue
    miss=[]
    for t,cls in old_texts(olds[k]):
        if t not in body: miss.append((t,cls))
    if miss:
        pairs.append((k,os.path.basename(olds[k]),os.path.basename(news[k]),miss))
print('paired',len(set(olds)&set(news)),'screens with missing labels',len(pairs))
for k,o,n,miss in pairs:
    print('\n==',k,o,'->',n,'missing',len(miss))
    for t,cls in miss[:40]: print('   ',repr(t),cls)
