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

-- the retail customer of the cash sale windows (w_sale reads `Customer WHERE custcode = 19`); the original ships it inside its pre-built database.
-- Parents first; a failure here must not stop the first-run data, so the block reports instead of raising.
DO $boot$
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.customer WHERE custcode = 19) THEN
    RETURN;
  END IF;
  INSERT INTO dbo.area (areacode, name, shortname) SELECT 1, 'DEFAULT', 'DEF' WHERE NOT EXISTS (SELECT 1 FROM dbo.area);
  INSERT INTO dbo.subarea (subareacode, name, manager, areacode) SELECT 1, 'SUB DEFAULT', '1', (SELECT min(areacode) FROM dbo.area) WHERE NOT EXISTS (SELECT 1 FROM dbo.subarea);
  INSERT INTO dbo.subaccounts (subacccode, catacccode, name) SELECT (SELECT coalesce(max(subacccode), 0) + 1 FROM dbo.subaccounts), 1, 'CUSTOMERS' WHERE NOT EXISTS (SELECT 1 FROM dbo.subaccounts WHERE name = 'CUSTOMERS');
  INSERT INTO dbo.accounts (acccode, subcode, name, aliasname, active, restricted) SELECT 19, (SELECT subacccode FROM dbo.subaccounts WHERE name = 'CUSTOMERS'), 'CASH CUSTOMER', 'CASHCUST19', 'Y', 'N' WHERE NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE acccode = 19);
  INSERT INTO dbo.customer (custcode, areacode, crlimit, dayslimit, custcatcode, subareacode, membershipid) VALUES (19, (SELECT min(areacode) FROM dbo.area), 0, 0, (SELECT min(custcatcode) FROM dbo.customercategory), (SELECT min(subareacode) FROM dbo.subarea), '19');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'retail customer 19 not created: %', SQLERRM;
END
$boot$;
