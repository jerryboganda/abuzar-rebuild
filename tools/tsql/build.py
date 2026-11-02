"""Build driver: translate views / functions / procedures / triggers to PostgreSQL.

usage: python -I tools/tsql/build.py --src <parent project dir> --repo <this repo> [--only NAME --print]
Outputs (under --repo):
  db/pg/40_functions.sql 50_views.sql 60_procedures.sql 70_triggers.sql
  data/sql/proc_signatures.json    signatures of every procedure / function / trigger
  data/sql/units.json              one record per routine (status, notes) - used by the CI runner and the report
Each routine is delimited by a '-- ==== <kind> <name> ====' line so the CI runner can apply them one by one.
"""
import argparse
import json
import os
import re
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

from tsql.parser import ParseError, parse_object, parse_proc_header, Node
from tsql.lexer import LexError
from tsql.schema import load_tables
from tsql.texpr import Untranslatable
from tsql.tquery import walk_nodes
from tsql.routines import Translator, Catalog
from tsql.names import ident, pident, fn_ident

SECRET_RE = re.compile(r'(BACKUP\s+DATABASE|RESTORE\s+(DATABASE|FILELISTONLY|HEADERONLY|VERIFYONLY)|MEDIAPASSWORD|\bPASSWORD\s*=)', re.I)
FILES = {'function': '40_functions.sql', 'view': '50_views.sql', 'proc': '60_procedures.sql', 'trigger': '70_triggers.sql'}
HDR = 'SET search_path TO dbo, public;\n'


def split_objects(path):
    src = open(path, encoding='utf-8', errors='replace').read()
    out = []
    for b in re.split(r'^GO\s*$', src, flags=re.M):
        m = re.search(r'^-- (\S+)\s*\n(.*)$', b.strip('\n'), re.S | re.M)
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def comment_block(text, limit=8000):
    t = text.strip()
    if len(t) > limit:
        t = t[:limit] + '\n...'
    return '\n'.join('-- ' + ln.rstrip() for ln in t.split('\n')) + '\n'


def stub_function(tr, kind, u, node, body):
    """a function with the right signature that raises"""
    name = u['name']
    reason = (u.get('error') or 'not translated').replace("'", "''").replace('%', '%%')[:240]
    if u['status'] == 'excluded':
        cm = '-- (original omitted)\n'
    else:
        cm = comment_block(body)
    params = ''
    sig = tr.catalog.procs.get(name.lower()) if kind == 'proc' else tr.catalog.funcs.get(name.lower())
    if kind in ('proc', 'function') and sig is not None:
        pd = []
        for ps in sig.params:
            d = ' DEFAULT ' + ps.default if ps.default is not None else ''
            pd.append('%s%s %s%s' % ('INOUT ' if ps.mode == 'inout' else '', pident(ps.name), ps.pgtype, d))
        if kind == 'proc':
            pd.append('OUT return_value integer')
        params = ', '.join(pd)
        ret = ''
        if kind == 'function':
            if sig.ret_table is not None:
                ret = '\n  RETURNS TABLE(%s)' % ', '.join('%s %s' % (ident(c.name), re.sub(r'\(.*\)', '', c.pg) if c.pg.startswith('numeric') else (c.pg or 'text')) for c in sig.ret_table.cols)
            else:
                ret = '\n  RETURNS ' + (sig.ret_pg or 'text')
    elif kind == 'proc':
        params = 'OUT return_value integer'
        ret = ''
    else:
        ret = '\n  RETURNS text'
    if kind == 'trigger':
        return cm + 'CREATE OR REPLACE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $body$\nBEGIN\n  RAISE EXCEPTION \'T-SQL trigger not translated: %s\' USING ERRCODE = \'0A000\';\nEND\n$body$;' % (fn_ident('trg_' + name), reason)
    if kind == 'view':
        return cm + "-- view not translated: %s\n" % reason.replace('\n', ' ')
    return cm + 'CREATE OR REPLACE FUNCTION %s(%s)%s\n  LANGUAGE plpgsql AS $body$\nBEGIN\n  RAISE EXCEPTION \'T-SQL routine %s not translated: %s\' USING ERRCODE = \'0A000\';\nEND\n$body$;' % (
        fn_ident(name), params, ret, name.replace("'", ''), reason)


