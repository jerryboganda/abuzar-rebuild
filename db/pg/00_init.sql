-- citext (contrib) gives case-insensitive text like the SQL Server collation of the original
CREATE EXTENSION IF NOT EXISTS citext;
-- soundex() used by the chemist-wise and Hilton reports
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE SCHEMA IF NOT EXISTS dbo;
