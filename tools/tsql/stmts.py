"""Embedded PowerScript SQL statements and DataWindow retrieve SQL -> PostgreSQL with $1..$n binds.

usage: python -I tools/tsql/stmts.py --src <parent project> --repo <this repo>
Writes data/sql/statements.json (one record per statement).
"""
import argparse
import glob
import json
import os
import re
import sys
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

from tsql.parser import Parser, ParseError, Node
from tsql.lexer import LexError
from tsql.schema import load_tables
from tsql.texpr import Untranslatable
from tsql.tquery import walk_nodes
from tsql.routines import Translator, Catalog
from tsql.build import prepare

SECRET = re.compile(r"(password|pwd)\s*=\s*'[^']*'|mediapass", re.I)


def _leak_words():
    """fragments that the lead's redact.py knows as vendor secrets (never written out here)"""
    try:
        sys.path.insert(0, os.path.join(HERE, '..'))
        import redact
        return [w.lower() for w in redact.FRAG_VALUES]
    except Exception:
        return []


LEAK = _leak_words()


def secret(text):
    if SECRET.search(text):
        return True
    low = text.lower()
    return any(w in low for w in LEAK)
HEADER = re.compile(r'^//\s+(\S+?)\(')
TRAILER = re.compile(r'\s+USING\s+[\w.\[\]]+\s*;?\s*((?:/\*.*?\*/\s*)*)$', re.I | re.S)
COMMENTS = re.compile(r'/\*(.*?)\*/', re.S)

PB_PG = {'string': 'text', 'number': 'numeric', 'long': 'integer', 'ulong': 'integer', 'int': 'integer', 'integer': 'integer',
         'uint': 'integer', 'decimal': 'numeric', 'real': 'real', 'double': 'double precision', 'datetime': 'timestamp',
         'date': 'date', 'time': 'time', 'boolean': 'boolean', 'blob': 'bytea', 'char': 'text', 'longlong': 'bigint'}

PREFIX_TYPES = [(('ls_', 'as_', 's_', 'is_', 'str_', 'lc_', 'ac_', 'gs_', 'ps_'), 'text'),
                (('ll_', 'al_', 'li_', 'ai_', 'il_', 'ii_', 'ul_', 'l_', 'i_', 'gl_', 'gi_'), 'integer'),
                (('ldt_', 'adt_', 'dt_', 'idt_', 'ldate', 'gdt_'), 'timestamp'),
                (('ld_', 'ad_', 'dc_', 'ldc_', 'adc_', 'idc_', 'gd_'), 'numeric'),
                (('lb_', 'ab_', 'lblob', 'ibl_', 'bl_'), 'bytea')]


def guess_type(name):
    last = name.split('.')[-1].split('[')[0].lower()
    if 'date' in last or last.startswith(('dt', 'adt', 'ldt')):
        return 'timestamp'
    for pre, ty in PREFIX_TYPES:
        if last.startswith(pre):
            return ty
    return None


def classify_embedded(body):
    t = body.strip()
    low = t.lower()
    first = low.split(None, 1)[0] if low else ''
    if first in ('rollback', 'commit', 'start', 'stop', 'connect', 'disconnect'):
        return 'tx-control'
    if first == 'execute':
        if re.match(r'execute\s+immediate\b', low):
            return 'dynamic'
        return 'procedure-call'
    if first in ('fetch', 'open', 'close', 'declare'):
        return 'cursor'
    if first in ('select', 'insert', 'update', 'delete'):
        return first
    if first in ('selectblob', 'updateblob'):
        return 'blob'
    return 'other'


def embedded(scripts_root):
    out = []
    for f in sorted(glob.glob(os.path.join(scripts_root, '*', '*.pbs'))):
        lib = os.path.basename(os.path.dirname(f))
        obj = os.path.splitext(os.path.basename(f))[0]
        routine = ''
        for i, line in enumerate(open(f, encoding='utf-8', errors='replace'), 1):
            m = HEADER.match(line)
            if m:
                routine = m.group(1)
                continue
            s = line.strip()
            if not s.startswith('SQL '):
                continue
            out.append({'id': 'emb:%s/%s:%d' % (lib, obj, i), 'file': 'recovered/scripts/%s/%s.pbs' % (lib, obj),
                        'line': i, 'routine': routine, 'raw': s[4:]})
    return out


def strip_trailer(raw):
    flags = []
    m = TRAILER.search(raw)
    body = raw
    if m:
        body = raw[:m.start()]
        for c in COMMENTS.findall(m.group(1) or ''):
            flags.append(c.strip())
    else:
        body = re.sub(r'\s*;\s*$', '', raw)
    # PowerBuilder annotation comments that are not trailers
    for c in COMMENTS.findall(body):
        if 'bind positions' in c or c.strip().startswith('args:'):
            flags.append(c.strip())
    body = COMMENTS.sub(' ', body).strip().rstrip(';').strip()
    return body, flags


