-- In-place upgrade of a database that was deployed before 2026-11-10 to the current db/pg scripts:
--   * the SQL Server sort order (collation dbo.sqlserver_ci on every text column: 00_init.sql + 12_collation.sql),
--   * the new and corrected functions, procedures and job tables (40_functions, 60_procedures, 86_jobs, 87_inplace),
--   * the views again (50_views.sql), and every trigger exactly as it was.
-- It runs as the database owner (superuser) in ONE transaction: any error leaves the database exactly as it was.
-- Stop the application server first (the table rewrite needs exclusive locks; about 35 seconds on the 2 GB production database).
-- Back up first (pg_dump -Fc). Run it from the db/pg folder, because it reads the scripts there with the psql command include:
--     cd db/pg
--     psql -d waseela -v ON_ERROR_STOP=1 -f ../upgrade/2026-11-10-sqlserver-order.sql
-- Rehearsed on a restored copy of the production backup on 2026-11-10 (docs/OPERATIONS.md).

\set ON_ERROR_STOP on
\timing on
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL search_path = dbo, public;

-- a column that a view uses cannot change while the view exists: drop every view of dbo, 50_views.sql recreates them
DO $$
DECLARE v record; n integer := 0;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'dbo' LOOP
    EXECUTE format('DROP VIEW IF EXISTS dbo.%I CASCADE', v.viewname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dropped % views', n;
END $$;

-- a trigger that names a column (UPDATE OF col, WHEN) blocks the column's type change: keep every trigger definition, drop the
-- triggers, and put them back unchanged at the end
CREATE TEMP TABLE upgrade_triggers ON COMMIT DROP AS
  SELECT c.relname AS tbl, t.tgname AS name, pg_get_triggerdef(t.oid) AS def, t.tgenabled AS enabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'dbo'::regnamespace AND NOT t.tgisinternal;
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT * FROM upgrade_triggers LOOP
    EXECUTE format('DROP TRIGGER %I ON dbo.%I', r.name, r.tbl);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dropped % triggers', n;
END $$;

\echo == 00_init.sql
\i 00_init.sql
\echo == 12_collation.sql
\i 12_collation.sql
\echo == 40_functions.sql
\i 40_functions.sql
\echo == 60_procedures.sql
\i 60_procedures.sql
\echo == 86_jobs.sql
\i 86_jobs.sql
\echo == 87_inplace.sql
\i 87_inplace.sql
\echo == 50_views.sql
\i 50_views.sql

DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT * FROM upgrade_triggers LOOP
    EXECUTE r.def;
    IF r.enabled <> 'O' THEN
      EXECUTE format('ALTER TABLE dbo.%I %s TRIGGER %I', r.tbl,
        CASE r.enabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' ELSE 'ENABLE' END, r.name);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'restored % triggers', n;
END $$;

-- verification inside the transaction: nothing may stay behind
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r','p')
    WHERE c.relnamespace = 'dbo'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'citext'::regtype AND a.attcollation <> (SELECT oid FROM pg_collation WHERE collname = 'sqlserver_ci' AND collnamespace = 'dbo'::regnamespace);
  IF n <> 0 THEN RAISE EXCEPTION '% citext columns still use another collation', n; END IF;
  SELECT count(*) INTO n FROM pg_views WHERE schemaname = 'dbo';
  RAISE NOTICE 'views after upgrade: %', n;
END $$;
COMMIT;
