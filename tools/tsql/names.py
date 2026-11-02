"""Identifier helpers (reuses the lead's tools/pgnames.py policy) and literal quoting."""
import os
import sys
import hashlib

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, '..'))
from pgnames import ident as _ident  # noqa: E402

MAXLEN = 63


def ident(name):
    return _ident(shorten(name))


def shorten(name):
    n = name.strip().lower()
    if len(n.encode('utf-8')) > MAXLEN:
        h = hashlib.sha1(n.encode('utf-8')).hexdigest()[:8]
        n = n[:MAXLEN - 9] + '_' + h
    return n


def q(s):
    """SQL string literal"""
    return "'" + s.replace("'", "''") + "'"


def dollar(body, tag='body'):
    t = tag
    while ('$' + t + '$') in body:
        t += 'x'
    return '$%s$' % t, '$%s$' % t


def fn_ident(name):
    return 'dbo.' + ident(name)


# keywords of the "col_name_keyword" class: valid as column names but not as function parameter names
COL_NAME_KW = set('''between bigint bit boolean char character coalesce dec decimal exists extract float greatest grouping inout int
integer interval json json_array json_arrayagg json_exists json_object json_objectagg json_query json_scalar json_serialize
json_table json_value least merge_action national nchar none normalize nullif numeric out overlay position precision real row
setof smallint substring time timestamp treat trim values varchar xmlattributes xmlconcat xmlelement xmlexists xmlforest
xmlnamespaces xmlparse xmlpi xmlroot xmlserialize xmltable'''.split())


def pident(name):
    """identifier of a function parameter"""
    n = ident(name)
    bare = n.strip('"')
    if bare in COL_NAME_KW:
        return '"%s"' % bare
    return n
