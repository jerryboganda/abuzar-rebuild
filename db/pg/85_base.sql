-- Parent rows the seed data (90_seed.sql) refers to: the seed grants rights to group 2 from the beginning and every godown belongs to a group.
-- The original shipped these rows inside a pre-built database.  Idempotent.
INSERT INTO dbo.groups (groupcode, groupname, remarks) VALUES (1, 'System', 'Created by the first start') ON CONFLICT DO NOTHING;
INSERT INTO dbo.groups (groupcode, groupname, remarks) VALUES (2, 'Administrators', 'Created by the first start') ON CONFLICT DO NOTHING;
INSERT INTO dbo.godowngroup (godowngroupcode, name) VALUES (1, 'Default') ON CONFLICT DO NOTHING;
INSERT INTO dbo.godown (gcode, name, godowngroupcode) VALUES (1, 'GODOWN1', 1) ON CONFLICT DO NOTHING;

-- the seed rows of older upgrade scripts have fewer columns than the final tables: columns that became NOT NULL later get a default
ALTER TABLE dbo.interfacesetting ALTER COLUMN wintype SET DEFAULT 1;
INSERT INTO dbo.itemcolour (icolourcode, name, shortname) VALUES (1, 'DEFAULT', 'DEF') ON CONFLICT DO NOTHING;
INSERT INTO dbo.itemsize (isizecode, name, shortname) VALUES (1, 'DEFAULT', 'DEF') ON CONFLICT DO NOTHING;

-- the fixed categories of the transactions (purchase, sale, adjustment, notes): every purchase / sale / adjustment header refers to one of them; the names and codes are the original's (a new company database of the original has them from the start)
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (7, 'Loose Purcahse cash') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (8, 'Loose Purcahse Credit') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (1, 'Normal Purchase Cash') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (2, 'Normal Purchase Credit') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (4, 'Normal Purchase Return Cash') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (5, 'Normal Purchase Return Credit') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (3, 'Opening Purchase') ON CONFLICT DO NOTHING;
INSERT INTO dbo.purcategory (purcatcode, name) VALUES (6, 'Opening Purchase Return') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (6, 'Cash Whole S/R') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (1, 'Cash Whole Sale') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (5, 'Clinic Sale') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (9, 'Commissioned S/R') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (4, 'Commissioned Sale') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (7, 'Credit Whole S/R') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (2, 'Credit Whole Sale') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (8, 'Retail S/R') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (3, 'Retail Sale') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (10, 'Retail Service') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (13, 'Retail Service Return') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (12, 'Whole Cash Service') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (15, 'Whole Cash Service Return') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (11, 'Whole Credit Service') ON CONFLICT DO NOTHING;
INSERT INTO dbo.salecategory (salecatcode, name) VALUES (14, 'Whole Credit Service Return') ON CONFLICT DO NOTHING;
INSERT INTO dbo.adjcategory (adjcatcode, name) VALUES (1, 'STOCK ADJUSTMENT-INCREASE') ON CONFLICT DO NOTHING;
INSERT INTO dbo.adjcategory (adjcatcode, name) VALUES (2, 'STOCK ADJUSTMENT-DECREASE') ON CONFLICT DO NOTHING;
INSERT INTO dbo.notescategory (notecatcode, name, counter) VALUES (1, 'Bills Receiveable', 0) ON CONFLICT DO NOTHING;
INSERT INTO dbo.notescategory (notecatcode, name, counter) VALUES (2, 'Bills Payable', 0) ON CONFLICT DO NOTHING;
