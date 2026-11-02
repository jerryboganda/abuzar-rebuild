"""Statement translation (T-SQL control flow -> PL/pgSQL)."""
import re
from .parser import Node, Parser, ParseError
from .lexer import tokenize, LexError
from .names import ident, q, fn_ident, shorten, pident
from .schema import map_type, Table, Col, pg_cls
from .texpr import Scope, Untranslatable, contains_agg, is_simple, NUMERIC
from .tquery import walk_nodes


class Ctx:
    def __init__(self, kind, fname):
        self.kind = kind            # proc func tvf trigger stmt
        self.fname = fname
        self.vars = {}              # '@x' lower -> (pgname, cls, pgtype)
        self.temps = {}             # '#t'/'@t' lower -> (pgname, Table)
        self.decls = []
        self.cursors = {}
        self.trigger_table = None
        self.uses_rowcount = False
        self.uses_fetch = False
        self.loop_depth = 0
        self.notes = []
        self.rs_next = 0
        self.rs_max = 0
        self.copyout = []
        self.sqlvars = set()
        self.sqlselect = set()
        self.tvf_var = None         # name of RETURNS @t TABLE variable
        self.tmp_n = 0
        self.dyn = False
        self.params = []
        self.uses_loop_vars = False
        self.declared_flags = set()
        self.rs_cols = {}
        self.perms = {}             # permanent work tables created by SELECT INTO / CREATE TABLE inside the routine


def raise_fmt(text):
    """RAISERROR format -> RAISE format: (text, number of placeholders)"""
    out, n, i = [], 0, 0
    spec = re.compile(r'%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[dDiIuUoOxXsScC]|%\d+!')
    while i < len(text):
        c = text[i]
        if c == '%':
            if text[i + 1:i + 2] == '%':
                out.append('%%')
                i += 2
                continue
            m = spec.match(text, i)
            if m:
                out.append('%')
                n += 1
                i = m.end()
                continue
            out.append('%%')
            i += 1
            continue
        out.append(c)
        i += 1
    return ''.join(out), n


def sql_comment(text, limit=1500):
    t = text.strip()
    if len(t) > limit:
        t = t[:limit] + ' ...'
    return '\n'.join('-- ' + ln.rstrip() for ln in t.split('\n'))


