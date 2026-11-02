"""Type model shared by the translator.

cls (coarse static type)   S string  I integer  N numeric/float  D date/time  B binary  O other (uuid, bool)  U unknown
"""
import re
import os

# T-SQL type name -> (cls, pg base)
TYPE_MAP = {
    'int': ('I', 'integer'), 'integer': ('I', 'integer'), 'smallint': ('I', 'smallint'), 'tinyint': ('I', 'smallint'),
    'bigint': ('I', 'bigint'), 'bit': ('I', 'smallint'),
    'numeric': ('N', 'numeric'), 'decimal': ('N', 'numeric'), 'dec': ('N', 'numeric'),
    'money': ('N', 'numeric(19,4)'), 'smallmoney': ('N', 'numeric(10,4)'),
    'float': ('N', 'double precision'), 'real': ('N', 'real'),
    'datetime': ('D', 'timestamp(3)'), 'smalldatetime': ('D', 'timestamp(0)'), 'date': ('D', 'date'), 'time': ('D', 'time'),
    'datetime2': ('D', 'timestamp(6)'),
    'char': ('S', 'citext'), 'varchar': ('S', 'citext'), 'nchar': ('S', 'citext'), 'nvarchar': ('S', 'citext'),
    'text': ('S', 'citext'), 'ntext': ('S', 'citext'), 'sysname': ('S', 'citext'), 'character': ('S', 'citext'),
    'image': ('B', 'bytea'), 'binary': ('B', 'bytea'), 'varbinary': ('B', 'bytea'), 'timestamp': ('B', 'bytea'),
    'uniqueidentifier': ('O', 'uuid'), 'sql_variant': ('U', 'text'), 'cursor': ('O', 'refcursor'),
}


def map_type(node_or_name, args=None, keep_precision=True):
    """T-SQL type -> (cls, pg type text)"""
    if hasattr(node_or_name, 'name'):
        name, args = node_or_name.name, node_or_name.args
    else:
        name = node_or_name
    name = name.lower()
    cls, base = TYPE_MAP.get(name, ('U', None))
    if base is None:
        return ('U', 'text')
    args = args or []
    if name in ('numeric', 'decimal', 'dec'):
        if args and keep_precision:
            p = args[0]
            s = args[1] if len(args) > 1 else '0'
            return ('N', 'numeric(%s,%s)' % (p, s))
        return ('N', 'numeric')
    return (cls, base)


PG_CLS = [('citext', 'S'), ('text', 'S'), ('character', 'S'), ('smallint', 'I'), ('integer', 'I'), ('bigint', 'I'),
          ('numeric', 'N'), ('double', 'N'), ('real', 'N'), ('timestamp', 'D'), ('date', 'D'), ('time', 'D'),
          ('bytea', 'B'), ('uuid', 'O')]


def pg_cls(pgtype):
    t = pgtype.lower()
    for k, c in PG_CLS:
        if t.startswith(k):
            return c
    return 'U'


class Col:
    __slots__ = ('name', 'pg', 'cls', 'identity', 'nullable')

    def __init__(self, name, pg, cls, identity=False, nullable=True):
        self.name, self.pg, self.cls, self.identity, self.nullable = name, pg, cls, identity, nullable


class Table:
    def __init__(self, name, cols):
        self.name = name
        self.cols = cols
        self.by = {c.name.lower(): c for c in cols}

    def cls_of(self, col):
        c = self.by.get(col.lower())
        return c.cls if c else None


_COL = re.compile(r'^\s+("?[\w$]+"?)\s+((?:double precision|[a-z]+)(?:\(\d+(?:,\d+)?\))?)(.*)$')


def load_tables(ddl_path):
    """parse db/pg/10_tables.sql (the lead's converter output) -> {lower table name: Table}"""
    tables = {}
    if not os.path.exists(ddl_path):
        return tables
    cur = None
    for line in open(ddl_path, encoding='utf-8'):
        m = re.match(r'CREATE TABLE dbo\.("?[\w$]+"?) \(', line)
        if m:
            cur = (m.group(1).strip('"'), [])
            continue
        if cur is None:
            continue
        if line.startswith(');'):
            tables[cur[0].lower()] = Table(cur[0], cur[1])
            cur = None
            continue
        s = line.lstrip()
        if s.startswith('CONSTRAINT'):
            continue
        m = _COL.match(line)
        if m:
            nm, ty, rest = m.groups()
            cur[1].append(Col(nm.strip('"'), ty, pg_cls(ty), 'GENERATED' in rest, 'NOT NULL' not in rest))
    return tables
