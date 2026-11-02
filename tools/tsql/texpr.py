"""Expression and query translation (T-SQL AST -> PostgreSQL text) with coarse static typing.

E(node, scope) -> (sql, cls) ; cls in S I N D B O P(predicate) U
"""
import re
from .parser import Node
from .names import ident, q, fn_ident, shorten
from .schema import map_type, Table, Col, pg_cls


class Untranslatable(Exception):
    pass


NUMERIC = ('I', 'N')


class Scope:
    def __init__(self, parent=None):
        self.parent = parent
        self.items = []     # (alias_lower, Table|None)

    def add(self, alias, table):
        self.items.append((alias.lower() if alias else None, table))

    def lookup(self, qual, col):
        """cls of column or None when not found anywhere"""
        s = self
        col = col.lower()
        while s is not None:
            hit = None
            unknown = False
            for alias, t in s.items:
                if qual is not None and alias != qual:
                    continue
                if t is None:
                    unknown = True
                    continue
                c = t.by.get(col)
                if c is not None:
                    hit = c.cls
                    break
            if hit is not None:
                return hit
            if unknown:
                return 'U'
            s = s.parent
        return None

    def find_identity(self, qual):
        s = self
        while s is not None:
            for alias, t in s.items:
                if qual is not None and alias != qual:
                    continue
                if t is None:
                    continue
                for c in t.cols:
                    if c.identity:
                        return alias, c.name
            s = s.parent
        return None, None

    def table_of(self, qual):
        s = self
        while s is not None:
            for alias, t in s.items:
                if alias == qual:
                    return t
            s = s.parent
        return None


INT_RE = re.compile(r'^-?\d+$')

DATE_PART = {
    'year': 'year', 'yy': 'year', 'yyyy': 'year', 'quarter': 'quarter', 'qq': 'quarter', 'q': 'quarter',
    'month': 'month', 'mm': 'month', 'm': 'month', 'dayofyear': 'dayofyear', 'dy': 'dayofyear', 'y': 'dayofyear',
    'day': 'day', 'dd': 'day', 'd': 'day', 'week': 'week', 'wk': 'week', 'ww': 'week',
    'weekday': 'weekday', 'dw': 'weekday', 'w': 'weekday', 'hour': 'hour', 'hh': 'hour',
    'minute': 'minute', 'mi': 'minute', 'n': 'minute', 'second': 'second', 'ss': 'second', 's': 'second',
    'millisecond': 'millisecond', 'ms': 'millisecond',
}

CONVERT_FMT = {
    0: 'Mon DD YYYY HH12:MIAM', 100: 'Mon DD YYYY HH12:MIAM', 1: 'MM/DD/YY', 101: 'MM/DD/YYYY', 2: 'YY.MM.DD', 102: 'YYYY.MM.DD',
    3: 'DD/MM/YY', 103: 'DD/MM/YYYY', 4: 'DD.MM.YY', 104: 'DD.MM.YYYY', 5: 'DD-MM-YY', 105: 'DD-MM-YYYY',
    6: 'DD Mon YY', 106: 'DD Mon YYYY', 7: 'Mon DD, YY', 107: 'Mon DD, YYYY', 8: 'HH24:MI:SS', 108: 'HH24:MI:SS',
    9: 'Mon DD YYYY HH12:MI:SS:MSAM', 109: 'Mon DD YYYY HH12:MI:SS:MSAM', 10: 'MM-DD-YY', 110: 'MM-DD-YYYY',
    11: 'YY/MM/DD', 111: 'YYYY/MM/DD', 12: 'YYMMDD', 112: 'YYYYMMDD', 13: 'DD Mon YYYY HH24:MI:SS:MS',
    113: 'DD Mon YYYY HH24:MI:SS:MS', 14: 'HH24:MI:SS:MS', 114: 'HH24:MI:SS:MS', 20: 'YYYY-MM-DD HH24:MI:SS',
    120: 'YYYY-MM-DD HH24:MI:SS', 21: 'YYYY-MM-DD HH24:MI:SS.MS', 121: 'YYYY-MM-DD HH24:MI:SS.MS',
    23: 'YYYY-MM-DD', 24: 'HH24:MI:SS', 126: 'YYYY-MM-DD"T"HH24:MI:SS.MS', 127: 'YYYY-MM-DD"T"HH24:MI:SS.MS',
}
DATE_ONLY_STYLES = {1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 23, 101, 102, 103, 104, 105, 106, 107, 110, 111, 112}

AGG = {'sum', 'count', 'avg', 'min', 'max', 'stdev', 'stdevp', 'var', 'varp', 'count_big', 'checksum_agg'}


def is_simple(n):
    return n.k in ('col', 'var', 'lit', 'bind', 'gvar')


def contains_agg(n):
    """does the expression contain an aggregate call (not descending into subqueries)"""
    if isinstance(n, Node):
        if n.k == 'func' and len(n.name) == 1 and n.name[0].lower() in AGG:
            return True
        if n.k in ('sub', 'exists', 'in') and n.k != 'in':
            return False
        for v in n.__dict__.values():
            if contains_agg(v):
                return True
    elif isinstance(n, (list, tuple)):
        for x in n:
            if contains_agg(x):
                return True
    return False


