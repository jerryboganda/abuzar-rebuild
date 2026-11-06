"""Translator self-test (no database needed): python -I tools/tsql/selftest.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

from tsql.parser import Parser
from tsql.schema import Table, Col
from tsql.routines import Translator, Catalog, Scope
from tsql.tstmt import Ctx, raise_fmt

TABLES = {
    'item': Table('Item', [Col('icode', 'integer', 'I', True), Col('name', 'citext', 'S'), Col('saleprice', 'numeric(15,2)', 'N'),
                           Col('lastupdate', 'timestamp(3)', 'D'), Col('active', 'smallint', 'I')]),
    'person': Table('Person', [Col('id', 'integer', 'I', True), Col('first', 'citext', 'S'), Col('last', 'citext', 'S'),
                               Col('born', 'timestamp(3)', 'D')]),
}


def tr():
    return Translator(TABLES, Catalog())


def body(src, params='', kind='proc'):
    """translate a procedure body and return the generated lines"""
    t = tr()
    node = Parser('CREATE PROCEDURE p %s AS %s' % (params, src)).parse_create_object()
    cat = t.catalog
    cat.procs['p'] = t.make_sig(node)
    t.build_catalog([node])
    return t.translate_proc(node, src)


def stmt(sql):
    t = tr()
    t.begin('proc', 'p', sql)
    p = Parser(sql, binds=True)
    n = p.parse_batch()[0]
    out, _ = t.standalone(n)
    return out


CASES = [
    # (description, actual, expected substring)
    ('string + string uses ||', stmt("SELECT first + ' ' + last FROM person"), "first || ' ') || last"),
    ('numeric + numeric uses +', stmt('SELECT icode + 1 FROM item'), '(icode + 1)'),
    ('datetime + 1 is a day', stmt('SELECT born + 1 FROM person'), "interval '1 day'"),
    ('ISNULL -> coalesce', stmt('SELECT ISNULL(name, 0) FROM item'), "coalesce(name, '0')"),
    ('TOP -> LIMIT', stmt('SELECT TOP 3 name FROM item ORDER BY name'), 'ORDER BY name LIMIT 3'),
    ('alias = expr', stmt('SELECT n = name FROM item'), 'name AS n'),
    ('binds are numbered by first occurrence', stmt('SELECT name FROM item WHERE icode = :a OR icode = :b OR icode = :a'), 'icode = $1) OR (icode = $2)) OR (icode = $1)'),
    ('GETDATE', stmt('SELECT GETDATE()'), 'localtimestamp(3)'),
    ('DATEDIFF day', stmt('SELECT DATEDIFF(day, born, GETDATE()) FROM person'), '(localtimestamp(3))::date - (born)::date'),
    ('CONVERT date style 103', stmt('SELECT CONVERT(varchar(10), born, 103) FROM person'), "to_char(born, 'DD/MM/YYYY')"),
    ('CAST numeric to int truncates', stmt('SELECT CAST(saleprice AS int) FROM item'), 'trunc(saleprice)::integer'),
    ('IDENTITYCOL', stmt('SELECT IDENTITYCOL FROM item'), 'SELECT item.icode'),
    ('NOLOCK hint dropped', stmt('SELECT name FROM item WITH (NOLOCK)'), 'FROM dbo.item'),
    ('UPDLOCK -> FOR UPDATE', stmt('SELECT name FROM item WITH (UPDLOCK) WHERE icode = 1'), 'FOR UPDATE OF item'),
    ('insert skips identity column', stmt("INSERT INTO person SELECT first, last, born FROM person"), 'INSERT INTO dbo.person (first, last, born)'),
    ('update from', stmt('UPDATE item SET name = p.first FROM item i, person p WHERE i.icode = p.id'), 'UPDATE dbo.item AS i SET name = p.first FROM dbo.person AS p'),
    ('delete from join', stmt('DELETE item FROM item i JOIN person p ON i.icode = p.id'), 'DELETE FROM dbo.item AS i USING dbo.person AS p'),
    ('UNION order by position', stmt('SELECT name FROM item UNION SELECT first FROM person ORDER BY name'), 'ORDER BY 1'),
    ('raise format', raise_fmt('Value %d of %s is 100%% and 5%')[0], 'Value % of % is 100%% and 5%%'),
    ('proc: assign select is a loop', body('DECLARE @n INT SELECT @n = icode FROM item WHERE name = @nm', '@nm VARCHAR(10)'), 'FOR _r1 IN SELECT icode AS c1'),
    ('proc: aggregate assign is SELECT INTO', body('DECLARE @n INT SELECT @n = COUNT(*) FROM item'), 'SELECT count(*) INTO v_n FROM dbo.item'),
    ('proc: result set is a refcursor', body('SELECT name FROM item'), 'OPEN rs1 FOR SELECT name FROM dbo.item'),
    ('proc: output parameter is INOUT', body('SET @o = 1', '@o INT OUTPUT'), 'INOUT o integer'),
    ('proc: temp table', body('CREATE TABLE #t (a INT) INSERT #t VALUES (1)'), 'CREATE TEMP TABLE tmp_t'),
    ('proc: temp table read by a result set is not dropped', body('CREATE TABLE #t (a INT) SELECT a FROM #t DROP TABLE #t'), '-- DROP TABLE #t skipped'),
    ('proc: other temp table is dropped', body('CREATE TABLE #t (a INT) CREATE TABLE #u (a INT) SELECT a FROM #t DROP TABLE #u'), 'DROP TABLE IF EXISTS tmp_u;'),
    ('proc: SET leaves @@ROWCOUNT at 1', body('DECLARE @a INT, @n INT UPDATE item SET active = 1 SET @a = 5 SELECT @n = @@ROWCOUNT'), 'v_a := 5;\n  _rc := 1;'),
    ('proc: rollback raises',body('ROLLBACK TRAN'), "ERRCODE = 'TS001'"),
    ('proc: cursor loop', body('DECLARE @a INT DECLARE c CURSOR FOR SELECT icode FROM item OPEN c FETCH NEXT FROM c INTO @a WHILE @@FETCH_STATUS = 0 BEGIN FETCH NEXT FROM c INTO @a END CLOSE c DEALLOCATE c'), 'WHILE (_fs = 0) LOOP'),
    ('proc: @@CURSOR_ROWS counts the opened cursor', body('DECLARE @n INT DECLARE c CURSOR FOR SELECT icode FROM item OPEN c SET @n = @@CURSOR_ROWS CLOSE c DEALLOCATE c'), 'v_n := (SELECT count(*) FROM (SELECT icode FROM dbo.item) _cursor_rows);'),
]


def main():
    bad = 0
    for desc, actual, expected in CASES:
        if expected not in actual:
            bad += 1
            print('FAIL', desc, '\n   expected', repr(expected), '\n   got     ', actual[:400])
    print('%d cases, %d failed' % (len(CASES), bad))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
