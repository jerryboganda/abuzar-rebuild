-- citext (contrib) gives case-insensitive text like the SQL Server collation of the original
CREATE EXTENSION IF NOT EXISTS citext;
-- soundex() used by the chemist-wise and Hilton reports
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE SCHEMA IF NOT EXISTS dbo;
-- The order of SQL Server's SQL_Latin1_General_CP1_CI_AS for character data (measured on the original's engine,
-- 2026-11-10): the control characters in code order, the blank, the ASCII punctuation in code order, DEL, then digits, then
-- letters with accents after their base letter. ICU's root order treats control characters as ignorable and keeps
-- punctuation significant (glibc and Windows locales ignore it or the hyphen); the rules put every ASCII character below
-- the digits in the order of SQL Server. citext supplies the case folding. Applied by 12_collation.sql.
DO $$
DECLARE
  bs constant text := chr(92);
  rule text;
  c integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'sqlserver_ci' AND collnamespace = 'dbo'::regnamespace) THEN
    -- every character is written with a backslash before it (ICU rules read a quoted character literally; \u escapes they do not read)
    rule := '&[before 1]' || bs || ' ';
    FOR c IN 1..31 LOOP rule := rule || '<' || bs || chr(c); END LOOP;
    rule := rule || ' &' || bs || ' ';
    FOR c IN 33..126 LOOP
      IF chr(c) !~ '[0-9A-Za-z]' THEN rule := rule || '<' || bs || chr(c); END IF;
    END LOOP;
    rule := rule || '<' || bs || chr(127);
    EXECUTE format('CREATE COLLATION dbo.sqlserver_ci (provider = icu, locale = %L, rules = %L)', 'und', rule);
  END IF;
END
$$;