class StmtMixin:
    # ------------------------------------------------------------------ output
    def emit(self, line):
        self.lines.append('  ' * self.ind + line)

    def indent(self):
        self.ind += 1

    def dedent(self):
        self.ind -= 1

    def stmts(self, lst):
        for s in lst:
            self.stmt(s)

    def stmt(self, n):
        m = getattr(self, 's_' + n.k, None)
        mark = len(self.lines)
        try:
            if m is None:
                raise Untranslatable('statement kind ' + n.k)
            m(n)
        except Untranslatable as e:
            del self.lines[mark:]
            self.untranslated(n, str(e))

    def untranslated(self, n, reason):
        self.ctx.notes.append(reason)
        cm = sql_comment(self.stmt_text(n))
        if cm:
            for ln in cm.split(chr(10)):
                self.emit(ln)
        self.emit("RAISE EXCEPTION 'untranslated T-SQL (%s)' USING ERRCODE = '0A000';" % reason.replace("'", "''")[:160])

    def stmt_text(self, n):
        if not (hasattr(n, 'pos') and hasattr(n, 'end')):
            return ''
        t = self.src[n.pos:n.end]
        return t if self.safe_text(t) else '[omitted: vendor backup/restore code]'

    def safe_text(self, t):
        return not re.search(r'password|pwd\s*=|mediapass', t, re.I)

    # ------------------------------------------------------------------ vars
    def lookup_var(self, name):
        key = '@' + name.lower()
        v = self.ctx.vars.get(key)
        if v is None:
            if self.ctx.kind == 'stmt':
                raise Untranslatable('variable @%s in standalone statement' % name)
            raise Untranslatable('undeclared variable @' + name)
        return v

    def declare_var(self, name, ty, init=None, param=False):
        key = '@' + name.lower()
        cls, pg = map_type(ty)
        pgname = ident('v_' + name.lower())
        if key not in self.ctx.vars:
            self.ctx.vars[key] = (pgname, cls, pg)
            self.ctx.decls.append('%s %s;' % (pgname, pg))
        return self.ctx.vars[key]

    def cursor_var(self, name):
        c = self.ctx.cursors.get(name.lower())
        if c is None:
            raise Untranslatable('unknown cursor ' + name)
        return c[0]

    # ------------------------------------------------------------------ trivial statements
    def s_noop(self, n):
        pass

    def s_label(self, n):
        raise Untranslatable('label/GOTO')

    def s_goto(self, n):
        raise Untranslatable('GOTO')

    def s_setopt(self, n):
        o = n.opt
        if o == 'ROWCOUNT':
            e = n.vals[0]
            if e.k == 'lit' and e.v == '0':
                return
            raise Untranslatable('SET ROWCOUNT n')
        self.emit('-- SET %s %s' % (o, ' '.join(str(v) for v in n.vals if isinstance(v, str))))

    def s_begintran(self, n):
        self.emit('-- BEGIN TRANSACTION (the caller owns the transaction)')

    def s_commit(self, n):
        self.emit('-- COMMIT (the caller owns the transaction)')

    def s_rollback(self, n):
        self.emit("RAISE EXCEPTION 'T-SQL ROLLBACK in %s' USING ERRCODE = 'TS001';" % self.ctx.fname.replace("'", "''"))

    def s_block(self, n):
        self.stmts(n.stmts)

    def s_break(self, n):
        self.emit('EXIT;')

    def s_continue(self, n):
        self.emit('CONTINUE;')

    def s_waitfor(self, n):
        e = n.e
        if n.what == 'DELAY' and e.k == 'lit' and e.t == 'str' and re.fullmatch(r'\d+:\d+:\d+', e.v):
            h, m, s = [int(x) for x in e.v.split(':')]
            self.emit('PERFORM pg_sleep(%d);' % (h * 3600 + m * 60 + s))
            return
        raise Untranslatable('WAITFOR')

    def s_print(self, n):
        s, c = self.E(n.e, Scope())
        if c != 'S':
            s = '(%s)::text' % s
        self.emit("RAISE NOTICE '%%', %s;" % s)

    def s_raiserror(self, n):
        a = n.args
        msg, sev = a[0], (a[1] if len(a) > 1 else None)
        level = 16
        if sev is not None and sev.k == 'lit' and sev.t == 'num':
            level = int(float(sev.v))
        extra = a[3:]
        kind = 'EXCEPTION' if level >= 11 else 'NOTICE'
        if msg.k == 'lit' and msg.t == 'str':
            fmt, nph = raise_fmt(msg.v)
            vals = [self.Es(x, Scope()) for x in extra][:nph]
            while len(vals) < nph:
                vals.append('NULL')
            args = ''.join(', ' + v for v in vals)
            self.emit('RAISE %s %s%s;' % (kind, q(fmt), args))
        elif msg.k == 'lit' and msg.t == 'num':
            self.emit("RAISE %s 'Error %s';" % (kind, msg.v))
        else:
            s, c = self.E(msg, Scope())
            if c != 'S':
                s = '(%s)::text' % s
            self.emit("RAISE %s '%%', %s;" % (kind, s))

    def s_trycatch(self, n):
        self.emit('BEGIN')
        self.indent()
        self.stmts(n.body)
        self.dedent()
        self.emit('EXCEPTION WHEN OTHERS THEN')
        self.indent()
        self.stmts(n.handler)
        self.dedent()
        self.emit('END;')

    # ------------------------------------------------------------------ control flow
    def s_if(self, n):
        cond = self.Es(n.cond, Scope())
        self.emit('IF %s THEN' % cond)
        base = self.ctx.rs_next
        self.indent()
        self.stmt_block(n.then)
        self.dedent()
        end_then = self.ctx.rs_next
        end_else = base
        if n.els is not None:
            self.ctx.rs_next = base
            self.emit('ELSE')
            self.indent()
            self.stmt_block(n.els)
            self.dedent()
            end_else = self.ctx.rs_next
        self.emit('END IF;')
        self.ctx.rs_next = max(end_then, end_else)
        self.ctx.rs_max = max(self.ctx.rs_max, self.ctx.rs_next)

    def stmt_block(self, n):
        if n.k == 'block':
            self.stmts(n.stmts)
        else:
            self.stmt(n)

    def s_while(self, n):
        cond = self.Es(n.cond, Scope())
        self.emit('WHILE %s LOOP' % cond)
        self.ctx.loop_depth += 1
        self.indent()
        self.stmt_block(n.body)
        self.dedent()
        self.ctx.loop_depth -= 1
        self.emit('END LOOP;')

    def s_return(self, n):
        k = self.ctx.kind
        if k == 'proc':
            if n.e is not None:
                s, c = self.E(n.e, Scope())
                self.emit('return_value := %s;' % s)
            else:
                self.emit('return_value := 0;')
            for c in self.ctx.copyout:
                self.emit(c)
            self.emit('RETURN;')
        elif k == 'func':
            if n.e is None:
                raise Untranslatable('RETURN without value in scalar function')
            s, c = self.E(n.e, Scope())
            self.emit('RETURN %s;' % self.cast_ret(s, c))
        elif k == 'tvf':
            self.emit('RETURN QUERY SELECT * FROM %s;' % self.tvf_table)
            self.emit('DROP TABLE IF EXISTS %s;' % self.tvf_table)
            self.emit('RETURN;')
        elif k == 'trigger':
            self.emit('RETURN NULL;')
        else:
            raise Untranslatable('RETURN')

    def cast_ret(self, s, c):
        if self.ret_pg and self.ret_cls == 'S' and c in ('S', 'U'):
            return '(%s)::citext' % s if not re.fullmatch(r"'[^']*'", s) else s
        return s

    # ------------------------------------------------------------------ declarations
    def s_declare(self, n):
        for name, ty, init in n.vars:
            v = self.declare_var(name, ty)
            if init is not None:
                s, c = self.E(init, Scope())
                self.emit('%s := %s;' % (v[0], s))
            elif self.ctx.loop_depth:
                self.emit('%s := NULL;' % v[0])

    def make_table(self, name, cols, cons):
        """column definitions -> (create-table body, Table)"""
        lines, tcols = [], []
        pk = []
        for c in cols:
            cls, pg = map_type(c.type)
            iden = ''
            if c.identity:
                iden = ' GENERATED BY DEFAULT AS IDENTITY'
                if c.identity != ('1', '1'):
                    iden += ' (START WITH %s INCREMENT BY %s)' % c.identity
                if pg not in ('integer', 'smallint', 'bigint'):
                    pg = 'integer'
            d = ''
            if c.default is not None:
                try:
                    d = ' DEFAULT ' + self.Es(c.default, Scope())
                except Untranslatable:
                    d = ''
            null = ''
            if c.null is False:
                null = ' NOT NULL'
            elif c.null is True:
                null = ' NULL'
            if c.pk:
                pk.append(c.name)
            lines.append('%s %s%s%s%s' % (ident(c.name), pg, iden, null, d))
            tcols.append(Col(c.name, pg, cls, bool(c.identity), c.null is not False))
        for con in cons:
            if con.kind in ('PRIMARY', 'UNIQUE') and con.cols:
                lines.append('%s (%s)' % ('PRIMARY KEY' if con.kind == 'PRIMARY' else 'UNIQUE', ', '.join(ident(x) for x in con.cols)))
        if pk:
            lines.append('PRIMARY KEY (%s)' % ', '.join(ident(x) for x in pk))
        return ',\n'.join('    ' + l for l in lines), Table(name, tcols)

    def s_decltable(self, n):
        key = '@' + n.name.lower()
        pg = self.tvar_name(n.name)
        body, tab = self.make_table(n.name, n.cols, n.cons)
        self.ctx.temps[key] = (pg, tab)
        self.emit('DROP TABLE IF EXISTS %s;' % pg)
        self.emit('CREATE TEMP TABLE %s (\n%s\n) ON COMMIT DROP;' % (pg, body))

    def s_createtable(self, n):
        name = n.name[-1]
        if not name.startswith('#'):
            raise Untranslatable('CREATE TABLE of a permanent table')
        key = name.lower()
        pg = self.temp_name(name)
        body, tab = self.make_table(name, n.cols, n.cons)
        self.ctx.temps[key] = (pg, tab)
        self.emit('DROP TABLE IF EXISTS %s;' % pg)
        self.emit('CREATE TEMP TABLE %s (\n%s\n) ON COMMIT DROP;' % (pg, body))

    def s_droptable(self, n):
        for parts in n.names:
            name = parts[-1]
            if name.startswith('#'):
                self.emit('DROP TABLE IF EXISTS %s;' % self.temp_name(name))
                self.ctx.temps.pop(name.lower(), None)
            elif name.lower() in self.tables or name.lower() in self.catalog.views:
                raise Untranslatable('DROP TABLE of a table of the schema')
            else:
                self.emit('DROP TABLE IF EXISTS dbo.%s;' % ident(name))
                self.ctx.perms.pop(name.lower(), None)

    def s_truncate(self, n):
        kind, pg, t, base = self.resolve_table(n.table)
        self.emit('TRUNCATE TABLE %s%s;' % (pg, ' RESTART IDENTITY' if kind in ('temp', 'tvar') or (t and any(c.identity for c in t.cols)) else ''))

    def s_createindex(self, n):
        name = n.table[-1]
        if not name.startswith('#'):
            raise Untranslatable('CREATE INDEX on a permanent table')
        self.ctx.tmp_n += 1
        self.emit('CREATE %sINDEX ON %s (%s);' % ('UNIQUE ' if n.unique else '', self.temp_name(name),
                                                  ', '.join(ident(c) + (' DESC' if d else '') for c, d in n.cols)))

    def s_dropindex(self, n):
        self.emit('-- DROP INDEX (temp table index dropped with its table)')

    def s_altertable(self, n):
        name = n.table[-1]
        if not name.startswith('#'):
            raise Untranslatable('ALTER TABLE of a permanent table')
        pg = self.temp_name(name)
        t = self.ctx.temps.get(name.lower())
        for c in n.add:
            cls, ty = map_type(c.type)
            iden = ' GENERATED BY DEFAULT AS IDENTITY' if c.identity else ''
            if c.identity and ty not in ('integer', 'smallint', 'bigint'):
                ty = 'integer'
            self.emit('ALTER TABLE %s ADD COLUMN %s %s%s%s;' % (pg, ident(c.name), ty, iden, ' NOT NULL' if c.null is False else ''))
            if t:
                t[1].cols.append(Col(c.name, ty, cls))
                t[1].by[c.name.lower()] = t[1].cols[-1]
        for c in getattr(n, 'drop', []):
            self.emit('ALTER TABLE %s DROP COLUMN %s;' % (pg, ident(c)))
        for c, ty in getattr(n, 'alter', []):
            cls, tp = map_type(ty)
            self.emit('ALTER TABLE %s ALTER COLUMN %s TYPE %s;' % (pg, ident(c), tp))

    # ------------------------------------------------------------------ SET
    def s_set(self, n):
        v = self.lookup_var(n.var)
        rhs = n.e
        if n.op != '=':
            rhs = Node('bin', op=n.op[0], l=Node('var', name=n.var), r=rhs)
        frag = ('@' + n.var.lower()) in self.ctx.sqlvars
        s, c = self.expr_frag(rhs, frag)
        self.emit('%s := %s;' % (v[0], self.assign_cast(v, s, c)))

    def assign_cast(self, v, s, c):
        pg = v[2]
        if v[1] == 'I' and c == 'N' and pg in ('integer', 'smallint', 'bigint'):
            return 'trunc(%s)::%s' % (s, pg)
        if v[1] == 'D' and c == 'S' and not s.startswith("'"):
            return '(%s)::%s' % (s, pg)
        return s

    def expr_frag(self, e, frag):
        if frag:
            self.dyn_mode = True
        try:
            return self.E(e, Scope())
        finally:
            self.dyn_mode = False

    def e_lit_dyn(self, text):
        return text

    # ------------------------------------------------------------------ SELECT statement
    def rs_alloc(self):
        i = self.ctx.rs_next
        self.ctx.rs_next += 1
        self.ctx.rs_max = max(self.ctx.rs_max, self.ctx.rs_next)
        return 'rs%d' % (i + 1)

    def after_dml(self):
        if self.ctx.uses_rowcount:
            self.emit('GET DIAGNOSTICS _rc = ROW_COUNT;')

    def s_select_stmt(self, n):
        sel = n.sel
        assigns = [it for it in sel.items if it.var is not None]
        if assigns:
            return self.select_assign(sel)
        if sel.into is not None:
            return self.select_into(sel)
        if self.ctx.kind != 'proc':
            if self.ctx.kind == 'trigger':
                self.emit('-- result set discarded in trigger')
                return
            raise Untranslatable('result set in %s' % self.ctx.kind)
        sql, cols = self.select_full(sel, Scope())
        rs = self.rs_alloc()
        if self.ctx.loop_depth:
            self.emit('%s := NULL;' % rs)
        self.emit('OPEN %s FOR %s;' % (rs, sql))
        self.ctx.rs_cols.setdefault(rs, cols)

    def select_into(self, sel):
        into = sel.into
        if not isinstance(into, Node) or into.k != 'table':
            raise Untranslatable('SELECT INTO host variables')
        name = into.parts[-1]
        sel2 = sel
        sql, cols = self.select_full(sel2, Scope())
        if name.startswith('#'):
            pg = self.temp_name(name)
            self.emit('DROP TABLE IF EXISTS %s;' % pg)
            self.emit('CREATE TEMP TABLE %s ON COMMIT DROP AS %s;' % (pg, sql))
            tcols = [Col(nm, '', cls) for nm, cls in cols if nm]
            self.ctx.temps[name.lower()] = (pg, Table(name, tcols))
        else:
            low = name.lower()
            if low in self.tables:
                raise Untranslatable('SELECT INTO an existing table')
            pg = 'dbo.' + ident(name)
            self.emit('DROP TABLE IF EXISTS %s;' % pg)
            self.emit('CREATE TABLE %s AS %s;' % (pg, sql))
            self.ctx.perms[low] = Table(name, [Col(nm, '', cls) for nm, cls in cols if nm])
        self.after_dml()

    def select_assign(self, sel):
        items = sel.items
        if any(it.var is None for it in items):
            raise Untranslatable('SELECT mixes variable assignment and data retrieval')
        if sel.union is not None:
            raise Untranslatable('assignment from UNION')
        if sel.frm is None:
            for it in items:
                v = self.lookup_var(it.var)
                rhs = it.e
                if it.op != '=':
                    rhs = Node('bin', op=it.op[0], l=Node('var', name=it.var), r=rhs)
                frag = ('@' + it.var.lower()) in self.ctx.sqlvars
                s, c = self.expr_frag(rhs, frag)
                self.emit('%s := %s;' % (v[0], self.assign_cast(v, s, c)))
            if self.ctx.uses_rowcount:
                self.emit('_rc := 1;')
            return
        varnames = set('@' + it.var.lower() for it in items)
        refs_self = any(n2.k == 'var' and ('@' + n2.name.lower()) in varnames
                        for it in items for n2 in walk_nodes(it.e)) or any(it.op != '=' for it in items)
        agg_only = (not sel.group) and any(contains_agg(it.e) for it in items)
        sc = Scope()
        if agg_only and not refs_self:
            # exactly one row: plain SELECT INTO
            q_sel = sel.copy()
            targets = []
            q_items = []
            for it in items:
                v = self.lookup_var(it.var)
                targets.append(v[0])
                q_items.append(Node('item', e=it.e, alias=None, var=None, op=None))
            q_sel.items = q_items
            sql, cols = self.select_full(q_sel, Scope())
            # SELECT a, b INTO v1, v2 FROM ...
            self.emit(self.insert_into_clause(sql, targets) + ';')
            self.after_dml()
            return
        # general: FOR loop, last row wins
        self.ctx.tmp_n += 1
        r = '_r%d' % self.ctx.tmp_n
        self.ctx.decls.append('%s record;' % r)
        loop_items = []
        sets = []
        if refs_self:
            # keep sub-expressions that do not depend on the assigned variables as loop columns
            counter = [0]

            def has_assigned(x):
                return any(k.k == 'var' and ('@' + k.name.lower()) in varnames for k in walk_nodes(x))

            def purify(x):
                if not isinstance(x, Node):
                    return x
                if x.k in ('lit',) or x.k == 'var':
                    return x
                if x.k in ('sub', 'exists', 'quant') or (x.k == 'in' and x.sub is not None):
                    if has_assigned(x):
                        return x
                if not has_assigned(x):
                    counter[0] += 1
                    nm = 'c%d' % counter[0]
                    loop_items.append(Node('item', e=x, alias=nm, var=None, op=None))
                    return Node('rawcol', sql='%s.%s' % (r, nm), cls='U')
                y = x.copy()
                for k, v in list(y.__dict__.items()):
                    if k == 'k':
                        continue
                    if isinstance(v, Node):
                        setattr(y, k, purify(v))
                    elif isinstance(v, list):
                        setattr(y, k, [purify(e) if isinstance(e, Node) else (tuple(purify(z) if isinstance(z, Node) else z for z in e) if isinstance(e, tuple) else e) for e in v])
                return y
            for it in items:
                rhs = it.e
                if it.op != '=':
                    rhs = Node('bin', op=it.op[0], l=Node('var', name=it.var), r=rhs)
                sets.append((it.var, purify(rhs)))
        else:
            for i, it in enumerate(items):
                nm = 'c%d' % (i + 1)
                loop_items.append(Node('item', e=it.e, alias=nm, var=None, op=None))
                sets.append((it.var, Node('rawcol', sql='%s.%s' % (r, nm), cls='U')))
        q_sel = sel.copy()
        q_sel.items = loop_items or [Node('item', e=Node('lit', t='num', v='1'), alias='c0', var=None, op=None)]
        q_sel.into = None
        sql, cols = self.select_full(q_sel, Scope())
        if self.ctx.uses_rowcount:
            self.emit('_rc := 0;')
        self.emit('FOR %s IN %s LOOP' % (r, sql))
        self.indent()
        if self.ctx.uses_rowcount:
            self.emit('_rc := _rc + 1;')
        for var, rhs in sets:
            v = self.lookup_var(var)
            frag = ('@' + var.lower()) in self.ctx.sqlvars
            s, c = self.expr_frag(rhs, frag)
            self.emit('%s := %s;' % (v[0], self.assign_cast(v, s, c)))
        self.dedent()
        self.emit('END LOOP;')

    def insert_into_clause(self, sql, targets):
        """SELECT <items> FROM ...  ->  SELECT <items> INTO t1, t2 FROM ..."""
        depth = 0
        i = 0
        low = sql.lower()
        n = len(sql)
        inq = False
        while i < n:
            ch = sql[i]
            if ch == "'":
                inq = not inq
            elif not inq:
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
                elif depth == 0 and low.startswith(' from ', i):
                    return sql[:i] + ' INTO ' + ', '.join(targets) + sql[i:]
            i += 1
        return sql + ' INTO ' + ', '.join(targets)

    # ------------------------------------------------------------------ DML
    def s_insert(self, n):
        if n.exec is not None:
            return self.insert_exec(n)
        self.emit(self.insert_sql(n) + ';')
        self.after_dml()

    def s_update(self, n):
        self.emit(self.update_sql(n) + ';')
        self.after_dml()

    def s_delete(self, n):
        self.emit(self.delete_sql(n) + ';')
        self.after_dml()

    # ------------------------------------------------------------------ cursors
    def s_declcursor(self, n):
        key = n.name.lower()
        pgvar = ident('cur_' + key)
        if key not in self.ctx.cursors:
            self.ctx.decls.append('%s refcursor;' % pgvar)
        self.ctx.cursors[key] = (pgvar, n.sel, n.opts, n.update)

    def s_open(self, n):
        key = n.name.lower()
        c = self.ctx.cursors.get(key)
        if c is None:
            raise Untranslatable('OPEN of undeclared cursor ' + n.name)
        sql, cols = self.select_full(c[1], Scope())
        scroll = ' SCROLL' if 'SCROLL' in c[2] else ''
        self.emit('OPEN %s%s FOR %s;' % (c[0], scroll, sql))

    def s_close(self, n):
        c = self.ctx.cursors.get(n.name.lower())
        if c is None:
            raise Untranslatable('CLOSE of undeclared cursor')
        self.emit('CLOSE %s;' % c[0])

    def s_deallocate(self, n):
        self.emit('-- DEALLOCATE %s' % n.name)

    def s_fetch(self, n):
        c = self.ctx.cursors.get(n.name.lower())
        if c is None:
            raise Untranslatable('FETCH of undeclared cursor ' + n.name)
        d = n.direction
        direction = {'NEXT': 'NEXT', 'PRIOR': 'PRIOR', 'FIRST': 'FIRST', 'LAST': 'LAST'}.get(d)
        if d in ('ABSOLUTE', 'RELATIVE'):
            direction = '%s %s' % (d, self.Es(n.arg, Scope()))
        targets = ', '.join(self.lookup_var(x)[0] if x.startswith('@') or True else x for x in [t.lstrip('@') for t in n.into])
        into = ' INTO ' + targets if targets else ''
        self.emit('FETCH %s FROM %s%s;' % (direction, c[0], into))
        self.ctx.uses_fetch = True
        self.emit('IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;')

    # ------------------------------------------------------------------ EXEC
    def s_execdyn(self, n):
        if self.ctx.kind == 'stmt':
            raise Untranslatable('dynamic SQL')
        self.ctx.dyn = True
        e = n.e
        if e is None:
            raise Untranslatable('EXEC without statement')
        self.dyn_mode = True
        try:
            s, c = self.E(e, Scope())
        finally:
            self.dyn_mode = False
        if c != 'S':
            s = '(%s)::text' % s
        is_select = self.dyn_is_select(e)
        using = ''
        if getattr(n, 'sp_executesql', False) and n.args:
            # sp_executesql @stmt, N'@p int', @p = value ... : parameters are substituted textually by name
            raise Untranslatable('sp_executesql with parameters')
        if is_select and self.ctx.kind == 'proc':
            rs = self.rs_alloc()
            self.emit('OPEN %s FOR EXECUTE %s;' % (rs, s))
        else:
            self.emit('EXECUTE %s;' % s)
            self.after_dml()

    def dyn_is_select(self, e):
        def first_lit(x):
            if x.k == 'lit' and x.t == 'str':
                return x.v
            if x.k == 'bin' and x.op == '+':
                return first_lit(x.l)
            if x.k == 'paren':
                return first_lit(x.e)
            if x.k == 'var':
                return '@' + x.name.lower()
            return None
        f = first_lit(e)
        if f is None:
            return False
        if f.startswith('@'):
            return f in self.ctx.sqlselect
        return bool(re.match(r'\s*select\b', f, re.I))

    def s_exec(self, n):
        if n.name is None:
            raise Untranslatable('EXEC @procvar')
        parts = [p for p in n.name if p != '']
        if len(parts) > 2 or (len(parts) == 2 and parts[0].lower() != 'dbo'):
            raise Untranslatable('procedure outside the database: ' + '.'.join(parts))
        lname = parts[-1].lower()
        sig = self.catalog.procs.get(lname)
        if sig is None:
            raise Untranslatable('unknown procedure ' + parts[-1])
        call, outs, rsn = self.call_proc(sig, n)
        sel = []
        tgt = []
        if n.ret:
            sel.append('r.return_value')
            tgt.append(self.lookup_var(n.ret)[0])
        for pname, var in outs:
            sel.append('r.' + pident(pname))
            tgt.append(var)
        # result sets pass through to our own slots
        if rsn and self.ctx.kind == 'proc':
            for i in range(sig.rs_count):
                slot = self.rs_alloc()
                sel.append('r.rs%d' % (i + 1))
                tgt.append(slot)
        if sel:
            self.emit('SELECT %s INTO %s FROM %s AS r;' % (', '.join(sel), ', '.join(tgt), call))
        else:
            self.emit('PERFORM %s;' % call)

    def call_proc(self, sig, n):
        """-> (call sql, [(callee out param, caller var)], passes result sets)"""
        args = []
        outs = []
        pos = 0
        used = set()
        for a in n.args:
            name, e, is_out = a
            if name is not None:
                p = next((x for x in sig.params if x.name == name.lower()), None)
                if p is None:
                    raise Untranslatable('unknown parameter @%s of %s' % (name, sig.name))
            else:
                if pos >= len(sig.params):
                    raise Untranslatable('too many arguments for ' + sig.name)
                p = sig.params[pos]
                pos += 1
            used.add(p.name)
            if e.k == 'default':
                continue
            s, c = self.E(e, Scope())
            s = self.coerce_to(e, s, c, p.pgtype, p.cls)
            args.append('%s => %s' % (pident(p.name), s))
            if is_out and p.mode == 'inout':
                if e.k != 'var':
                    raise Untranslatable('OUTPUT argument must be a variable')
                outs.append((p.name, self.lookup_var(e.name)[0]))
        for p in sig.params:
            if p.name not in used and p.default is None:
                args.append('%s => NULL::%s' % (pident(p.name), p.pgtype))
        return '%s(%s)' % (fn_ident(sig.name), ', '.join(args)), outs, sig.rs_count > 0

    def insert_exec(self, n):
        ex = n.exec
        if ex.k == 'execdyn' and ex.e is not None and not getattr(ex, 'sp_executesql', False):
            kind, pg, tab, base = self.target_info(n.target)
            cols = ' (%s)' % ', '.join(ident(c) for c in n.cols) if n.cols else ''
            self.dyn_mode = True
            try:
                s, c = self.E(ex.e, Scope())
            finally:
                self.dyn_mode = False
            if c != 'S':
                s = '(%s)::text' % s
            self.emit('EXECUTE %s || %s;' % (q('INSERT INTO %s%s ' % (pg, cols)), s))
            self.after_dml()
            return
        if ex.k != 'exec' or ex.name is None:
            raise Untranslatable('INSERT ... EXEC of dynamic SQL')
        parts = [p for p in ex.name if p != '']
        lname = parts[-1].lower()
        sig = self.catalog.procs.get(lname)
        if sig is None or sig.rs_count < 1:
            raise Untranslatable('INSERT ... EXEC of %s (no result set)' % parts[-1])
        kind, pg, tab, base = self.target_info(n.target)
        if tab is None:
            raise Untranslatable('INSERT ... EXEC into unknown table')
        call, outs, _ = self.call_proc(sig, ex)
        names = n.cols or [c.name for c in tab.cols if not c.identity]
        types = []
        for nm in names:
            c = tab.by.get(nm.lower())
            if c is None:
                raise Untranslatable('INSERT ... EXEC column %s' % nm)
            types.append(c.pg or 'text')
        self.ctx.tmp_n += 1
        k = self.ctx.tmp_n
        cur, row = '_xc%d' % k, '_xr%d' % k
        self.ctx.decls.append('%s refcursor;' % cur)
        self.ctx.decls.append('%s record;' % row)
        self.emit('SELECT r.rs1 INTO %s FROM %s AS r;' % (cur, call))
        self.emit('LOOP')
        self.indent()
        self.emit('FETCH %s INTO %s;' % (cur, row))
        self.emit('EXIT WHEN NOT FOUND;')
        vals = ', '.join('(a.v)[%d]::%s' % (i + 1, t) for i, t in enumerate(types))
        self.emit('INSERT INTO %s (%s)' % (pg, ', '.join(ident(x) for x in names)))
        self.emit("  SELECT %s FROM (SELECT array_agg(value ORDER BY ord) AS v FROM json_each_text(row_to_json(%s)) WITH ORDINALITY AS j(key, value, ord)) a;" % (vals, row))
        self.dedent()
        self.emit('END LOOP;')
        self.emit('CLOSE %s;' % cur)
        self.after_dml()
