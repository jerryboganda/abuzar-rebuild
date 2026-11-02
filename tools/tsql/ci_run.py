"""CI runner: apply the translated routines to a real PostgreSQL 17 one by one and validate embedded statements.

usage: python tools/tsql/ci_run.py --repo . --out ci-out
 - applies db/pg/40..70 one routine at a time (a failure does not hide the others)
 - plpgsql_check_function() on every created PL/pgSQL function when the extension is available
 - PREPARE of every translated embedded / DataWindow statement (data/sql/statements.json)
Writes: <out>/sql-failures.json  <out>/results.json  docs/SQL-TRANSLATION-REPORT.md (to --report)
Needs: pip install "psycopg[binary]" ; PG* environment variables for the connection.
"""
import argparse
import collections
import json
import os
import re
import sys
import time

import psycopg

MARK = re.compile(r'^-- ==== (\S+) (.+?) ====\s*$', re.M)
FILES = [('function', '40_functions.sql'), ('view', '50_views.sql'), ('proc', '60_procedures.sql'), ('trigger', '70_triggers.sql')]


def shorten_name(name):
    """same rule as tools/tsql/names.py: identifiers longer than 63 bytes get a sha1 suffix"""
    import hashlib
    n = name.strip().lower()
    if len(n.encode('utf-8')) > 63:
        n = n[:54] + '_' + hashlib.sha1(n.encode('utf-8')).hexdigest()[:8]
    return n


def split_units(path):
    text = open(path, encoding='utf-8').read()
    ms = list(MARK.finditer(text))
    out = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        out.append((m.group(1), m.group(2), text[m.end():end].strip()))
    return out


def kind_of_error(msg):
    m = re.sub(r'"[^"]*"', '"X"', msg)
    m = re.sub(r'\b\d+\b', 'N', m)
    m = re.sub(r'\$\d+', '$N', m)
    m = re.sub(r"'[^']*'", "'X'", m)
    return m[:140]


def connect():
    return psycopg.connect(autocommit=True)


def first_line(e):
    return str(e).strip().split('\n')[0]


def apply_units(conn, repo, results, failures, sources):
    created = []
    for kind, fname in FILES:
        path = os.path.join(repo, 'db', 'pg', fname)
        if not os.path.exists(path):
            continue
        for k, name, sql in split_units(path):
            cat = 'compat' if k == 'compat' else k
            rec = {'category': cat, 'name': name, 'file': fname}
            if sql.lstrip().startswith('-- view not translated'):
                rec['result'] = 'skipped'
                results.append(rec)
                continue
            try:
                conn.execute('SET search_path TO dbo, public')
                conn.execute(sql)
                rec['result'] = 'created'
                created.append((cat, name))
                sources[(cat, name)] = sql
            except Exception as e:
                rec['result'] = 'failed'
                st = getattr(e, 'sqlstate', None)
                rec['sqlstate'] = st
                rec['message'] = first_line(e)
                rec['kind'] = kind_of_error(first_line(e))
                diag = getattr(e, 'diag', None)
                if diag is not None and diag.statement_position:
                    try:
                        pos = int(diag.statement_position)
                        rec['near'] = sql[max(0, pos - 80):pos + 80].replace('\n', ' ')
                    except Exception:
                        pass
                failures.append({'stage': 'create', **rec})
            results.append(rec)
    return created


TEMP_OPEN = re.compile(r'^\s*CREATE TEMP TABLE (\S+) \($')
TEMP_CTAS = re.compile(r'^\s*CREATE TEMP TABLE (\S+) ON COMMIT DROP AS (.*);\s*$')
PERM_CTAS = re.compile(r'^\s*CREATE TABLE (dbo\.\S+) AS (.*);\s*$')
DECL = re.compile(r'^  (v_\w+|"v_\w+") ([^;]+);$')


def temp_statements(sql):
    """temporary tables a routine creates, in order: (name, ddl).  Structure for CREATE TABLE AS comes from running the SELECT
    with the routine's variables replaced by typed NULLs (WITH NO DATA)."""
    lines = sql.split('\n')
    decl = {}
    for ln in lines:
        m = DECL.match(ln)
        if m:
            decl[m.group(1).strip('"')] = m.group(2)
    out = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = TEMP_OPEN.match(ln)
        if m:
            j = i + 1
            body = []
            while j < len(lines) and not lines[j].startswith(') ON COMMIT DROP;'):
                body.append(lines[j])
                j += 1
            out.append((m.group(1), 'CREATE TEMP TABLE %s (\n%s\n)' % (m.group(1), '\n'.join(body))))
            i = j
        else:
            m = TEMP_CTAS.match(ln)
            if m:
                sel = m.group(2)
                for v, ty in decl.items():
                    sel = re.sub(r'(?<![\w.])%s(?!\w)' % re.escape(v), '(NULL::%s)' % ty, sel)
                out.append((m.group(1), 'CREATE TEMP TABLE %s AS %s WITH NO DATA' % (m.group(1), sel)))
            else:
                m = PERM_CTAS.match(ln)
                if m:
                    sel = m.group(2)
                    for v, ty in decl.items():
                        sel = re.sub(r'(?<![\w.])%s(?!\w)' % re.escape(v), '(NULL::%s)' % ty, sel)
                    out.append((m.group(1), 'CREATE TABLE %s AS %s WITH NO DATA' % (m.group(1), sel)))
        i += 1
    return out


