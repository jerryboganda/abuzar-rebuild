# T-SQL to PostgreSQL translation

Everything that is not a plain table of the recovered SQL Server schema (74 functions, 36 views, 642 stored procedures, 10 triggers) plus
every SQL statement embedded in PowerScript (7,580 `SQL ...` lines) and every DataWindow retrieve statement (8,748 DataWindows) is translated
mechanically by `tools/tsql/` (Python 3, standard library only). Results of the last verification run on PostgreSQL 17 are in
`docs/SQL-TRANSLATION-REPORT.md` (generated, numbers come from the CI run, not from estimates).

## Pipeline

| step | tool | output |
|---|---|---|
| routines | `python -I tools/tsql/build.py --src <parent project> --repo .` | `db/pg/40_functions.sql`, `50_views.sql`, `60_procedures.sql`, `70_triggers.sql`, `data/sql/proc_signatures.json`, `data/sql/units.json` |
| statements | `python -I tools/tsql/stmts.py --src <parent project> --repo .` | `data/sql/statements.json` |
| verification | `.github/workflows/sql.yml` -> `tools/tsql/ci_run.py` | job summary + `docs/SQL-TRANSLATION-REPORT.md` content |

The translator is a real tokenizer + recursive-descent parser (`lexer.py`, `parser.py`) producing an AST, then a typed emitter (`texpr.py` expressions,
`tquery.py` SELECT/INSERT/UPDATE/DELETE, `tstmt.py` control flow, `routines.py` routine assembly, `schema.py` types). Static types (string, integer,
numeric, date, binary, unknown) are inferred from the converted schema (`db/pg/10_tables.sql`), declared variables and function results. They decide
`+` (concatenation `||` versus addition), date arithmetic, implicit conversions and the casts PostgreSQL needs.

The files in `db/pg/40..70` contain one routine per block, each introduced by `-- ==== <kind> <name> ====`, so they can be applied one routine at a
time (the CI does this). They apply with plain `psql -f` too.

## Naming and types

* schema `dbo`, `SET search_path TO dbo, public`; identifiers lower-cased, quoted only when PostgreSQL needs it (`tools/pgnames.py`).
* every function body starts with `#variable_conflict use_column`: parameter and variable names never shadow column names.
* T-SQL variables become `v_<name>`; parameters keep their plain name (without `@`) so the backend can call with named notation `f(name => $1)`; the body copies
  them into `v_<name>` on entry and copies INOUT values back before every `RETURN`.
* parameter names that are PostgreSQL `col_name_keyword`s (`interval`, `position`, `values`, ...) are quoted in the signature and in named-notation calls.
* types: `tinyint`/`bit` -> `smallint`, `int` -> `integer`, `char/varchar/nchar/nvarchar/text` -> `citext`, `datetime` -> `timestamp(3)`, `smalldatetime` -> `timestamp(0)`,
  `money` -> `numeric(19,4)`, `float` -> `double precision`, `image/binary` -> `bytea`, `uniqueidentifier` -> `uuid`. Function parameters drop precision/scale.
* function names longer than 63 bytes are shortened with a stable hash suffix (`shorten()` in `names.py`); only trigger functions are affected today.
* `citext` keeps the case-insensitive comparison semantics of the SQL Server collation. Because `text -> citext` is only an *assignment* cast, every
  argument passed to a translated routine is cast to the exact parameter type, and computed strings that flow into a comparison are cast to `citext`.

## Procedures: mapping rule (one rule for all 642)

A stored procedure becomes `dbo.<name>(<params>, OUT return_value integer [, OUT rs1 refcursor, OUT rs2 refcursor ...])`, LANGUAGE plpgsql.

* T-SQL input parameters -> `IN`; `OUTPUT` parameters -> `INOUT` (the caller may pass an initial value; the new value is returned).
  After the first parameter that has a default, every following parameter gets `DEFAULT NULL` (PostgreSQL rule); T-SQL defaults are translated.
* `return_value` is the T-SQL return status (`RETURN n`, 0 when the procedure falls off the end).
* **Result sets are returned as refcursors**: one `OUT rsN refcursor` per result-producing statement that can run in one call (alternative branches of an
  `IF/ELSE` share the same slot; a call to another procedure passes its cursors through). The backend calls inside a transaction:

  ```sql
  BEGIN;
  SELECT * FROM dbo.sp_x(a => $1, b => $2);      -- one row: INOUT values, return_value, rs1, rs2 ...
  FETCH ALL FROM "<rs1 value>";                   -- rows of the first result set (cursor name is the refcursor value)
  CLOSE "<rs1 value>";                            -- always close: an open cursor over a temp table blocks the next call's DROP/TRUNCATE of it
  COMMIT;
  ```
  A cursor slot that was not opened in this call is `NULL`. No column list is needed on the call, and the column types of the result are whatever
  the translated SELECT returns. `data/sql/proc_signatures.json` lists, per procedure, `inout_columns`, the `result_sets` slots and (when the first
  statement is a plain SELECT with names) the column names and static type class.
