"""Identifier policy shared by every T-SQL -> PostgreSQL converter.
SQL Server (default collation) is case-insensitive about identifiers, PostgreSQL folds unquoted names to lower case.
Policy: every identifier is lower-cased; it is double-quoted only when PostgreSQL would not accept it bare."""
import re, json, os

RESERVED = set('''all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column
concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp current_user
default deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in initially inner
intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on only or order
outer overlaps placing primary references returning right select session_user similar some symmetric system_user table tablesample then
to trailing true union unique user using variadic verbose when where window with'''.split())

_BARE = re.compile(r'^[a-z_][a-z0-9_$]*$')


def ident(name):
    n = name.strip().strip('[]"').strip().lower()
    if _BARE.match(n) and n not in RESERVED:
        return n
    return '"%s"' % n.replace('"', '""')


def export_json(path):
    json.dump({'reserved': sorted(RESERVED)}, open(path, 'w'), indent=1)


if __name__ == '__main__':
    export_json(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'pg_reserved.json'))
