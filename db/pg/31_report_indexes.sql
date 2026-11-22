-- Indexes PostgreSQL needs and SQL Server did not (hand-written; 30_indexes.sql is generated from the original's indexes).
-- The original's reports fill dbo.reportdata (codeN columns are numeric) and then sum each item's history in correlated
-- sub-queries such as `saledetail.icode = reportdata.code10` (Stock Reports > Item Activity: d_itemactivity, 8 sub-queries x 27,818
-- items).  PostgreSQL compares integer with numeric by casting the integer column, so no index on icode applies and every
-- sub-query scanned its whole table: the report ran for more than 16 minutes and held the server.  An index on (icode::numeric)
-- is what such a comparison uses; the plain icode indexes serve the integer comparisons.  Same results either way.
SET search_path TO dbo, public;
CREATE INDEX IF NOT EXISTS idx_srdetail_icode ON dbo.srdetail (icode);
CREATE INDEX IF NOT EXISTS idx_prdetail_icode ON dbo.prdetail (icode);
CREATE INDEX IF NOT EXISTS idx_adjdetail_icode ON dbo.adjdetail (icode);
CREATE INDEX IF NOT EXISTS idx_receiptdetail_icode ON dbo.receiptdetail (icode);
CREATE INDEX IF NOT EXISTS idx_duesatisfydetail_icode ON dbo.duesatisfydetail (icode);
CREATE INDEX IF NOT EXISTS idx_item_icode_numeric ON dbo.item ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_saledetail_icode_numeric ON dbo.saledetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_purdetail_icode_numeric ON dbo.purdetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_srdetail_icode_numeric ON dbo.srdetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_prdetail_icode_numeric ON dbo.prdetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_adjdetail_icode_numeric ON dbo.adjdetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_issuedetail_icode_numeric ON dbo.issuedetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_receiptdetail_icode_numeric ON dbo.receiptdetail ((icode::numeric));
CREATE INDEX IF NOT EXISTS idx_duesatisfydetail_icode_numeric ON dbo.duesatisfydetail ((icode::numeric));
