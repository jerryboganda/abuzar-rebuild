"""Convert the recovered SQL Server schema (tables, foreign keys, indexes) to PostgreSQL.
usage: python -I tsql2pg_ddl.py <src schema dir> <out dir>
Outputs 00_init.sql 10_tables.sql 20_foreign_keys.sql 30_indexes.sql conversion-report.json"""
import re, sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pgnames import ident

SIMPLE = {
    'tinyint': 'smallint', 'smallint': 'smallint', 'int': 'integer', 'bigint': 'bigint', 'bit': 'smallint',
    'datetime': 'timestamp(3)', 'smalldatetime': 'timestamp(0)', 'date': 'date', 'time': 'time',
    'money': 'numeric(19,4)', 'smallmoney': 'numeric(10,4)', 'float': 'double precision', 'real': 'real',
    'image': 'bytea', 'text': 'citext', 'ntext': 'citext', 'uniqueidentifier': 'uuid',
    'binary': 'bytea', 'varbinary': 'bytea', 'timestamp': 'bytea', 'sysname': 'citext',
    'char': 'citext', 'varchar': 'citext', 'nchar': 'citext', 'nvarchar': 'citext',
}
ctr = collections.Counter()


def map_type(t):
    m = re.match(r'(\w+)(?:\((\d+)(?:,(\d+))?\))?$', t.strip())
    if not m:
        raise ValueError('type ' + t)
    base, a, b = m.group(1).lower(), m.group(2), m.group(3)
    ctr[base] += 1
    if base in ('numeric', 'decimal'):
        return 'numeric(%s,%s)' % (a, b or '0') if a else 'numeric'
    if base in SIMPLE:
        return SIMPLE[base]
    raise ValueError('unmapped type ' + t)


def balanced(s):
    d = 0
    for c in s:
        d += (c == '(') - (c == ')')
        if d < 0:
            return False
    return d == 0


def split_top(s, sep=','):
    out, depth, cur, q = [], 0, [], False
    for ch in s:
        if ch == "'":
            q = not q
        if not q:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif ch == sep and depth == 0:
                out.append(''.join(cur))
                cur = []
                continue
        cur.append(ch)
    if ''.join(cur).strip():
        out.append(''.join(cur))
    return out


def conv_expr(e, pgtype=None):
    """T-SQL scalar default / check expression -> PostgreSQL"""
    e = e.strip()
    while e.startswith('(') and e.endswith(')') and balanced(e[1:-1]):
        e = e[1:-1].strip()
    e = re.sub(r'\bgetdate\(\)', 'localtimestamp(3)', e, flags=re.I)
    e = re.sub(r'\bgetutcdate\(\)', "(now() at time zone 'utc')", e, flags=re.I)
    e = re.sub(r'localtimestamp\(3\)\s*\+\s*(\d+)', r"localtimestamp(3) + interval '\1 day'", e)
    e = re.sub(r'localtimestamp\(3\)\s*-\s*(\d+)', r"localtimestamp(3) - interval '\1 day'", e)
    e = re.sub(r'\bisnull\(', 'coalesce(', e, flags=re.I)
    e = re.sub(r'\[([^\]]+)\]', lambda m: ident(m.group(1)), e)
    if pgtype == 'citext' and re.fullmatch(r'-?\d+(\.\d+)?', e):
        e = "'%s'" % e
    if pgtype and pgtype.startswith('timestamp') and re.fullmatch(r'-?\d+', e):
        e = "timestamp '1900-01-01' + interval '%s day'" % e
    if pgtype == 'smallint' and e.lower() in ("'y'", "'n'"):
        e = '1' if e.lower() == "'y'" else '0'
    return e


def parse_tables(sql):
    tables = []
    for blk in re.split(r'^GO\s*$', sql, flags=re.M):
        m = re.search(r'CREATE TABLE \[(\w+)\]\.\[([^\]]+)\]\s*\((.*)\)\s*;?\s*$', blk, re.S)
        if not m:
            continue
        cols, cons = [], []
        for line in split_top(m.group(3)):
            line = line.strip()
            if re.match(r'(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK)\b', line, re.I):
                cons.append(line)
                continue
            cm = re.match(r'\[([^\]]+)\]\s+(\w+(?:\(\d+(?:,\d+)?\))?)\s*(.*)$', line, re.S)
            if not cm:
                raise ValueError('column line: ' + line)
            cols.append((cm.group(1), cm.group(2), cm.group(3)))
        tables.append((m.group(1), m.group(2), cols, cons))
    return tables


class Names:
    """PostgreSQL index / constraint names live in one schema-wide namespace (SQL Server: per table)"""

    def __init__(self):
        self.used = set()
        self.renamed = []

    def uniq(self, name, table):
        key = ident(name).strip('"')
        if key in self.used:
            key = '%s_%s' % (key, table.lower())
            self.renamed.append((name, key))
        self.used.add(key)
        return ident(key)


def default_of(rest, pt):
    i = rest.upper().find('DEFAULT')
    if i < 0:
        return ''
    j = rest.find('(', i)
    depth, k = 0, j
    while k < len(rest):
        depth += (rest[k] == '(') - (rest[k] == ')')
        k += 1
        if depth == 0:
            break
    return ' DEFAULT ' + conv_expr(rest[j:k], pt)


