"""Query translation: SELECT / INSERT / UPDATE / DELETE."""
import re
from .parser import Node
from .names import ident, q, fn_ident, shorten
from .schema import map_type, Table, Col
from .texpr import Scope, Untranslatable, contains_agg, is_simple

SYSTABLES = {'sysobjects', 'syscolumns', 'sysindexes', 'sysusers', 'sysdatabases', 'sysprocesses', 'sysfiles', 'syskeys',
             'sysdepends', 'sysforeignkeys', 'sysreferences', 'sysconstraints', 'systypes', 'syscomments', 'sysjobs',
             'sysjobschedules', 'sysjobsteps', 'syslogins', 'sysmessages', 'sysperfinfo', 'sysservers', 'sysfilegroups',
             'sysindexkeys', 'sysprotects', 'syspermissions', 'sysmembers', 'syssegments'}


def walk_nodes(n):
    """generator over all Node descendants"""
    if isinstance(n, Node):
        yield n
        for v in n.__dict__.values():
            for x in walk_nodes(v):
                yield x
    elif isinstance(n, (list, tuple)):
        for v in n:
            for x in walk_nodes(v):
                yield x


class QueryMixin:
    # ------------------------------------------------------------------ names
    def temp_name(self, name):
        n = name.lstrip('#').lower()
        return ident('tmp_' + n)

    def tvar_name(self, name):
        return ident('tv_%s_%s' % (self.ctx.fname.lower(), name.lstrip('@').lower()))

    def lookup_temp(self, key):
        t = self.ctx.temps.get(key)
        return t

    def resolve_table(self, parts):
        """-> (kind, pgname, Table|None, basename)  kinds real temp tvar trans info"""
        parts = list(parts)
        if len(parts) == 4:
            raise Untranslatable('linked-server table ' + '.'.join(parts))
        if len(parts) == 3:
            db, sch, name = parts
            if name.startswith('#'):
                parts = [name]
            elif db.lower() in ('', 'dbo', 'traderdbv3') and sch.lower() in ('', 'dbo'):
                parts = [name]
            elif db.lower() == 'information_schema' or sch.lower() == 'information_schema':
                parts = [sch, name]
            else:
                raise Untranslatable('cross-database table %s.%s.%s' % (db, sch, name))
        if len(parts) == 2:
            sch, name = parts
            if sch.lower() == 'information_schema':
                return ('info', 'information_schema.' + ident(name), None, name.lower())
            if sch.lower() not in ('dbo', ''):
                raise Untranslatable('schema-qualified table %s.%s' % (sch, name))
            parts = [name]
        name = parts[0]
        low = name.lower()
        if name.startswith('#'):
            t = self.ctx.temps.get(low)
            return ('temp', self.temp_name(name), t[1] if t else None, low)
        if name.startswith('@'):
            t = self.ctx.temps.get(low)
            return ('tvar', self.tvar_name(name), t[1] if t else None, low)
        if low in ('inserted', 'deleted') and self.ctx.trigger_table is not None:
            return ('trans', low, self.ctx.trigger_table, low)
        if low in SYSTABLES:
            raise Untranslatable('system table ' + name)
        t = self.ctx.perms.get(low) or self.tables.get(low)
        if t is None:
            t = self.catalog.views.get(low)
        return ('real', 'dbo.' + ident(name), t, low)

    # ------------------------------------------------------------------ SELECT
    def select_sql(self, sel, outer):
        return self.select_full(sel, outer)[0]

    def select_full(self, sel, outer, targets=None):
        """query expression -> (sql, output columns).  targets: columns of the INSERT target (positional coercions)"""
        members = []
        cur = sel
        while cur is not None:
            members.append(cur)
            cur = cur.union[2] if cur.union else None
        union = len(members) > 1
        unify = None
        nbinds = len(self.binds)
        for attempt in (0, 1):
            del self.binds[nbinds:]
            parts, cols, first_scope, single_limit = [], None, None, ''
            metas = []
            member_nulls = []
            first_names = None
            for i, m in enumerate(members):
                sql, mcols, msc, limit = self.select_core(m, outer, targets=targets, unify=unify)
                if union and limit.endswith(' FOR UPDATE') or (union and ' FOR UPDATE OF ' in limit):
                    limit = limit[:limit.index(' FOR UPDATE')]
                metas.append(mcols)
                if i == 0:
                    cols, first_scope = mcols, msc
                    raw0 = list(getattr(self, 'last_raw', []))
                member_nulls.append(list(getattr(self, 'last_nulls', [])))
                if union:
                    if limit or (i > 0 and m.order):
                        if i > 0 and m.order:
                            sql += ' ORDER BY ' + ', '.join(self.Es(e, msc) + (' DESC' if d else '') for e, d in m.order)
                        sql = '(%s%s)' % (sql, limit)
                    parts.append(sql)
                    if m.union:
                        op, all_, _ = m.union
                        parts.append(op + (' ALL' if all_ else ''))
                else:
                    parts.append(sql)
                    single_limit = limit
            if not union or attempt == 1:
                break
            unify = self.union_plan(metas, member_nulls)
            if not unify:
                break
        sql = ' '.join(parts)
        if sel.order:
            osc = first_scope if first_scope is not None else Scope(outer)
            items = []
            names0 = [c[0] for c in cols] if cols else []
            for e, desc in sel.order:
                if union:
                    e0 = e
                    e = self.union_order_item(e, sel)
                    pos = self.order_ordinal(e0, osc, raw0, sel)
                    if pos is None and e is not e0:
                        pos = self.order_ordinal(e, osc, raw0, sel)
                    if pos is not None:
                        items.append(str(pos) + (' DESC' if desc else ''))
                        continue
                    if not (e.k == 'col' and len(e.parts) == 1):
                        continue      # T-SQL accepts expressions that are not output columns; PostgreSQL cannot - tie-breaker dropped
                else:
                    e = self.group_order_item(e, sel)
                    if e.k == 'col' and len(e.parts) == 1 and names0.count(e.parts[0].lower()) > 1:
                        items.append(str(names0.index(e.parts[0].lower()) + 1) + (' DESC' if desc else ''))
                        continue
                items.append(self.Es(e, osc) + (' DESC' if desc else ''))
            sql += ' ORDER BY ' + ', '.join(items)
        sql += single_limit
        sql = sql.replace(' ORDER BY ' + '', ' ORDER BY ') if sel.order and not union else sql
        if union and sel.order and sql.rstrip().endswith('ORDER BY'):
            sql = sql.rstrip()[:-len('ORDER BY')].rstrip()
        return sql, cols

    def order_ordinal(self, e, osc, raw0, first):
        """ORDER BY item of a UNION -> position in the select list (T-SQL matches by expression)"""
        if e.k == 'lit':
            return None
        nb = len(self.binds)
        try:
            sql = self.Es(e, osc)
        except Untranslatable:
            return None
        finally:
            del self.binds[nb:]
        for j, r in enumerate(raw0):
            if r == sql:
                return j + 1
        if e.k == 'col':
            last = e.parts[-1].lower()
            hits = [j for j, it in enumerate(first.items)
                    if (it.alias or (it.e.parts[-1] if it.e.k == 'col' else '') or '').lower() == last]
            if hits:
                return hits[0] + 1
        return None

    @staticmethod
    def colkey(x):
        ps = [p.lower() for p in x.parts if p != '']
        if len(ps) > 2 and ps[0] == 'dbo':
            ps = ps[1:]
        return tuple(ps[-2:])

    def group_order_item(self, e, sel):
        if e.k != 'col' or not sel.group or sel.where is None:
            return e
        gset = set(self.colkey(g) for g in sel.group if g.k == 'col')
        if self.colkey(e) in gset or len(e.parts) < 2:
            return e
        conj, stack = [], [sel.where]
        while stack:
            c = stack.pop()
            if c.k == 'paren':
                stack.append(c.e)
            elif c.k == 'bin' and c.op == 'AND':
                stack.extend([c.l, c.r])
            elif c.k == 'bin' and c.op == '=' and c.l.k == 'col' and c.r.k == 'col':
                conj.append(c)
        me = self.colkey(e)
        for c in conj:
            for a, b in ((c.l, c.r), (c.r, c.l)):
                if self.colkey(a) == me and self.colkey(b) in gset:
                    return b
        last = e.parts[-1].lower()
        for it in sel.items:
            if it.alias and it.alias.lower() == last and not (it.e.k == 'col' and self.colkey(it.e) == me):
                return Node('col', parts=[it.alias])
        return e

    def union_order_item(self, e, first):
        """ORDER BY of a UNION: qualified columns refer to the output column names"""
        if e.k == 'col' and len(e.parts) > 1:
            key = [p.lower() for p in e.parts if p != ''][-2:]
            for it in first.items:
                if it.e.k == 'col' and [p.lower() for p in it.e.parts if p != ''][-2:] == key:
                    return Node('col', parts=[it.alias or it.e.parts[-1]])
            last = e.parts[-1].lower()
            for it in first.items:
                nm = it.alias or (it.e.parts[-1] if it.e.k == 'col' else None)
                if nm and nm.lower() == last:
                    return Node('col', parts=[nm])
            return Node('col', parts=[e.parts[-1]])
        return e

    def union_plan(self, metas, nulls=None):
        """columns of a UNION that need casts: {index: target class}.  Either the static class differs between the members, or some
        member has a typeless NULL there (PostgreSQL resolves NULL-only branches of a chained UNION to text)"""
        n = min(len(m) for m in metas)
        plan = {}
        rank = {'D': 4, 'N': 3, 'I': 2, 'S': 1}
        for j in range(n):
            cl = [m[j][1] for m in metas if m[j][1] in rank]
            has_null = nulls is not None and any(j < len(nl) and nl[j] for nl in nulls)
            if cl and (len(set(cl)) > 1 or has_null):
                plan[j] = max(cl, key=lambda c: rank[c])
        return plan

    def select_core(self, s, outer, targets=None, unify=None):
        sc = Scope(outer)
        frm = ''
        if s.frm:
            frm = ' FROM ' + self.from_list(s.frm, sc)
        items, cols = self.select_items(s.items, sc, targets, unify)
        parts = ['SELECT']
        if s.distinct:
            parts.append('DISTINCT')
        parts.append(', '.join(items))
        sql = ' '.join(parts) + frm
        if s.where is not None:
            sql += ' WHERE ' + self.Es(s.where, sc)
        if s.group:
            if s.group_all:
                raise Untranslatable('GROUP BY ALL')
            sql += ' GROUP BY ' + ', '.join(self.Es(g, sc) for g in s.group)
        if s.having is not None:
            sql += ' HAVING ' + self.Es(s.having, sc)
        limit = ''
        if s.top is not None:
            if s.top_pct:
                raise Untranslatable('TOP PERCENT')
            tp = self.Es(s.top, sc)
            if s.with_ties:
                limit = ' FETCH FIRST %s ROWS WITH TIES' % tp
            else:
                limit = ' LIMIT %s' % tp
        locks = getattr(sc, 'rowlocks', None)
        if locks and not s.distinct and not s.group and not s.union and not any(contains_agg(it.e) for it in s.items):
            limit += ' FOR UPDATE OF ' + ', '.join(ident(x) for x in locks)
        return sql, cols, sc, limit

    def unify_cast(self, e, s, c, target_cls):
        if e.k == 'lit' and e.t == 'null':
            return 'NULL::%s' % {'D': 'timestamp', 'N': 'numeric', 'I': 'integer', 'S': 'citext'}.get(target_cls, 'text')
        if e.k == 'bind' and target_cls in ('D', 'N', 'I'):
            return '(%s)::%s' % (s, {'D': 'timestamp', 'N': 'numeric', 'I': 'numeric'}[target_cls])
        if c == target_cls or c in ('U', 'P'):
            return s
        if c == 'S':
            if e.k == 'lit' and e.t == 'str' and e.v.strip() == '':
                return "timestamp '1900-01-01'" if target_cls == 'D' else '0'
            return '(%s)::%s' % (s, 'timestamp' if target_cls == 'D' else 'numeric')
        if target_cls == 'S':
            return '(%s)::text' % s
        if target_cls == 'D' and c in ('I', 'N'):
            return "(timestamp '1900-01-01' + (%s) * interval '1 day')" % s
        if target_cls == 'N' and c == 'I':
            return s
        return s

    def select_items(self, items, sc, targets=None, unify=None):
        out, cols = [], []
        raw = []
        nulls = []
        self.last_raw = raw
        self.last_nulls = nulls
        pos = 0
        for it in items:
            if it.var is not None:
                raise Untranslatable('variable assignment inside query expression')
            e = it.e
            if e.k == 'star':
                s, _ = self.E(e, sc)
                out.append(s)
                sc_cols = self.star_cols(e, sc)
                cols.extend(sc_cols)
                pos += len(sc_cols)
                targets = None
                continue
            s, c = self.E(e, sc)
            if unify and pos in unify:
                s = self.unify_cast(e, s, c, unify[pos])
                c = unify[pos]
            elif targets is not None and pos < len(targets):
                s = self.coerce_col(e, s, c, targets[pos])
            name = it.alias
            if name is None and e.k == 'col':
                name = e.parts[-1]
            if name is None and e.k == 'paren' and e.e.k == 'col':
                name = e.e.parts[-1]
            raw.append(s)
            nulls.append(e.k == 'lit' and e.t == 'null')
            if it.alias is not None:
                s = '%s AS %s' % (s, ident(it.alias))
            elif name is not None and unify and pos in unify and e.k == 'col':
                s = '%s AS %s' % (s, ident(name))
            out.append(s)
            cols.append((name.lower() if name else None, c))
            pos += 1
        return out, cols

    def star_cols(self, e, sc):
        cols = []
        if e.q:
            qual = [p for p in e.q if p != ''][-1].lower()
            t = sc.table_of(qual)
            if t is not None:
                return [(c.name.lower(), c.cls) for c in t.cols]
            return [(None, 'U')]
        for alias, t in sc.items:
            if t is None:
                return [(None, 'U')]
            cols.extend((c.name.lower(), c.cls) for c in t.cols)
        return cols

    # ------------------------------------------------------------------ FROM
    def from_list(self, srcs, sc):
        return ', '.join(self.from_src(s, sc) for s in srcs)

    def from_src(self, n, sc):
        k = n.k
        if k == 'table':
            kind, pg, t, base = self.resolve_table(n.parts)
            alias = n.alias
            reg = alias or n.parts[-1]
            sc.add(reg, t)
            if 'UPDLOCK' in n.hints or 'XLOCK' in n.hints:
                sc.rowlocks = getattr(sc, 'rowlocks', []) + [alias or n.parts[-1].lstrip('#')]
            if kind in ('temp', 'tvar') and not alias:
                sc.add(n.parts[-1].lstrip('#@'), t)
            sql = pg
            if alias:
                sql += ' AS ' + ident(alias)
            elif kind in ('temp', 'tvar'):
                sql += ' AS ' + ident(n.parts[-1].lstrip('#@'))
            return sql
        if k == 'tvar':
            low = n.name.lower() if n.name.startswith('@') else '@' + n.name.lower()
            t = self.ctx.temps.get(low)
            tab = t[1] if t else None
            sc.add(n.alias or n.name, tab)
            return '%s AS %s' % (self.tvar_name(n.name), ident(n.alias or n.name))
        if k == 'derived':
            sub_outer = sc.parent
            sql, cols = self.select_full(n.sel, sub_outer)
            names = n.cols
            tcols = []
            for i, (nm, cls) in enumerate(cols):
                nm2 = names[i].lower() if names and i < len(names) else nm
                if nm2:
                    tcols.append(Col(nm2, '', cls))
            sc.add(n.alias, Table(n.alias or '', tcols))
            sql = '(%s) AS %s' % (sql, ident(n.alias)) if n.alias else '(%s)' % sql
            if names:
                sql += '(%s)' % ', '.join(ident(x) for x in names)
            return sql
        if k == 'tfunc':
            parts = [p for p in n.name if p != '']
            lname = parts[-1].lower()
            if len(parts) > 2 or (len(parts) == 2 and parts[0].lower() != 'dbo'):
                raise Untranslatable('cross-database table function')
            sig = self.catalog.funcs.get(lname)
            args = []
            for i, a in enumerate(n.args):
                s, c = self.E(a, sc)
                if sig is not None and i < len(sig.params):
                    s = self.coerce_to(a, s, c, sig.params[i].pgtype, sig.params[i].cls)
                args.append(s)
            tab = sig.ret_table if sig is not None else None
            sc.add(n.alias or lname, tab)
            return '%s(%s) AS %s' % (fn_ident(lname), ', '.join(args), ident(n.alias or lname))
        if k == 'join':
            l = self.from_src(n.l, sc)
            r = self.from_src(n.r, sc)
            kw = {'INNER': 'JOIN', 'LEFT': 'LEFT JOIN', 'RIGHT': 'RIGHT JOIN', 'FULL': 'FULL JOIN', 'CROSS': 'CROSS JOIN'}[n.kind]
            if n.kind == 'CROSS' or n.on is None:
                return '%s %s %s' % (l, 'CROSS JOIN' if n.on is None else kw, r) + ('' if n.on is None else '')
            return '%s %s %s ON %s' % (l, kw, r, self.Es(n.on, sc))
        if k == 'group':
            return '(%s)' % self.from_src(n.src, sc)
        raise Untranslatable('FROM source ' + k)

    # ------------------------------------------------------------------ target helpers
    def target_info(self, t):
        """INSERT/UPDATE/DELETE target -> (kind, pgname, Table|None, base)"""
        if t.k == 'tvar':
            low = t.name.lower() if t.name.startswith('@') else '@' + t.name.lower()
            tab = self.ctx.temps.get(low)
            return ('tvar', self.tvar_name(t.name), tab[1] if tab else None, low)
        return self.resolve_table(t.parts)

    # ------------------------------------------------------------------ INSERT
    def insert_sql(self, n, sc_outer=None):
        kind, pg, tab, base = self.target_info(n.target)
        sc = Scope()
        cols_sql = ''
        names = None
        if n.cols:
            names = [c for c in n.cols]
            cols_sql = ' (%s)' % ', '.join(ident(c) for c in names)

        def target_cols(names, count):
            if tab is None:
                return None
            if names is not None:
                return [tab.by.get(x.lower()) for x in names]
            return None

        if n.sel is not None:
            # figure out the column list first (identity columns are skipped when the select has one column fewer)
            if names is None and tab is not None:
                nb0 = len(self.binds)
                sql0, ocols = self.select_full(n.sel, Scope())
                del self.binds[nb0:]
                ins = [c for c in tab.cols if c.identity]
                if ins and ocols and all(c[0] != '*' for c in ocols):
                    noni = [c for c in tab.cols if not c.identity]
                    if len(ocols) == len(noni) and len(ocols) != len(tab.cols):
                        names = [c.name for c in noni]
                        cols_sql = ' (%s)' % ', '.join(ident(c) for c in names)
            tc = None
            if tab is not None:
                if names is not None:
                    tc = [tab.by.get(x.lower()) for x in names]
                else:
                    tc = list(tab.cols)
            sql, ocols = self.select_full(n.sel, Scope(), targets=tc)
            return 'INSERT INTO %s%s %s' % (pg, cols_sql, sql)
        if getattr(n, 'defaults', False):
            return 'INSERT INTO %s DEFAULT VALUES' % pg
        if names is None and tab is not None and n.rows:
            ins = [c for c in tab.cols if c.identity]
            nvals = len(n.rows[0])
            if ins and nvals == len(tab.cols) - len(ins):
                names = [c.name for c in tab.cols if not c.identity]
                cols_sql = ' (%s)' % ', '.join(ident(c) for c in names)
        tc = None
        if tab is not None:
            tc = [tab.by.get(x.lower()) for x in names] if names is not None else list(tab.cols)
        rows = []
        for row in n.rows:
            vals = []
            for i, e in enumerate(row):
                s, c = self.E(e, sc)
                if tc is not None and i < len(tc):
                    s = self.coerce_col(e, s, c, tc[i])
                vals.append(s)
            rows.append('(%s)' % ', '.join(vals))
        return 'INSERT INTO %s%s VALUES %s' % (pg, cols_sql, ', '.join(rows))

    # ------------------------------------------------------------------ UPDATE / DELETE
    def find_target(self, n, srcs):
        """locate the target table inside the FROM list.  -> (path, node) or None
        path: ('top', idx) | ('left', idx) when target is the left-most leaf of an all-inner join tree | ('deep', idx)"""
        tkind = n.target.k
        tparts = n.target.parts if tkind == 'table' else None
        tname = (tparts[-1] if tparts else n.target.name).lower().lstrip('@') if True else None
        tname_full = (tparts[-1] if tparts else n.target.name).lower()
        refs = [x for x in walk_nodes(srcs) if x.k == 'table' and x.parts[-1].lower() == tname_full]
        single = len(refs) == 1
        aliased = any(x.alias is not None and x.alias.lower() == tname_full for x in walk_nodes(srcs) if x.k == 'table')

        def matches(x):
            if x.k == 'table':
                if x.alias is not None and x.alias.lower() == tname_full:
                    return True
                if x.alias is not None:
                    return single and not aliased and x.parts[-1].lower() == tname_full
                return x.parts[-1].lower() == tname_full
            if x.k == 'tvar':
                if x.alias is not None:
                    return x.alias.lower() == tname_full
                return x.name.lower() == tname_full or ('@' + x.name.lower()) == tname_full
            return False

        def contains(x):
            if matches(x):
                return True
            if x.k == 'join':
                return contains(x.l) or contains(x.r)
            if x.k == 'group':
                return contains(x.src)
            return False

        for i, s in enumerate(srcs):
            if matches(s):
                return ('top', i, s)
        for i, s in enumerate(srcs):
            if s.k == 'join' and contains(s):
                # left-most leaf of an inner-join chain?
                chain, cur, ok = [], s, True
                while cur.k == 'join':
                    if cur.kind not in ('INNER', 'CROSS'):
                        ok = False
                    chain.append(cur)
                    cur = cur.l
                if ok and matches(cur):
                    return ('left', i, cur)
                return ('deep', i, None)
        for i, s in enumerate(srcs):
            if s.k == 'group' and contains(s):
                return ('deep', i, None)
        return None

    def flatten_inner(self, s):
        """inner-join chain -> (leaf list, [conditions]) ; leaves excludes the left-most leaf"""
        leaves, conds = [], []
        chain = []
        cur = s
        while cur.k == 'join':
            chain.append(cur)
            cur = cur.l
        for j in reversed(chain):
            leaves.append(j.r)
            if j.on is not None:
                conds.append(j.on)
        return cur, leaves, conds

    def dml_common(self, n, is_update):
        kind, pg, tab, base = self.target_info(n.target)
        tname = n.target.parts[-1] if n.target.k == 'table' else n.target.name
        info = {'kind': kind, 'pg': pg, 'tab': tab}
        sc = Scope()
        alias = None
        from_sql = ''
        extra_where = []
        ctid_mode = False
        frm = n.frm
        if not frm:
            sc.add(tname.lstrip('#@'), tab)
            sc.add(tname, tab)
            return info, sc, None, '', [], False
        found = self.find_target(n, frm)
        if found is None:
            sc.add(tname.lstrip('#@'), tab)
            sc.add(tname, tab)
            from_sql = self.from_list(frm, sc)
            return info, sc, None, from_sql, [], False
        mode, idx, leaf = found
        if mode in ('top', 'left'):
            if mode == 'top':
                tnode = leaf
                rest = frm[:idx] + frm[idx + 1:]
                conds = []
            else:
                tnode, leaves, conds = self.flatten_inner(frm[idx])
                rest = frm[:idx] + leaves + frm[idx + 1:]
            if tnode.k == 'table':
                k2, pg2, tab2, _ = self.resolve_table(tnode.parts)
                info = {'kind': k2, 'pg': pg2, 'tab': tab2}
            else:
                k2, pg2, tab2, _ = self.target_info(Node('tvar', name=tnode.name, alias=None))
                info = {'kind': k2, 'pg': pg2, 'tab': tab2}
            talias = tnode.alias or (tnode.parts[-1].lstrip('#') if tnode.k == 'table' else tnode.name.lstrip('@'))
            alias = talias
            sc.add(talias, info['tab'])
            if tnode.k == 'table':
                sc.add(tnode.parts[-1], info['tab'])
            from_sql = self.from_list(rest, sc) if rest else ''
            extra_where = [self.Es(c, sc) for c in conds]
            return info, sc, alias, from_sql, extra_where, False
        # deep: ctid fallback
        sc2 = Scope()
        from_sql = self.from_list(frm, sc2)
        return info, sc2, None, from_sql, [], True

    def update_sql(self, n):
        if n.top is not None:
            raise Untranslatable('UPDATE TOP')
        info, sc, alias, from_sql, extra, ctid = self.dml_common(n, True)
        tname = n.target.parts[-1] if n.target.k == 'table' else n.target.name
        sets = []
        for tgt, op, e in n.sets:
            if tgt[0] == 'var':
                raise Untranslatable('UPDATE ... SET @variable = ...')
            col = tgt[1][-1]
            s, c = self.E(e, sc)
            if op != '=':
                cur = ident(col)
                s = '%s %s (%s)' % (cur, op[0], s)
            elif info['tab'] is not None:
                s = self.coerce_col(e, s, c, info['tab'].by.get(col.lower()))
            sets.append((col, s))
        where_sql = ''
        if n.where is not None:
            if n.where.k == 'current_of':
                where_sql = ' WHERE CURRENT OF %s' % self.cursor_var(n.where.cursor)
            else:
                w = self.Es(n.where, sc)
                where_sql = ' WHERE ' + ' AND '.join(extra + [w])
        elif extra:
            where_sql = ' WHERE ' + ' AND '.join(extra)
        if ctid:
            tnode = self.find_target(n, n.frm)
            # alias of the target inside the original FROM
            talias = self.target_alias_in(n, n.frm)
            vals = ', '.join('%s AS _v%d' % (s, i) for i, (_, s) in enumerate(sets))
            inner_w = ''
            if n.where is not None:
                inner_w = ' WHERE ' + self.Es(n.where, sc)
            sub = 'SELECT %s.ctid AS _id, %s FROM %s%s' % (ident(talias), vals, from_sql, inner_w)
            return 'UPDATE %s AS _t SET %s FROM (%s) AS _s WHERE _t.ctid = _s._id' % (
                info['pg'], ', '.join('%s = _s._v%d' % (ident(c), i) for i, (c, _) in enumerate(sets)), sub)
        if not alias and info['kind'] in ('temp', 'tvar'):
            alias = tname.lstrip('#@')
        a = ' AS ' + ident(alias) if alias else ''
        return 'UPDATE %s%s SET %s%s%s' % (info['pg'], a, ', '.join('%s = %s' % (ident(c), s) for c, s in sets),
                                           (' FROM ' + from_sql) if from_sql else '', where_sql)

    def target_alias_in(self, n, frm):
        tname = (n.target.parts[-1] if n.target.k == 'table' else n.target.name).lower()
        for x in walk_nodes(frm):
            if x.k == 'table':
                if (x.alias and x.alias.lower() == tname) or (not x.alias and x.parts[-1].lower() == tname):
                    return x.alias or x.parts[-1]
        return tname

    def delete_sql(self, n):
        if n.top is not None:
            raise Untranslatable('DELETE TOP')
        info, sc, alias, from_sql, extra, ctid = self.dml_common(n, False)
        where_sql = ''
        if n.where is not None:
            if n.where.k == 'current_of':
                where_sql = ' WHERE CURRENT OF %s' % self.cursor_var(n.where.cursor)
            else:
                w = self.Es(n.where, sc)
                where_sql = ' WHERE ' + ' AND '.join(extra + [w])
        elif extra:
            where_sql = ' WHERE ' + ' AND '.join(extra)
        if ctid:
            talias = self.target_alias_in(n, n.frm)
            inner_w = ''
            if n.where is not None:
                inner_w = ' WHERE ' + self.Es(n.where, sc)
            return 'DELETE FROM %s WHERE ctid IN (SELECT %s.ctid FROM %s%s)' % (info['pg'], ident(talias), from_sql, inner_w)
        if not alias and info['kind'] in ('temp', 'tvar'):
            alias = (n.target.parts[-1] if n.target.k == 'table' else n.target.name).lstrip('#@')
        a = ' AS ' + ident(alias) if alias else ''
        return 'DELETE FROM %s%s%s%s' % (info['pg'], a, (' USING ' + from_sql) if from_sql else '', where_sql)
