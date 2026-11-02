"""Recursive-descent parser for the T-SQL subset used by the Trader App database, PowerBuilder embedded SQL
and DataWindow retrieve statements.  Produces a light AST of `Node` objects (kind in .k).

Nodes (fields):
 expressions : lit(t,v) col(parts) var(name) gvar(name) bind(name) func(name,args,distinct) bin(op,l,r) un(op,e)
               between(e,lo,hi,neg) in(e,items,sub,neg) like(e,pat,esc,neg) isnull(e,neg) exists(sel)
               sub(sel) case(operand,whens,els) cast(e,type) convert(type,e,style) quant(op,q,sel) star(q) default
 query       : select(distinct,top,top_pct,items,into,frm,where,group,having,order,union) ; item(e,alias,var,op)
               from sources: table(parts,alias,hints) derived(sel,alias,cols) tfunc(name,args,alias) tvar(name,alias)
               join(kind,l,r,on)
 statements  : see Parser.statement
"""
from .lexer import tokenize, Token, LexError


class ParseError(Exception):
    def __init__(self, msg, pos=None, src=None):
        Exception.__init__(self, msg)
        self.msg = msg
        self.pos = pos
        self.src = src

    def __str__(self):
        if self.src is not None and self.pos is not None:
            a = max(0, self.pos - 60)
            return '%s at %d near ...%s<<HERE>>%s...' % (self.msg, self.pos, self.src[a:self.pos].replace('\n', ' '),
                                                      self.src[self.pos:self.pos + 60].replace('\n', ' '))
        return self.msg


class Node:
    def __init__(self, k, **f):
        self.k = k
        self.__dict__.update(f)

    def __repr__(self):
        return 'Node(%s)' % ', '.join('%s=%r' % kv for kv in self.__dict__.items())

    def copy(self, **kw):
        d = dict(self.__dict__)
        k = d.pop('k')
        d.update(kw)
        return Node(k, **d)


# words that can never be an implicit (AS-less) alias / that start or continue statements
STOP = set('''FROM WHERE GROUP HAVING ORDER UNION INTERSECT EXCEPT INTO FOR COMPUTE ON JOIN INNER LEFT RIGHT FULL CROSS OUTER
SET SELECT INSERT UPDATE DELETE DECLARE IF ELSE WHILE BEGIN END RETURN EXEC EXECUTE PRINT OPEN CLOSE FETCH DEALLOCATE DROP CREATE
ALTER TRUNCATE COMMIT ROLLBACK RAISERROR GOTO BREAK CONTINUE WAITFOR USE GO AND OR NOT IN IS LIKE BETWEEN EXISTS AS WITH OPTION
VALUES CASE WHEN THEN NULL TOP DISTINCT ALL ANY SOME ASC DESC BY SAVE KILL DBCC BACKUP RESTORE GRANT REVOKE DENY SETUSER
CHECKPOINT SHUTDOWN ESCAPE PERCENT TIES OUTPUT TRAN TRANSACTION TRY CATCH USING READTEXT WRITETEXT UPDATETEXT LOAD DUMP
RECONFIGURE LOOP HASH MERGE REMOTE SCHEMABINDING'''.split())

STMT_START = set('''SELECT INSERT UPDATE DELETE DECLARE IF ELSE WHILE BEGIN END RETURN EXEC EXECUTE PRINT OPEN CLOSE FETCH
DEALLOCATE DROP CREATE ALTER TRUNCATE COMMIT ROLLBACK RAISERROR GOTO BREAK CONTINUE WAITFOR USE SET SAVE KILL DBCC BACKUP
RESTORE GRANT REVOKE DENY SETUSER CHECKPOINT SHUTDOWN READTEXT WRITETEXT UPDATETEXT LOAD DUMP RECONFIGURE'''.split())

JOIN_WORDS = {'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN'}
HINT_WORDS = {'NOLOCK', 'INDEX', 'HOLDLOCK', 'READPAST', 'ROWLOCK', 'TABLOCK', 'TABLOCKX', 'UPDLOCK', 'XLOCK', 'PAGLOCK',
              'READUNCOMMITTED', 'READCOMMITTED', 'REPEATABLEREAD', 'SERIALIZABLE', 'FASTFIRSTROW', 'NOWAIT', 'PAGLOCK'}


