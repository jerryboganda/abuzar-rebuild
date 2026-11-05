-- Inplace / Normal Initialization: reset _TabMaxKey from the real maximum keys.
--
-- The generated translation of msdb-side `sp_Initialize_TabMaxKey` could not
-- resolve table names at run time (it used SQL Server `OBJECT_ID` and
-- `sysindexes`), so it raised `untranslated T-SQL` and aborted every
-- initialization run at the last step.  PostgreSQL can find the primary key
-- from its own catalogs; the explicit counter updates below are the original
-- procedure's tail unchanged.
CREATE OR REPLACE FUNCTION dbo.sp_initialize_tabmaxkey(OUT return_value integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_tbl text;
  v_reg regclass;
  v_col text;
  v_max bigint;
BEGIN
  FOR r IN
    SELECT btrim(tabname) AS tabname
      FROM dbo._tabmaxkey
     WHERE tabid <> 12
       AND tabname NOT IN ('Quotation', 'SaleLedgerCashDummy', 'SaleLedgerCreditDummy', 'DataTransferLog', 'PrescriptionHeaderLog', 'SRLedger')
    UNION ALL
    SELECT 'SaleLedger'
    ORDER BY 1
  LOOP
    v_tbl := r.tabname;
    v_reg := to_regclass('dbo.' || lower(v_tbl));
    IF v_reg IS NULL THEN
      CONTINUE;
    END IF;

    -- the counter of each table is the maximum of its single-column integer primary key
    SELECT a.attname INTO v_col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = v_reg
       AND i.indisprimary
       AND i.indnatts = 1
       AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
     LIMIT 1;
    IF v_col IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT coalesce(max(%I), 0) FROM %s', v_col, v_reg) INTO v_max;
    UPDATE dbo._tabmaxkey SET tabmaxkey = v_max WHERE btrim(tabname) = v_tbl;
  END LOOP;

  -- original tail: special counters and header counters
  UPDATE dbo._tabmaxkey SET tabmaxkey = coalesce((SELECT max(transferlogid) FROM dbo.datatransferlog), 0) WHERE (tabname = 'DataTransferLog');
  UPDATE dbo._tabmaxkey SET tabmaxkey = coalesce((SELECT max(logid) FROM dbo.prescriptionheaderlog), 0) WHERE (tabname = 'PrescriptionHeaderLog');
  UPDATE dbo._tabmaxkey SET tabmaxkey = coalesce((SELECT max(a) FROM (SELECT coalesce(max(srinvcode), 0) AS a FROM dbo.srledger UNION SELECT coalesce(max(srbufferinvcode), 0) AS a FROM dbo.srbufferledger) AS t), 0) WHERE (tabname = 'SRLedger');
  UPDATE dbo._tabmaxkey SET tabmaxkey = coalesce((SELECT max(quotationcode) FROM dbo.quotationheader), 0) WHERE (tabname = 'Quotation');
  UPDATE dbo._tabmaxkey SET tabmaxkey = 0 WHERE (tabname IN ('SaleLedgerCashDummy', 'SaleLedgerCreditDummy'));
  UPDATE dbo._tabmaxkey SET tabmaxkey = 0 WHERE ((tabid = 12) AND (tabname <> 'SaleLedger'));
  UPDATE dbo.vochercategory SET counter = coalesce((SELECT max(glheader.vouchercode) FROM dbo.glheader WHERE (glheader.vochcatcode = vochercategory.vochcatcode)), 0);
  UPDATE dbo.notescategory SET counter = coalesce((SELECT max(notes.vouchercode) FROM dbo.notes WHERE (notes.notecatcode = notescategory.notecatcode)), 0);
  UPDATE dbo.saletype SET counter = coalesce((SELECT max(coalesce(saleledger.saletypeinvno, 0)) FROM dbo.saleledger WHERE (saleledger.saletypecode = saletype.saletypecode)), 0);
  UPDATE dbo.saleordercategory SET counter = coalesce((SELECT max(coalesce(saleorderheader.saleordercode, 0)) FROM dbo.saleorderheader WHERE (saleorderheader.socatcode = saleordercategory.socatcode)), 0);
  UPDATE dbo.receiptcategory SET counter = coalesce((SELECT max(coalesce(receiptheader.receiptcode, 0)) FROM dbo.receiptheader WHERE (receiptheader.receiptcategorycode = receiptcategory.receiptcategorycode)), 0);
  UPDATE dbo.issuecategory SET counter = coalesce((SELECT max(coalesce(issueheader.issuecode, 0)) FROM dbo.issueheader WHERE (issueheader.issuecategorycode = issuecategory.issuecategorycode)), 0);
  UPDATE dbo._tabmaxkey SET tabmaxkey = 100 WHERE ((tabname = 'Accounts') AND (coalesce((SELECT max(coalesce(acccode, 0)) FROM dbo.accounts), 0) < 100));
  UPDATE dbo._tabmaxkey SET tabmaxkey = 100 WHERE ((tabname = 'SubAccounts') AND (coalesce((SELECT max(coalesce(subacccode, 0)) FROM dbo.subaccounts), 0) < 100));
  UPDATE dbo._tabmaxkey SET tabmaxkey = 100 WHERE ((tabname = 'CategoryAccounts') AND (coalesce((SELECT max(coalesce(catacccode, 0)) FROM dbo.categoryaccounts), 0) < 100));
  UPDATE dbo._tabmaxkey SET tabmaxkey = 100 WHERE ((tabname = 'VocherCategory') AND (coalesce((SELECT max(coalesce(vochcatcode, 0)) FROM dbo.vochercategory), 0) < 100));
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.saleledger AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 1);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.srledger AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 2);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.purledger AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 3);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.prledger AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 4);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.issueheader AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 5);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.receiptheader AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 6);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.adjheader AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 7);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.theader AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 8);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.saleorderheader AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 12);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = 0 WHERE (module = 15);
  UPDATE dbo._headertabmaxkey SET tabmaxkey = coalesce((SELECT max(coalesce(s.headerinvno, 0)) FROM dbo.advsaleledger AS s WHERE (s.headerno = _headertabmaxkey.headercode)), 0) WHERE (module = 21);

  return_value := 0;
  RETURN;
END $$;
