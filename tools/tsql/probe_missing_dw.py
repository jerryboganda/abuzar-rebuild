import sys, os, json
from pathlib import Path
repo=r"C:\Projects\Abuzar\rebuild"
sys.path.insert(0, os.path.join(repo,'tools'))
from tsql.build import prepare
from tsql.parser import ParseError
from tsql.lexer import LexError
from tsql.texpr import Untranslatable
import importlib.util
spec=importlib.util.spec_from_file_location("stmts", os.path.join(repo,'tools','tsql','stmts.py'))
stmts=importlib.util.module_from_spec(spec); spec.loader.exec_module(stmts)
src=r"C:\Projects\Abuzar"
tables,cat,tr,parsed=prepare(src,repo)
names={"d_backupschedule","d_backupschedule_2012","d_databasesname","d_linkedservers","ddd_exportrestricted_column_list","ddd_restricted_column_list","ddd_objectcolumnlist","d_conectionmonitorlist","d_conectionmonitorlist2","d_chemistwisesale","d_custdata_hilton"}
for d in stmts.dw_items(os.path.join(src,'recovered','datawindows_json')):
    nm=d['id'].split('/')[-1]
    if nm not in names: continue
    try:
        args=d['args']
        if d['dwkind']=='procedure':
            sql,binds,pname=stmts.proc_call_to_pg(d['raw'],None); status='translated'
        else:
            text=d['raw']
            if d['dwkind']=='pbselect':
                text,args2=stmts.pbselect_to_tsql(d['raw']); args={**args,**args2}
            bt={k:'D' for k,v in args.items() if v in ('datetime','date','time','timestamp')}
            sql,binds,into=stmts.translate_text(tr,text,bt); status='translated'
        print(nm,d['dwkind'],status,len(sql),sql[:120].replace('\n',' '))
    except (ParseError,LexError) as e:
        print(nm,d['dwkind'],'parse-error',str(e)[:160])
    except Untranslatable as e:
        print(nm,d['dwkind'],'untranslatable',str(e)[:160])
    except Exception as e:
        print(nm,d['dwkind'],'translator-error',type(e).__name__,str(e)[:160])
