-- First start of an empty company database: the administrator and what every window of the application expects to exist.
-- The original shipped these rows inside a pre-built database; the rebuild creates them (85_base.sql holds the parents the seed needs).
-- Idempotent.
--
-- The first administrator is  admin / admin  - change the password after the first login (the original keeps passwords in plain text, too).

INSERT INTO dbo.users (usercode, username, password, active) VALUES (1, 'admin', 'admin', 'Y') ON CONFLICT DO NOTHING;
INSERT INTO dbo.usergroups (usercode, groupcode, modifiedby) VALUES (1, 2, 1) ON CONFLICT DO NOTHING;

-- one preferences row (every window reads it); all columns have defaults
INSERT INTO dbo.preferences (userid) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM dbo.preferences);

-- both groups may use every right and every godown of every module
INSERT INTO dbo.grouprights (groupcode, rightcode, status) SELECT g.groupcode, r.rightcode, 1 FROM dbo.groups g, dbo.rights r WHERE g.groupcode IN (1, 2) ON CONFLICT DO NOTHING;
INSERT INTO dbo.groupallowedgodown (groupcode, gcode, module, priority) SELECT g.groupcode, 1, m.module, 1 FROM dbo.groups g, dbo.module m WHERE g.groupcode IN (1, 2) ON CONFLICT DO NOTHING;

-- the original checks at every start that a SQL Server backup exists and opens its backup window; backups are made with pg_dump here
UPDATE dbo.softwarepreferences SET prefvalue = 'N' WHERE lower(name) IN ('checkmanualbackuphealthatstartup', 'checkmasterbackuphealthatstartup');
