"""Patches of the translated statement catalog (data/sql/statements.json) for SQL Server semantics measured on the
original's engine.  Idempotent: run it after any regeneration of the catalog.

usage: python -I tools/tsql/catalog_patches.py [--repo .] [--check]

1. CONVERT(varchar, datetime, 0 | 100 | 9 | 109 | 126 | 127): to_char -> dbo.tsql_convert_dt (blank-padded day and hour).
2. Name lookups `name = :typed` compare like SQL Server: trailing blanks do not count ('A' = 'A ', ANSI padding), so a
   value stored with a trailing blank - 1 of the 9 user names, 1,332 item names and 31 account names on the reference
   database - is still found by the login, the password change and the duplicate-name checks of the entry windows.
   Only `<name column> = $n` predicates are rewritten (rtrim both sides, case-insensitive as before); the tables are
   master data, so the lost index use does not matter.
The file keeps its compact serialisation (json.dumps(..., ensure_ascii=False)).
"""
import argparse
import json
import os
import re
import sys

STYLES = {"'Mon DD YYYY HH12:MIAM'": 0, "'Mon DD YYYY HH12:MI:SS:MSAM'": 9, "'YYYY-MM-DD\"T\"HH24:MI:SS.MS'": 126}

COL = r'(?:\w+\.)?(?:username|name|aliasname|login)'
NAME_EQ = re.compile(r'\((\(lower\(%s\)\)::citext|lower\(%s\)|%s) = (\$\d+)\)' % (COL, COL, COL))


def convert_styles(sql):
    """to_char(x, '<style 0/9/126 format>') -> dbo.tsql_convert_dt((x)::timestamp, style), parentheses and literals aware"""
    out, i, n = [], 0, 0
    while True:
        j = sql.find('to_char(', i)
        if j < 0:
            out.append(sql[i:])
            return ''.join(out), n
        k, depth, comma, quoted = j + len('to_char('), 1, -1, False
        while k < len(sql) and depth:
            c = sql[k]
            if quoted:
                if c == "'":
                    if k + 1 < len(sql) and sql[k + 1] == "'":
                        k += 1
                    else:
                        quoted = False
            elif c == "'":
                quoted = True
            elif c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0:
                    break
            elif c == ',' and depth == 1:
                comma = k
            k += 1
        fmt = sql[comma + 1:k].strip() if comma > 0 else ''
        if fmt in STYLES:
            arg = sql[j + len('to_char('):comma].strip()
            out.append(sql[i:j] + 'dbo.tsql_convert_dt((%s)::timestamp, %d)' % (arg, STYLES[fmt]))
            i, n = k + 1, n + 1
        else:
            out.append(sql[i:j + len('to_char(')])
            i = j + len('to_char(')


def pad_equality(sql):
    return NAME_EQ.subn(lambda m: '(rtrim(%s)::citext = rtrim(%s)::citext)' % (m.group(1), m.group(2)), sql)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('--check', action='store_true', help='fail when a patch would still change the catalog')
    a = ap.parse_args()
    path = os.path.join(a.repo, 'data', 'sql', 'statements.json')
    data = json.load(open(path, encoding='utf-8'))
    counts = {'convert': 0, 'pad': 0}
    for r in data:
        t = r.get('translated')
        if not isinstance(t, str):
            continue
        t, n = convert_styles(t)
        counts['convert'] += n
        t, n = pad_equality(t)
        counts['pad'] += n
        r['translated'] = t
    print('CONVERT styles rewritten: %(convert)d, name comparisons rewritten: %(pad)d' % counts)
    if a.check:
        sys.exit(1 if any(counts.values()) else 0)
    if any(counts.values()):
        open(path, 'w', encoding='utf-8', newline='').write(json.dumps(data, ensure_ascii=False))


if __name__ == '__main__':
    main()