* The backend must run each call inside a transaction: temporary tables are created `ON COMMIT DROP` and cursors live until the end of the transaction.
* Callers inside the database use `SELECT r.return_value, r.<out param> INTO v_ret, v_out FROM dbo.callee(arg => ...) AS r`.
  `INSERT INTO t EXEC proc` fetches the callee's first cursor row by row into the target table (column order, explicit casts).

## Functions

* scalar UDF -> `RETURNS <type>`; multi-statement table UDF (`RETURNS @t TABLE (...)`) -> `RETURNS TABLE(...)` that collects rows in a temp table and
  `RETURN QUERY`s it; the inline table UDF `fn_GetInProcessChequesList` -> `RETURNS TABLE(...)` with its select list cast to the declared column types.
  Input parameters that have the same name as a result column are renamed `p_<name>` (PostgreSQL treats result columns as OUT parameters).
* helper functions for constructs without a direct equivalent live in the first block of `40_functions.sql`:
  `dbo.tsql_str` (STR), `tsql_datediff`, `tsql_charindex`, `tsql_patindex`, `tsql_isnumeric`, `tsql_isdate`, `tsql_lastident` (@@IDENTITY / SCOPE_IDENTITY),
  `tsql_datepart_week`, `tsql_trg_flag`.

## Statement level rules

