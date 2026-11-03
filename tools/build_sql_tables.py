"""Turn data/sql/statements.json and proc_signatures.json into the lookup tables used by the UI runtime.
usage: python -I build_sql_tables.py <data/sql dir> <out json>
  stmt: normalised original text of an embedded statement -> {sql, params (host variables in $n order), into}
  dw:   DataWindow name -> {sql, params (retrieval argument names in $n order), proc}
  proc: stored procedure (lower-case original name) -> {call, params:[{name, mode}], status column / result sets}
"""
import sys, os, re, json


def key(text):
    return re.sub(r'\s+', ' ', text).strip().lower()


CALL = re.compile(r'^(\s*SELECT\s+\*\s+FROM\s+dbo\.)(\w+)\((.*)\)(\s*;?\s*)$', re.I | re.S)
ARG = re.compile(r'(\w+)\s*=>\s*\$(\d+)(?!\d)')


def cast_call(sql, types):
    """`SELECT * FROM dbo.sp_x(a => $1, b => $2)`: the parameters are substituted as plain literals (an integer literal is an
    integer, which PostgreSQL does not pass to a smallint parameter), so each one is cast to the declared type of the procedure."""
    m = CALL.match(sql)
    if not m:
        return sql
    fn = types.get(m.group(2).lower())
    if not fn:
        return sql

    def one(a):
        ty = fn.get(a.group(1).lower())
        return f'{a.group(1)} => ${a.group(2)}::{ty}' if ty and ty != 'refcursor' else a.group(0)

    return m.group(1) + m.group(2) + '(' + ARG.sub(one, m.group(3)) + ')' + m.group(4)


SEQ_TIE = re.compile(r'(ORDER BY\s+(?:moduleid\s*,\s*)?sequenceid)(\s*$|\s+LIMIT|\s*\))', re.I)


def tie_order(sql):
    """InterfaceSetting rows with equal sequence ids come back in the order of SQL Server's clustered key (module, column, window type): a sort on
    PostgreSQL leaves ties unspecified, so the column name is added as the next key (the customer form shows City / County / Post Code like the original)."""
    return SEQ_TIE.sub(lambda m: m.group(1) + ', colname' + m.group(2), sql) if 'dbo.interfacesetting' in sql.lower() else sql


def main(src, out):
    st = json.load(open(os.path.join(src, 'statements.json'), encoding='utf-8'))
    sig = json.load(open(os.path.join(src, 'proc_signatures.json'), encoding='utf-8'))
    stmt, dw, proc = {}, {}, {}
    ptypes = {s['name'].lower(): {p['name'].lower(): p.get('type', '') for p in s['params']} for s in sig if s['kind'] == 'proc'}
    for x in st:
        if x['status'] != 'translated' or not x.get('translated'):
            continue
        if x['kind'].startswith('dw-'):
            m = re.match(r'dw:[^/]+/([^#]+)(#proc)?$', x['id'])
            if m:
                dw[m.group(1).lower()] = {'sql': tie_order(cast_call(x['translated'], ptypes)), 'params': x['params'] or [], **({'proc': True} if m.group(2) else {})}
        else:
            k = key(x['original'])
            if k not in stmt:
                e = {'sql': tie_order(cast_call(x['translated'], ptypes)), 'params': x['params'] or []}
                if x.get('into'):
                    e['into'] = x['into']
                stmt[k] = e
    for s in sig:
        if s['kind'] == 'proc' and s['status'] in ('translated', 'partial'):
            r = s['returns']
            proc[s['name'].lower()] = {'call': cast_call(s['call'], ptypes), 'params': [{'name': p['name'], 'mode': p['mode'], 'type': p.get('type', '')} for p in s['params']],
                                       'inout': r.get('inout_columns', []), 'rs': len(r.get('result_sets', []))}
    json.dump({'stmt': stmt, 'dw': dw, 'proc': proc}, open(out, 'w', encoding='utf-8', newline='\n'), separators=(',', ':'))
    print('embedded', len(stmt), 'datawindows', len(dw), 'procedures', len(proc))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