def dw_items(dw_root):
    out = []
    for f in sorted(glob.glob(os.path.join(dw_root, '*', '*.json'))):
        lib = os.path.basename(os.path.dirname(f))
        name = os.path.splitext(os.path.basename(f))[0]
        d = json.load(open(f, encoding='utf-8'))
        t = d.get('table') or {}
        args = {}
        for it in ((t.get('arguments') or {}).get('_items') or []):
            nm = it.get('_items') if isinstance(it, dict) else None
            if nm and len(nm) >= 2:
                args[str(nm[0]).lower()] = str(nm[1]).lower()
        base = {'id': 'dw:%s/%s' % (lib, name), 'file': 'recovered/datawindows_json/%s/%s.json' % (lib, name), 'args': args}
        if t.get('procedure'):
            out.append({**base, 'dwkind': 'procedure', 'raw': t['procedure']})
        if t.get('retrieve'):
            r = t['retrieve']
            out.append({**base, 'dwkind': 'pbselect' if r.strip().upper().startswith('PBSELECT') else 'select', 'raw': r})
    return out


def pbselect_to_tsql(r):
    tables = re.findall(r'TABLE\(\s*NAME="([^"]+)"(?:\s*ALIAS="([^"]+)")?', r)
    cols = re.findall(r'COLUMN\(\s*NAME="([^"]+)"', r)
    comps = re.findall(r'COMPUTE\(\s*NAME="([^"]+)"', r)
    if re.search(r'\bJOIN\(|\bGROUP\(|\bHAVING\(|\bDISTINCT\b', r):
        raise Untranslatable('PBSELECT with JOIN/GROUP/HAVING/DISTINCT')
    if not tables:
        raise Untranslatable('PBSELECT without table')
    sel = ', '.join(cols + comps) if (cols or comps) else '*'
    frm = ', '.join(t[0] + (' ' + t[1] if t[1] else '') for t in tables)
    sql = 'SELECT %s FROM %s' % (sel, frm)
    wh = re.search(r'WHERE\((.*?)\)\s*(?=(?:ORDER|GROUP|ARG|\)|$))', r, re.S)
    if wh:
        conds = re.findall(r'EXP1\s*=\s*"([^"]*)"\s*OP\s*=\s*"([^"]*)"\s*EXP2\s*=\s*"([^"]*)"(?:\s*LOGIC\s*=\s*"([^"]*)")?', wh.group(1))
        # WHERE( ... ) may repeat per condition; collect all
    conds = re.findall(r'EXP1\s*=\s*"([^"]*)"\s*OP\s*=\s*"([^"]*)"\s*EXP2\s*=\s*"([^"]*)"(?:\s*LOGIC\s*=\s*"([^"]*)")?', r)
    if conds:
        parts = []
        for i, (a, op, b, lg) in enumerate(conds):
            parts.append('%s %s %s' % (a, op, b))
            if lg and i < len(conds) - 1:
                parts.append(lg)
        sql += ' WHERE ' + ' '.join(parts)
    orders = re.findall(r'ORDER\(\s*NAME="([^"]+)"\s*ASC=(\w+)', r)
    if orders:
        sql += ' ORDER BY ' + ', '.join('%s%s' % (n, '' if a.lower() == 'yes' else ' DESC') for n, a in orders)
    args = {}
    for n, t in re.findall(r'ARG\(\s*NAME\s*=\s*"([^"]+)"\s*TYPE\s*=\s*(\w+)', r):
        args[n.lower()] = t.lower()
    return sql, args


def proc_call_to_pg(raw, sigs):
    """'1 execute dbo.SP_X;1 @a = :a, @b = :b'  ->  SELECT * FROM dbo.sp_x(a => $1, b => $2)"""
    m = re.match(r'\s*\d+\s+execute\s+(?:dbo\.)?(\w+)\s*;\s*\d+\s*(.*)$', raw, re.I | re.S)
    if not m:
        raise Untranslatable('procedure call shape')
    name, rest = m.group(1), m.group(2)
    args = re.findall(r'@(\w+)\s*=\s*:(\w+)', rest)
    from tsql.names import ident, pident
    return 'SELECT * FROM dbo.%s(%s)' % (ident(name), ', '.join('%s => $%d' % (pident(a), i + 1) for i, (a, b) in enumerate(args))), [b for a, b in args], name


def translate_text(tr, text):
    """parse + translate one statement text (with :binds).  -> (sql, binds, into)"""
    p = Parser(text, binds=True, dq_is_string=True)
    stmts = p.parse_batch()
    if len(stmts) != 1:
        raise Untranslatable('%d statements' % len(stmts))
    st = stmts[0]
    into = None
    if st.k == 'select_stmt':
        sel = st.sel
        n = sel
        while n is not None:
            if n.into is not None and isinstance(n.into, list):
                into = n.into[0].names
                n.into = None
            n = n.union[2] if n.union else None
    sql, binds = tr.standalone(st)
    return sql, binds, into


