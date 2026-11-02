-- First start of an empty company database: the administrator and the rows every window of the application expects to exist.
-- The original shipped these rows inside a pre-built database; the rebuild creates them.  Idempotent.
--
-- The first administrator is  admin / admin  - change the password after the first login (the original keeps passwords in plain text, too).

INSERT INTO dbo.groups (groupcode, groupname, remarks) VALUES (1, 'Administrators', 'Created by the first start') ON CONFLICT DO NOTHING;

INSERT INTO dbo.users (usercode, username, password, active) VALUES (1, 'admin', 'admin', 'Y') ON CONFLICT DO NOTHING;
INSERT INTO dbo.usergroups (usercode, groupcode, modifiedby) VALUES (1, 1, 1) ON CONFLICT DO NOTHING;

INSERT INTO dbo.godowngroup (godowngroupcode, name) VALUES (1, 'Default') ON CONFLICT DO NOTHING;
INSERT INTO dbo.godown (gcode, name, godowngroupcode) VALUES (1, 'Main Store', 1) ON CONFLICT DO NOTHING;

-- one preferences row (every window reads it); all columns have defaults
INSERT INTO dbo.preferences (userid) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM dbo.preferences);

-- the administrators group may use every right and every godown of every module
INSERT INTO dbo.grouprights (groupcode, rightcode, status) SELECT 1, r.rightcode, 1 FROM dbo.rights r ON CONFLICT DO NOTHING;
INSERT INTO dbo.groupallowedgodown (groupcode, gcode, module, priority) SELECT 1, 1, m.module, 1 FROM dbo.module m ON CONFLICT DO NOTHING;
