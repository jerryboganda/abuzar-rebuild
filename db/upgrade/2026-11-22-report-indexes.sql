-- In-place upgrade of a database deployed before 2026-11-22: the indexes of db/pg/31_report_indexes.sql (why: see that file).
-- CONCURRENTLY: built while the application keeps running (no table lock); each statement is its own transaction, so this file is
-- NOT wrapped in BEGIN/COMMIT.  Safe to run again (IF NOT EXISTS).  Run as the database owner:
--     psql -d waseela -v ON_ERROR_STOP=1 -f db/upgrade/2026-11-22-report-indexes.sql
-- Measured on the scratch copy waseela_rehearsal (2026-11-22): see docs/DEPLOYMENT.md.
\set ON_ERROR_STOP on
\timing on
SET search_path = dbo, public;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_srdetail_icode ON dbo.srdetail (icode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prdetail_icode ON dbo.prdetail (icode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adjdetail_icode ON dbo.adjdetail (icode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receiptdetail_icode ON dbo.receiptdetail (icode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duesatisfydetail_icode ON dbo.duesatisfydetail (icode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_icode_numeric ON dbo.item ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saledetail_icode_numeric ON dbo.saledetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purdetail_icode_numeric ON dbo.purdetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_srdetail_icode_numeric ON dbo.srdetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prdetail_icode_numeric ON dbo.prdetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adjdetail_icode_numeric ON dbo.adjdetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issuedetail_icode_numeric ON dbo.issuedetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receiptdetail_icode_numeric ON dbo.receiptdetail ((icode::numeric));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duesatisfydetail_icode_numeric ON dbo.duesatisfydetail ((icode::numeric));
ANALYZE dbo.item; ANALYZE dbo.saledetail; ANALYZE dbo.purdetail; ANALYZE dbo.srdetail; ANALYZE dbo.prdetail;
ANALYZE dbo.adjdetail; ANALYZE dbo.issuedetail; ANALYZE dbo.receiptdetail; ANALYZE dbo.duesatisfydetail; ANALYZE dbo.reportdata;
