"""Routine level translation: procedures, functions, views, triggers + catalog / signatures."""
import re
from .parser import Node, Parser, ParseError, parse_object
from .lexer import tokenize, LexError
from .names import ident, q, fn_ident, shorten, pident
from .schema import map_type, Table, Col, pg_cls
from .texpr import ExprMixin, Scope, Untranslatable, contains_agg
from .tquery import QueryMixin, walk_nodes
from .tstmt import StmtMixin, Ctx, sql_comment


class PSig:
    def __init__(self, name, pgtype, cls, mode, default, tsql_type):
        self.name, self.pgtype, self.cls, self.mode, self.default, self.tsql_type = name, pgtype, cls, mode, default, tsql_type


class Sig:
    def __init__(self, name, kind):
        self.name = name
        self.kind = kind
        self.params = []
        self.ret_cls = 'U'
        self.ret_pg = None
        self.ret_table = None
        self.rs_count = 0
        self.node = None
        self.status = 'untranslated'
        self.src = ''


class Catalog:
    def __init__(self):
        self.procs = {}
        self.funcs = {}
        self.views = {}


def pg_param_type(ty):
    cls, pg = map_type(ty, keep_precision=False)
    return cls, re.sub(r'\(.*\)', '', pg)


def tsql_type_str(ty):
    return ty.name + ('(%s)' % ','.join(ty.args) if ty.args else '')


def scan_sqlvars(body):
    """variables whose value is executed as dynamic SQL; and those holding SELECT text"""
    sqlvars, sqlselect = set(), set()
    for n in walk_nodes(body):
        if n.k == 'execdyn' and n.e is not None:
            for x in walk_nodes(n.e):
                if x.k == 'var':
                    sqlvars.add('@' + x.name.lower())
    changed = True
    while changed:
        changed = False
        for n in walk_nodes(body):
            tgt = None
            if n.k == 'set':
                tgt, rhs = '@' + n.var.lower(), n.e
            elif n.k == 'select_stmt':
                for it in n.sel.items:
                    if it.var:
                        t2 = '@' + it.var.lower()
                        if t2 in sqlvars:
                            for x in walk_nodes(it.e):
                                if x.k == 'lit' and x.t == 'str' and re.match(r'\s*select\b', x.v, re.I):
                                    sqlselect.add(t2)
                continue
            if tgt and tgt in sqlvars:
                for x in walk_nodes(rhs):
                    if x.k == 'lit' and x.t == 'str' and re.match(r'\s*select\b', x.v, re.I):
                        if tgt not in sqlselect:
                            sqlselect.add(tgt)
                    if x.k == 'var':
                        t2 = '@' + x.name.lower()
                        if t2 not in sqlvars and t2 != tgt:
                            sqlvars.add(t2)
                            changed = True
    return sqlvars, sqlselect


def count_rs(stmts, procs, sqlselect):
    def dyn_select(e):
        def first(x):
            if x.k == 'lit' and x.t == 'str':
                return x.v
            if x.k == 'bin' and x.op == '+':
                return first(x.l)
            if x.k == 'paren':
                return first(x.e)
            if x.k == 'var':
                return '@' + x.name.lower()
            return None
        f = first(e) if e is not None else None
        if f is None:
            return False
        if f.startswith('@'):
            return f in sqlselect
        return bool(re.match(r'\s*select\b', f, re.I))

    def walk(lst, cur):
        for s in lst:
            cur = one(s, cur)
        return cur

    def one(s, cur):
        k = s.k
        if k == 'select_stmt':
            if s.sel.into is None and not any(it.var for it in s.sel.items):
                return cur + 1
            return cur
        if k == 'exec' and s.name:
            c = procs.get(s.name[-1].lower())
            return cur + (c.rs_count if c else 0)
        if k == 'execdyn':
            return cur + (1 if dyn_select(s.e) else 0)
        if k == 'if':
            a = walk([s.then], cur)
            b = walk([s.els], cur) if s.els is not None else cur
            return max(a, b)
        if k == 'while':
            return walk([s.body], cur)
        if k == 'block':
            return walk(s.stmts, cur)
        if k == 'trycatch':
            return walk(s.handler, walk(s.body, cur))
        return cur
    return walk(stmts, 0)


