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

-- the argument windows of the reports start with today 00:00:00 (the original showed that date)
UPDATE dbo.softwarepreferences SET prefvalue = 'N' WHERE lower(name) = 'applyargsdate';

-- the migration of the original switches the group customer category rule off (UPDATE preferences SET groupcustomercategory = 'N'); without categories assigned to the user group sales would refuse to open
UPDATE dbo.softwarepreferences SET prefvalue = 'N' WHERE lower(name) IN ('groupcustomercategory', 'groupsuppcatinpurandpr');

-- the retail customer of the cash sale windows (w_sale reads `Customer WHERE custcode = 19`) with the base rows the original ships inside its pre-built
-- database (names and codes as the original shows them).  The customer table also defaults to province 7, which the recovered seed does not contain.
-- A failure is reported as an error of this block and leaves nothing half done.
DO $boot$
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.customer WHERE custcode = 19) THEN
    RETURN;
  END IF;
  INSERT INTO dbo.stateprovince (stateprovincecode, stateprovincedescription) SELECT 7, 'NOT SPECIFIED' WHERE NOT EXISTS (SELECT 1 FROM dbo.stateprovince WHERE stateprovincecode = 7);
  INSERT INTO dbo.area (areacode, name, shortname) SELECT 1, 'DEFAULT AREA', '1' WHERE NOT EXISTS (SELECT 1 FROM dbo.area WHERE areacode = 1);
  INSERT INTO dbo.subarea (subareacode, name, manager, areacode) SELECT 1, 'SUB DEFAULT AREA', '1', 1 WHERE NOT EXISTS (SELECT 1 FROM dbo.subarea WHERE subareacode = 1);
  INSERT INTO dbo.customercategory (custcatcode, name) SELECT 1, 'DEFAULT CATEGORY' WHERE NOT EXISTS (SELECT 1 FROM dbo.customercategory WHERE custcatcode = 1);
  INSERT INTO dbo.subaccounts (subacccode, catacccode, name) SELECT 3, 1, 'CUSTOMERS/DEBITORS' WHERE NOT EXISTS (SELECT 1 FROM dbo.subaccounts WHERE subacccode = 3 OR name = 'CUSTOMERS/DEBITORS');
  INSERT INTO dbo.accounts (acccode, subcode, name, aliasname, active, restricted) SELECT 19, 3, '****CASH SALES CUSTOMER', 'CASHSALES', 'Y', 'N' WHERE NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE acccode = 19);
  INSERT INTO dbo.customer (custcode, areacode, crlimit, dayslimit, custcatcode, subareacode, membershipid) VALUES (19, 1, 0, 0, 1, 1, '19');
END
$boot$;

-- the About window reads the version row and the licence text catalog; the rebuild has no licence checks, the rows only have to exist
INSERT INTO dbo.sequence (sequenceid, appversion, dbstatus) SELECT 1, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM dbo.sequence);
INSERT INTO dbo.systextcatalog (textcatalog, cataloglength, textlength, status, cache) SELECT '', 0, 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM dbo.systextcatalog);

-- the last transaction date every entry window compares the server date with (wf_getserverdatetime): one row, set to the day of the installation
INSERT INTO dbo.serverdate (lasttransdate) SELECT date_trunc('day', localtimestamp(3)) WHERE NOT EXISTS (SELECT 1 FROM dbo.serverdate);
