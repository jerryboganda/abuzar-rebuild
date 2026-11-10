-- citext (contrib) gives case-insensitive text like the SQL Server collation of the original
CREATE EXTENSION IF NOT EXISTS citext;
-- soundex() used by the chemist-wise and Hilton reports
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE SCHEMA IF NOT EXISTS dbo;
-- The order of SQL Server's SQL_Latin1_General_CP1_CI_AS for character data (measured on the original's engine,
-- 2026-11-10): the blank, then the ASCII punctuation in code order, then digits, then letters with accents after their
-- base letter. ICU's root order keeps punctuation significant (glibc and Windows locales ignore it or the hyphen);
-- the rules put the ASCII punctuation in code order. citext supplies the case folding. Applied by 12_collation.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'sqlserver_ci' AND collnamespace = 'dbo'::regnamespace) THEN
    CREATE COLLATION dbo.sqlserver_ci (provider = icu, locale = 'und',
      rules = '&\u0020<\u0021<\u0022<\u0023<\u0024<\u0025<\u0026<\u0027<\u0028<\u0029<\u002A<\u002B<\u002C<\u002D<\u002E<\u002F<\u003A<\u003B<\u003C<\u003D<\u003E<\u003F<\u0040<\u005B<\u005C<\u005D<\u005E<\u005F<\u0060<\u007B<\u007C<\u007D<\u007E');
  END IF;
END
$$;
