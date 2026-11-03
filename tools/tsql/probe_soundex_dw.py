import sys, os, json
from pathlib import Path
repo=r"C:\Projects\Abuzar\rebuild"; src=r"C:\Projects\Abuzar"
sys.path.insert(0, os.path.join(repo,'tools'))
from tsql.build import prepare
import importlib.util
spec=importlib.util.spec_from_file_location("stmts", os.path.join(repo,'tools','tsql','stmts.py'))
stmts=importlib.util.module_from_spec(spec); spec.loader.exec_module(stmts)
tables,cat,tr,parsed=prepare(src,repo)
want={"d_chemistwisesale","d_custdata_hilton"}
out={}
for d in stmts.dw_items(os.path.join(src,'recovered','datawindows_json')):
    nm=d['id'].split('/')[-1]
    if nm not in want: continue
    text=d['raw']; args=d['args']
    if d['dwkind']=='pbselect':
        text,args2=stmts.pbselect_to_tsql(d['raw']); args={**args,**args2}
    bt={k:'D' for k,v in args.items() if v in ('datetime','date','time','timestamp')}
    sql,binds,into=stmts.translate_text(tr,text,bt)
    out[nm]={'sql':stmts.compact(sql),'params':binds,'args':args}
    print(nm,'ok',len(sql),'binds',binds)
Path(r"C:\Users\Admin\AppData\Local\Temp\opencode\soundex_dw.json").write_text(json.dumps(out,indent=1),encoding="utf-8")
print("written")
