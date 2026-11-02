"""Seed data for a new database: the data statements of the original migration chain, translated to PostgreSQL.

usage: python -I tools/build_seed.py <research project root> <this repo> [out sql]

The research project's db/seed/seed_ledger.sql holds the INSERT / UPDATE / DELETE statements the original upgrade scripts ran (rights, group
rights, preferences, interface settings, modules, report metadata ...; no customer data).  Every statement is translated with the T-SQL
translator (tools/tsql) and written to db/pg/90_seed.sql in order; what cannot be translated is kept as a comment with the reason.
The file is applied statement by statement: a statement that no longer fits the final schema (a dropped column ...) must not stop the rest.
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tsql.build import prepare
from tsql.stmts import translate_text
from tsql.parser import ParseError
from tsql.lexer import LexError
from tsql.texpr import Untranslatable


def blocks(path):
    """(script number, statement text) of the ledger: statements end with a line `GO`, `-- script N` precedes them.
    The ledger was cut at the SELECT of `INSERT INTO t (columns) SELECT ... UNION ALL SELECT ...`: the two halves are joined again."""
    raw = []
    script = 0
    cur = []
    cur_script = 0

    def flush():
        nonlocal cur, cur_script
        text = chr(10).join(cur).strip()
        if text:
            raw.append((cur_script, text))
        cur = []

    for line in open(path, encoding='utf-8', errors='replace'):
        s = line.strip()
        m = re.match(r'--\s*script\s+(\d+)', s, re.I)
        if m:
            script = int(m.group(1))
            if not cur:
                cur_script = script
            continue
        if s.upper() == 'GO':
            flush()
            continue
        if s.startswith('--') and not cur:
            continue
        if not cur:
            cur_script = script
        cur.append(line.rstrip(chr(10)))
    flush()
    head = re.compile(r'^insert\s+(?:into\s+)?[\w.\[\]]+\s*(\([^)]*\))?\s*$', re.I | re.S)
    out = []
    i = 0
    while i < len(raw):
        sc, text = raw[i]
        if head.match(text) and i + 1 < len(raw) and re.match(r'^select\b', raw[i + 1][1], re.I):
            text = text + chr(10) + raw[i + 1][1]
            i += 1
        # ... and at every UNION ALL
        while re.search(r'union(\s+all)?\s*$', text, re.I) and i + 1 < len(raw):
            text = text + chr(10) + raw[i + 1][1]
            i += 1
        out.append((sc, text))
        i += 1
    return out


def main(src, repo, out):
    tables, cat, tr, parsed = prepare(src, repo)
    from tsql.build import emit_unit
    for u, node, body in parsed['view']:
        if node is not None and u['status'] is None:
            emit_unit(tr, 'view', u, node, body)
    stats = collections.Counter()
    lines = []  # comments about what could not be translated
    stmts = []
    why = collections.Counter()
    for script, text in blocks(os.path.join(src, 'db', 'seed', 'seed_ledger.sql')):
        try:
            sql, binds, _into = translate_text(tr, text)
            if binds:
                raise Untranslatable('host variables in a seed statement')
            stmts.append(sql.rstrip().rstrip(';'))
            stats['translated'] += 1
        except (ParseError, LexError, Untranslatable) as ex:
            stats['untranslated'] += 1
            why[str(ex)[:60]] += 1
            lines.append('-- script %d: not translated (%s)' % (script, str(ex)[:100].replace('\n', ' ')))
            lines.extend('-- ' + l for l in text.split('\n')[:6])
        except Exception as ex:  # a translator defect on one statement must not lose the others
            stats['untranslated'] += 1
            why['%s' % type(ex).__name__] += 1
            lines.append('-- script %d: translator error %s' % (script, type(ex).__name__))
            lines.extend('-- ' + l for l in text.split('\n')[:6])
    head = ['-- Seed data translated from the original migration chain (tools/build_seed.py). Generated; do not edit.',
            '-- The statements ran in the order of the original upgrade scripts, against the schema of their time: a statement that fails (a row it',
            '-- needs is inserted later, a column no longer exists) is retried after the others, up to five passes; what never fits is reported.',
            'DO $seed$', 'DECLARE', '  stmts text[] := ARRAY[']
    nl = chr(10)
    body = (',' + nl).join('    $q$' + s + '$q$' for s in stmts)
    tail = ['  ];', '  pending text[] := stmts;', '  failed text[] := ARRAY[]::text[];', '  s text;', '  applied int := 0;', 'BEGIN',
            '  FOR pass IN 1..5 LOOP', '    failed := ARRAY[]::text[];', '    FOREACH s IN ARRAY pending LOOP', '      BEGIN', '        EXECUTE s;',
            '        applied := applied + 1;', '      EXCEPTION WHEN OTHERS THEN', '        failed := failed || s;', '      END;', '    END LOOP;',
            '    EXIT WHEN cardinality(failed) = 0 OR cardinality(failed) = cardinality(pending);', '    pending := failed;', '  END LOOP;',
            "  RAISE WARNING 'seed: % statements applied, % did not fit the schema', applied, cardinality(failed);",
            '  FOREACH s IN ARRAY failed LOOP', "    RAISE WARNING 'seed skipped: %', left(regexp_replace(s, '[[:space:]]+', ' ', 'g'), 140);", '  END LOOP;', 'END', '$seed$;']
    notes = [(l if l.startswith('--') else '-- ' + l) for l in lines]
    text = nl.join(head) + nl + body + nl + nl.join(tail) + nl + (nl.join(notes) + nl if notes else '')
    open(out, 'w', encoding='utf-8', newline=nl).write(text)
    print(dict(stats))
    for k, v in why.most_common(12):
        print(v, k)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else os.path.join(sys.argv[2], 'db', 'pg', '90_seed.sql'))
