"""Turn data/sql/statements.json and proc_signatures.json into the lookup tables used by the UI runtime.
usage: python -I build_sql_tables.py <data/sql dir> <out json>
  stmt: normalised original text of an embedded statement -> {sql, params (host variables in $n order), into}
  dw:   DataWindow name -> {sql, params (retrieval argument names in $n order), proc}
  proc: stored procedure (lower-case original name) -> {call, params:[{name, mode}], status column / result sets}
"""
import sys, os, re, json


def key(text):
    return re.sub(r'\s+', ' ', text).strip().lower()


def main(src, out):
    st = json.load(open(os.path.join(src, 'statements.json'), encoding='utf-8'))
    sig = json.load(open(os.path.join(src, 'proc_signatures.json'), encoding='utf-8'))
    stmt, dw, proc = {}, {}, {}
    for x in st:
        if x['status'] != 'translated' or not x.get('translated'):
            continue
        if x['kind'].startswith('dw-'):
            m = re.match(r'dw:[^/]+/([^#]+)(#proc)?$', x['id'])
            if m:
                dw[m.group(1).lower()] = {'sql': x['translated'], 'params': x['params'] or [], **({'proc': True} if m.group(2) else {})}
        else:
            k = key(x['original'])
            if k not in stmt:
                e = {'sql': x['translated'], 'params': x['params'] or []}
                if x.get('into'):
                    e['into'] = x['into']
                stmt[k] = e
    for s in sig:
        if s['kind'] == 'proc' and s['status'] in ('translated', 'partial'):
            r = s['returns']
            proc[s['name'].lower()] = {'call': s['call'], 'params': [{'name': p['name'], 'mode': p['mode']} for p in s['params']],
                                       'inout': r.get('inout_columns', []), 'rs': len(r.get('result_sets', []))}
    json.dump({'stmt': stmt, 'dw': dw, 'proc': proc}, open(out, 'w', encoding='utf-8', newline='\n'), separators=(',', ':'))
    print('embedded', len(stmt), 'datawindows', len(dw), 'procedures', len(proc))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
