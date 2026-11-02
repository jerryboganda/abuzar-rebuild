"""T-SQL tokenizer (also used for PowerBuilder embedded SQL / DataWindow SQL, with ':host' bind variables).

Token: (kind, value, pos)   kinds:
  id     bare identifier or keyword (value keeps original case; '#tmp' / '##tmp' names are ids too)
  qid    [bracketed] or "double quoted" identifier (value without the quotes)
  str    string literal (value is the decoded text); 'nstr' for N'..'
  num    numeric literal (value is the source text)
  var    @name       gvar  @@name
  bind   :name / :a.b.c / :a[1]  (PowerBuilder host variable; value without the colon)
  odbc   {ts '...'} / {d '...'} / {fn ...} escape  (value is the whole text)
  op     operator or punctuation
  eof
"""
import re

_ID_START = re.compile(r'[A-Za-z_#\u0080-￿]')
_ID_CHARS = re.compile(r'[A-Za-z0-9_#$@\u0080-￿]*')
_NUM = re.compile(r'0[xX][0-9A-Fa-f]*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?')
_OPS3 = ('<=>',)
_OPS2 = ('<>', '<=', '>=', '!=', '!<', '!>', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '=*')


class LexError(Exception):
    pass


class Token(tuple):
    __slots__ = ()

    def __new__(cls, kind, value, pos):
        return tuple.__new__(cls, (kind, value, pos))

    kind = property(lambda s: s[0])
    value = property(lambda s: s[1])
    pos = property(lambda s: s[2])

    def is_kw(self, *names):
        return self[0] == 'id' and self[1].upper() in names

    def is_op(self, *ops):
        return self[0] == 'op' and self[1] in ops

    def __repr__(self):
        return 'T(%s,%r)' % (self[0], self[1])


def tokenize(s, binds=False, dq_is_string=False):
    """binds: recognise :name host variables.  dq_is_string: treat "x" as a string literal (QUOTED_IDENTIFIER OFF)."""
    toks = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in ' \t\r\n\f\v\xa0﻿':
            i += 1
            continue
        if binds and c == '/' and s.startswith('//', i):      # PowerBuilder line comment inside DataWindow SQL
            j = s.find(chr(10), i)
            i = n if j < 0 else j + 1
            continue
        if c == '-' and s.startswith('--', i):
            j = s.find('\n', i)
            i = n if j < 0 else j + 1
            continue
        if c == '/' and s.startswith('/*', i):
            depth, j = 1, i + 2
            while j < n and depth:
                if s.startswith('/*', j):
                    depth += 1
                    j += 2
                elif s.startswith('*/', j):
                    depth -= 1
                    j += 2
                else:
                    j += 1
            i = j
            continue
        if c == "'":
            j, buf = i + 1, []
            while True:
                k = s.find("'", j)
                if k < 0:
                    raise LexError('unterminated string at %d' % i)
                buf.append(s[j:k])
                if k + 1 < n and s[k + 1] == "'":
                    buf.append("'")
                    j = k + 2
                    continue
                j = k + 1
                break
            toks.append(Token('str', ''.join(buf), i))
            i = j
            continue
        if (c == 'N' or c == 'n') and i + 1 < n and s[i + 1] == "'":
            t = tokenize_str(s, i + 1)
            toks.append(Token('str', t[0], i))
            i = t[1]
            continue
        if c == '"':
            k = s.find('"', i + 1)
            if k < 0:
                raise LexError('unterminated "')
            body = s[i + 1:k]
            toks.append(Token('str' if dq_is_string else 'qid', body, i))
            i = k + 1
            continue
        if c == '[':
            k = s.find(']', i + 1)
            if k < 0:
                raise LexError('unterminated [')
            toks.append(Token('qid', s[i + 1:k].replace(']]', ']'), i))
            i = k + 1
            continue
        if c == '{':
            k = s.find('}', i)
            if k < 0:
                raise LexError('unterminated {')
            toks.append(Token('odbc', s[i:k + 1], i))
            i = k + 1
            continue
        if c == '@':
            if s.startswith('@@', i):
                m = _ID_CHARS.match(s, i + 2)
                toks.append(Token('gvar', m.group(0), i))
                i = m.end()
            else:
                m = _ID_CHARS.match(s, i + 1)
                toks.append(Token('var', m.group(0), i))
                i = m.end()
            continue
        if c == ':' and binds and i + 1 < n and (s[i + 1].isalpha() or s[i + 1] == '_'):
            m = re.compile(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\[[^\]]*\](?:\.[A-Za-z_][A-Za-z0-9_]*)*)*').match(s, i + 1)
            toks.append(Token('bind', m.group(0), i))
            i = m.end()
            continue
        if c.isdigit() or (c == '.' and i + 1 < n and s[i + 1].isdigit()):
            m = _NUM.match(s, i)
            toks.append(Token('num', m.group(0), i))
            i = m.end()
            continue
        if _ID_START.match(c):
            m = _ID_CHARS.match(s, i + 1)
            toks.append(Token('id', s[i:m.end()], i))
            i = m.end()
            continue
        two = s[i:i + 2]
        if two in _OPS2:
            toks.append(Token('op', two, i))
            i += 2
            continue
        if c in '+-*/%=<>(),.;&|^~:!?':
            toks.append(Token('op', c, i))
            i += 1
            continue
        raise LexError('unexpected character %r at %d' % (c, i))
    toks.append(Token('eof', '', n))
    # '< =' '> =' '< >' '! =' written with a blank in between (accepted by SQL Server)
    out = []
    for t in toks:
        if out and t.kind == 'op' and out[-1].kind == 'op':
            pv = out[-1].value + t.value
            if pv in ('<=', '>=', '<>', '!=', '!<', '!>') and out[-1].pos + 1 < t.pos:
                out[-1] = Token('op', pv, out[-1].pos)
                continue
        out.append(t)
    return out


def tokenize_str(s, i):
    """decode the quoted string starting at s[i] == "'" ; returns (text, next index)"""
    n = len(s)
    j, buf = i + 1, []
    while True:
        k = s.find("'", j)
        if k < 0:
            raise LexError('unterminated string')
        buf.append(s[j:k])
        if k + 1 < n and s[k + 1] == "'":
            buf.append("'")
            j = k + 2
            continue
        return ''.join(buf), k + 1