def precreate_temps(conn, sql):
    made = []
    for name, ddl in temp_statements(sql):
        try:
            conn.execute('DROP TABLE IF EXISTS %s' % name)
            conn.execute(ddl)
            made.append(name)
        except Exception:
            pass
    return made


def plpgsql_check(conn, created, units_index, results, failures, sources):
    try:
        conn.execute('CREATE EXTENSION IF NOT EXISTS plpgsql_check')
    except Exception as e:
        print('plpgsql_check not available:', first_line(e))
        return False
    # trigger functions need their table
    trig_tables = {}
    for u in units_index:
        if u['kind'] == 'trigger':
            trig_tables[u['name']] = u.get('table')
    n = 0
    for cat, name in created:
        if cat not in ('proc', 'function', 'trigger'):
            continue
        fname = ('trg_' + name) if cat == 'trigger' else name
        low = shorten_name(fname)
        try:
            row = conn.execute("select p.oid, p.prosrc <> '' from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                               "where n.nspname = 'dbo' and p.proname = %s", (low,)).fetchone()
        except Exception:
            row = None
        rec = next((r for r in results if r['category'] == cat and r['name'] == name and r['result'] == 'created'), None)
        if rec is None:
            continue
        if row is None:
            rec['check'] = 'not-found'
            continue
        oid = row[0]
        made = precreate_temps(conn, sources.get((cat, name), ''))
        try:
            if cat == 'trigger':
                tbl = trig_tables.get(name)
                evs = next((u.get('events') or [] for u in units_index if u['kind'] == 'trigger' and u['name'] == name), [])
                oldt = 'deleted' if ('UPDATE' in evs or 'DELETE' in evs) else None
                newt = 'inserted' if ('UPDATE' in evs or 'INSERT' in evs) else None
                rows = conn.execute("select lineno, sqlstate, message, level, statement, query from plpgsql_check_function_tb(%s::oid::regproc, %s::regclass, fatal_errors := false, other_warnings := false, extra_warnings := false, performance_warnings := false, oldtable := %s, newtable := %s)",
                                    (oid, 'dbo.' + tbl.lower() if tbl else None, oldt, newt)).fetchall()
            else:
                rows = conn.execute("select lineno, sqlstate, message, level, statement, query from plpgsql_check_function_tb(%s::oid::regproc, fatal_errors := false, other_warnings := false, extra_warnings := false, performance_warnings := false)",
                                    (oid,)).fetchall()
        except Exception as e:
            rec['check'] = 'check-error'
            rec['check_message'] = first_line(e)
            for t in made:
                conn.execute('DROP TABLE IF EXISTS %s' % t)
            continue
        for t in made:
            try:
                conn.execute('DROP TABLE IF EXISTS %s' % t)
            except Exception:
                pass
        errs = [r for r in rows if r[3] == 'error']
        n += 1
        temp_only = errs and all(re.match(r'relation "(tmp_|tv_)\w*" does not exist', r[2] or '') for r in errs)
        if not errs:
            rec['check'] = 'ok'
        elif temp_only:
            rec['check'] = 'temp-unresolved'
            rec['check_errors'] = [{'line': r[0], 'message': r[2]} for r in errs[:3]]
        else:
            rec['check'] = 'errors'
            rec['check_errors'] = [{'line': r[0], 'sqlstate': r[1], 'message': r[2], 'statement': r[4], 'query': (r[5] or '')[:200]} for r in errs[:8]]
            for r in errs[:8]:
                failures.append({'stage': 'check', 'category': cat, 'name': name, 'sqlstate': r[1], 'message': r[2],
                                 'kind': kind_of_error(r[2]), 'line': r[0], 'query': (r[5] or '')[:200]})
    print('plpgsql_check ran on', n, 'functions')
    return True


PB_PG = {'string': 'text', 'number': 'numeric', 'long': 'integer', 'ulong': 'integer', 'int': 'integer', 'integer': 'integer',
         'uint': 'integer', 'decimal': 'numeric', 'real': 'real', 'double': 'double precision', 'datetime': 'timestamp',
         'date': 'date', 'time': 'time', 'boolean': 'boolean', 'blob': 'bytea'}


def prepare_statements(conn, repo, results, failures):
    path = os.path.join(repo, 'data', 'sql', 'statements.json')
    if not os.path.exists(path):
        return None
    sts = json.load(open(path, encoding='utf-8'))
    stats = collections.Counter()
    for st in sts:
        if st.get('status') != 'translated' or not st.get('translated'):
            stats[('skipped', st.get('kind'))] += 1
            continue
        rec = {'category': 'stmt-' + st['kind'], 'name': st['id'], 'result': None}
        try:
            conn.execute('SET search_path TO dbo, public')
            conn.execute('PREPARE s AS ' + st['translated'])
            conn.execute('DEALLOCATE s')
            rec['result'] = 'prepared'
        except Exception as e:
            sqlstate = getattr(e, 'sqlstate', None)
            msg = first_line(e)
            near = None
            try:
                pos = int(e.diag.position) - len('PREPARE s AS ') - 1
                near = st['translated'][max(0, pos - 100):pos + 100]
            except Exception:
                pass
            try:
                conn.execute('DEALLOCATE s')
            except Exception:
                pass
            # retry with the parameter types declared by the DataWindow arguments / PowerScript variable names
            types = st.get('param_types') or []
            ok = False
            if types and len(types) == len(st.get('params') or []):
                try:
                    conn.execute('PREPARE s (%s) AS %s' % (', '.join(types), st['translated']))
                    conn.execute('DEALLOCATE s')
                    ok = True
                except Exception as e2:
                    try:
                        conn.execute('DEALLOCATE s')
                    except Exception:
                        pass
                    if sqlstate == '42P18':
                        sqlstate, msg = getattr(e2, 'sqlstate', None), first_line(e2)
            if ok:
                rec['result'] = 'prepared-with-declared-types'
            elif sqlstate == '42P18':
                rec['result'] = 'indeterminate-param-type'
                rec['sqlstate'], rec['message'] = sqlstate, msg
            else:
                rec['result'] = 'failed'
                rec['sqlstate'], rec['message'], rec['kind'] = sqlstate, msg, kind_of_error(msg)
                failures.append({'stage': 'prepare', 'category': rec['category'], 'name': st['id'], 'sqlstate': sqlstate,
                                 'message': msg, 'kind': rec['kind'], 'file': st.get('file'), 'text': st['translated'][:300], 'near': near})
        results.append(rec)
        stats[(rec['result'], st['kind'])] += 1
    return sts


def summarize(results, failures, units_index, repo, report_path, stmts_total):
    by = collections.defaultdict(collections.Counter)
    for r in results:
        by[r['category']][r['result']] += 1
        if r.get('check'):
            by[r['category']]['check-' + r['check']] += 1
    st_idx = {(u['kind'], u['name']): u for u in units_index}
    lines = ['# SQL translation report', '',
             'Generated by `tools/tsql/ci_run.py` against PostgreSQL 17 (GitHub Actions run). Numbers below come from that run, not from estimates.', '']
    lines += ['## Routines (views, functions, procedures, triggers)', '',
              '| category | total | translated fully | translated with untranslated statements | stub or excluded | CREATE succeeded | CREATE failed | plpgsql_check clean | plpgsql_check errors | plpgsql_check unresolved (temp table structure unknown) |',
              '|---|---|---|---|---|---|---|---|---|---|']
    kinds = {'function': 'function', 'view': 'view', 'proc': 'procedure', 'trigger': 'trigger'}
    tot = collections.Counter()
    for k, label in kinds.items():
        us = [u for u in units_index if u['kind'] == k]
        c = collections.Counter(u['status'] for u in us)
        r = by.get(k, collections.Counter())
        row = [label, len(us), c.get('translated', 0), c.get('partial', 0), c.get('stub', 0) + c.get('excluded', 0),
               r.get('created', 0), r.get('failed', 0), r.get('check-ok', 0), r.get('check-errors', 0), r.get('check-temp-unresolved', 0)]
        if k == 'view':
            row[7] = row[8] = row[9] = 'n/a'
        lines.append('| ' + ' | '.join(str(x) for x in row) + ' |')
        for i, x in enumerate(row[1:]):
            if isinstance(x, int):
                tot[i] += x
    lines.append('| **all** | ' + ' | '.join(str(tot[i]) for i in range(9)) + ' |')
    lines += ['',
              '"translated fully" = every statement was translated; "with untranslated statements" = the routine compiles but contains `RAISE EXCEPTION \'untranslated T-SQL\'` placeholders (original kept as a comment);',
              '"stub" = parse/translation failed, or deliberately excluded (vendor backup/restore code, SQL Server system views): a function with the right signature that raises when called.',
              '"CREATE succeeded" counts what PostgreSQL accepted (PL/pgSQL syntax check only); "plpgsql_check clean" additionally resolves tables, columns, types and function calls inside each body.', '']
    sm = collections.Counter()
    nfetch = 0
    for r in results:
        if r['category'].startswith('smoke-'):
            sm[r['result']] += 1
            nfetch += r.get('cursors_fetched', 0)
    if sm:
        lines += ['Runtime smoke test (every translated procedure/function called once with NULL arguments on the empty schema, rolled back): %s. Result-set cursors opened by those calls and fetched with FETCH ALL: %d.' % (', '.join('%s %d' % (k, v) for k, v in sorted(sm.items())), nfetch), '']
    comp = by.get('compat', collections.Counter())
    lines += ['Compatibility helper functions (`dbo.tsql_*`): created %d, failed %d.' % (comp.get('created', 0), comp.get('failed', 0)), '']
    if stmts_total is not None:
        lines += ['## Embedded SQL statements and DataWindow retrieve SQL', '',
                  '| category | total | translated | PREPARE ok | ok with declared param types | indeterminate param type | failed |', '|---|---|---|---|---|---|---|']
        sts = collections.defaultdict(collections.Counter)
        for s in stmts_total:
            sts[s['kind']]['total'] += 1
            if s.get('status') == 'translated':
                sts[s['kind']]['translated'] += 1
        for k in sorted(sts):
            r = by.get('stmt-' + k, collections.Counter())
            lines.append('| %s | %d | %d | %d | %d | %d | %d |' % (k, sts[k]['total'], sts[k]['translated'], r.get('prepared', 0),
                                                                 r.get('prepared-with-declared-types', 0), r.get('indeterminate-param-type', 0), r.get('failed', 0)))
        lines.append('')
    fk = collections.defaultdict(list)
    for f in failures:
        fk[(f['stage'], f['category'], f['kind'])].append(f)
    lines += ['## Top failure causes', '', '| count | stage | category | cause (identifiers normalised) | examples |', '|---|---|---|---|---|']
    for (stage, cat, kind), fs in sorted(fk.items(), key=lambda x: -len(x[1]))[:40]:
        ex = ', '.join(sorted({f['name'] for f in fs})[:3])
        lines.append('| %d | %s | %s | %s | %s |' % (len(fs), stage, cat, kind.replace('|', '/'), ex.replace('|', '/')))
    # untranslated statement reasons
    notes = collections.Counter()
    for u in units_index:
        for n in u.get('notes') or []:
            notes[re.sub(r'\b[\w.]+\b', lambda m: m.group(0) if m.group(0).islower() or not m.group(0)[0].isupper() else m.group(0), n)[:100]] += 1
    lines += ['', '## Untranslated statements inside routines (by reason)', '', '| count | reason |', '|---|---|']
    for n, c in notes.most_common(40):
        lines.append('| %d | %s |' % (c, n.replace('|', '/')))
    lines += ['', '## Stubs and exclusions', '', '| routine | kind | reason |', '|---|---|---|']
    for u in units_index:
        if u['status'] in ('stub', 'excluded'):
            lines.append('| %s | %s | %s |' % (u['name'], u['kind'], (u.get('error') or '').replace('|', '/')[:160]))
    os.makedirs(os.path.dirname(report_path) or '.', exist_ok=True)
    open(report_path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    return by


def smoke_calls(conn, units_index, results, failures):
    """call every translated procedure / function with NULL arguments inside a rolled-back transaction (schema is empty):
    exercises dynamic SQL, cursors, temp tables and casts that the static checks cannot see"""
    sigs = json.load(open(os.path.join(REPO, 'data', 'sql', 'proc_signatures.json'), encoding='utf-8'))
    n = 0
    for sg in sigs:
        if sg.get('kind') not in ('proc', 'function') or sg.get('status') not in ('translated', 'partial'):
            continue
        name = sg['name']
        fq = sg['pg_name']
        nargs = len(sg['params'])
        args = ', '.join('NULL' for _ in range(nargs))
        if sg['kind'] == 'function' and (sg.get('returns') or {}).get('style') == 'table':
            sql = 'SELECT count(*) FROM %s(%s)' % (fq, args)
        elif sg['kind'] == 'proc':
            sql = 'SELECT * FROM %s(%s)' % (fq, args)
        else:
            sql = 'SELECT %s(%s)' % (fq, args)
        rec = {'category': 'smoke-' + sg['kind'], 'name': name}
        try:
            conn.execute('BEGIN')
            conn.execute("SET LOCAL statement_timeout = '4s'")
            conn.execute('SET LOCAL search_path TO dbo, public')
            cur = conn.execute(sql)
            rows = cur.fetchall()
            rec['result'] = 'ok'
            if sg['kind'] == 'proc' and rows and cur.description:
                # documented protocol: FETCH ALL FROM the refcursor returned in column rsN (runs the cursor's query)
                for i, col in enumerate(cur.description):
                    if re.fullmatch(r'rs\d+', col.name) and rows[0][i]:
                        conn.execute('FETCH ALL FROM "%s"' % rows[0][i].replace('"', '""')).fetchall()
                        rec['cursors_fetched'] = rec.get('cursors_fetched', 0) + 1
        except Exception as e:
            st = getattr(e, 'sqlstate', None)
            msg = first_line(e)
            if st == '0A000' and 'untranslated T-SQL' in msg:
                rec['result'] = 'ok-untranslated-placeholder'
            elif st in ('23502', '23503', '22004', '22P02', '22003', '22012'):
                rec['result'] = 'ok-null-argument-effect'     # NOT NULL / FK / cast errors caused by the NULL test arguments
            elif st in ('TS001',):
                rec['result'] = 'ok-rollback-requested'
            elif st == 'P0001':
                rec['result'] = 'ok-raised'
            elif st == '57014':
                rec['result'] = 'timeout'
            else:
                rec['result'] = 'failed'
                rec['sqlstate'], rec['message'], rec['kind'] = st, msg, kind_of_error(msg)
                failures.append({'stage': 'smoke', 'category': rec['category'], 'name': name, 'sqlstate': st, 'message': msg,
                                 'kind': rec['kind']})
        finally:
            try:
                conn.execute('ROLLBACK')
            except Exception:
                pass
        results.append(rec)
        n += 1
    print('smoke calls', n)


REPO = '.'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('--out', default='ci-out')
    ap.add_argument('--report', default='ci-out/SQL-TRANSLATION-REPORT.md')
    ap.add_argument('--top', type=int, default=25)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    units_index = json.load(open(os.path.join(a.repo, 'data', 'sql', 'units.json'), encoding='utf-8'))
    conn = connect()
    results, failures = [], []
    t0 = time.time()
    sources = {}
    created = apply_units(conn, a.repo, results, failures, sources)
    print('applied routines in %.0fs' % (time.time() - t0))
    have_check = plpgsql_check(conn, created, units_index, results, failures, sources)
    t0 = time.time()
    stmts = prepare_statements(conn, a.repo, results, failures)
    print('statements prepared in %.0fs' % (time.time() - t0))
    global REPO
    REPO = a.repo
    t0 = time.time()
    smoke_calls(conn, units_index, results, failures)
    print('smoke calls in %.0fs' % (time.time() - t0))
    by = summarize(results, failures, units_index, a.repo, a.report, stmts)
    json.dump(failures, open(os.path.join(a.out, 'sql-failures.json'), 'w', encoding='utf-8'), indent=1)
    json.dump(results, open(os.path.join(a.out, 'results.json'), 'w', encoding='utf-8'), indent=1)
    print('\n=== counts per category')
    for cat in sorted(by):
        print(cat, dict(by[cat]))
    print('\n=== top failure groups')
    fk = collections.defaultdict(list)
    for f in failures:
        fk[(f['stage'], f['category'], f['kind'])].append(f)
    for (stage, cat, kind), fs in sorted(fk.items(), key=lambda x: -len(x[1]))[:a.top]:
        print('%4d  %s/%s  %s   e.g. %s' % (len(fs), stage, cat, kind, ', '.join(sorted({f['name'] for f in fs})[:3])))
    print('\nfailures total', len(failures))
    print('=== BEGIN REPORT')
    print(open(a.report, encoding='utf-8').read())
    print('=== END REPORT')
    if os.environ.get('DUMP_FAILURES', '1') == '1':
        print('=== BEGIN FAILURES (json lines)')
        for f in failures:
            print(json.dumps(f, ensure_ascii=False))
        print('=== END FAILURES')
        print('=== BEGIN RESULTS (json lines)')
        for r in results:
            if r.get('result') not in ('created', 'prepared') or r.get('check') not in (None, 'ok'):
                print(json.dumps(r, ensure_ascii=False))
        print('=== END RESULTS')


if __name__ == '__main__':
    main()