def prepare(src_root, repo):
    tables = load_tables(os.path.join(repo, 'db', 'pg', '10_tables.sql'))
    schema_dir = os.path.join(src_root, 'db', 'schema')
    raw = {}
    for kind, fname in (('function', '04_functions'), ('view', '05_views'), ('proc', '06_procedures'), ('trigger', '07_triggers')):
        raw[kind] = split_objects(os.path.join(schema_dir, fname + '.sql'))
    cat = Catalog()
    tr = Translator(tables, cat)
    parsed = {}
    for kind in ('function', 'view', 'proc', 'trigger'):
        res = []
        for name, body in raw[kind]:
            u = {'kind': kind, 'name': name, 'status': None, 'notes': [], 'error': None}
            node = None
            if SECRET_RE.search(body):
                u.update(status='excluded', error='vendor backup/restore code (replaced by pg_dump in the rebuild)')
                if kind == 'proc':
                    try:
                        node = parse_proc_header(body)
                    except (ParseError, LexError):
                        node = None
            elif kind == 'view' and name.lower().startswith('sys'):
                u.update(status='excluded', error='SQL Server system view')
            else:
                try:
                    node = parse_object(body)
                except (ParseError, LexError) as e:
                    u.update(status='stub', error='parse error: ' + str(e)[:300])
                    if kind == 'proc':
                        try:
                            node = parse_proc_header(body)
                        except (ParseError, LexError):
                            node = None
            res.append((u, node, body))
        parsed[kind] = res
    cat_nodes = [n for k in ('function', 'proc') for (u, n, b) in parsed[k] if n is not None]
    tr.build_catalog(cat_nodes)
    return tables, cat, tr, parsed


def emit_unit(tr, kind, u, node, body):
    try:
        if kind == 'proc':
            return tr.translate_proc(node, body)
        if kind == 'function':
            return tr.translate_function(node, body)
        if kind == 'view':
            return tr.translate_view(node, body)
        if kind == 'trigger':
            sql, sig = tr.translate_trigger(node, body)
            u['events'] = sig.events
            u['table'] = sig.table
            u['notes'] = list(sig.notes)
            return sql
    except Untranslatable as e:
        u['status'] = 'stub'
        u['error'] = 'untranslatable: ' + str(e)
    except Exception as e:  # translator bug: keep going, the report lists it
        u['status'] = 'stub'
        u['error'] = 'translator error: %s: %s' % (type(e).__name__, e)
        u['trace'] = traceback.format_exc()[-1500:]
    return None


def view_order(parsed_views):
    """views referencing other views must come after them"""
    names = {u['name'].lower(): (u, n, b) for (u, n, b) in parsed_views}
    deps = {}
    for key, (u, n, b) in names.items():
        d = set()
        if n is not None:
            for x in walk_nodes(n):
                if x.k == 'table' and x.parts[-1].lower() in names and x.parts[-1].lower() != key:
                    d.add(x.parts[-1].lower())
        deps[key] = d
    out, seen, tmp = [], set(), set()

    def visit(k):
        if k in seen:
            return
        if k in tmp:
            return
        tmp.add(k)
        for d in sorted(deps[k]):
            visit(d)
        tmp.discard(k)
        seen.add(k)
        out.append(names[k])
    for k in sorted(names):
        visit(k)
    return out


def sig_json(tr, kind, u, sg, rs_cols):
    params = [{'name': p.name, 'pg_param': pident(p.name), 'type': p.pgtype, 'tsql_type': p.tsql_type, 'mode': p.mode, 'default': p.default} for p in sg.params]
    d = {'name': u['name'], 'pg_name': 'dbo.' + ident(u['name']).strip('"'), 'kind': kind, 'status': u['status'], 'params': params}
    if kind == 'proc':
        outs = [p.name for p in sg.params if p.mode == 'inout']
        rs = []
        for i in range(sg.rs_count):
            cols = rs_cols.get('rs%d' % (i + 1)) if rs_cols else None
            rs.append({'column': 'rs%d' % (i + 1),
                       'columns': [{'name': c[0], 'class': c[1]} for c in cols if c[0]] if cols else None})
        d['returns'] = {'kind': 'record', 'style': 'record', 'status_column': 'return_value', 'inout_columns': outs, 'result_sets': rs}
        d['call'] = 'SELECT * FROM dbo.%s(%s)' % (ident(u['name']).strip('"'), ', '.join('%s => $%d' % (p['pg_param'], i + 1) for i, p in enumerate(params)))
    elif kind == 'function':
        if sg.ret_table is not None:
            d['returns'] = {'kind': 'table', 'style': 'table', 'columns': [{'name': ident(c.name).strip('"'), 'type': c.pg} for c in sg.ret_table.cols]}
            d['call'] = 'SELECT * FROM dbo.%s(%s)' % (ident(u['name']).strip('"'), ', '.join('$%d' % (i + 1) for i in range(len(params))))
        else:
            d['returns'] = {'kind': 'scalar', 'style': 'scalar', 'type': sg.ret_pg}
            d['call'] = 'SELECT dbo.%s(%s)' % (ident(u['name']).strip('"'), ', '.join('$%d' % (i + 1) for i in range(len(params))))
    if u.get('notes'):
        d['untranslated_statements'] = len(u['notes'])
    return d