class Translator(ExprMixin, QueryMixin, StmtMixin):
    def __init__(self, tables, catalog):
        self.tables = tables
        self.catalog = catalog
        self.binds = []
        self.dyn_mode = False
        self.ctx = Ctx('stmt', 'stmt')
        self.lines = []
        self.ind = 1
        self.src = ''

    # ------------------------------------------------------------------ dynamic SQL fragments
    def frag_fix(self, text):
        try:
            toks = tokenize(text)
        except LexError:
            return text
        edits = []
        n = len(toks)
        for i, t in enumerate(toks):
            if t.kind == 'id':
                up = t.value.upper()
                nxt = toks[i + 1] if i + 1 < n else None
                if up == 'ISNULL' and nxt is not None and nxt.is_op('('):
                    edits.append((t.pos, t.pos + len(t.value), 'COALESCE'))
                elif up == 'GETDATE' and nxt is not None and nxt.is_op('(') and i + 2 < n and toks[i + 2].is_op(')'):
                    edits.append((t.pos, toks[i + 2].pos + 1, 'localtimestamp(3)'))
                elif up == 'LEN' and nxt is not None and nxt.is_op('('):
                    edits.append((t.pos, t.pos + len(t.value), 'length'))
                elif t.value.startswith('#'):
                    edits.append((t.pos, t.pos + len(t.value), self.temp_name(t.value)))
            elif t.kind == 'qid':
                end = text.find(']', t.pos) + 1 if text[t.pos] == '[' else t.pos + len(t.value) + 2
                edits.append((t.pos, end, ident(t.value)))
        if not edits:
            return text
        out, last = [], 0
        for a, b, r in edits:
            out.append(text[last:a])
            out.append(r)
            last = b
        out.append(text[last:])
        return ''.join(out)

    # ------------------------------------------------------------------ catalog
    def make_sig(self, node):
        name = node.name[-1].lower()
        s = Sig(name, 'proc' if node.k == 'proc' else 'func')
        s.node = node
        seen_default = False
        params = node.params
        first_default = next((i for i, p in enumerate(params) if p.default is not None), None)
        for i, p in enumerate(params):
            cls, pg = pg_param_type(p.type)
            dflt = None
            if p.default is not None:
                try:
                    self.ctx = Ctx('stmt', 'defaults')
                    dflt = self.Es(p.default, Scope())
                except Untranslatable:
                    dflt = 'NULL'
            elif p.out or (first_default is not None and i > first_default):
                dflt = 'NULL'
            s.params.append(PSig(p.name.lower(), pg, cls, 'inout' if p.out else 'in', dflt, tsql_type_str(p.type)))
        if node.k == 'function':
            if node.ret_type is not None:
                s.ret_cls, s.ret_pg = map_type(node.ret_type, keep_precision=False)
            elif node.ret_var is not None:
                cols, cons = node.ret_table
                tcols = []
                for c in cols:
                    cls, pg = map_type(c.type)
                    tcols.append(Col(c.name, pg, cls, bool(c.identity), c.null is not False))
                s.ret_table = Table(node.ret_var, tcols)
        return s

    def build_catalog(self, objs):
        """objs: list of parsed Nodes (proc/function/view)"""
        cat = self.catalog
        for n in objs:
            if n.k == 'proc':
                sg = self.make_sig(n)
                cat.procs[sg.name] = sg
            elif n.k == 'function':
                sg = self.make_sig(n)
                cat.funcs[sg.name] = sg
        # inline table functions: output columns from the select list
        for sg in cat.funcs.values():
            n = sg.node
            if n.ret_table is not None and n.ret_var is None:
                sel = n.body[0].e.sel
                self.ctx = Ctx('stmt', sg.name)
                try:
                    sql, cols = self.select_full(sel, Scope())
                except Untranslatable:
                    cols = []
                sg.inline_sel = sel
                tcols = []
                for nm, cls in cols:
                    if nm:
                        tcols.append(Col(nm, self.cls_default_pg(cls), cls))
                sg.ret_table = Table(sg.name, tcols)
        # result-set counts (fixpoint)
        for sg in cat.procs.values():
            sg.sqlvars, sg.sqlselect = scan_sqlvars(sg.node.body)
        for _ in range(8):
            changed = False
            for sg in cat.procs.values():
                c = count_rs(sg.node.body, cat.procs, sg.sqlselect)
                if c != sg.rs_count:
                    sg.rs_count = c
                    changed = True
            if not changed:
                break

    def cls_default_pg(self, cls):
        return {'S': 'citext', 'I': 'integer', 'N': 'numeric', 'D': 'timestamp(3)', 'B': 'bytea', 'O': 'uuid'}.get(cls, 'text')

    # ------------------------------------------------------------------ routine plumbing
    def begin(self, kind, fname, src):
        self.ctx = Ctx(kind, fname)
        self.src = src
        self.lines = []
        self.ind = 1
        self.binds = []
        self.dyn_mode = False
        self.ret_pg = None
        self.ret_cls = None
        self.tvf_table = None

    def prescan(self, body):
        sv, ss = scan_sqlvars(body)
        self.ctx.sqlvars, self.ctx.sqlselect = sv, ss
        for n in walk_nodes(body):
            if n.k == 'gvar' and n.name == 'rowcount':
                self.ctx.uses_rowcount = True
            if n.k == 'gvar' and n.name == 'fetch_status':
                self.ctx.uses_fetch = True

    def assemble(self, header, params_sql, returns, body_lines, decls, language='plpgsql', extra_decl=()):
        d = list(decls) + list(extra_decl)
        if self.ctx.uses_rowcount:
            d.append('_rc integer;')
        if self.ctx.uses_fetch:
            d.append('_fs integer := -1;')
        out = ['CREATE OR REPLACE FUNCTION %s(%s)' % (header, params_sql)]
        if returns:
            out.append('  RETURNS ' + returns)
        out.append('  LANGUAGE plpgsql AS $body$')
        out.append('#variable_conflict use_column')
        if d:
            out.append('DECLARE')
            out.extend('  ' + x for x in d)
        out.append('BEGIN')
        out.extend(body_lines)
        out.append('END')
        out.append('$body$;')
        return '\n'.join(out)

    # ------------------------------------------------------------------ procedures
    def translate_proc(self, node, src):
        name = node.name[-1]
        sig = self.catalog.procs[name.lower()]
        self.begin('proc', name, src)
        ctx = self.ctx
        self.prescan(node.body)
        pdecl = []
        copyin = []
        for p, ps in zip(node.params, sig.params):
            mode = 'INOUT ' if ps.mode == 'inout' else ''
            d = ' DEFAULT ' + ps.default if ps.default is not None else ''
            pdecl.append('%s%s %s%s' % (mode, pident(p.name), ps.pgtype, d))
            v = self.declare_var(p.name, p.type, param=True)
            copyin.append('%s := %s;' % (v[0], pident(p.name)))
            if ps.mode == 'inout':
                ctx.copyout.append('%s := %s;' % (pident(p.name), v[0]))
        pdecl.append('OUT return_value integer')
        for i in range(sig.rs_count):
            pdecl.append('OUT rs%d refcursor' % (i + 1))
        self.ind = 1
        for c in copyin:
            self.emit(c)
        self.stmts(node.body)
        # fall off the end: return code 0
        self.emit('return_value := 0;')
        for c in ctx.copyout:
            self.emit(c)
        self.emit('RETURN;')
        sig.status = 'partial' if ctx.notes else 'full'
        sig.notes = list(ctx.notes)
        sig.rs_cols = dict(ctx.rs_cols)
        return self.assemble(fn_ident(name), ', '.join(pdecl), None, self.lines, ctx.decls)

    # ------------------------------------------------------------------ functions
    def translate_function(self, node, src):
        name = node.name[-1]
        sig = self.catalog.funcs[name.lower()]
        kind = 'func'
        if node.ret_table is not None:
            kind = 'tvf'
        self.begin(kind, name, src)
        ctx = self.ctx
        self.prescan(node.body)
        pdecl, copyin = [], []
        for p, ps in zip(node.params, sig.params):
            d = ' DEFAULT ' + ps.default if ps.default is not None else ''
            pdecl.append('%s %s%s' % (pident(p.name), ps.pgtype, d))
            v = self.declare_var(p.name, p.type, param=True)
            copyin.append('%s := %s;' % (v[0], pident(p.name)))
        self.ind = 1
        for c in copyin:
            self.emit(c)
        if kind == 'func':
            self.ret_cls, self.ret_pg = sig.ret_cls, sig.ret_pg
            self.stmts(node.body)
            self.emit('RETURN NULL;')
            returns = sig.ret_pg
        elif node.ret_var is not None:
            cols, cons = node.ret_table
            key = '@' + node.ret_var.lower()
            self.tvf_table = self.tvar_name(node.ret_var)
            body, tab = self.make_table(node.ret_var, cols, cons)
            ctx.temps[key] = (self.tvf_table, tab)
            self.emit('DROP TABLE IF EXISTS %s;' % self.tvf_table)
            self.emit('CREATE TEMP TABLE %s (\n%s\n) ON COMMIT DROP;' % (self.tvf_table, body))
            self.stmts(node.body)
            if not node.body or node.body[-1].k != 'return':
                self.emit('RETURN QUERY SELECT * FROM %s;' % self.tvf_table)
                self.emit('DROP TABLE IF EXISTS %s;' % self.tvf_table)
                self.emit('RETURN;')
            returns = 'TABLE(%s)' % ', '.join('%s %s' % (ident(c.name), re.sub(r'\(.*\)', '', c.pg) if c.pg.startswith('numeric') else c.pg) for c in sig.ret_table.cols)
        else:
            # inline table-valued function
            sel = sig.inline_sel
            sql, cols = self.select_full(sel, Scope())
            items = ctx_items = None
            tcols = sig.ret_table.cols
            self.emit('RETURN QUERY %s;' % self.cast_inline(sel, tcols))
            self.emit('RETURN;')
            returns = 'TABLE(%s)' % ', '.join('%s %s' % (ident(c.name), c.pg) for c in tcols)
        sig.status = 'partial' if ctx.notes else 'full'
        sig.notes = list(ctx.notes)
        return self.assemble(fn_ident(name), ', '.join(pdecl), returns, self.lines, ctx.decls)

    def cast_inline(self, sel, tcols):
        """wrap the inline TVF select so that its columns have exactly the declared types"""
        sql, cols = self.select_full(sel, Scope())
        names = ', '.join(ident(c.name) for c in tcols)
        casts = ', '.join('(t.%s)::%s' % (ident(c.name), c.pg) for c in tcols)
        return 'SELECT %s FROM (%s) AS t(%s)' % (casts, sql, names)

    # ------------------------------------------------------------------ views
    def translate_view(self, node, src):
        name = node.name[-1]
        self.begin('view', name, src)
        sql, cols = self.select_full(node.sel, Scope())
        tcols = []
        names = node.cols
        for i, (nm, cls) in enumerate(cols):
            nm2 = names[i] if names and i < len(names) else nm
            if nm2:
                tcols.append(Col(nm2, self.cls_default_pg(cls), cls))
        self.catalog.views[name.lower()] = Table(name, tcols)
        colsql = ' (%s)' % ', '.join(ident(c) for c in names) if names else ''
        return 'CREATE OR REPLACE VIEW %s%s AS\n%s;' % (fn_ident(name), colsql, sql)

    # ------------------------------------------------------------------ triggers
    def translate_trigger(self, node, src):
        name = node.name[-1]
        tname = node.table[-1]
        self.begin('trigger', name, src)
        ctx = self.ctx
        table = self.tables.get(tname.lower())
        ctx.trigger_table = table
        self.prescan(node.body)
        body = node.body
        # IF UPDATE(col) [OR UPDATE(col2)...] wrapping the whole body  ->  AFTER UPDATE OF cols
        update_cols = None
        stmts = body
        if len(stmts) == 1 and stmts[0].k == 'block':
            stmts = stmts[0].stmts
        if len(stmts) == 1 and stmts[0].k == 'if' and stmts[0].els is None:
            conds = self.update_calls(stmts[0].cond)
            if conds is not None:
                update_cols = conds
        events = [e for e in node.events if e in ('INSERT', 'UPDATE', 'DELETE')]
        refs_deleted = any(n.k == 'table' and n.parts[-1].lower() == 'deleted' for n in walk_nodes(body))
        refs_inserted = any(n.k == 'table' and n.parts[-1].lower() == 'inserted' for n in walk_nodes(body))
        fn = 'trg_' + name
        fnq = fn_ident(fn)
        guard = shorten('tsql.' + name)[:60]
        self.ind = 1
        self.emit("IF coalesce(current_setting('%s', true), '') = '1' THEN RETURN NULL; END IF;" % guard)
        self.emit("PERFORM set_config('%s', '1', true);" % guard)
        self.stmts(body)
        self.emit("PERFORM set_config('%s', '0', true);" % guard)
        self.emit('RETURN NULL;')
        func = self.assemble(fnq, '', 'trigger', self.lines, ctx.decls)
        trigs = []
        for ev in events:
            ref = {'INSERT': 'REFERENCING NEW TABLE AS inserted', 'DELETE': 'REFERENCING OLD TABLE AS deleted',
                   'UPDATE': 'REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted'}[ev]
            evs = ev
            if ev == 'UPDATE' and update_cols:
                evs = 'UPDATE OF ' + ', '.join(ident(c) for c in update_cols)
            tn = ident(name if len(events) == 1 else '%s_%s' % (name, ev[0].lower()))
            trigs.append('DROP TRIGGER IF EXISTS %s ON %s;\nCREATE TRIGGER %s AFTER %s ON %s\n  %s\n  FOR EACH STATEMENT EXECUTE FUNCTION %s();'
                         % (tn, fn_ident(tname), tn, evs, fn_ident(tname), ref, fnq))
        sig = Sig(name.lower(), 'trigger')
        sig.status = 'partial' if ctx.notes else 'full'
        sig.notes = list(ctx.notes)
        sig.events = events
        sig.table = tname
        return func + '\n' + '\n'.join(trigs), sig

    def update_calls(self, cond):
        if cond.k == 'func' and cond.name[-1].lower() == 'update' and len(cond.args) == 1 and cond.args[0].k == 'col':
            return [cond.args[0].parts[-1]]
        if cond.k == 'bin' and cond.op == 'OR':
            a = self.update_calls(cond.l)
            b = self.update_calls(cond.r)
            if a is not None and b is not None:
                return a + b
        if cond.k == 'paren':
            return self.update_calls(cond.e)
        return None

    # ------------------------------------------------------------------ standalone statements (embedded / DataWindow)
    def standalone(self, node, binds_cls=None):
        """translate a parsed SELECT/INSERT/UPDATE/DELETE with :bind variables -> (sql, binds, select_cols)"""
        self.begin('stmt', 'stmt', '')
        self.bind_types = binds_cls or {}
        if node.k == 'select':
            sql, cols = self.select_full(node, Scope())
            return sql, list(self.binds)
        if node.k == 'select_stmt':
            sql, cols = self.select_full(node.sel, Scope())
            return sql, list(self.binds)
        if node.k == 'insert':
            return self.insert_sql(node), list(self.binds)
        if node.k == 'update':
            return self.update_sql(node), list(self.binds)
        if node.k == 'delete':
            return self.delete_sql(node), list(self.binds)
        raise Untranslatable('statement kind ' + node.k)