| T-SQL | PostgreSQL |
|---|---|
| `DECLARE @x type` | hoisted into the DECLARE block as `v_x`; initial value assigned where the DECLARE was |
| `SET @x = e`, `SELECT @x = e` (no FROM) | `v_x := e` |
| `SELECT @a = c1, @b = c2 FROM ...` | aggregate-only: `SELECT .. INTO`; otherwise a `FOR _rN IN SELECT ..` loop (last row wins, nothing assigned when no rows, exactly like T-SQL) |
| `@@ROWCOUNT` | `GET DIAGNOSTICS _rc = ROW_COUNT` after every DML/assignment statement of routines that read it |
| `@@ERROR` | `0` (an error is an exception in PostgreSQL) |
| `@@FETCH_STATUS` | `_fs`, set after every `FETCH` |
| `@@IDENTITY`, `SCOPE_IDENTITY()` | `dbo.tsql_lastident()` (`lastval()`) |
| `IF/ELSE/WHILE/BREAK/CONTINUE/RETURN` | `IF/WHILE LOOP/EXIT/CONTINUE/RETURN` |
| `BEGIN TRAN`, `COMMIT`, `SAVE TRAN` | removed (the caller owns the transaction) |
| `ROLLBACK` | `RAISE EXCEPTION ... USING ERRCODE = 'TS001'` (the transaction is rolled back by the caller) |
| `RAISERROR(msg, sev, state, args)` | `RAISE EXCEPTION` (severity >= 11) or `RAISE NOTICE`; `%d/%s` placeholders converted |
| `PRINT` | `RAISE NOTICE` |
| `TRY/CATCH` | `BEGIN ... EXCEPTION WHEN OTHERS` |
| cursors (`DECLARE c CURSOR FOR`, `OPEN`, `FETCH`, `CLOSE`) | unbound `refcursor` variables, query supplied at `OPEN` (so variables are read at OPEN time like T-SQL) |
| `#temp` | `CREATE TEMP TABLE tmp_<name> ... ON COMMIT DROP` (shared name, like T-SQL's visibility to callees) |
| `DECLARE @t TABLE (...)` | temp table `tv_<routine>_<name>` (unique per routine) |
| `SELECT ... INTO #t` | `CREATE TEMP TABLE ... AS SELECT` |
| `SELECT ... INTO permanentWorkTable` | `DROP TABLE IF EXISTS` + `CREATE TABLE dbo.x AS SELECT` |
| `INSERT INTO t SELECT ...` (identity column skipped) | explicit column list without the identity columns; NULL literals and strings are cast to the target column types |
| `UPDATE t SET .. FROM ..`, `DELETE t FROM ..` | `UPDATE .. FROM` / `DELETE .. USING`; the target is the single FROM entry of that table (even when aliased); left-joined targets use a `ctid` sub-select |
| `TOP n` | `LIMIT n` (`WITH TIES` -> `FETCH FIRST .. WITH TIES`) |
| `WITH (UPDLOCK)` | `FOR UPDATE OF <alias>` |
| `EXEC(@sql)`, `EXEC (...)` | `EXECUTE` (NULL-safe; a string starting with SELECT opens a result cursor). T-SQL fragments inside the string literals get ISNULL/GETDATE/LEN/`#temp`/`[x]` rewritten; the rest of the dynamic SQL is the caller's responsibility |
| `GETDATE()` | `localtimestamp(3)` |
| `DATEADD/DATEDIFF/DATEPART/DATENAME`, `CONVERT(.., style)`, `STR`, `CHARINDEX`, `LEN`, `ISNULL`, ... | inline PostgreSQL expressions or `dbo.tsql_*` helpers |
| `col IDENTITYCOL` | the table's identity column |

## Triggers

Each trigger becomes a statement-level `AFTER INSERT/UPDATE/DELETE` trigger with transition tables (`REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted`),
so the T-SQL bodies keep using `inserted`/`deleted`. A trigger with several events gets one PostgreSQL trigger per event (shared function).
`IF UPDATE(col)` around the whole body becomes a `BEFORE UPDATE OF col` flag trigger (`dbo.tsql_trg_flag`) plus a flag check in the main trigger
(PostgreSQL cannot combine transition tables with a column list). A per-trigger guard (`set_config`) reproduces SQL Server's default of
non-recursive triggers.

## statements.json

One record per embedded SQL line / DataWindow retrieve (`id`, `source`, `kind`, `original`, `translated`, `params`, `param_types`, `into`, `status`, `note`).
Host variables (`:name`) become `$1..$n`, **numbered by first occurrence; a host variable that occurs several times keeps its number** (the same value is bound
once, and PostgreSQL can then prove that repeated `CASE $1 ...` expressions in SELECT and GROUP BY are identical). `params` lists the host variable names in
that order, `param_types` the PostgreSQL types derived from the DataWindow argument declarations (or from PowerScript variable prefixes `ls_`, `ll_`, ...),
`into` the `INTO :a, :b` target list of `SELECT ... INTO`. Kinds: `embedded-select|insert|update|delete|blob`, `embedded-dynamic`
(EXECUTE IMMEDIATE), `embedded-tx-control` (commit/rollback/...), `dw-select`, `dw-pbselect` (PBSELECT painter syntax converted to SELECT),
`dw-procedure` (`SELECT * FROM dbo.proc(arg => $n)`, result set in cursor `rs1`). Statuses: `translated`, `dynamic`, `not-applicable`, `untranslatable`,
`parse-error`, `excluded` (statements with password-like literals are never exported).

## Not translated (kept as stubs or placeholders, see the report for the list)

* vendor backup/restore procedures (replaced by `pg_dump` in the rebuild) and SQL Server system views: stub without the original text;
* code that reads SQL Server catalogs (`sysobjects`, `sysindexes`, `OBJECT_ID(@x)`), uses COM automation (`sp_OA*`), `xp_cmdshell`, `msdb` jobs, linked servers or
  other databases (`SheerazDBV1.*`): the statement is kept as a comment and replaced by `RAISE EXCEPTION ... ERRCODE '0A000'`; the rest of the routine is translated;
* `sp_executesql` with parameters, `COMPUTE BY`, `GROUP BY ALL`, `GOTO`, `SET ROWCOUNT n`, `TOP n PERCENT`, legacy `*=` outer joins.

## Hand-off notes for the backend

* **Parameter types.** Translated routines take `citext` for every T-SQL character parameter. `text -> citext` is only an assignment cast in PostgreSQL, so a
  bound `text` value must be sent untyped or cast: `dbo.f(name => $1::citext)`. The statements in `statements.json` are untyped `$n` and let PostgreSQL
  infer the type from the column (`param_types` is only a fallback for the few statements where inference alone fails).
* **Cursors.** Close every returned refcursor after `FETCH ALL` (`CLOSE "<name>"`) before calling the next routine in the same transaction.
* **Transactions.** Translated procedures never `COMMIT`/`ROLLBACK`; a T-SQL `ROLLBACK` raises SQLSTATE `TS001` (roll the transaction back and report the failure),
  T-SQL `RAISERROR` with severity >= 11 raises `P0001`, an untranslated statement raises `0A000`.
* **Dates.** `GETDATE()` is `localtimestamp(3)` (transaction start time). Date literals written as `'MM/DD/YYYY'` rely on the default `DateStyle = ISO, MDY`.
* **Dynamic SQL built in PowerScript** (`embedded-dynamic`, 122 sites) cannot be translated statically: `statements.json` keeps the assignments that build the string
  (`builder`) so the ported scripts can be rewritten to build PostgreSQL text directly. Dynamic SQL built inside stored procedures is translated as far as
  its literal parts allow (see `frag_fix`/`frag_extra` in `routines.py` and `dbo.tsql_dyn`).
* **Work tables.** Report procedures write to permanent work tables (`ReportData`, `VirtualGLTemp`, ...) exactly like the original; concurrent users therefore
  share them as before.
* **Regeneration.** `python -I tools/tsql/build.py --src <parent project> --repo .` then `python -I tools/tsql/stmts.py --src <parent project> --repo .`
  (the second step also merges the DataWindow-declared result columns into `proc_signatures.json`). `python -I tools/tsql/selftest.py` checks the translator
  without a database; `tools/tsql/functional_test.py` runs the mechanism tests against PostgreSQL (done by `.github/workflows/sql.yml`).