def run(src_root, repo, only=None, show=False):
    tables, cat, tr, parsed = prepare(src_root, repo)
    out_units = []
    files = {k: [] for k in FILES}
    sigs = []
    compat = open(os.path.join(HERE, 'compat.sql'), encoding='utf-8').read()
    files['function'].append(('compat', compat))
    order = {'function': parsed['function'], 'proc': parsed['proc'], 'trigger': parsed['trigger']}
    order['view'] = view_order(parsed['view'])
    # views first (functions that use views at run time are late bound; views never call plpgsql functions of ours)
    for kind in ('view', 'function', 'proc', 'trigger'):
        items = sorted(order[kind], key=lambda x: x[0]['name'].lower()) if kind != 'view' else order[kind]
        for u, node, body in items:
            if only and u['name'].lower() != only.lower():
                continue
            sql = None
            if node is not None and u['status'] is None:
                sql = emit_unit(tr, kind, u, node, body)
                if sql is not None:
                    sg = cat.procs.get(u['name'].lower()) if kind == 'proc' else cat.funcs.get(u['name'].lower()) if kind == 'function' else None
                    notes = list(sg.notes) if sg is not None and hasattr(sg, 'notes') else u.get('notes') or []
                    u['notes'] = notes
                    u['status'] = 'partial' if notes else 'translated'
            if sql is None:
                if u['status'] is None:
                    u['status'] = 'stub'
                    u['error'] = u.get('error') or 'no parse tree'
                sql = stub_function(tr, kind, u, node, body)
            files[kind].append((u['name'], sql))
            u['file'] = 'db/pg/' + FILES[kind]
            out_units.append(u)
            if show:
                print(sql)
            sg = cat.procs.get(u['name'].lower()) if kind == 'proc' else cat.funcs.get(u['name'].lower()) if kind == 'function' else None
            if sg is not None:
                sigs.append(sig_json(tr, kind, u, sg, getattr(sg, 'rs_cols', None)))
            elif kind == 'trigger':
                sigs.append({'name': u['name'], 'pg_name': 'dbo.' + ident('trg_' + u['name']).strip('"'), 'kind': 'trigger',
                             'status': u['status'], 'table': u.get('table'), 'events': u.get('events')})
    if only:
        return out_units
    for kind, fname in FILES.items():
        parts = [HDR]
        for name, sql in files[kind]:
            parts.append('\n-- ==== %s %s ====\n%s\n' % (kind if name != 'compat' else 'compat', name, sql.strip('\n')))
        text = ''.join(parts)
        if kind == 'function':
            text = HDR + '\n' + compat.strip('\n') + '\n' + ''.join('\n-- ==== function %s ====\n%s\n' % (n, s.strip('\n')) for n, s in files[kind] if n != 'compat')
        os.makedirs(os.path.join(repo, 'db', 'pg'), exist_ok=True)
        with open(os.path.join(repo, 'db', 'pg', fname), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    os.makedirs(os.path.join(repo, 'data', 'sql'), exist_ok=True)
    for u in out_units:
        u.pop('trace', None) if False else None
    with open(os.path.join(repo, 'data', 'sql', 'units.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out_units, f, indent=1, ensure_ascii=False)
    with open(os.path.join(repo, 'data', 'sql', 'proc_signatures.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(sigs, f, indent=1, ensure_ascii=False)
    return out_units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--repo', required=True)
    ap.add_argument('--only', default=None)
    ap.add_argument('--print', action='store_true')
    a = ap.parse_args()
    units = run(a.src, a.repo, a.only, a.print)
    from collections import Counter
    c = Counter((u['kind'], u['status']) for u in units)
    for k in sorted(c):
        print(k, c[k])
    errs = Counter()
    for u in units:
        if u['status'] in ('stub', 'excluded'):
            errs[(u.get('error') or '')[:100]] += 1
    for e, n in errs.most_common(25):
        print(n, e)
    notes = Counter()
    for u in units:
        for nt in u.get('notes') or []:
            notes[nt[:80]] += 1
    print('--- untranslated statement reasons')
    for e, n in notes.most_common(40):
        print(n, e)


if __name__ == '__main__':
    main()