class Parser:
    def __init__(self, src, binds=False, dq_is_string=False):
        self.src = src
        self.toks = tokenize(src, binds=binds, dq_is_string=dq_is_string)
        self.i = 0

    # ---- token helpers -------------------------------------------------
    @property
    def t(self):
        return self.toks[self.i]

    def peek(self, n=1):
        j = self.i + n
        return self.toks[j] if j < len(self.toks) else self.toks[-1]

    def err(self, msg):
        raise ParseError(msg, self.t.pos, self.src)

    def adv(self):
        t = self.toks[self.i]
        if t.kind != 'eof':
            self.i += 1
        return t

    def kw(self, *names):
        return self.t.kind == 'id' and self.t.value.upper() in names

    def accept_kw(self, *names):
        if self.kw(*names):
            return self.adv()
        return None

    def expect_kw(self, *names):
        if not self.kw(*names):
            self.err('expected %s' % '/'.join(names))
        return self.adv()

    def op(self, *ops):
        return self.t.kind == 'op' and self.t.value in ops

    def accept_op(self, *ops):
        if self.op(*ops):
            return self.adv()
        return None

    def expect_op(self, o):
        if not self.op(o):
            self.err('expected %r' % o)
        return self.adv()

    def at_end(self):
        return self.t.kind == 'eof'

    # ---- identifiers & types --------------------------------------------
    def ident_tok(self):
        t = self.t
        if t.kind in ('id', 'qid'):
            return t
        return None

    def parse_name_parts(self):
        """dotted object name: a.b.c ; empty parts allowed (db..tbl).  returns list of strings"""
        t = self.t
        if t.kind not in ('id', 'qid'):
            self.err('expected name')
        parts = [self.adv().value]
        while self.op('.'):
            self.adv()
            if self.op('.'):          # db..tbl
                parts.append('')
                continue
            if self.t.kind not in ('id', 'qid'):
                self.err('expected name after .')
            parts.append(self.adv().value)
        return parts

    def parse_type(self):
        t = self.t
        if t.kind not in ('id', 'qid'):
            self.err('expected type')
        name = self.adv().value
        if self.op('.'):      # [dbo].[udt]
            self.adv()
            name = self.adv().value
        args = []
        if self.op('('):
            self.adv()
            while not self.op(')'):
                a = self.adv()
                args.append(a.value)
                self.accept_op(',')
            self.expect_op(')')
        nm = name.lower()
        if nm == 'double' and self.kw('PRECISION'):
            self.adv()
            nm = 'float'
        if nm == 'national' or nm == 'character' or nm == 'binary' and self.kw('VARYING'):
            pass
        return Node('type', name=nm, args=args)

    # ---- expressions ---------------------------------------------------
    def parse_expr(self):
        return self.parse_or()

    def parse_or(self):
        l = self.parse_and()
        while self.kw('OR'):
            self.adv()
            l = Node('bin', op='OR', l=l, r=self.parse_and())
        return l

    def parse_and(self):
        l = self.parse_not()
        while self.kw('AND'):
            self.adv()
            l = Node('bin', op='AND', l=l, r=self.parse_not())
        return l

    def parse_not(self):
        if self.kw('NOT'):
            self.adv()
            return Node('un', op='NOT', e=self.parse_not())
        return self.parse_predicate()

    CMP = ('=', '<>', '!=', '<', '>', '<=', '>=', '!<', '!>', '*=', '=*')

    def parse_predicate(self):
        l = self.parse_add()
        while True:
            t = self.t
            if t.kind == 'op' and t.value in self.CMP:
                op = self.adv().value
                if self.kw('ALL', 'ANY', 'SOME') and self.peek().is_op('('):
                    q = self.adv().value.upper()
                    self.expect_op('(')
                    sel = self.parse_select()
                    self.expect_op(')')
                    l = Node('quant', op=op, q=q, l=l, sel=sel)
                else:
                    l = Node('bin', op=op, l=l, r=self.parse_add())
                continue
            neg = False
            if self.kw('NOT') and self.peek().kind == 'id' and self.peek().value.upper() in ('BETWEEN', 'IN', 'LIKE'):
                self.adv()
                neg = True
            if self.kw('BETWEEN'):
                self.adv()
                lo = self.parse_add()
                self.expect_kw('AND')
                hi = self.parse_add()
                l = Node('between', e=l, lo=lo, hi=hi, neg=neg)
                continue
            if self.kw('IN'):
                self.adv()
                self.expect_op('(')
                if self.kw('SELECT'):
                    sel = self.parse_select()
                    self.expect_op(')')
                    l = Node('in', e=l, items=None, sub=sel, neg=neg)
                else:
                    items = [self.parse_expr()]
                    while self.accept_op(','):
                        items.append(self.parse_expr())
                    self.expect_op(')')
                    l = Node('in', e=l, items=items, sub=None, neg=neg)
                continue
            if self.kw('LIKE'):
                self.adv()
                pat = self.parse_add()
                esc = None
                if self.kw('ESCAPE'):
                    self.adv()
                    esc = self.parse_add()
                l = Node('like', e=l, pat=pat, esc=esc, neg=neg)
                continue
            if self.kw('IS'):
                self.adv()
                n2 = bool(self.accept_kw('NOT'))
                self.expect_kw('NULL')
                l = Node('isnull', e=l, neg=n2)
                continue
            return l

    def parse_add(self):
        l = self.parse_mul()
        while self.t.kind == 'op' and self.t.value in ('+', '-', '&', '|', '^'):
            op = self.adv().value
            l = Node('bin', op=op, l=l, r=self.parse_mul())
        return l

    def parse_mul(self):
        l = self.parse_unary()
        while self.t.kind == 'op' and self.t.value in ('*', '/', '%'):
            op = self.adv().value
            l = Node('bin', op=op, l=l, r=self.parse_unary())
        return l

    def parse_unary(self):
        if self.t.kind == 'op' and self.t.value in ('-', '+', '~'):
            op = self.adv().value
            e = self.parse_unary()
            if op == '-' and e.k == 'lit' and e.t == 'num':
                return Node('lit', t='num', v='-' + e.v)
            return Node('un', op=op, e=e)
        e = self.parse_primary()
        if self.kw('COLLATE'):
            self.adv()
            self.adv()
        return e

    def parse_case(self):
        operand = None
        if not self.kw('WHEN'):
            operand = self.parse_expr()
        whens = []
        while self.kw('WHEN'):
            self.adv()
            c = self.parse_expr()
            self.expect_kw('THEN')
            whens.append((c, self.parse_expr()))
        els = None
        if self.accept_kw('ELSE'):
            els = self.parse_expr()
        self.expect_kw('END')
        return Node('case', operand=operand, whens=whens, els=els)

    def parse_primary(self):
        t = self.t
        k = t.kind
        if k == 'num':
            self.adv()
            return Node('lit', t='num', v=t.value)
        if k == 'str':
            self.adv()
            return Node('lit', t='str', v=t.value)
        if k == 'var':
            self.adv()
            return Node('var', name=t.value)
        if k == 'gvar':
            self.adv()
            return Node('gvar', name=t.value.lower())
        if k == 'bind':
            self.adv()
            return Node('bind', name=t.value)
        if k == 'odbc':
            self.adv()
            return Node('odbc', text=t.value)
        if k == 'op':
            if t.value == '(':
                self.adv()
                if self.kw('SELECT'):
                    sel = self.parse_select()
                    self.expect_op(')')
                    return Node('sub', sel=sel)
                e = self.parse_expr()
                self.expect_op(')')
                return Node('paren', e=e)
            if t.value == '*':
                self.adv()
                return Node('star', q=None)
            self.err('unexpected %r in expression' % t.value)
        if k in ('id', 'qid'):
            up = t.value.upper() if k == 'id' else None
            if up == 'NULL':
                self.adv()
                return Node('lit', t='null', v='NULL')
            if up == 'CASE':
                self.adv()
                return self.parse_case()
            if up == 'EXISTS' and self.peek().is_op('('):
                self.adv()
                self.expect_op('(')
                sel = self.parse_select()
                self.expect_op(')')
                return Node('exists', sel=sel)
            if up == 'DEFAULT':
                self.adv()
                return Node('default')
            if up == 'CAST' and self.peek().is_op('('):
                self.adv()
                self.expect_op('(')
                e = self.parse_expr()
                self.expect_kw('AS')
                ty = self.parse_type()
                self.expect_op(')')
                return Node('cast', e=e, type=ty)
            if up in ('CONVERT',) and self.peek().is_op('('):
                self.adv()
                self.expect_op('(')
                ty = self.parse_type()
                self.expect_op(',')
                e = self.parse_expr()
                style = None
                if self.accept_op(','):
                    style = self.parse_expr()
                self.expect_op(')')
                return Node('convert', type=ty, e=e, style=style)
            # name / function / column reference
            parts = [self.adv().value]
            quoted0 = k == 'qid'
            while self.op('.') and self.peek().kind in ('id', 'qid', 'op'):
                nx = self.peek()
                if nx.kind == 'op' and nx.value == '*':
                    self.adv()
                    self.adv()
                    return Node('star', q=parts)
                if nx.kind == 'op' and nx.value == '.':     # a..b
                    self.adv()
                    parts.append('')
                    continue
                if nx.kind == 'op':
                    break
                self.adv()
                parts.append(self.adv().value)
            if self.op('('):
                self.adv()
                args, distinct = [], False
                if self.kw('DISTINCT'):
                    self.adv()
                    distinct = True
                elif self.kw('ALL') and not self.peek().is_op(')'):
                    self.adv()
                if not self.op(')'):
                    args.append(self.parse_expr())
                    while self.accept_op(','):
                        args.append(self.parse_expr())
                self.expect_op(')')
                return Node('func', name=parts, args=args, distinct=distinct)
            return Node('col', parts=parts)
        self.err('unexpected token %r in expression' % (t.value,))

    # ---- SELECT --------------------------------------------------------
    def parse_select(self):
        """query expression: select [UNION [ALL] select]* [ORDER BY ...] [COMPUTE ...]"""
        first = self.parse_select_core()
        cur = first
        while self.kw('UNION', 'INTERSECT', 'EXCEPT'):
            op = self.adv().value.upper()
            all_ = bool(self.accept_kw('ALL'))
            nxt = self.parse_select_core()
            cur.union = (op, all_, nxt)
            cur = nxt
        # ORDER BY / COMPUTE after the whole union belong to the first select node as `order`
        if self.kw('ORDER'):
            first.order = self.parse_order_by()
        if self.kw('COMPUTE'):
            raise ParseError('COMPUTE clause not supported', self.t.pos, self.src)
        if self.kw('FOR') and self.peek().kind == 'id' and self.peek().value.upper() in ('XML', 'BROWSE'):
            raise ParseError('FOR XML not supported', self.t.pos, self.src)
        if self.kw('OPTION') and self.peek().is_op('('):
            self.adv()
            self.skip_parens()
        return first

    def skip_parens(self):
        self.expect_op('(')
        d = 1
        while d:
            t = self.adv()
            if t.kind == 'eof':
                self.err('unbalanced parens')
            if t.is_op('('):
                d += 1
            elif t.is_op(')'):
                d -= 1

    def parse_order_by(self):
        self.expect_kw('ORDER')
        self.expect_kw('BY')
        items = []
        while True:
            e = self.parse_expr()
            d = False
            if self.kw('ASC'):
                self.adv()
            elif self.kw('DESC'):
                self.adv()
                d = True
            items.append((e, d))
            if not self.accept_op(','):
                break
        return items

    def parse_select_core(self):
        if self.op('('):
            self.adv()
            s = self.parse_select()
            self.expect_op(')')
            s.paren = True
            return s
        self.expect_kw('SELECT')
        sel = Node('select', distinct=False, top=None, top_pct=False, items=[], into=None, frm=None, where=None,
                   group=None, having=None, order=None, union=None, with_ties=False, paren=False, group_all=False)
        if self.kw('DISTINCT'):
            self.adv()
            sel.distinct = True
        elif self.kw('ALL'):
            self.adv()
        if self.kw('TOP'):
            self.adv()
            if self.op('('):
                self.adv()
                sel.top = self.parse_expr()
                self.expect_op(')')
            else:
                sel.top = self.parse_primary()
            if self.accept_kw('PERCENT'):
                sel.top_pct = True
            if self.kw('WITH') and self.peek().kind == 'id' and self.peek().value.upper() == 'TIES':
                self.adv()
                self.adv()
                sel.with_ties = True
        sel.items = self.parse_select_items()
        if self.kw('INTO'):
            self.adv()
            if self.t.kind == 'bind':
                sel.into = [self.parse_into_binds()]
            else:
                sel.into = Node('table', parts=self.parse_name_parts(), alias=None, hints=[])
        if self.kw('FROM'):
            self.adv()
            sel.frm = self.parse_from_list()
        if self.kw('WHERE'):
            self.adv()
            sel.where = self.parse_expr()
        if self.kw('GROUP') and self.peek().kind == 'id' and self.peek().value.upper() == 'BY':
            self.adv()
            self.adv()
            if self.accept_kw('ALL'):
                sel.group_all = True
            sel.group = [self.parse_expr()]
            while self.accept_op(','):
                sel.group.append(self.parse_expr())
            if self.kw('WITH') and self.peek().kind == 'id' and self.peek().value.upper() in ('ROLLUP', 'CUBE'):
                raise ParseError('GROUP BY WITH ROLLUP/CUBE not supported', self.t.pos, self.src)
        if self.kw('HAVING'):
            self.adv()
            sel.having = self.parse_expr()
        return sel

    def parse_into_binds(self):
        names = [self.adv().value]
        while self.op(','):
            self.adv()
            if self.t.kind != 'bind':
                self.err('expected :host variable')
            names.append(self.adv().value)
        return Node('into_binds', names=names)

    def parse_select_items(self):
        items = []
        while True:
            items.append(self.parse_select_item())
            if not self.accept_op(','):
                break
            # PowerBuilder host list in "SELECT a, b INTO :x, :y" is handled by caller, not here
        return items

    ASSIGN_OPS = ('=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=')

    def parse_select_item(self):
        t = self.t
        n1 = self.peek()
        if t.kind == 'var' and n1.kind == 'op' and n1.value in self.ASSIGN_OPS:
            self.adv()
            op = self.adv().value
            return Node('item', e=self.parse_expr(), alias=None, var=t.value, op=op)
        if t.kind in ('id', 'qid', 'str') and n1.is_op('=') and not (t.kind == 'id' and t.value.upper() in STOP):
            self.adv()
            self.adv()
            return Node('item', e=self.parse_expr(), alias=t.value, var=None, op=None)
        e = self.parse_expr()
        alias = None
        if self.kw('AS'):
            self.adv()
            a = self.adv()
            if a.kind not in ('id', 'qid', 'str'):
                self.err('expected alias')
            alias = a.value
        elif self.t.kind in ('qid', 'str') or (self.t.kind == 'id' and self.t.value.upper() not in STOP):
            alias = self.adv().value
        return Node('item', e=e, alias=alias, var=None, op=None)

    # ---- FROM ----------------------------------------------------------
    def parse_from_list(self):
        srcs = [self.parse_join_tree()]
        while self.accept_op(','):
            srcs.append(self.parse_join_tree())
        return srcs

    def parse_join_tree(self):
        l = self.parse_table_primary()
        while True:
            kind = None
            if self.kw('JOIN'):
                kind = 'INNER'
            elif self.kw('INNER', 'CROSS', 'LEFT', 'RIGHT', 'FULL'):
                if self.kw('LEFT', 'RIGHT') and self.peek().is_op('('):
                    return l       # LEFT( function, not a join
                kind = self.adv().value.upper()
                self.accept_kw('OUTER')
                if self.kw('LOOP', 'HASH', 'MERGE', 'REMOTE'):
                    self.adv()
                if not self.kw('JOIN'):
                    self.err('expected JOIN')
            else:
                return l
            self.adv()  # JOIN
            r = self.parse_table_primary()
            on = None
            if kind != 'CROSS' and self.kw('ON'):
                self.adv()
                on = self.parse_expr()
            l = Node('join', kind=kind, l=l, r=r, on=on)

    def parse_alias(self):
        if self.kw('AS'):
            self.adv()
            return self.adv().value
        if self.t.kind == 'qid' or (self.t.kind == 'id' and self.t.value.upper() not in STOP):
            return self.adv().value
        return None

    def parse_hints(self):
        hints = []
        if self.kw('WITH') and self.peek().is_op('('):
            self.adv()
            self.skip_parens()
            hints.append('with')
        elif self.op('(') and self.peek().kind == 'id' and self.peek().value.upper() in HINT_WORDS:
            self.skip_parens()
            hints.append('paren')
        return hints

    def parse_table_primary(self):
        t = self.t
        if t.is_op('('):
            self.adv()
            if self.kw('SELECT') or self.op('('):
                sel = self.parse_select()
                self.expect_op(')')
                alias = self.parse_alias()
                cols = None
                if alias and self.op('('):
                    self.adv()
                    cols = [self.adv().value]
                    while self.accept_op(','):
                        cols.append(self.adv().value)
                    self.expect_op(')')
                return Node('derived', sel=sel, alias=alias, cols=cols)
            src = self.parse_join_tree()
            self.expect_op(')')
            return Node('group', src=src)
        if t.kind == 'var':
            self.adv()
            alias = self.parse_alias()
            return Node('tvar', name=t.value, alias=alias)
        if t.kind in ('id', 'qid'):
            if t.kind == 'id' and t.value.upper() == 'OPENQUERY' or (t.kind == 'id' and t.value.upper() in ('OPENROWSET', 'OPENDATASOURCE')):
                raise ParseError('%s not supported' % t.value, t.pos, self.src)
            parts = self.parse_name_parts()
            if self.op('(') and not (self.peek().kind == 'id' and self.peek().value.upper() in HINT_WORDS):
                self.adv()
                args = []
                if not self.op(')'):
                    args.append(self.parse_expr())
                    while self.accept_op(','):
                        args.append(self.parse_expr())
                self.expect_op(')')
                alias = self.parse_alias()
                return Node('tfunc', name=parts, args=args, alias=alias)
            alias = self.parse_alias()
            hints = self.parse_hints()
            if alias is None and hints and False:
                pass
            if alias is None:
                alias = self.parse_alias_after_hints()
            return Node('table', parts=parts, alias=alias, hints=hints)
        self.err('expected table source')

    def parse_alias_after_hints(self):
        return None

    # ---- statements ----------------------------------------------------
    def parse_batch(self):
        """statement list up to EOF"""
        out = []
        while not self.at_end():
            s = self.parse_statement()
            if s is not None:
                out.append(s)
        return out

    def parse_block_until_end(self):
        out = []
        while not self.kw('END') and not self.at_end():
            s = self.parse_statement()
            if s is not None:
                out.append(s)
        return out

    def parse_stmt_body(self):
        """a single statement (BEGIN..END counts as one)"""
        s = self.parse_statement()
        if s is None:
            return Node('block', stmts=[])
        return s

    def statement_pos(self):
        return self.t.pos

    def parse_statement(self):
        pos = self.t.pos
        s = self._statement()
        if s is not None:
            s.pos = pos
            s.end = self.t.pos       # start of the next token: src[pos:end] is the statement text
        return s

    def _statement(self):
        t = self.t
        if t.is_op(';'):
            self.adv()
            return None
        if t.kind not in ('id', 'qid'):
            self.err('statement expected')
        up = t.value.upper() if t.kind == 'id' else ''
        n1 = self.peek()
        # label
        if t.kind == 'id' and n1.is_op(':') and up not in STOP:
            self.adv()
            self.adv()
            return Node('label', name=t.value)
        m = getattr(self, 'st_' + up.lower(), None) if up else None
        if m is None:
            self.err('unsupported statement start %r' % t.value)
        self.adv()
        r = m()
        self.accept_op(';')
        return r

    # control flow
    def st_begin(self):
        if self.kw('TRAN', 'TRANSACTION'):
            self.adv()
            name = None
            if self.t.kind in ('id', 'var') and not (self.t.kind == 'id' and self.t.value.upper() in STOP):
                name = self.adv().value
            if self.kw('WITH') and self.peek().kind == 'id':
                self.adv()
                self.adv()
                if self.t.kind == 'str':
                    self.adv()
            return Node('begintran', name=name)
        if self.kw('DISTRIBUTED'):
            self.adv()
            self.expect_kw('TRAN', 'TRANSACTION')
            return Node('begintran', name=None)
        if self.kw('TRY'):
            self.adv()
            body = self.parse_block_until_end()
            self.expect_kw('END')
            self.expect_kw('TRY')
            self.expect_kw('BEGIN')
            self.expect_kw('CATCH')
            cbody = self.parse_block_until_end()
            self.expect_kw('END')
            self.expect_kw('CATCH')
            return Node('trycatch', body=body, handler=cbody)
        stmts = self.parse_block_until_end()
        self.expect_kw('END')
        return Node('block', stmts=stmts)

    def st_if(self):
        cond = self.parse_expr()
        then = self.parse_stmt_body()
        els = None
        self.accept_op(';')
        if self.kw('ELSE'):
            self.adv()
            els = self.parse_stmt_body()
        return Node('if', cond=cond, then=then, els=els)

    def st_while(self):
        cond = self.parse_expr()
        return Node('while', cond=cond, body=self.parse_stmt_body())

    def st_return(self):
        e = None
        t = self.t
        if self.expr_starts():
            e = self.parse_expr()
        return Node('return', e=e)

    def expr_starts(self):
        t = self.t
        if t.kind in ('num', 'str', 'var', 'gvar', 'bind', 'odbc', 'qid'):
            return True
        if t.kind == 'op':
            return t.value in ('(', '-', '+', '~')
        if t.kind == 'id':
            return t.value.upper() not in STOP or t.value.upper() in ('CASE', 'NULL', 'EXISTS')
        return False

    def st_break(self):
        return Node('break')

    def st_continue(self):
        return Node('continue')

    def st_goto(self):
        return Node('goto', name=self.adv().value)

    def st_print(self):
        return Node('print', e=self.parse_expr())

    def st_waitfor(self):
        w = self.adv().value.upper()
        e = self.parse_expr()
        return Node('waitfor', what=w, e=e)

    def st_raiserror(self):
        paren = bool(self.accept_op('('))
        args = [self.parse_expr()]
        while self.accept_op(','):
            args.append(self.parse_expr())
        if paren:
            self.expect_op(')')
        if self.kw('WITH'):
            self.adv()
            while self.t.kind == 'id' and self.t.value.upper() in ('LOG', 'NOWAIT', 'SETERROR'):
                self.adv()
                self.accept_op(',')
        return Node('raiserror', args=args)

    def st_use(self):
        self.adv()
        return Node('noop', what='USE')

    def st_commit(self):
        self.accept_kw('TRAN', 'TRANSACTION', 'WORK')
        if self.t.kind in ('id', 'var') and not (self.t.kind == 'id' and self.t.value.upper() in STOP):
            self.adv()
        return Node('commit')

    def st_rollback(self):
        self.accept_kw('TRAN', 'TRANSACTION', 'WORK')
        name = None
        if self.t.kind in ('id', 'var') and not (self.t.kind == 'id' and self.t.value.upper() in STOP):
            name = self.adv().value
        return Node('rollback', name=name)

    def st_save(self):
        self.accept_kw('TRAN', 'TRANSACTION')
        self.adv()
        return Node('noop', what='SAVE')

    # DECLARE
    def st_declare(self):
        t = self.t
        if t.kind == 'var':
            decls = []
            while True:
                v = self.adv()
                if v.kind != 'var':
                    self.err('expected @variable')
                self.accept_kw('AS')
                if self.kw('TABLE'):
                    self.adv()
                    cols, cons = self.parse_coldefs()
                    return Node('decltable', name=v.value, cols=cols, cons=cons)
                ty = self.parse_type()
                init = None
                if self.accept_op('='):
                    init = self.parse_expr()
                decls.append((v.value, ty, init))
                if not self.accept_op(','):
                    break
            return Node('declare', vars=decls)
        # cursor
        name = self.adv().value
        if self.kw('INSENSITIVE', 'SCROLL'):
            while self.kw('INSENSITIVE', 'SCROLL'):
                self.adv()
        self.expect_kw('CURSOR')
        opts = []
        while self.kw('LOCAL', 'GLOBAL', 'FORWARD_ONLY', 'SCROLL', 'STATIC', 'KEYSET', 'DYNAMIC', 'FAST_FORWARD',
                      'READ_ONLY', 'SCROLL_LOCKS', 'OPTIMISTIC', 'TYPE_WARNING'):
            opts.append(self.adv().value.upper())
        self.expect_kw('FOR')
        sel = self.parse_select()
        upd = None
        if self.kw('FOR'):
            self.adv()
            if self.accept_kw('READ'):
                self.expect_kw('ONLY')
            else:
                self.expect_kw('UPDATE')
                upd = []
                if self.accept_kw('OF'):
                    upd.append(self.adv().value)
                    while self.accept_op(','):
                        upd.append(self.adv().value)
        return Node('declcursor', name=name, sel=sel, opts=opts, update=upd)

    def parse_coldefs(self):
        self.expect_op('(')
        cols, cons = [], []
        while True:
            if self.op(')'):
                break
            if self.kw('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'):
                cons.append(self.parse_table_constraint())
            else:
                cols.append(self.parse_coldef())
            if not self.accept_op(','):
                break
        self.expect_op(')')
        return cols, cons

    def parse_table_constraint(self):
        name = None
        if self.accept_kw('CONSTRAINT'):
            name = self.adv().value
        if self.kw('PRIMARY', 'UNIQUE'):
            kind = self.adv().value.upper()
            if kind == 'PRIMARY':
                self.expect_kw('KEY')
            self.accept_kw('CLUSTERED', 'NONCLUSTERED')
            self.expect_op('(')
            cols = []
            while True:
                cols.append(self.adv().value)
                self.accept_kw('ASC', 'DESC')
                if not self.accept_op(','):
                    break
            self.expect_op(')')
            self.skip_index_opts()
            return Node('con', kind=kind, cols=cols, name=name)
        if self.kw('CHECK'):
            self.adv()
            self.expect_op('(')
            e = self.parse_expr()
            self.expect_op(')')
            return Node('con', kind='CHECK', expr=e, name=name, cols=[])
        if self.kw('FOREIGN'):
            self.adv()
            self.expect_kw('KEY')
            self.skip_parens()
            self.expect_kw('REFERENCES')
            self.parse_name_parts()
            if self.op('('):
                self.skip_parens()
            while self.kw('ON'):
                self.adv()
                self.adv()
                self.adv()
                if self.kw('ACTION'):
                    self.adv()
            return Node('con', kind='FK', cols=[], name=name)
        self.err('bad table constraint')

    def skip_index_opts(self):
        if self.kw('WITH') and self.peek().is_op('('):
            self.adv()
            self.skip_parens()
        if self.kw('ON') and self.peek().kind in ('id', 'qid') and self.peek().value.upper() == 'PRIMARY':
            self.adv()
            self.adv()

    def parse_coldef(self):
        name = self.adv().value
        if self.kw('AS'):
            raise ParseError('computed column', self.t.pos, self.src)
        ty = self.parse_type()
        col = Node('coldef', name=name, type=ty, null=None, identity=None, default=None, pk=False, unique=False)
        while True:
            if self.kw('NOT'):
                self.adv()
                self.expect_kw('NULL')
                col.null = False
            elif self.kw('NULL'):
                self.adv()
                col.null = True
            elif self.kw('IDENTITY'):
                self.adv()
                seed, inc = '1', '1'
                if self.accept_op('('):
                    seed = self.adv().value
                    self.expect_op(',')
                    inc = self.adv().value
                    self.expect_op(')')
                col.identity = (seed, inc)
            elif self.kw('DEFAULT'):
                self.adv()
                col.default = self.parse_unary_default()
            elif self.kw('PRIMARY'):
                self.adv()
                self.expect_kw('KEY')
                self.accept_kw('CLUSTERED', 'NONCLUSTERED')
                col.pk = True
            elif self.kw('UNIQUE'):
                self.adv()
                self.accept_kw('CLUSTERED', 'NONCLUSTERED')
                col.unique = True
            elif self.kw('CONSTRAINT'):
                self.adv()
                self.adv()
            elif self.kw('REFERENCES'):
                self.adv()
                self.parse_name_parts()
                if self.op('('):
                    self.skip_parens()
            elif self.kw('CHECK'):
                self.adv()
                self.skip_parens()
            elif self.kw('COLLATE'):
                self.adv()
                self.adv()
            elif self.kw('ROWGUIDCOL'):
                self.adv()
            else:
                break
        return col

    def parse_unary_default(self):
        return self.parse_add()

    # SET
    def st_set(self):
        t = self.t
        if t.kind == 'var':
            self.adv()
            if self.op(*self.ASSIGN_OPS):
                op = self.adv().value
            else:
                self.err('expected = in SET')
            if self.kw('CURSOR'):
                raise ParseError('cursor variable', self.t.pos, self.src)
            return Node('set', var=t.value, op=op, e=self.parse_expr())
        opt = self.adv().value
        words = [opt.upper()]
        vals = []
        if opt.upper() == 'TRANSACTION':
            while self.t.kind == 'id' and self.t.value.upper() not in STOP:
                vals.append(self.adv().value)
            return Node('setopt', opt='TRANSACTION', vals=vals)
        if opt.upper() == 'IDENTITY_INSERT':
            tbl = self.parse_name_parts()
            on = self.adv().value.upper()
            return Node('setopt', opt='IDENTITY_INSERT', vals=[tbl, on])
        if opt.upper() == 'ROWCOUNT':
            e = self.parse_expr()
            return Node('setopt', opt='ROWCOUNT', vals=[e])
        # SET option ON|OFF | value
        while self.t.kind in ('id', 'num', 'str', 'var') and (self.kw('ON', 'OFF') or not (self.t.kind == 'id' and self.t.value.upper() in STOP)):
            vals.append(self.adv().value)
            if not self.accept_op(','):
                break
        return Node('setopt', opt=opt.upper(), vals=vals)

    # SELECT / INSERT / UPDATE / DELETE
    def st_select(self):
        self.i -= 1
        sel = self.parse_select()
        return Node('select_stmt', sel=sel)

    def parse_target(self):
        t = self.t
        if t.kind == 'var':
            self.adv()
            return Node('tvar', name=t.value, alias=None)
        parts = self.parse_name_parts()
        return Node('table', parts=parts, alias=None, hints=self.parse_hints())

    def st_insert(self):
        self.accept_kw('INTO')
        target = self.parse_target()
        cols = None
        if self.op('(') :
            # column list vs (select ...)
            if not (self.peek().kind == 'id' and self.peek().value.upper() == 'SELECT'):
                self.adv()
                cols = []
                while True:
                    cols.append(self.adv().value)
                    if not self.accept_op(','):
                        break
                self.expect_op(')')
        if self.kw('VALUES'):
            self.adv()
            rows = []
            while True:
                self.expect_op('(')
                row = [self.parse_expr()]
                while self.accept_op(','):
                    row.append(self.parse_expr())
                self.expect_op(')')
                rows.append(row)
                if not self.accept_op(','):
                    break
            return Node('insert', target=target, cols=cols, rows=rows, sel=None, exec=None)
        if self.kw('DEFAULT'):
            self.adv()
            self.expect_kw('VALUES')
            return Node('insert', target=target, cols=cols, rows=[[]], sel=None, exec=None, defaults=True)
        if self.kw('EXEC', 'EXECUTE'):
            self.adv()
            ex = self.st_exec()
            return Node('insert', target=target, cols=cols, rows=None, sel=None, exec=ex)
        sel = self.parse_select()
        return Node('insert', target=target, cols=cols, rows=None, sel=sel, exec=None)

    def parse_update_set(self):
        sets = []
        while True:
            t = self.t
            if t.kind == 'var':
                self.adv()
                col_or_var = ('var', t.value, None)
                op = self.adv().value
                e = self.parse_expr()
                # SET @v = col = expr   (rare) not supported
                sets.append((('var', t.value), op, e))
            else:
                parts = self.parse_name_parts()
                if not self.op(*self.ASSIGN_OPS):
                    self.err('expected = in UPDATE SET')
                op = self.adv().value
                e = self.parse_expr()
                sets.append((('col', parts), op, e))
            if not self.accept_op(','):
                break
        return sets

    def st_update(self):
        top = None
        if self.kw('TOP'):
            self.adv()
            top = self.parse_primary()
        target = self.parse_target()
        if self.kw('SET') is None:
            pass
        self.expect_kw('SET')
        sets = self.parse_update_set()
        frm = None
        if self.kw('FROM'):
            self.adv()
            frm = self.parse_from_list()
        where = None
        if self.kw('WHERE'):
            self.adv()
            if self.kw('CURRENT'):
                self.adv()
                self.expect_kw('OF')
                where = Node('current_of', cursor=self.adv().value)
            else:
                where = self.parse_expr()
        if self.kw('OPTION') and self.peek().is_op('('):
            self.adv()
            self.skip_parens()
        return Node('update', target=target, sets=sets, frm=frm, where=where, top=top)

    def st_delete(self):
        top = None
        if self.kw('TOP'):
            self.adv()
            top = self.parse_primary()
        self.accept_kw('FROM')
        target = self.parse_target()
        frm = None
        if self.kw('FROM'):
            self.adv()
            frm = self.parse_from_list()
        where = None
        if self.kw('WHERE'):
            self.adv()
            if self.kw('CURRENT'):
                self.adv()
                self.expect_kw('OF')
                where = Node('current_of', cursor=self.adv().value)
            else:
                where = self.parse_expr()
        if self.kw('OPTION') and self.peek().is_op('('):
            self.adv()
            self.skip_parens()
        return Node('delete', target=target, frm=frm, where=where, top=top)

    def st_truncate(self):
        self.expect_kw('TABLE')
        return Node('truncate', table=self.parse_name_parts())

    # EXEC
    def st_execute(self):
        return self.st_exec()

    def st_exec(self):
        if self.op('('):
            self.adv()
            e = self.parse_expr()
            self.expect_op(')')
            return Node('execdyn', e=e, args=[])
        ret = None
        if self.t.kind == 'var' and self.peek().is_op('='):
            ret = self.adv().value
            self.adv()
        if self.t.kind == 'var':
            # EXEC @procname
            return Node('exec', ret=ret, name=None, namevar=self.adv().value, args=[])
        name = self.parse_name_parts()
        if self.op(';') and self.peek().kind == 'num':
            self.adv()
            self.adv()
        args = []
        while self.exec_arg_starts():
            args.append(self.parse_exec_arg())
            if not self.accept_op(','):
                break
        if name[-1].lower() == 'sp_executesql':
            return Node('execdyn', e=args[0][1] if args else None, args=args[1:], sp_executesql=True)
        if self.kw('WITH') and self.peek().kind == 'id' and self.peek().value.upper() == 'RECOMPILE':
            self.adv()
            self.adv()
        return Node('exec', ret=ret, name=name, namevar=None, args=args)

    def exec_arg_starts(self):
        t = self.t
        if t.kind == 'id' and t.value.upper() in STOP and t.value.upper() not in ('NULL', 'DEFAULT'):
            return False
        return self.expr_starts() or (t.kind == 'id' and t.value.upper() == 'DEFAULT')

    def parse_exec_arg(self):
        """returns (name or None, expr, is_output)"""
        name = None
        if self.t.kind == 'var' and self.peek().is_op('='):
            name = self.adv().value
            self.adv()
        if self.kw('DEFAULT'):
            self.adv()
            return (name, Node('default'), False)
        e = self.parse_expr()
        out = False
        if self.kw('OUTPUT', 'OUT'):
            self.adv()
            out = True
        return (name, e, out)

    # cursor ops
    def st_open(self):
        return Node('open', name=self.adv().value)

    def st_close(self):
        return Node('close', name=self.adv().value)

    def st_deallocate(self):
        return Node('deallocate', name=self.adv().value)

    def st_fetch(self):
        direction = 'NEXT'
        arg = None
        if self.kw('NEXT', 'PRIOR', 'FIRST', 'LAST'):
            direction = self.adv().value.upper()
        elif self.kw('ABSOLUTE', 'RELATIVE'):
            direction = self.adv().value.upper()
            arg = self.parse_expr()
        self.accept_kw('FROM')
        name = self.adv().value
        into = []
        if self.accept_kw('INTO'):
            into.append(self.adv().value)
            while self.accept_op(','):
                into.append(self.adv().value)
        return Node('fetch', name=name, direction=direction, arg=arg, into=into)

    # DDL
    def st_create(self):
        if self.kw('TABLE'):
            self.adv()
            name = self.parse_name_parts()
            cols, cons = self.parse_coldefs()
            return Node('createtable', name=name, cols=cols, cons=cons)
        uq = clustered = False
        while self.kw('UNIQUE', 'CLUSTERED', 'NONCLUSTERED'):
            if self.adv().value.upper() == 'UNIQUE':
                uq = True
        if self.kw('INDEX'):
            self.adv()
            iname = self.adv().value
            self.expect_kw('ON')
            tbl = self.parse_name_parts()
            self.expect_op('(')
            cols = []
            while True:
                c = self.adv().value
                d = False
                if self.kw('ASC'):
                    self.adv()
                elif self.kw('DESC'):
                    self.adv()
                    d = True
                cols.append((c, d))
                if not self.accept_op(','):
                    break
            self.expect_op(')')
            self.skip_index_opts()
            return Node('createindex', name=iname, table=tbl, cols=cols, unique=uq)
        self.err('unsupported CREATE')

    def st_drop(self):
        if self.kw('TABLE'):
            self.adv()
            names = [self.parse_name_parts()]
            while self.accept_op(','):
                names.append(self.parse_name_parts())
            return Node('droptable', names=names)
        if self.kw('INDEX'):
            self.adv()
            names = [self.parse_name_parts()]
            while self.accept_op(','):
                names.append(self.parse_name_parts())
            return Node('dropindex', names=names)
        self.err('unsupported DROP')

    def st_alter(self):
        self.expect_kw('TABLE')
        tbl = self.parse_name_parts()
        if self.kw('ADD'):
            self.adv()
            cols = []
            while True:
                if self.kw('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'):
                    self.parse_table_constraint()
                else:
                    cols.append(self.parse_coldef())
                if not self.accept_op(','):
                    break
            return Node('altertable', table=tbl, add=cols)
        if self.kw('DROP'):
            self.adv()
            self.expect_kw('COLUMN')
            c = self.adv().value
            return Node('altertable', table=tbl, add=[], drop=[c])
        if self.kw('ALTER'):
            self.adv()
            self.expect_kw('COLUMN')
            c = self.adv().value
            ty = self.parse_type()
            while self.kw('NOT', 'NULL'):
                self.adv()
            return Node('altertable', table=tbl, add=[], drop=[], alter=[(c, ty)])
        self.err('unsupported ALTER TABLE')

    def st_dbcc(self):
        raise ParseError('DBCC not supported', self.t.pos, self.src)

    def st_backup(self):
        raise ParseError('BACKUP not supported', self.t.pos, self.src)

    def st_restore(self):
        raise ParseError('RESTORE not supported', self.t.pos, self.src)

    def st_grant(self):
        raise ParseError('GRANT not supported', self.t.pos, self.src)

    # ---- top-level objects --------------------------------------------
    def parse_params(self, paren):
        params = []
        if paren:
            self.expect_op('(')
        while self.t.kind == 'var':
            name = self.adv().value
            self.accept_kw('AS')
            ty = self.parse_type()
            default = None
            out = False
            if self.accept_op('='):
                default = self.parse_expr()
            if self.kw('OUTPUT', 'OUT'):
                self.adv()
                out = True
            if self.kw('READONLY'):
                self.adv()
            params.append(Node('param', name=name, type=ty, default=default, out=out))
            if not self.accept_op(','):
                break
        if paren:
            self.expect_op(')')
        return params

    def parse_create_object(self, header_only=False):
        """CREATE PROCEDURE|FUNCTION|VIEW|TRIGGER ..."""
        self.expect_kw('CREATE')
        what = self.adv().value.upper()
        if what == 'PROC':
            what = 'PROCEDURE'
        name = self.parse_name_parts()
        if self.op(';') and self.peek().kind == 'num':
            self.adv()
            self.adv()
        if what == 'PROCEDURE':
            paren = self.op('(')
            params = self.parse_params(paren)
            while self.kw('WITH', 'FOR'):
                self.adv()
                while self.t.kind == 'id' and self.t.value.upper() in ('RECOMPILE', 'ENCRYPTION', 'REPLICATION'):
                    self.adv()
                    self.accept_op(',')
            self.expect_kw('AS')
            body = [] if header_only else self.parse_batch()
            return Node('proc', name=name, params=params, body=body)
        if what == 'FUNCTION':
            params = self.parse_params(True)
            self.expect_kw('RETURNS')
            ret_table = None
            ret_type = None
            ret_var = None
            if self.t.kind == 'var':
                ret_var = self.adv().value
                self.expect_kw('TABLE')
                cols, cons = self.parse_coldefs()
                ret_table = (cols, cons)
            elif self.kw('TABLE'):
                self.adv()
                ret_table = ([], [])   # inline
            else:
                ret_type = self.parse_type()
            if self.kw('WITH'):
                self.adv()
                while self.t.kind == 'id' and self.t.value.upper() in ('SCHEMABINDING', 'ENCRYPTION', 'RETURNS', 'NULL', 'ON', 'INPUT', 'CALLED', 'RECOMPILE'):
                    self.adv()
                    self.accept_op(',')
            self.expect_kw('AS')
            if self.kw('BEGIN'):
                self.adv()
                body = self.parse_block_until_end()
                self.expect_kw('END')
                inline = None
                if self.at_end() is False:
                    pass
            else:
                self.expect_kw('RETURN')
                if self.op('('):
                    self.adv()
                    sel = self.parse_select()
                    self.expect_op(')')
                else:
                    sel = self.parse_select()
                body = [Node('return', e=Node('sub', sel=sel), pos=0)]
            return Node('function', name=name, params=params, ret_type=ret_type, ret_var=ret_var, ret_table=ret_table, body=body)
        if what == 'VIEW':
            cols = None
            if self.op('('):
                self.adv()
                cols = [self.adv().value]
                while self.accept_op(','):
                    cols.append(self.adv().value)
                self.expect_op(')')
            if self.kw('WITH'):
                self.adv()
                while self.t.kind == 'id' and self.t.value.upper() in ('SCHEMABINDING', 'ENCRYPTION', 'VIEW_METADATA'):
                    self.adv()
                    self.accept_op(',')
            self.expect_kw('AS')
            sel = self.parse_select()
            if self.kw('WITH'):
                self.adv()
                self.expect_kw('CHECK')
                self.expect_kw('OPTION')
            return Node('view', name=name, cols=cols, sel=sel)
        if what == 'TRIGGER':
            self.expect_kw('ON')
            table = self.parse_name_parts()
            instead = False
            if self.kw('WITH'):
                self.adv()
                self.adv()
            if self.kw('INSTEAD'):
                self.adv()
                self.expect_kw('OF')
                instead = True
            elif self.kw('AFTER', 'FOR'):
                self.adv()
            events = [self.adv().value.upper()]
            while self.accept_op(','):
                events.append(self.adv().value.upper())
            if self.kw('WITH'):
                self.adv()
                self.adv()
            self.expect_kw('AS')
            body = self.parse_batch()
            return Node('trigger', name=name, table=table, events=events, instead=instead, body=body)
        self.err('unsupported CREATE ' + what)


def parse_object(src):
    p = Parser(src)
    n = p.parse_create_object()
    if not p.at_end():
        p.err('trailing input')
    return n


def parse_proc_header(src):
    p = Parser(src)
    return p.parse_create_object(header_only=True)


def parse_statements(src, **kw):
    p = Parser(src, **kw)
    return p.parse_batch()


def parse_select_text(src, **kw):
    p = Parser(src, **kw)
    s = p.parse_select()
    p.accept_op(';')
    return s, p
