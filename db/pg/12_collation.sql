-- Every citext column of the application sorts like SQL Server (dbo.sqlserver_ci, see 00_init.sql): item, account and
-- other name lists, drop-downs and reports keep the original's order when names contain blanks or punctuation.
-- Idempotent. On a database that already holds data it rebuilds the indexes of the changed tables; a column that a view
-- uses cannot change while the view exists (drop the views, run this, then 50_views.sql again).
DO $$
DECLARE
  target oid := (SELECT oid FROM pg_collation WHERE collname = 'sqlserver_ci' AND collnamespace = 'dbo'::regnamespace);
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname, c.relname,
           string_agg(format('ALTER COLUMN %I TYPE citext COLLATE dbo.sqlserver_ci', a.attname), ', ' ORDER BY a.attnum) AS changes
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'dbo' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'citext'::regtype AND a.attcollation <> target
    GROUP BY n.nspname, c.relname
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %I.%I %s', t.nspname, t.relname, t.changes);
  END LOOP;
END
$$;