def convert_tables(sql, names, report):
    out = []
    for schema, tname, cols, cons in parse_tables(sql):
        t = ident(tname)
        names.used.add(t.strip('"'))
        lines = []
        for cname, ctype, rest in cols:
            pt = map_type(ctype)
            im = re.search(r'IDENTITY\((\d+),(\d+)\)', rest, re.I)
            null = 'NOT NULL' if 'NOT NULL' in rest.upper() else 'NULL'
            d = default_of(rest, pt)
            idn = ''
            if im:
                idn = ' GENERATED BY DEFAULT AS IDENTITY'
                if im.groups() != ('1', '1'):
                    idn += ' (START WITH %s INCREMENT BY %s)' % im.groups()
                report['identity'] += 1
            lines.append('    %s %s%s %s%s' % (ident(cname), pt, idn, null, d))
            report['columns'] += 1
        for c in cons:
            c = re.sub(r'\b(NON)?CLUSTERED\b', '', c, flags=re.I)
            m = re.match(r'CONSTRAINT \[([^\]]+)\]\s+(PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)', c, re.I)
            if m:
                cl = ', '.join(ident(x) for x in m.group(3).split(','))
                lines.append('    CONSTRAINT %s %s (%s)' % (names.uniq(m.group(1), tname), m.group(2).upper(), cl))
                report['pk' if m.group(2).upper().startswith('P') else 'unique'] += 1
                continue
            m = re.match(r'CONSTRAINT \[([^\]]+)\]\s+CHECK\s*(\(.*\))\s*$', c, re.I | re.S)
            if m:
                lines.append('    CONSTRAINT %s CHECK %s' % (names.uniq(m.group(1), tname), conv_expr(m.group(2))))
                report['check'] += 1
                continue
            raise ValueError('constraint: ' + c)
        out.append('CREATE TABLE dbo.%s (\n%s\n);\n' % (t, ',\n'.join(lines)))
        report['tables'] += 1
    return '\n'.join(out)


FK = re.compile(r'ALTER TABLE \[(\w+)\]\.\[([^\]]+)\] ADD CONSTRAINT \[([^\]]+)\] FOREIGN KEY \(([^)]*)\) REFERENCES \[(\w+)\]\.\[([^\]]+)\] \(([^)]*)\)(.*?);', re.S)


def convert_fks(sql, names, report):
    out = []
    for m in FK.finditer(sql):
        _, t, nm, cols, _, rt, rcols, tail = m.groups()
        cl = ', '.join(ident(x) for x in cols.split(','))
        rcl = ', '.join(ident(x) for x in rcols.split(','))
        extra = ''
        if re.search(r'ON DELETE CASCADE', tail, re.I):
            extra += ' ON DELETE CASCADE'
        if re.search(r'ON UPDATE CASCADE', tail, re.I):
            extra += ' ON UPDATE CASCADE'
        # FK names are per table in PostgreSQL too, so no renaming is needed
        out.append('ALTER TABLE dbo.%s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES dbo.%s (%s)%s;' % (ident(t), ident(nm), cl, ident(rt), rcl, extra))
        report['fk'] += 1
    return '\n'.join(out) + '\n'


IDX = re.compile(r'CREATE\s+(UNIQUE\s+)?(?:NONCLUSTERED\s+|CLUSTERED\s+)?INDEX \[([^\]]+)\] ON \[(\w+)\]\.\[([^\]]+)\] \(([^)]*)\)(.*?);', re.S)


def convert_indexes(sql, names, report):
    out = []
    for m in IDX.finditer(sql):
        uq, nm, _, t, cols, tail = m.groups()
        parts = []
        for x in cols.split(','):
            x = x.strip()
            desc = bool(re.search(r'\bDESC$', x, re.I))
            parts.append(ident(re.sub(r'\s+(ASC|DESC)$', '', x, flags=re.I)) + (' DESC' if desc else ''))
        out.append('CREATE %sINDEX %s ON dbo.%s (%s);' % ('UNIQUE ' if uq else '', names.uniq(nm, t), ident(t), ', '.join(parts)))
        report['index'] += 1
    return '\n'.join(out) + '\n'


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    report = collections.Counter()
    names = Names()

    def rd(f):
        return open(os.path.join(src, f), encoding='utf-8', errors='replace').read()

    def wr(f, text):
        open(os.path.join(dst, f), 'w', encoding='utf-8', newline='\n').write(text)

    hdr = 'SET search_path TO dbo, public;\n'
    wr('00_init.sql', '-- citext (contrib) gives case-insensitive text like the SQL Server collation of the original\n'
                      'CREATE EXTENSION IF NOT EXISTS citext;\nCREATE SCHEMA IF NOT EXISTS dbo;\n')
    wr('10_tables.sql', hdr + convert_tables(rd('01_tables.sql'), names, report))
    wr('30_indexes.sql', hdr + convert_indexes(rd('03_indexes.sql'), names, report))
    wr('20_foreign_keys.sql', hdr + convert_fks(rd('02_foreign_keys.sql'), names, report))
    report['renamed_constraints'] = len(names.renamed)
    json.dump({'counts': dict(report), 'types': dict(ctr), 'renamed': names.renamed}, open(os.path.join(dst, 'conversion-report.json'), 'w'), indent=1)
    print(dict(report))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
