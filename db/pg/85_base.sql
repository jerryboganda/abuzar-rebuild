-- Parent rows the seed data (90_seed.sql) refers to: the seed grants rights to group 2 from the beginning and every godown belongs to a group.
-- The original shipped these rows inside a pre-built database.  Idempotent.
INSERT INTO dbo.groups (groupcode, groupname, remarks) VALUES (1, 'System', 'Created by the first start') ON CONFLICT DO NOTHING;
INSERT INTO dbo.groups (groupcode, groupname, remarks) VALUES (2, 'Administrators', 'Created by the first start') ON CONFLICT DO NOTHING;
INSERT INTO dbo.godowngroup (godowngroupcode, name) VALUES (1, 'Default') ON CONFLICT DO NOTHING;
INSERT INTO dbo.godown (gcode, name, godowngroupcode) VALUES (1, 'Main Store', 1) ON CONFLICT DO NOTHING;