def blob_to_tsql(body):
    low = body.lower()
    if low.startswith('selectblob'):
        m = re.match(r'selectblob\s+(.*?)\s+into\s+(:[\w.\[\]]+)\s+from\s+(.*)$', body, re.I | re.S)
        if not m:
            raise Untranslatable('SelectBlob shape')
        return 'SELECT %s FROM %s' % (m.group(1), m.group(3)), [m.group(2).lstrip(':')]
    m = re.match(r'updateblob\s+(\S+)\s+set\s+(.*)$', body, re.I | re.S)
    if not m:
        raise Untranslatable('UpdateBlob shape')
    return 'UPDATE %s SET %s' % (m.group(1), m.group(2)), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    tables, cat, tr, parsed = prepare(a.src, a.repo)
    # views get registered while building routines; the statement translator only needs their column lists
    from tsql.build import emit_unit
    for u, node, body in parsed['view']:
        if node is not None and u['status'] is None:
            emit_unit(tr, 'view', u, node, body)
    recs = []
    for e in embedded(os.path.join(a.src, 'recovered', 'scripts')):
        body, flags = strip_trailer(e['raw'])
        kind = classify_embedded(body)
        r = {'id': e['id'], 'source': e['file'], 'line': e['line'], 'routine': e['routine'], 'kind': 'embedded-' + kind,
             'original': body, 'translated': None, 'params': [], 'param_types': [], 'into': None, 'status': None, 'flags': flags}
        if secret(body):
            r.update(original='[omitted]', status='excluded', note='contains a password-like token; vendor backup/restore code')
            recs.append(r)
            continue
        if kind in ('tx-control', 'cursor', 'other'):
            r['status'] = 'not-applicable'
            r['note'] = {'tx-control': 'transaction control: handled by the backend connection layer', 'cursor': 'cursor statement bound to a declaration outside the single-line statements',
                         'other': 'unrecognised statement form'}[kind]
        elif kind == 'dynamic':
            r['status'] = 'dynamic'
            r['note'] = 'EXECUTE IMMEDIATE of a statement built at run time'
        elif kind == 'procedure-call':
            r['status'] = 'dynamic'
            r['note'] = 'EXECUTE of a procedure declared by a DECLARE ... PROCEDURE FOR statement elsewhere'
        else:
            try:
                text = body
                blob_into = None
                if kind == 'blob':
                    text, blob_into = blob_to_tsql(body)
                sql, binds, into = translate_text(tr, text)
                if blob_into is not None:
                    into = blob_into
                r.update(translated=sql, params=binds, into=into, status='translated')
                r['param_types'] = [guess_type(b) or 'text' for b in binds]
            except (ParseError, LexError) as ex:
                r.update(status='parse-error', note=str(ex)[:200])
            except Untranslatable as ex:
                r.update(status='untranslatable', note=str(ex)[:200])
            except Exception as ex:
                r.update(status='translator-error', note='%s: %s' % (type(ex).__name__, ex))
        recs.append(r)
    for d in dw_items(os.path.join(a.src, 'recovered', 'datawindows_json')):
        kind = {'select': 'dw-select', 'pbselect': 'dw-pbselect', 'procedure': 'dw-procedure'}[d['dwkind']]
        r = {'id': d['id'] + ('#proc' if d['dwkind'] == 'procedure' else ''), 'source': d['file'], 'kind': kind, 'original': d['raw'].strip(),
             'translated': None, 'params': [], 'param_types': [], 'into': None, 'status': None}
        if secret(d["raw"]):
            r.update(original='[omitted]', status='excluded', note='contains a password-like token')
            recs.append(r)
            continue
        try:
            args = d['args']
            if d['dwkind'] == 'procedure':
                sql, binds, pname = proc_call_to_pg(d['raw'], None)
                r.update(translated=sql, params=binds, status='translated', note='procedure result set is returned in refcursor column rs1')
            else:
                text = d['raw']
                if d['dwkind'] == 'pbselect':
                    text, args2 = pbselect_to_tsql(d['raw'])
                    args = {**args, **args2}
                sql, binds, into = translate_text(tr, text)
                r.update(translated=sql, params=binds, status='translated')
            r['param_types'] = [PB_PG.get(args.get(b.lower().split('.')[0], ''), guess_type(b) or 'text') for b in r['params']]
        except (ParseError, LexError) as ex:
            r.update(status='parse-error', note=str(ex)[:200])
        except Untranslatable as ex:
            r.update(status='untranslatable', note=str(ex)[:200])
        except Exception as ex:
            r.update(status='translator-error', note='%s: %s' % (type(ex).__name__, ex))
        recs.append(r)
    os.makedirs(os.path.join(a.repo, 'data', 'sql'), exist_ok=True)
    with open(os.path.join(a.repo, 'data', 'sql', 'statements.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(recs, f, indent=0, ensure_ascii=False)
    c = collections.Counter((r['kind'], r['status']) for r in recs)
    for k in sorted(c):
        print(k, c[k])
    notes = collections.Counter()
    for r in recs:
        if r['status'] in ('parse-error', 'untranslatable', 'translator-error'):
            notes[(r['status'], re.sub(r'near .*', '', r.get('note') or '')[:90])] += 1
    for k, n in notes.most_common(40):
        print(n, k)


if __name__ == '__main__':
    main()