class ExprMixin:
    # ------------------------------------------------------------------ helpers
    def E(self, n, sc):
        m = getattr(self, 'e_' + n.k, None)
        if m is None:
            raise Untranslatable('expression kind ' + n.k)
        return m(n, sc)

    def Es(self, n, sc):
        return self.E(n, sc)[0]

    def sink(self, n, sql, cls):
        """expression flows into a comparison: keep case-insensitive semantics for computed strings"""
        if cls == 'S' and not is_simple(n) and not (n.k == 'paren' and is_simple(n.e)):
            if n.k == 'cast' or n.k == 'convert' or n.k == 'func' or n.k == 'bin' or n.k == 'case' or n.k == 'paren':
                return '(%s)::citext' % sql
        return sql

    def is_str_lit(self, n):
        return n.k == 'lit' and n.t == 'str'

    def is_num_lit(self, n):
        return n.k == 'lit' and n.t == 'num'

    def as_pg_type(self, sql, cls, pgtype):
        return '(%s)::%s' % (sql, pgtype)

    def cmp_operands(self, ln, rn, sc):
        ls, lc = self.E(ln, sc)
        rs, rc = self.E(rn, sc)
        ls, rs = self.coerce_pair(ln, ls, lc, rn, rs, rc)
        return ls, lc, rs, rc

    def coerce_pair(self, ln, ls, lc, rn, rs, rc):
        if lc == 'S' and rc in NUMERIC:
            if self.is_num_lit(rn):
                rs = q(rn.v)
            elif not self.is_str_lit(ln):
                ls = '(%s)::numeric' % ls
        elif rc == 'S' and lc in NUMERIC:
            if self.is_num_lit(ln):
                ls = q(ln.v)
            elif not self.is_str_lit(rn):
                rs = '(%s)::numeric' % rs
        elif lc == 'D' and rc == 'S' and not self.is_str_lit(rn):
            rs = '(%s)::timestamp' % rs
        elif rc == 'D' and lc == 'S' and not self.is_str_lit(ln):
            ls = '(%s)::timestamp' % ls
        elif lc == 'D' and rc in NUMERIC:
            rs = "(timestamp '1900-01-01' + (%s) * interval '1 day')" % rs
        elif rc == 'D' and lc in NUMERIC:
            ls = "(timestamp '1900-01-01' + (%s) * interval '1 day')" % ls
        if lc == 'S' and not ls.endswith(')::numeric') and not ls.endswith(')::timestamp'):
            ls = self.sink(ln, ls, lc)
        if rc == 'S' and not rs.endswith(')::numeric') and not rs.endswith(')::timestamp'):
            rs = self.sink(rn, rs, rc)
        return ls, rs

    # ------------------------------------------------------------------ leaves
    def e_lit(self, n, sc):
        if n.t == 'str':
            return q(self.frag_fix(n.v) if self.dyn_mode else n.v), 'S'
        if n.t == 'null':
            return 'NULL', 'U'
        v = n.v
        if v.lower().startswith('0x') or v.lower().startswith('-0x'):
            return v, 'I'
        if re.fullmatch(r'-?\d+', v):
            return v, 'I'
        return v, 'N'

    def e_odbc(self, n, sc):
        m = re.match(r"\{\s*(ts|d|t)\s+'([^']*)'\s*\}", n.text, re.I)
        if m:
            kind = {'ts': 'timestamp', 'd': 'date', 't': 'time'}[m.group(1).lower()]
            return "%s '%s'" % (kind, m.group(2)), 'D'
        raise Untranslatable('ODBC escape ' + n.text)

    def e_bind(self, n, sc):
        self.binds.append(n.name)
        return '$%d' % len(self.binds), self.bind_cls(n.name)

    def bind_cls(self, name):
        return 'U'

    def e_default(self, n, sc):
        return 'DEFAULT', 'U'

    def e_paren(self, n, sc):
        s, c = self.E(n.e, sc)
        return '(%s)' % s, c

    def e_rawcol(self, n, sc):
        return n.sql, n.cls

    def e_star(self, n, sc):
        if n.q:
            return '%s.*' % '.'.join(ident(x) for x in self.qual_parts(n.q)), 'U'
        return '*', 'U'

    def qual_parts(self, parts):
        parts = [p for p in parts if p != '']
        if len(parts) >= 2 and parts[0].lower() == 'dbo':
            parts = parts[1:]
        out = []
        for p in parts:
            if p.startswith('#') or p.startswith('@'):
                out.append(p.lstrip('#@').lower())
            else:
                out.append(p)
        return out

    def e_var(self, n, sc):
        v = self.lookup_var(n.name)
        return v[0], v[1]

    def e_gvar(self, n, sc):
        g = n.name
        if g == 'rowcount':
            self.ctx.uses_rowcount = True
            return '_rc', 'I'
        if g == 'error':
            return '0', 'I'
        if g == 'fetch_status':
            self.ctx.uses_fetch = True
            return '_fs', 'I'
        if g == 'trancount':
            return '1', 'I'
        if g in ('identity',):
            return 'dbo.tsql_lastident()', 'I'
        if g == 'spid':
            return 'pg_backend_pid()', 'I'
        if g == 'servername':
            return "current_setting('cluster_name', true)", 'S'
        if g == 'version':
            return 'version()', 'S'
        if g == 'language':
            return "'English'", 'S'
        if g in ('nestlevel',):
            return 'pg_trigger_depth()', 'I'
        if g == 'datefirst':
            return '7', 'I'
        if g == 'cursor_rows':
            return '(-1)', 'I'
        raise Untranslatable('@@' + g)

    def e_col(self, n, sc):
        parts = [p for p in n.parts if p != '']
        if len(parts) == 1:
            up = parts[0].upper()
            if up in ('CURRENT_TIMESTAMP',):
                return 'localtimestamp(3)', 'D'
            if up in ('CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER', 'USER'):
                return 'current_user', 'S'
            cls = sc.lookup(None, parts[0])
            return ident(parts[0]), cls or 'U'
        if parts[-1].lower() == 'identitycol':
            qual = parts[-2].lower() if len(parts) >= 2 else None
            alias, colname = sc.find_identity(qual)
            if colname is None:
                raise Untranslatable('IDENTITYCOL of a table without an identity column')
            return (ident(alias) + '.' if alias else '') + ident(colname), 'I'
        pq = self.qual_parts(parts)
        qual = parts[-2].lower() if len(parts) >= 2 else None
        cls = sc.lookup(qual, parts[-1])
        return '.'.join(ident(x) for x in pq), cls or 'U'

    # ------------------------------------------------------------------ operators
    CMP_MAP = {'=': '=', '<>': '<>', '!=': '<>', '<': '<', '>': '>', '<=': '<=', '>=': '>=', '!<': '>=', '!>': '<='}

    def e_bin(self, n, sc):
        op = n.op
        if op in ('AND', 'OR'):
            l = self.Es(n.l, sc)
            r = self.Es(n.r, sc)
            return '(%s %s %s)' % (l, op, r), 'P'
        if op in ('*=', '=*'):
            raise Untranslatable('legacy outer join operator ' + op)
        if op in self.CMP_MAP:
            ls, lc, rs, rc = self.cmp_operands(n.l, n.r, sc)
            return '(%s %s %s)' % (ls, self.CMP_MAP[op], rs), 'P'
        ls, lc = self.E(n.l, sc)
        rs, rc = self.E(n.r, sc)
        if op == '+':
            if (lc == 'S' or rc == 'S') and not (lc == 'S' and self.is_str_lit(n.l) and rc in NUMERIC and False):
                if lc in NUMERIC and rc == 'S' and self.is_str_lit(n.r):
                    return '(%s + (%s)::numeric)' % (ls, rs), 'N'
                if rc in NUMERIC and lc == 'S' and self.is_str_lit(n.l):
                    return '((%s)::numeric + %s)' % (ls, rs), 'N'
                return '(%s || %s)' % (ls, rs), 'S'
            if lc == 'D' and rc != 'D':
                return "(%s + (%s) * interval '1 day')" % (ls, rs), 'D'
            if rc == 'D' and lc != 'D':
                return "(%s + (%s) * interval '1 day')" % (rs, ls), 'D'
            return '(%s + %s)' % (ls, rs), self.promote(lc, rc)
        if op == '-':
            if lc == 'D' and rc == 'D':
                return '(extract(epoch from (%s - %s)) / 86400.0)' % (ls, rs), 'N'
            if lc == 'D':
                return "(%s - (%s) * interval '1 day')" % (ls, rs), 'D'
            return '(%s - %s)' % (ls, rs), self.promote(lc, rc)
        if op in ('*', '/', '%'):
            return '(%s %s %s)' % (ls, op, rs), self.promote(lc, rc)
        if op == '^':
            return '(%s # %s)' % (ls, rs), 'I'
        if op in ('&', '|'):
            return '(%s %s %s)' % (ls, op, rs), 'I'
        raise Untranslatable('operator ' + op)

    def promote(self, a, b):
        if a == 'N' or b == 'N':
            return 'N'
        if a == 'I' and b == 'I':
            return 'I'
        if a in NUMERIC:
            return a if b in ('U',) else a
        if b in NUMERIC:
            return b
        return 'U'

    def e_un(self, n, sc):
        s, c = self.E(n.e, sc)
        if n.op == 'NOT':
            return '(NOT %s)' % s, 'P'
        if n.op == '-':
            return '(-%s)' % s, c
        if n.op == '+':
            return s, c
        if n.op == '~':
            return '(~%s)' % s, 'I'
        raise Untranslatable('unary ' + n.op)

    def e_between(self, n, sc):
        es, ec = self.E(n.e, sc)
        los, loc = self.E(n.lo, sc)
        his, hic = self.E(n.hi, sc)
        es2, los = self.coerce_pair(n.e, es, ec, n.lo, los, loc)
        es3, his = self.coerce_pair(n.e, es, ec, n.hi, his, hic)
        return '(%s %sBETWEEN %s AND %s)' % (es2, 'NOT ' if n.neg else '', los, his), 'P'

    def e_in(self, n, sc):
        es, ec = self.E(n.e, sc)
        es = self.sink(n.e, es, ec)
        if n.sub is not None:
            sub = self.select_sql(n.sub, sc)
            return '(%s %sIN (%s))' % (es, 'NOT ' if n.neg else '', sub), 'P'
        items = []
        for it in n.items:
            s, c = self.E(it, sc)
            if ec == 'S' and c in NUMERIC and self.is_num_lit(it):
                s = q(it.v)
            elif ec in NUMERIC and c == 'S' and not self.is_str_lit(it):
                s = '(%s)::numeric' % s
            else:
                s = self.sink(it, s, c)
            items.append(s)
        return '(%s %sIN (%s))' % (es, 'NOT ' if n.neg else '', ', '.join(items)), 'P'

    def e_like(self, n, sc):
        es, ec = self.E(n.e, sc)
        if ec in NUMERIC or ec == 'D':
            es = '(%s)::text' % es
        else:
            es = self.sink(n.e, es, ec)
        if self.is_str_lit(n.pat) and '[' in n.pat.v and n.esc is None:
            rx = self.like_to_regex(n.pat.v)
            return '(%s %s %s)' % (es, '!~*' if n.neg else '~*', q(rx)), 'P'
        ps, pc = self.E(n.pat, sc)
        ps = self.sink(n.pat, ps, pc)
        s = '(%s %sLIKE %s' % (es, 'NOT ' if n.neg else '', ps)
        if n.esc is not None:
            s += ' ESCAPE ' + self.Es(n.esc, sc)
        return s + ')', 'P'

    def like_to_regex(self, pat):
        out = ['^']
        i = 0
        while i < len(pat):
            c = pat[i]
            if c == '[':
                j = pat.find(']', i + 1)
                if j < 0:
                    raise Untranslatable('LIKE pattern')
                out.append('[' + pat[i + 1:j] + ']')
                i = j + 1
                continue
            if c == '%':
                out.append('.*')
            elif c == '_':
                out.append('.')
            elif c in '.^$*+?(){}|\\':
                out.append('\\' + c)
            else:
                out.append(c)
            i += 1
        out.append('$')
        return ''.join(out)

    def e_isnull(self, n, sc):
        es, ec = self.E(n.e, sc)
        return '(%s IS %sNULL)' % (es, 'NOT ' if n.neg else ''), 'P'

    def e_exists(self, n, sc):
        return 'EXISTS (%s)' % self.select_sql(n.sel, sc), 'P'

    def e_sub(self, n, sc):
        sql, cols = self.select_full(n.sel, sc)
        cls = cols[0][1] if cols else 'U'
        return '(%s)' % sql, cls

    def e_quant(self, n, sc):
        ls, lc = self.E(n.l, sc)
        sub = self.select_sql(n.sel, sc)
        return '(%s %s %s (%s))' % (ls, self.CMP_MAP.get(n.op, n.op), 'ANY' if n.q == 'SOME' else n.q, sub), 'P'

    def e_case(self, n, sc):
        parts = ['CASE']
        cls = 'U'
        opn = None
        if n.operand is not None:
            os_, oc = self.E(n.operand, sc)
            os_ = self.sink(n.operand, os_, oc)
            parts.append(os_)
            opn = (n.operand, oc)
        for c, r in n.whens:
            if opn is None:
                cs = self.Es(c, sc)
            else:
                cs, cc = self.E(c, sc)
                if opn[1] == 'S' and cc in NUMERIC and self.is_num_lit(c):
                    cs = q(c.v)
                else:
                    cs = self.sink(c, cs, cc)
            rs, rc = self.E(r, sc)
            if cls == 'U' and rc not in ('U',):
                cls = rc
            parts.append('WHEN %s THEN %s' % (cs, rs))
        if n.els is not None:
            es, ec = self.E(n.els, sc)
            if cls == 'U' and ec != 'U':
                cls = ec
            parts.append('ELSE ' + es)
        parts.append('END')
        return ' '.join(parts), cls

    # ------------------------------------------------------------------ CAST / CONVERT
    def e_cast(self, n, sc):
        return self.conv(n.type, n.e, None, sc)

    def e_convert(self, n, sc):
        return self.conv(n.type, n.e, n.style, sc)

    def style_val(self, style):
        if style is None:
            return None
        if style.k == 'lit' and style.t == 'num' and INT_RE.match(style.v):
            return int(style.v)
        return None

    def conv(self, ty, e, style, sc):
        cls, pg = map_type(ty)
        sv = self.style_val(style)
        tname = ty.name
        # CONVERT(datetime, CONVERT(varchar, X, <date-only style>))  ->  date_trunc('day', X)
        if cls == 'D' and e.k in ('convert', 'cast', 'paren'):
            inner = e.e if e.k == 'paren' else e
            if inner.k in ('convert', 'cast'):
                icls, _ = map_type(inner.type)
                istyle = self.style_val(getattr(inner, 'style', None))
                ilen = int(inner.type.args[0]) if inner.type.args and inner.type.args[0].isdigit() else None
                if icls == 'S' and istyle is not None and (istyle in DATE_ONLY_STYLES or (istyle in (20, 21, 120, 121, 126) and ilen is not None and ilen <= 10)):
                    xs, xc = self.E(inner.e, sc)
                    if xc != 'D':
                        xs = '(%s)::timestamp' % xs
                    res = "date_trunc('day', %s)" % xs
                    if tname == 'date':
                        res = '(%s)::date' % res
                    elif tname == 'smalldatetime':
                        res = '(%s)::timestamp(0)' % res
                    else:
                        res = '(%s)::timestamp(3)' % res
                    return res, 'D'
        s, c = self.E(e, sc)
        if cls == 'S':
            ln = None
            if ty.args and ty.args[0].isdigit():
                ln = int(ty.args[0])
            if c == 'D':
                fmt = CONVERT_FMT.get(sv if sv is not None else 0)
                if fmt is None:
                    raise Untranslatable('CONVERT style %r' % (sv,))
                r = "to_char(%s, '%s')" % (s, fmt)
            elif c in NUMERIC:
                if sv in (1, 2) and c == 'N':
                    r = "to_char(%s, 'FM999,999,999,999,990.%s')" % (s, '00' if sv == 1 else '0000') if sv == 1 else "(%s)::text" % s
                else:
                    r = '(%s)::text' % s
            elif c == 'S':
                r = s
            else:
                r = '(%s)::text' % s
            if ln is not None and c in ('S', 'D', 'U') and ln < 4000:
                r = 'left(%s, %d)' % (r, ln)
            return r, 'S'
        if cls == 'I':
            if tname == 'bit':
                return 'CASE WHEN (%s) <> 0 THEN 1 ELSE 0 END' % s, 'I'
            if c == 'N':
                return 'trunc(%s)::%s' % (s, pg), 'I'
            if c == 'D':
                return '((%s)::date - date \'1900-01-01\')' % s, 'I'
            if c == 'S' and not self.is_str_lit(e):
                return '(trunc((%s)::numeric))::%s' % (s, pg), 'I'
            return '(%s)::%s' % (s, pg), 'I'
        if cls == 'N':
            return '(%s)::%s' % (s, pg), 'N'
        if cls == 'D':
            if c in NUMERIC:
                return "(timestamp '1900-01-01' + (%s) * interval '1 day')" % s, 'D'
            if c == 'S' and sv is not None and sv in CONVERT_FMT and not self.is_str_lit(e) or (c == 'S' and sv is not None and sv in CONVERT_FMT and sv not in (0, 100, 20, 120, 21, 121, 23, 126, 127)):
                return "to_timestamp(%s, '%s')::%s" % (s, CONVERT_FMT[sv], pg), 'D'
            return '(%s)::%s' % (s, pg), 'D'
        if cls == 'B':
            return '(%s)::bytea' % s, 'B'
        if cls == 'O':
            return '(%s)::%s' % (s, pg), 'O'
        return '(%s)::%s' % (s, pg), 'U'

    # ------------------------------------------------------------------ function calls
    def e_func(self, n, sc):
        parts = [p for p in n.name if p != '']
        lname = parts[-1].lower()
        if len(parts) == 1 and lname in self.catalog_funcs() and lname not in self.BUILTIN_FIRST:
            return self.call_udf(lname, n.args, sc)
        if len(parts) >= 2:
            if parts[0].lower() == 'dbo' and len(parts) == 2:
                return self.call_udf(lname, n.args, sc)
            raise Untranslatable('cross-database function ' + '.'.join(parts))
        h = getattr(self, 'fn_' + lname, None)
        if h is not None:
            return h(n, sc)
        if lname in AGG:
            return self.agg(n, sc)
        if lname in self.catalog_funcs():
            return self.call_udf(lname, n.args, sc)
        raise Untranslatable('function ' + parts[-1])

    BUILTIN_FIRST = set()

    def catalog_funcs(self):
        return self.catalog.funcs

    def call_udf(self, lname, args, sc):
        sig = self.catalog.funcs.get(lname)
        out = []
        for i, a in enumerate(args):
            s, c = self.E(a, sc)
            if sig is not None and i < len(sig.params):
                s = self.coerce_to(a, s, c, sig.params[i].pgtype, sig.params[i].cls)
            out.append(s)
        ret = sig.ret_cls if sig is not None else 'U'
        return '%s(%s)' % (fn_ident(lname), ', '.join(out)), ret

    def coerce_to(self, node, s, c, pgtype, pcls):
        """argument -> declared parameter type (needed: text -> citext is only an assignment cast)"""
        if node.k == 'default' or (node.k == 'lit' and node.t in ('str', 'null')):
            return s
        base = re.sub(r'\(.*\)', '', pgtype or '')
        if not base:
            return s
        if node.k == 'var':
            v = self.ctx.vars.get('@' + node.name.lower())
            if v and re.sub(r'\(.*\)', '', v[2]) == base:
                return s
        if node.k == 'lit' and node.t == 'num':
            if (base == 'integer' and c == 'I') or (base == 'numeric' and c == 'N'):
                return s
        if c == 'N' and base in ('smallint', 'integer', 'bigint'):
            return 'trunc(%s)::%s' % (s, base)
        return '(%s)::%s' % (s, base)

    def coerce_col(self, e, s, c, col):
        """expression assigned to a table column (INSERT ... SELECT / VALUES / UPDATE SET): T-SQL converts implicitly,
        PostgreSQL needs an explicit cast for string -> number/date and for typeless NULLs inside UNIONs"""
        if col is None or not col.pg:
            return s
        pcls, pg = col.cls, col.pg
        if e.k == 'lit' and e.t == 'null':
            return 'NULL::%s' % pg
        if c == 'S' and pcls in ('I', 'N'):
            if e.k == 'lit' and e.t == 'str' and e.v.strip() == '':
                return '0'
            return '(%s)::%s' % (s, pg)
        if c == 'S' and pcls == 'D':
            if e.k == 'lit' and e.t == 'str' and e.v.strip() == '':
                return "timestamp '1900-01-01'"
            return '(%s)::%s' % (s, pg)
        if c == 'N' and pcls == 'I':
            return 'trunc(%s)::%s' % (s, pg)
        return s

    def args_sql(self, n, sc):
        return [self.E(a, sc) for a in n.args]

    def agg(self, n, sc):
        lname = n.name[-1].lower()
        pgname = {'stdev': 'stddev_samp', 'stdevp': 'stddev_pop', 'var': 'var_samp', 'varp': 'var_pop',
                  'count_big': 'count'}.get(lname, lname)
        if lname == 'checksum_agg':
            raise Untranslatable('CHECKSUM_AGG')
        if not n.args:
            raise Untranslatable('aggregate without argument')
        a = n.args[0]
        if a.k == 'star':
            return '%s(*)' % pgname, 'I'
        s, c = self.E(a, sc)
        d = 'DISTINCT ' if n.distinct else ''
        if lname in ('sum', 'avg') and c == 'S':
            s = '(%s)::numeric' % s
            c = 'N'
        if lname in ('min', 'max') and c == 'S':
            pass
        cls = {'count': 'I', 'count_big': 'I', 'avg': 'N'}.get(lname, c)
        if lname in ('stdev', 'stdevp', 'var', 'varp'):
            cls = 'N'
        return '%s(%s%s)' % (pgname, d, s), cls

    def a2(self, n, sc, k=None):
        if k is not None and len(n.args) != k:
            raise Untranslatable('%s expects %d args' % (n.name[-1], k))
        return [self.E(a, sc) for a in n.args]

    # --- null handling
    def fn_isnull(self, n, sc):
        if len(n.args) != 2:
            raise Untranslatable('ISNULL arity')
        (a, ac), (b, bc) = self.a2(n, sc)
        if ac == 'S' and bc in NUMERIC and self.is_num_lit(n.args[1]):
            b = q(n.args[1].v)
        elif ac in NUMERIC and self.is_str_lit(n.args[1]) and n.args[1].v.strip() == '':
            b = '0'
        elif ac == 'D' and bc in NUMERIC:
            b = "(timestamp '1900-01-01' + (%s) * interval '1 day')" % b
        elif ac in NUMERIC and bc == 'S' and not self.is_str_lit(n.args[1]):
            b = '(%s)::numeric' % b
        return 'coalesce(%s, %s)' % (a, b), (ac if ac != 'U' else bc)

    def fn_coalesce(self, n, sc):
        r = self.a2(n, sc)
        cls = next((c for s, c in r if c != 'U'), 'U')
        out = []
        for (s, c), a in zip(r, n.args):
            if cls == 'S' and c in NUMERIC and self.is_num_lit(a):
                s = q(a.v)
            out.append(s)
        return 'coalesce(%s)' % ', '.join(out), cls

    def fn_nullif(self, n, sc):
        (a, ac), (b, bc) = self.a2(n, sc, 2)
        a, b = self.coerce_pair(n.args[0], a, ac, n.args[1], b, bc)
        return 'nullif(%s, %s)' % (a, b), ac

    def fn_iif(self, n, sc):
        c = self.Es(n.args[0], sc)
        (a, ac), (b, bc) = self.E(n.args[1], sc), self.E(n.args[2], sc)
        return 'CASE WHEN %s THEN %s ELSE %s END' % (c, a, b), ac if ac != 'U' else bc

    # --- strings
    def fn_len(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'length(rtrim((%s)::text))' % a if c != 'S' else 'length(rtrim(%s))' % a, 'I'

    def fn_datalength(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'octet_length(%s)' % a, 'I'

    def fn_left(self, n, sc):
        (a, c), (b, bc) = self.a2(n, sc, 2)
        return 'left(%s, %s)' % (self.str_arg(a, c), self.int_arg(b, bc)), 'S'

    def fn_right(self, n, sc):
        (a, c), (b, bc) = self.a2(n, sc, 2)
        return 'right(%s, %s)' % (self.str_arg(a, c), self.int_arg(b, bc)), 'S'

    def str_arg(self, s, c):
        return '(%s)::text' % s if c in NUMERIC or c == 'D' else s

    def int_arg(self, s, c):
        return 'trunc(%s)::integer' % s if c == 'N' else s

    def fn_substring(self, n, sc):
        if len(n.args) != 3:
            raise Untranslatable('SUBSTRING arity')
        (a, c), (b, bc), (d, dc) = self.a2(n, sc)
        return 'substring(%s, %s, %s)' % (self.str_arg(a, c), self.int_arg(b, bc), self.int_arg(d, dc)), 'S'

    def fn_charindex(self, n, sc):
        r = self.a2(n, sc)
        if len(r) == 2:
            (a, ac), (b, bc) = r
            return 'strpos((%s)::citext, (%s)::citext)' % (self.str_arg(b, bc), self.str_arg(a, ac)), 'I'
        (a, ac), (b, bc), (st, sc_) = r
        return 'dbo.tsql_charindex((%s)::citext, (%s)::citext, %s)' % (self.str_arg(a, ac), self.str_arg(b, bc), self.int_arg(st, sc_)), 'I'

    def fn_patindex(self, n, sc):
        (a, ac), (b, bc) = self.a2(n, sc, 2)
        return 'dbo.tsql_patindex(%s, %s)' % (a, self.str_arg(b, bc)), 'I'

    def fn_replace(self, n, sc):
        (a, ac), (b, bc), (c, cc) = self.a2(n, sc, 3)
        return 'replace((%s)::citext, (%s)::citext, (%s)::citext)' % (self.str_arg(a, ac), b, c), 'S'

    def fn_replicate(self, n, sc):
        (a, ac), (b, bc) = self.a2(n, sc, 2)
        return 'repeat(%s, %s)' % (self.str_arg(a, ac), self.int_arg(b, bc)), 'S'

    def fn_space(self, n, sc):
        (a, ac), = self.a2(n, sc, 1)
        return "repeat(' ', %s)" % self.int_arg(a, ac), 'S'

    def fn_reverse(self, n, sc):
        (a, ac), = self.a2(n, sc, 1)
        return 'reverse(%s)' % self.str_arg(a, ac), 'S'

    def fn_str(self, n, sc):
        r = self.a2(n, sc)
        args = ['(%s)::numeric' % r[0][0]] + [self.int_arg(s, c) for s, c in r[1:]]
        return 'dbo.tsql_str(%s)' % ', '.join(args), 'S'

    def fn_stuff(self, n, sc):
        (a, ac), (b, bc), (c, cc), (d, dc) = self.a2(n, sc, 4)
        return 'overlay(%s placing %s from %s for %s)' % (self.str_arg(a, ac), self.str_arg(d, dc), b, c), 'S'

    def fn_lower(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'lower(%s)' % self.str_arg(a, c), 'S'

    def fn_upper(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'upper(%s)' % self.str_arg(a, c), 'S'

    def fn_ltrim(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'ltrim(%s)' % self.str_arg(a, c), 'S'

    def fn_rtrim(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'rtrim(%s)' % self.str_arg(a, c), 'S'

    def fn_ascii(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'ascii(%s)' % a, 'I'

    def fn_char(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'chr(%s)' % self.int_arg(a, c), 'S'

    fn_nchar = fn_char

    def fn_unicode(self, n, sc):
        return self.fn_ascii(n, sc)

    def fn_quotename(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'quote_ident(%s)' % a, 'S'

    def fn_isnumeric(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'dbo.tsql_isnumeric(%s)' % self.str_arg(a, c), 'I'

    def fn_isdate(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'dbo.tsql_isdate(%s)' % self.str_arg(a, c), 'I'

    # --- numeric
    def fn_abs(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'abs(%s)' % a, c

    def fn_ceiling(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return ('ceiling(%s)' % a) if c != 'I' else a, c

    def fn_floor(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return ('floor(%s)' % a) if c != 'I' else a, c

    def fn_round(self, n, sc):
        r = self.a2(n, sc)
        (a, c) = r[0]
        d = self.int_arg(*r[1]) if len(r) > 1 else '0'
        if len(r) == 3 and not (n.args[2].k == 'lit' and n.args[2].v == '0'):
            return 'trunc((%s)::numeric, %s)' % (a, d), 'N' if c != 'I' else c
        if c == 'I':
            return 'round((%s)::numeric, %s)' % (a, d) if d.startswith('-') else a, 'I'
        return 'round((%s)::numeric, %s)' % (a, d), 'N'

    def fn_power(self, n, sc):
        (a, c), (b, bc) = self.a2(n, sc, 2)
        return 'power((%s)::numeric, (%s)::numeric)' % (a, b), 'N'

    def fn_sqrt(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'sqrt((%s)::double precision)' % a, 'N'

    def fn_square(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return '((%s) * (%s))' % (a, a), c

    def fn_sign(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'sign(%s)' % a, c

    def fn_exp(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'exp((%s)::double precision)' % a, 'N'

    def fn_log(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'ln((%s)::numeric)' % a, 'N'

    def fn_log10(self, n, sc):
        (a, c), = self.a2(n, sc, 1)
        return 'log((%s)::numeric)' % a, 'N'

    def fn_pi(self, n, sc):
        return 'pi()', 'N'

    def fn_rand(self, n, sc):
        return 'random()', 'N'

    # --- date / time
    def fn_getdate(self, n, sc):
        return 'localtimestamp(3)', 'D'

    def fn_getutcdate(self, n, sc):
        return "(now() AT TIME ZONE 'UTC')::timestamp(3)", 'D'

    def part_of(self, node):
        if node.k == 'col' and len(node.parts) == 1:
            p = DATE_PART.get(node.parts[0].lower())
            if p:
                return p
        if node.k == 'lit' and node.t == 'str':
            p = DATE_PART.get(node.v.lower())
            if p:
                return p
        raise Untranslatable('date part')

    def date_arg(self, node, sc, as_date=False):
        s, c = self.E(node, sc)
        ty = 'date' if as_date else 'timestamp'
        if node.k == 'lit' and node.t == 'num':
            return "%s '1900-01-01'" % ty if node.v == '0' else "(timestamp '1900-01-01' + (%s) * interval '1 day')" % s
        if c == 'D':
            return ('(%s)::date' % s) if as_date else s
        return '(%s)::%s' % (s, ty)

    def fn_dateadd(self, n, sc):
        if len(n.args) != 3:
            raise Untranslatable('DATEADD arity')
        part = self.part_of(n.args[0])
        ns, nc = self.E(n.args[1], sc)
        d = self.date_arg(n.args[2], sc)
        if nc == 'N':
            ns = 'trunc(%s)' % ns
        elif nc not in ('I',) and not (n.args[1].k == 'lit'):
            ns = '(%s)::integer' % ns
        unit = {'year': "interval '1 year'", 'quarter': "interval '3 month'", 'month': "interval '1 month'", 'dayofyear': "interval '1 day'",
                'day': "interval '1 day'", 'week': "interval '7 day'", 'weekday': "interval '1 day'", 'hour': "interval '1 hour'",
                'minute': "interval '1 minute'", 'second': "interval '1 second'", 'millisecond': "interval '1 millisecond'"}[part]
        return '(%s + (%s) * %s)' % (d, ns, unit), 'D'

    def fn_datediff(self, n, sc):
        if len(n.args) != 3:
            raise Untranslatable('DATEDIFF arity')
        part = self.part_of(n.args[0])
        if part in ('day', 'dayofyear', 'weekday'):
            a = self.date_arg(n.args[1], sc, True)
            b = self.date_arg(n.args[2], sc, True)
            return '(%s - %s)' % (b, a), 'I'
        a = self.date_arg(n.args[1], sc)
        b = self.date_arg(n.args[2], sc)
        return "dbo.tsql_datediff('%s', %s, %s)" % (part, a, b), 'I'

    def fn_datepart(self, n, sc):
        if len(n.args) != 2:
            raise Untranslatable('DATEPART arity')
        part = self.part_of(n.args[0])
        d = self.date_arg(n.args[1], sc)
        return self.datepart_sql(part, d), 'I'

    def datepart_sql(self, part, d):
        if part == 'weekday':
            return '(extract(dow from %s)::integer + 1)' % d
        if part == 'millisecond':
            return '(extract(milliseconds from %s)::integer %% 1000)' % d
        if part == 'second':
            return 'floor(extract(second from %s))::integer' % d
        if part == 'week':
            return 'dbo.tsql_datepart_week(%s)' % d
        return 'extract(%s from %s)::integer' % ('doy' if part == 'dayofyear' else part, d)

    def fn_year(self, n, sc):
        return self.datepart_sql('year', self.date_arg(n.args[0], sc)), 'I'

    def fn_month(self, n, sc):
        return self.datepart_sql('month', self.date_arg(n.args[0], sc)), 'I'

    def fn_day(self, n, sc):
        return self.datepart_sql('day', self.date_arg(n.args[0], sc)), 'I'

    def fn_datename(self, n, sc):
        part = self.part_of(n.args[0])
        d = self.date_arg(n.args[1], sc)
        if part == 'month':
            return "trim(to_char(%s, 'Month'))" % d, 'S'
        if part == 'weekday':
            return "trim(to_char(%s, 'Day'))" % d, 'S'
        if part == 'year':
            return "to_char(%s, 'YYYY')" % d, 'S'
        return '(%s)::text' % self.datepart_sql(part, d), 'S'

    # --- system
    def fn_newid(self, n, sc):
        return 'gen_random_uuid()', 'O'

    def fn_db_name(self, n, sc):
        return 'current_database()', 'S'

    def fn_host_name(self, n, sc):
        return "coalesce(inet_client_addr()::text, 'localhost')", 'S'

    def fn_suser_sname(self, n, sc):
        return 'current_user', 'S'

    fn_user_name = fn_suser_sname
    fn_system_user = fn_suser_sname
    fn_suser_name = fn_suser_sname

    def fn_app_name(self, n, sc):
        return "current_setting('application_name')", 'S'

    def fn_scope_identity(self, n, sc):
        return 'dbo.tsql_lastident()', 'I'

    fn_ident_current = fn_scope_identity

    def fn_object_id(self, n, sc):
        a = n.args[0]
        if a.k == 'lit' and a.t == 'str':
            nm = a.v.replace('[', '').replace(']', '')
            if 'tempdb' in nm.lower() or '#' in nm:
                short = nm.split('.')[-1]
                return "to_regclass('pg_temp.%s')" % self.temp_name(short), 'U'
            short = nm.split('.')[-1]
            return "to_regclass('dbo.%s')" % shorten(short), 'U'
        raise Untranslatable('OBJECT_ID of non-literal')

    def fn_update(self, n, sc):
        # IF UPDATE(col) inside triggers - resolved by the trigger translator
        return 'TRUE', 'P'

    def fn_error_message(self, n, sc):
        return 'SQLERRM', 'S'

    def fn_error_number(self, n, sc):
        return '0', 'I'
