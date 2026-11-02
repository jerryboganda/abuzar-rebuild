SET search_path TO dbo, public;

-- ==== compat tsql_str ====
CREATE OR REPLACE FUNCTION dbo.tsql_str(n numeric, len integer DEFAULT 10, d integer DEFAULT 0) RETURNS text
  LANGUAGE plpgsql IMMUTABLE AS $body$
DECLARE s text;
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  s := round(n, GREATEST(d, 0))::text;
  IF length(s) > len THEN RETURN repeat('*', len); END IF;
  RETURN lpad(s, len);
END
$body$;
-- ==== compat tsql_datediff ====
CREATE OR REPLACE FUNCTION dbo.tsql_datediff(part text, a timestamp, b timestamp) RETURNS integer
  LANGUAGE plpgsql IMMUTABLE AS $body$
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN NULL; END IF;
  RETURN CASE part
    WHEN 'year' THEN extract(year FROM b)::integer - extract(year FROM a)::integer
    WHEN 'quarter' THEN (extract(year FROM b)::integer * 4 + extract(quarter FROM b)::integer) - (extract(year FROM a)::integer * 4 + extract(quarter FROM a)::integer)
    WHEN 'month' THEN (extract(year FROM b)::integer * 12 + extract(month FROM b)::integer) - (extract(year FROM a)::integer * 12 + extract(month FROM a)::integer)
    WHEN 'week' THEN floor(((b::date - date '1900-01-07')::numeric) / 7)::integer - floor(((a::date - date '1900-01-07')::numeric) / 7)::integer
    WHEN 'hour' THEN floor(extract(epoch FROM date_trunc('hour', b) - date_trunc('hour', a)) / 3600)::integer
    WHEN 'minute' THEN floor(extract(epoch FROM date_trunc('minute', b) - date_trunc('minute', a)) / 60)::integer
    WHEN 'second' THEN floor(extract(epoch FROM date_trunc('second', b) - date_trunc('second', a)))::integer
    WHEN 'millisecond' THEN floor(extract(epoch FROM b - a) * 1000)::integer
    ELSE NULL END;
END
$body$;
-- ==== compat tsql_charindex ====
CREATE OR REPLACE FUNCTION dbo.tsql_charindex(sub citext, s citext, start integer DEFAULT 1) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $body$
  SELECT CASE WHEN sub IS NULL OR s IS NULL THEN NULL
              WHEN start IS NULL OR start <= 1 THEN strpos(s, sub)
              WHEN strpos(substr(s, start)::citext, sub) = 0 THEN 0
              ELSE strpos(substr(s, start)::citext, sub) + start - 1 END
$body$;
-- ==== compat tsql_patindex ====
CREATE OR REPLACE FUNCTION dbo.tsql_patindex(pat text, s text) RETURNS integer
  LANGUAGE plpgsql IMMUTABLE AS $body$
DECLARE core text; tail text; i integer;
BEGIN
  IF pat IS NULL OR s IS NULL THEN RETURN NULL; END IF;
  core := pat;
  IF left(core, 1) = '%' THEN
    core := substr(core, 2);
    FOR i IN 1..length(s) + 1 LOOP
      IF substr(s, i) LIKE core THEN RETURN i; END IF;
    END LOOP;
    RETURN 0;
  END IF;
  IF s LIKE core THEN RETURN 1; END IF;
  RETURN 0;
END
$body$;
-- ==== compat tsql_isnumeric ====
CREATE OR REPLACE FUNCTION dbo.tsql_isnumeric(s text) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $body$
  SELECT CASE WHEN s ~ '^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$' THEN 1 ELSE 0 END
$body$;
-- ==== compat tsql_isdate ====
CREATE OR REPLACE FUNCTION dbo.tsql_isdate(s text) RETURNS integer
  LANGUAGE plpgsql STABLE AS $body$
BEGIN
  PERFORM s::timestamp;
  RETURN 1;
EXCEPTION WHEN others THEN
  RETURN 0;
END
$body$;
-- ==== compat tsql_lastident ====
CREATE OR REPLACE FUNCTION dbo.tsql_lastident() RETURNS bigint
  LANGUAGE plpgsql VOLATILE AS $body$
BEGIN
  RETURN lastval();
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$body$;
-- ==== compat tsql_datepart_week ====
CREATE OR REPLACE FUNCTION dbo.tsql_datepart_week(ts timestamp) RETURNS integer
  LANGUAGE sql IMMUTABLE AS $body$
  SELECT floor((extract(doy FROM ts) - 1 + extract(dow FROM date_trunc('year', ts))) / 7)::integer + 1
$body$;
-- ==== compat tsql_trg_flag ====
CREATE OR REPLACE FUNCTION dbo.tsql_trg_flag() RETURNS trigger
  LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config(TG_ARGV[0], '1', true);
  RETURN NULL;
END
$body$;

-- ==== function Fn_AccountBalance ====
CREATE OR REPLACE FUNCTION dbo.fn_accountbalance(date timestamp, acccode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_date timestamp(3);
  v_acccode integer;
  v_balance numeric(15,5);
BEGIN
  v_date := date;
  v_acccode := acccode;
  v_balance := coalesce((SELECT sum((debit - credit)) AS b FROM dbo.virtualgl WHERE (acccode = v_acccode)), 0);
  RETURN (v_balance);
  RETURN NULL;
END
$body$;

-- ==== function Fn_CustomerOverDueBalance ====
CREATE OR REPLACE FUNCTION dbo.fn_customeroverduebalance(type citext, list citext, date timestamp, overduedays integer)
  RETURNS TABLE(acccode smallint, odbalance numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_type citext;
  v_list citext;
  v_date timestamp(3);
  v_overduedays integer;
  v_oldacccode integer;
  v_ll_acccode integer;
  v_rowid integer;
  v_daysold integer;
  v_startlimit integer;
  v_endlimit integer;
  v_weekofmonth integer;
  v_weekday integer;
  v_tdate timestamp(3);
  v_amt numeric(15,5);
  v_paid numeric(15,5);
  v_pmt numeric(15,5);
  v_overduebal numeric(15,5);
  cur_c1 refcursor;
  _fs integer := -1;
BEGIN
  v_type := type;
  v_list := list;
  v_date := date;
  v_overduedays := overduedays;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_rettable;
  CREATE TEMP TABLE tv_fn_customeroverduebalance_rettable (
    acccode smallint,
    odbalance numeric(15,5)
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_typelist;
  CREATE TEMP TABLE tv_fn_customeroverduebalance_typelist (
    code integer NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_fn_customeroverduebalance_typelist SELECT code FROM dbo.udf_stringtotabl(v_list, ',') AS udf_stringtotabl;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_lt_amt;
  CREATE TEMP TABLE tv_fn_customeroverduebalance_lt_amt (
    acccode integer NOT NULL,
    date timestamp(3) NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0,
    paid numeric(15,5) NOT NULL DEFAULT 0,
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    daysold integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_lt_pmt;
  CREATE TEMP TABLE tv_fn_customeroverduebalance_lt_pmt (
    acccode integer NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_lt_interval;
  CREATE TEMP TABLE tv_fn_customeroverduebalance_lt_interval (
    intervalid integer GENERATED BY DEFAULT AS IDENTITY (START WITH 0 INCREMENT BY 1) NOT NULL,
    lowerlimit integer NOT NULL DEFAULT 0,
    upperlimit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  v_startlimit := 0;
  WHILE (v_startlimit <= v_overduedays) LOOP
    v_endlimit := (v_startlimit + CASE v_startlimit WHEN 0 THEN 0 ELSE (v_overduedays - 1) END);
    v_endlimit := CASE WHEN (v_endlimit > v_overduedays) THEN v_overduedays ELSE v_endlimit END;
    INSERT INTO tv_fn_customeroverduebalance_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, v_endlimit);
    v_startlimit := (v_endlimit + 1);
  END LOOP;
  INSERT INTO tv_fn_customeroverduebalance_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, 99999999);
  IF (v_type = 'S') THEN
    INSERT INTO tv_fn_customeroverduebalance_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, debit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.salesmancode)))) ORDER BY acccode, date, debit;
    INSERT INTO tv_fn_customeroverduebalance_lt_pmt SELECT acccode, sum(credit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.salesmancode)))) GROUP BY acccode ORDER BY acccode;
  END IF;
  IF (v_type = 'A') THEN
    INSERT INTO tv_fn_customeroverduebalance_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, debit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.areacode)))) ORDER BY acccode, date, debit;
    INSERT INTO tv_fn_customeroverduebalance_lt_pmt SELECT acccode, sum(credit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.areacode)))) GROUP BY acccode ORDER BY acccode;
  END IF;
  IF (v_type = 'B') THEN
    INSERT INTO tv_fn_customeroverduebalance_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, debit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.subareacode)))) ORDER BY acccode, date, debit;
    INSERT INTO tv_fn_customeroverduebalance_lt_pmt SELECT acccode, sum(credit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer AS c, tv_fn_customeroverduebalance_typelist AS t WHERE (t.code = c.subareacode)))) GROUP BY acccode ORDER BY acccode;
  END IF;
  OPEN cur_c1 FOR SELECT * FROM tv_fn_customeroverduebalance_lt_amt AS lt_amt;
  FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  WHILE (_fs = 0) LOOP
    v_pmt := coalesce((SELECT coalesce(amount, 0) FROM tv_fn_customeroverduebalance_lt_pmt AS lt_pmt WHERE (acccode = v_ll_acccode)), 0);
    IF (v_pmt <> 0) THEN
      UPDATE tv_fn_customeroverduebalance_lt_amt AS lt_amt SET paid = (paid + CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END) WHERE ((rowid = v_rowid) AND (acccode = v_ll_acccode));
      v_pmt := (v_pmt - (SELECT CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END));
      UPDATE tv_fn_customeroverduebalance_lt_pmt AS lt_pmt SET amount = v_pmt WHERE (acccode = v_ll_acccode);
    END IF;
    FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_c1;
  -- DEALLOCATE C1
  INSERT INTO tv_fn_customeroverduebalance_rettable SELECT a.acccode, coalesce(sum((t.amount - t.paid)), 0) AS overduebal FROM dbo.accounts AS a, tv_fn_customeroverduebalance_lt_amt AS t WHERE ((a.acccode = t.acccode) AND (t.daysold > v_overduedays)) GROUP BY a.acccode ORDER BY a.acccode;
  RETURN QUERY SELECT * FROM tv_fn_customeroverduebalance_rettable;
  DROP TABLE IF EXISTS tv_fn_customeroverduebalance_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_Get_DateTime_Preference ====
CREATE OR REPLACE FUNCTION dbo.fn_get_datetime_preference(prefname citext)
  RETURNS timestamp(3)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_prefname citext;
  v_prefvalue timestamp(3);
BEGIN
  v_prefname := prefname;
  v_prefvalue := ((SELECT ltrim(rtrim(prefvalue)) FROM dbo.softwarepreferences WHERE ((lower(name))::citext = (lower(v_prefname))::citext)))::timestamp(3);
  RETURN v_prefvalue;
  RETURN NULL;
END
$body$;

-- ==== function Fn_Get_Int_Preference ====
CREATE OR REPLACE FUNCTION dbo.fn_get_int_preference(prefname citext)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_prefname citext;
  v_prefvalue integer;
BEGIN
  v_prefname := prefname;
  v_prefvalue := (trunc(((SELECT ltrim(rtrim(prefvalue)) FROM dbo.softwarepreferences WHERE ((lower(name))::citext = (lower(v_prefname))::citext)))::numeric))::integer;
  RETURN v_prefvalue;
  RETURN NULL;
END
$body$;

-- ==== function fn_Get_ZonalSaleAndStock_CatWise_ToDate ====
CREATE OR REPLACE FUNCTION dbo.fn_get_zonalsaleandstock_catwise_todate(zonecode smallint, date timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_zonecode smallint;
  v_date timestamp(3);
  v_rep citext;
  v_name citext;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_rowcount integer;
  v_rowid integer;
  v_sale numeric(15,4);
  v_stock numeric(15,4);
  v_totsalevalue numeric(15,2);
  v_totstockvalue numeric(15,2);
  v_salevalue numeric(15,2);
  v_stockvalue numeric(15,2);
BEGIN
  v_zonecode := zonecode;
  v_date := date;
  DROP TABLE IF EXISTS tv_fn_get_zonalsaleandstock_catwise_todate_lt_report;
  CREATE TEMP TABLE tv_fn_get_zonalsaleandstock_catwise_todate_lt_report (
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    zone citext,
    itemname citext,
    sale numeric(15,4),
    salevalue numeric(15,2),
    stock numeric(15,4),
    stockvalue numeric(15,2)
) ON COMMIT DROP;
  v_startdate := (((ltrim(rtrim(dbo.tsql_str((extract(month from v_date)::integer)::numeric))) || '-01-') || ltrim(rtrim(dbo.tsql_str((extract(year from v_date)::integer)::numeric)))))::timestamp(3);
  v_enddate := v_date;
  INSERT INTO tv_fn_get_zonalsaleandstock_catwise_todate_lt_report (zone, itemname, sale, salevalue, stock, stockvalue) SELECT s.zone AS zone, CASE WHEN (i.shortname IS NULL) THEN left(i.name, 10) ELSE i.shortname END AS itemname, (dbo.tsql_str((round((sum(s.sale))::numeric, 2))::numeric, 15, 0))::numeric(15,4) AS sale, (dbo.tsql_str((round((sum(s.salevalue))::numeric, 2))::numeric, 15, 2))::numeric(15,2) AS salevalue, (dbo.tsql_str((round((sum(s.stock))::numeric, 2))::numeric, 15, 0))::numeric(15,4) AS stock, (dbo.tsql_str((round((sum(s.stockvalue))::numeric, 2))::numeric, 15, 2))::numeric(15,2) AS stockvalue FROM dbo.item AS i, (SELECT z.name AS zone, d.icode, sum((d.looseqty + d.bonusqty)) AS sale, sum((((d.looseqty * ((d.saleprice - d.itemflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (s.discperc * 0.01))))) AS salevalue, 0.0000 AS stock, 0.0000 AS stockvalue FROM dbo.saleledger AS s, dbo.saledetail AS d, dbo.customer AS c, dbo.area AS a, dbo.zone AS z, dbo.zoneareas AS za, dbo.item AS i WHERE ((((((((((z.zonecode = v_zonecode) AND (z.useforsms = 'Y')) AND (z.zonecode = za.zonecode)) AND (za.areacode = a.areacode)) AND (a.areacode = c.areacode)) AND (c.custcode = s.custcode)) AND (s.date BETWEEN v_startdate AND v_enddate)) AND (s.saleinvcode = d.saleinvcode)) AND (d.icode = i.icode)) AND (i.icatcode = z.icatcode)) GROUP BY z.name, d.icode UNION ALL SELECT z.name AS zone, d.icode, (-sum((d.looseqty + d.bonusqty))) AS sale, (-sum((((d.looseqty * d.srprice) * ((1 - (d.discperc * 0.01)))) * ((1 - (s.discperc * 0.01)))))) AS salevalue, 0.0000 AS stock, 0.0000 AS stockvalue FROM dbo.srledger AS s, dbo.srdetail AS d, dbo.customer AS c, dbo.area AS a, dbo.zone AS z, dbo.zoneareas AS za, dbo.item AS i WHERE ((((((((((z.zonecode = v_zonecode) AND (z.useforsms = 'Y')) AND (z.zonecode = za.zonecode)) AND (za.areacode = a.areacode)) AND (a.areacode = c.areacode)) AND (c.custcode = s.custcode)) AND (s.date BETWEEN v_startdate AND v_enddate)) AND (s.srinvcode = d.srinvcode)) AND (d.icode = i.icode)) AND (i.icatcode = z.icatcode)) GROUP BY z.name, d.icode UNION ALL SELECT z.name AS zone, d.icode, 0.0000 AS sale, 0.0000 AS salevalue, sum(d.currqty) AS stock, sum((d.currqty * i.saleprice)) AS stockvalue FROM dbo.godowndetail AS d, dbo.zone AS z, dbo.item AS i WHERE ((((z.zonecode = v_zonecode) AND (z.useforsms = 'Y')) AND (z.icatcode = i.icatcode)) AND (d.icode = i.icode)) GROUP BY z.name, d.icode) AS s WHERE (s.icode = i.icode) GROUP BY s.zone, i.name, i.shortname ORDER BY zone, itemname;
  v_rowcount := coalesce((SELECT count(*) FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report), 0);
  v_rowid := 1;
  v_rep := '';
  v_totsalevalue := 0;
  v_totstockvalue := 0;
  WHILE (v_rowid <= v_rowcount) LOOP
    v_sale := coalesce((SELECT sale FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_salevalue := coalesce((SELECT salevalue FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_stock := coalesce((SELECT stock FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_stockvalue := coalesce((SELECT stockvalue FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_name := coalesce((SELECT itemname FROM tv_fn_get_zonalsaleandstock_catwise_todate_lt_report AS lt_report WHERE (rowid = v_rowid)), '0');
    v_rep := ((((((v_rep || ltrim(rtrim(v_name))) || ':') || ltrim(rtrim(dbo.tsql_str((coalesce(v_sale, 0))::numeric, 15, 0)))) || '/') || ltrim(rtrim(dbo.tsql_str((coalesce(v_stock, 0))::numeric, 15, 0)))) || ', ');
    v_totsalevalue := (v_totsalevalue + coalesce(v_salevalue, 0));
    v_totstockvalue := (v_totstockvalue + coalesce(v_stockvalue, 0));
    v_rowid := (v_rowid + 1);
  END LOOP;
  IF (v_rowcount > 0) THEN
    v_rep := ((v_rep || '** Group Sales Value: ') || ltrim(rtrim(dbo.tsql_str((v_totsalevalue)::numeric, 15, 2))));
    v_rep := ((v_rep || '** Stock Value: ') || ltrim(rtrim(dbo.tsql_str((v_totstockvalue)::numeric, 15, 2))));
  END IF;
  RETURN (v_rep)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetAmountOfInProcessCheques ====
CREATE OR REPLACE FUNCTION dbo.fn_getamountofinprocesscheques(acccode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_acccode integer;
  v_amount numeric(15,2);
BEGIN
  v_acccode := acccode;
  v_amount := coalesce((SELECT sum(CASE notecatcode WHEN 1 THEN CASE WHEN (acccode = v_acccode) THEN (-amount) ELSE amount END ELSE CASE WHEN (acccode = v_acccode) THEN amount ELSE (-amount) END END) AS amount FROM dbo.notes WHERE (((((acccode = v_acccode) OR (bankacccode = v_acccode))) AND (finalized = 'Y')) AND (posted = 'N'))), 0);
  RETURN (v_amount);
  RETURN NULL;
END
$body$;

-- ==== function fn_GetAvailableGodown ====
CREATE OR REPLACE FUNCTION dbo.fn_getavailablegodown(groupcode smallint, module smallint)
  RETURNS TABLE(code smallint, rowid integer)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_groupcode smallint;
  v_module smallint;
BEGIN
  v_groupcode := groupcode;
  v_module := module;
  DROP TABLE IF EXISTS tv_fn_getavailablegodown_godownlist;
  CREATE TEMP TABLE tv_fn_getavailablegodown_godownlist (
    code smallint,
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_fn_getavailablegodown_godownlist (code) SELECT gcode FROM dbo.groupallowedgodown WHERE ((groupallowedgodown.groupcode = v_groupcode) AND (groupallowedgodown.module = v_module)) ORDER BY priority, gcode;
  RETURN QUERY SELECT * FROM tv_fn_getavailablegodown_godownlist;
  DROP TABLE IF EXISTS tv_fn_getavailablegodown_godownlist;
  RETURN;
END
$body$;

-- ==== function Fn_GetColumnPrecision ====
CREATE OR REPLACE FUNCTION dbo.fn_getcolumnprecision(col citext)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_col citext;
  v_colprecision integer;
BEGIN
  v_col := col;
  v_colprecision := (SELECT colprecision FROM dbo.columnpreferences WHERE (columnname = v_col));
  IF ((v_colprecision IS NULL)) THEN
    v_colprecision := 0;
  END IF;
  RETURN v_colprecision;
  RETURN NULL;
END
$body$;

-- ==== function fn_getCopiedSaleInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getcopiedsaleinvtotal(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_netamount numeric(15,2);
  _r1 record;
BEGIN
  v_saleinvcode := saleinvcode;
  FOR _r1 IN SELECT (CASE WHEN (round((sum(((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc) + misccharges)))::numeric, 2) IS NULL) THEN 0 ELSE round((((sum(((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc) + misccharges))::numeric, 0) END + round(((sum(round((((((sd.looseqty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc))) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, 0)) AS c1 FROM dbo.saleledgermodified AS sl, dbo.saledetailmodified AS sd WHERE ((sl.saleinvcode = v_saleinvcode) AND (sl.saleinvcode = sd.saleinvcode)) GROUP BY sl.saleinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1 LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetFormNoAndQty_DailyLedger ====
CREATE OR REPLACE FUNCTION dbo.fn_getformnoandqty_dailyledger(custcode integer, icode integer, datetype citext, start_date timestamp, end_date timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_custcode integer;
  v_icode integer;
  v_datetype citext;
  v_start_date timestamp(3);
  v_end_date timestamp(3);
  v_formnoandqty citext;
  v_temp citext;
  cur_tempcursor refcursor;
  _fs integer := -1;
BEGIN
  v_custcode := custcode;
  v_icode := icode;
  v_datetype := datetype;
  v_start_date := start_date;
  v_end_date := end_date;
  OPEN cur_tempcursor FOR SELECT (((ltrim(rtrim(coalesce(sl.custrefno, ''))) || '/') || ltrim(rtrim(dbo.tsql_str((sum(sd.looseqty))::numeric, 10, 0)))) || '  ') AS formnoandqty FROM dbo.saleledger AS sl, dbo.saleinvdetail AS sd WHERE (((((CASE WHEN ((lower(v_datetype))::citext = 'originaldate') THEN sl.originaldate WHEN ((lower(v_datetype))::citext = 'lastsavingdate') THEN sl.date WHEN ((lower(v_datetype))::citext = 'billingdate') THEN sl.billingdate ELSE sl.date END BETWEEN v_start_date AND v_end_date) AND (sl.custcode = v_custcode)) AND (sl.posted = 'Y')) AND (sl.saleinvcode = sd.saleinvcode)) AND (sd.icode = v_icode)) GROUP BY sl.custrefno, sd.icode;
  FETCH NEXT FROM cur_tempcursor INTO v_temp;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  v_formnoandqty := '';
  WHILE (_fs = 0) LOOP
    v_formnoandqty := (v_formnoandqty || v_temp);
    FETCH NEXT FROM cur_tempcursor INTO v_temp;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_tempcursor;
  -- DEALLOCATE tempcursor
  RETURN (v_formnoandqty)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetGodown ====
CREATE OR REPLACE FUNCTION dbo.fn_getgodown(groupcode smallint, module smallint)
  RETURNS smallint
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_groupcode smallint;
  v_module smallint;
  v_gcode smallint;
BEGIN
  v_groupcode := groupcode;
  v_module := module;
  v_gcode := (SELECT gcode FROM dbo.groupallowedgodown WHERE ((groupallowedgodown.groupcode = v_groupcode) AND (groupallowedgodown.module = v_module)) ORDER BY priority, gcode LIMIT 1);
  RETURN v_gcode;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetGroupCode ====
CREATE OR REPLACE FUNCTION dbo.fn_getgroupcode(usercode smallint)
  RETURNS smallint
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_usercode smallint;
  v_groupcode smallint;
BEGIN
  v_usercode := usercode;
  v_groupcode := coalesce((SELECT min(groupcode) FROM dbo.usergroups WHERE (usercode = v_usercode)), 0);
  RETURN v_groupcode;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetHeader ====
CREATE OR REPLACE FUNCTION dbo.fn_getheader(groupcode smallint, module smallint)
  RETURNS smallint
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_groupcode smallint;
  v_module smallint;
  v_headercode smallint;
BEGIN
  v_groupcode := groupcode;
  v_module := module;
  v_headercode := (SELECT headercode FROM dbo.groupallowedheader WHERE ((groupallowedheader.groupcode = v_groupcode) AND (groupallowedheader.module = v_module)) ORDER BY priority, headercode LIMIT 1);
  RETURN v_headercode;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetHeaderWiseSaleSummary ====
CREATE OR REPLACE FUNCTION dbo.fn_getheaderwisesalesummary(date timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_date timestamp(3);
  v_rep citext;
  v_rowcount integer;
  v_rowid integer;
  v_headerno integer;
  v_totnetsale numeric(15,2);
  v_netsale numeric(15,2);
BEGIN
  v_date := date;
  DROP TABLE IF EXISTS tv_fn_getheaderwisesalesummary_lt_report;
  CREATE TEMP TABLE tv_fn_getheaderwisesalesummary_lt_report (
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    headerno integer,
    netsale numeric(15,2)
) ON COMMIT DROP;
  INSERT INTO tv_fn_getheaderwisesalesummary_lt_report (headerno, netsale) SELECT headerno, (coalesce(sum(t.sales), 0) - coalesce(sum(t.sr), 0)) AS sales FROM (SELECT headerno, coalesce(sum(h.invtotal), 0) AS sales, 0 AS sr FROM dbo.saleledger AS h WHERE ((left(to_char(h.date, 'DD/MM/YYYY'), 100))::citext = (left(to_char(v_date, 'DD/MM/YYYY'), 100))::citext) GROUP BY h.headerno UNION ALL SELECT headerno, 0 AS sales, coalesce(sum(h.invtotal), 0) AS sr FROM dbo.srledger AS h WHERE ((left(to_char(h.date, 'DD/MM/YYYY'), 100))::citext = (left(to_char(v_date, 'DD/MM/YYYY'), 100))::citext) GROUP BY h.headerno) AS t GROUP BY t.headerno;
  v_rowcount := coalesce((SELECT count(*) FROM tv_fn_getheaderwisesalesummary_lt_report AS lt_report), 0);
  v_rowid := 1;
  v_rep := '';
  v_totnetsale := 0;
  WHILE (v_rowid <= v_rowcount) LOOP
    v_netsale := coalesce((SELECT netsale FROM tv_fn_getheaderwisesalesummary_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_headerno := coalesce((SELECT headerno FROM tv_fn_getheaderwisesalesummary_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_rep := (((((v_rep || 'Header : ') || ltrim(rtrim(dbo.tsql_str((v_headerno)::numeric, 10)))) || ' , Net Sale : ') || ltrim(rtrim(dbo.tsql_str((v_netsale)::numeric, 15, 2)))) || ' ');
    v_totnetsale := (v_totnetsale + v_netsale);
    v_rowid := (v_rowid + 1);
  END LOOP;
  IF (v_rowcount > 0) THEN
    v_rep := ((v_rep || '*** Total : ') || ltrim(rtrim(dbo.tsql_str((v_totnetsale)::numeric, 15, 2))));
  END IF;
  RETURN (v_rep)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetInProcessChequesList ====
CREATE OR REPLACE FUNCTION dbo.fn_getinprocesschequeslist(p_acccode integer)
  RETURNS TABLE(notecode integer, vouchercode integer, acccode integer, documentnumber citext, transferredto integer, debit integer, credit numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_acccode integer;
BEGIN
  v_acccode := p_acccode;
  RETURN QUERY SELECT (t.notecode)::integer, (t.vouchercode)::integer, (t.acccode)::integer, (t.documentnumber)::citext, (t.transferredto)::integer, (t.debit)::integer, (t.credit)::numeric FROM (SELECT notecode, vouchercode, acccode, documentnumber, bankacccode AS transferredto, CASE notecatcode WHEN 1 THEN 0 ELSE amount END AS debit, CASE notecatcode WHEN 1 THEN amount ELSE 0 END AS credit FROM dbo.notes WHERE (((acccode = v_acccode) AND (finalized = 'Y')) AND (posted = 'N'))) AS t(notecode, vouchercode, acccode, documentnumber, transferredto, debit, credit);
  RETURN;
END
$body$;

-- ==== function Fn_GetItemCostHistory ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemcosthistory(icode integer, date timestamp)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_date timestamp(3);
  v_avgprice numeric(15,5);
BEGIN
  v_icode := icode;
  v_date := date;
  v_avgprice := coalesce((SELECT avgprice FROM dbo.itemcosthistory WHERE ((itemcosthistory.icode = v_icode) AND (itemcosthistory.date IN (SELECT max(t.date) AS date FROM (SELECT max(date) AS date FROM dbo.itemcosthistory WHERE ((itemcosthistory.icode = v_icode) AND (itemcosthistory.date <= v_date)) UNION ALL SELECT min(date) AS date FROM dbo.itemcosthistory WHERE ((itemcosthistory.icode = v_icode) AND (itemcosthistory.date > v_date))) AS t)))), 0);
  RETURN v_avgprice;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemDueQty ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemdueqty(saleinvcode integer, icode integer, salerowid integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_icode integer;
  v_salerowid integer;
  v_dueqty numeric(15,4);
  _r1 record;
BEGIN
  v_saleinvcode := saleinvcode;
  v_icode := icode;
  v_salerowid := salerowid;
  FOR _r1 IN SELECT looseqty AS c1 FROM dbo.saledetail AS sd WHERE ((((sd.saleinvcode = v_saleinvcode) AND (sd.icode = v_icode)) AND (sd.rowid = v_salerowid)) AND (sd.due = 'D')) LOOP
    v_dueqty := _r1.c1;
  END LOOP;
  IF ((v_dueqty IS NULL)) THEN
    v_dueqty := 0;
  END IF;
  RETURN v_dueqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemDueQtyOnAllInv ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemdueqtyonallinv(icode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_dueqty numeric(15,4);
BEGIN
  v_icode := icode;
  v_dueqty := (SELECT sum(looseqty) FROM dbo.saledetail WHERE ((icode = v_icode) AND (due = 'D')));
  IF ((v_dueqty IS NULL)) THEN
    v_dueqty := 0;
  END IF;
  RETURN v_dueqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemDueSatisfiedQty ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemduesatisfiedqty(saleinvcode integer, icode integer, salerowid integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_icode integer;
  v_salerowid integer;
  v_satisfiedqty numeric(15,4);
BEGIN
  v_saleinvcode := saleinvcode;
  v_icode := icode;
  v_salerowid := salerowid;
  SELECT sum(duesatisfyqty) INTO v_satisfiedqty FROM dbo.duesatisfyheader AS dsh JOIN dbo.duesatisfydetail AS dsd ON (dsh.duesatisfycode = dsd.duesatisfycode) WHERE (((dsh.saleinvcode = v_saleinvcode) AND (dsd.icode = v_icode)) AND (dsd.salerowid = v_salerowid));
  IF ((v_satisfiedqty IS NULL)) THEN
    v_satisfiedqty := 0;
  END IF;
  RETURN v_satisfiedqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemPurQtyWRTDate ====
CREATE OR REPLACE FUNCTION dbo.fn_getitempurqtywrtdate(icode integer, startdate timestamp, enddate timestamp)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_purqty numeric(15,4);
BEGIN
  v_icode := icode;
  v_startdate := startdate;
  v_enddate := enddate;
  v_purqty := (SELECT sum(CASE pl.purcatcode WHEN 1 THEN ((pd.packqty * pd.packunits)) WHEN 2 THEN ((pd.packqty * pd.packunits)) ELSE pd.looseqty END) FROM dbo.purledger AS pl JOIN dbo.purdetail AS pd ON (((pl.purinvcode = pd.purinvcode) AND (pl.posted = 'Y')) AND (pl.date BETWEEN v_startdate AND v_enddate)) WHERE (icode = v_icode));
  IF (v_purqty IS NULL) THEN
    v_purqty := 0;
  END IF;
  RETURN v_purqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemPurReturnQtyWRTDate ====
CREATE OR REPLACE FUNCTION dbo.fn_getitempurreturnqtywrtdate(icode integer, startdate timestamp, enddate timestamp)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_purreturnqty numeric(15,4);
BEGIN
  v_icode := icode;
  v_startdate := startdate;
  v_enddate := enddate;
  v_purreturnqty := (SELECT sum(pd.looseqty) FROM dbo.prledger AS pl JOIN dbo.prdetail AS pd ON ((pl.prinvcode = pd.prinvcode) AND (pl.date BETWEEN v_startdate AND v_enddate)) WHERE (icode = v_icode));
  IF (v_purreturnqty IS NULL) THEN
    v_purreturnqty := 0;
  END IF;
  RETURN v_purreturnqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemReturnQtyWRTDate ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemreturnqtywrtdate(icode integer, startdate timestamp, enddate timestamp)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_returnqty numeric(15,4);
BEGIN
  v_icode := icode;
  v_startdate := startdate;
  v_enddate := enddate;
  v_returnqty := (SELECT sum(sd.looseqty) FROM dbo.srledger AS sl JOIN dbo.srdetail AS sd ON ((sl.srinvcode = sd.srinvcode) AND (sl.date BETWEEN v_startdate AND v_enddate)) WHERE (icode = v_icode));
  IF (v_returnqty IS NULL) THEN
    v_returnqty := 0;
  END IF;
  RETURN v_returnqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemSoldQtyWRTDate ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemsoldqtywrtdate(icode integer, startdate timestamp, enddate timestamp)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_soldqty numeric(15,4);
BEGIN
  v_icode := icode;
  v_startdate := startdate;
  v_enddate := enddate;
  v_soldqty := (SELECT sum(sd.looseqty) FROM dbo.saleledger AS sl JOIN dbo.saledetail AS sd ON ((sl.saleinvcode = sd.saleinvcode) AND (sl.date BETWEEN v_startdate AND v_enddate)) WHERE (icode = v_icode));
  IF (v_soldqty IS NULL) THEN
    v_soldqty := 0;
  END IF;
  RETURN v_soldqty;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetItemStockInGodowns ====
CREATE OR REPLACE FUNCTION dbo.fn_getitemstockingodowns(icode integer, sgcode integer, lgcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_sgcode integer;
  v_lgcode integer;
  v_qty numeric(15,4);
BEGIN
  v_icode := icode;
  v_sgcode := sgcode;
  v_lgcode := lgcode;
  v_qty := (SELECT sum(currqty) FROM dbo.godowndetail WHERE ((icode = v_icode) AND (gcode BETWEEN v_sgcode AND v_lgcode)) GROUP BY icode);
  IF (v_qty IS NULL) THEN
    v_qty := 0;
  END IF;
  RETURN v_qty;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetManfWiseNetSaleToDate ====
CREATE OR REPLACE FUNCTION dbo.fn_getmanfwisenetsaletodate(date timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_date timestamp(3);
  v_rep citext;
  v_name citext;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_rowcount integer;
  v_rowid integer;
  v_totnetsale numeric(15,2);
  v_netsale numeric(15,2);
BEGIN
  v_date := date;
  DROP TABLE IF EXISTS tv_fn_getmanfwisenetsaletodate_lt_report;
  CREATE TEMP TABLE tv_fn_getmanfwisenetsaletodate_lt_report (
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    name citext,
    netsale numeric(15,2)
) ON COMMIT DROP;
  v_startdate := (((ltrim(rtrim(dbo.tsql_str((extract(month from v_date)::integer)::numeric))) || '-01-') || ltrim(rtrim(dbo.tsql_str((extract(year from v_date)::integer)::numeric)))))::timestamp(3);
  v_enddate := v_date;
  INSERT INTO tv_fn_getmanfwisenetsaletodate_lt_report (name, netsale) SELECT left(m.name, 10) AS manufacturer, (dbo.tsql_str((round((sum(s.salevalue))::numeric, 2))::numeric, 15, 2))::numeric(15,2) AS netsale FROM dbo.item AS i, dbo.manufacturer AS m, (SELECT d.icode, sum((((d.looseqty * ((d.saleprice - d.itemflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (s.discperc * 0.01))))) AS salevalue FROM dbo.saleledger AS s, dbo.saledetail AS d WHERE ((s.date BETWEEN v_startdate AND v_enddate) AND (s.saleinvcode = d.saleinvcode)) GROUP BY d.icode UNION ALL SELECT d.icode, (-sum((((d.looseqty * d.srprice) * ((1 - (d.discperc * 0.01)))) * ((1 - (s.discperc * 0.01)))))) AS salevalue FROM dbo.srledger AS s, dbo.srdetail AS d WHERE ((s.date BETWEEN v_startdate AND v_enddate) AND (s.srinvcode = d.srinvcode)) GROUP BY d.icode) AS s WHERE ((s.icode = i.icode) AND (i.manfcode = m.manfcode)) GROUP BY m.name ORDER BY m.name;
  v_rowcount := coalesce((SELECT count(*) FROM tv_fn_getmanfwisenetsaletodate_lt_report AS lt_report), 0);
  v_rowid := 1;
  v_rep := '';
  v_totnetsale := 0;
  WHILE (v_rowid <= v_rowcount) LOOP
    v_netsale := coalesce((SELECT netsale FROM tv_fn_getmanfwisenetsaletodate_lt_report AS lt_report WHERE (rowid = v_rowid)), 0);
    v_name := coalesce((SELECT name FROM tv_fn_getmanfwisenetsaletodate_lt_report AS lt_report WHERE (rowid = v_rowid)), '0');
    v_rep := ((((v_rep || ltrim(rtrim(v_name))) || ':') || ltrim(rtrim(dbo.tsql_str((v_netsale)::numeric, 15, 2)))) || ' ');
    v_totnetsale := (v_totnetsale + v_netsale);
    v_rowid := (v_rowid + 1);
  END LOOP;
  IF (v_rowcount > 0) THEN
    v_rep := ((v_rep || '** Total Sales : ') || ltrim(rtrim(dbo.tsql_str((v_totnetsale)::numeric, 15, 2))));
  END IF;
  RETURN (v_rep)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetModelListOfItemPart ====
CREATE OR REPLACE FUNCTION dbo.fn_getmodellistofitempart(ipartcode integer)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ipartcode integer;
  v_rowid integer;
  v_totrows integer;
  v_list citext;
BEGIN
  v_ipartcode := ipartcode;
  DROP TABLE IF EXISTS tv_fn_getmodellistofitempart_models;
  CREATE TEMP TABLE tv_fn_getmodellistofitempart_models (
    name citext NOT NULL,
    rowid integer GENERATED BY DEFAULT AS IDENTITY
) ON COMMIT DROP;
  INSERT INTO tv_fn_getmodellistofitempart_models (name) SELECT m.name FROM dbo.itempart AS ip, dbo.itempartinmodel AS ipm, dbo.model AS m WHERE (((ip.ipartcode = v_ipartcode) AND (ip.ipartcode = ipm.ipartcode)) AND (ipm.modelcode = m.modelcode));
  v_totrows := coalesce((SELECT count(*) FROM tv_fn_getmodellistofitempart_models AS models), 0);
  v_rowid := 1;
  v_list := '';
  WHILE (v_rowid <= v_totrows) LOOP
    v_list := ((v_list || coalesce((SELECT ltrim(rtrim(name)) FROM tv_fn_getmodellistofitempart_models AS models WHERE (rowid = v_rowid)), '')) || ',');
    v_rowid := (v_rowid + 1);
  END LOOP;
  RETURN (v_list)::citext;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetPendingInvoices ====
CREATE OR REPLACE FUNCTION dbo.fn_getpendinginvoices(type citext, acccode integer)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_type citext;
  v_acccode integer;
  v_invcode_string citext;
  v_holdinvcode citext;
  cur_tempcursor refcursor;
  _fs integer := -1;
BEGIN
  v_type := type;
  v_acccode := acccode;
  IF (v_type = 'C') THEN
  ELSE
  END IF;
  OPEN cur_tempcursor FOR SELECT (((('' || ltrim(rtrim((purinvcode)::text))) || ':') || ltrim(rtrim((outstandingamt)::text))) || '') FROM dbo.purledger WHERE ((outstandingamt <> 0) AND (suppcode = v_acccode));
  FETCH NEXT FROM cur_tempcursor INTO v_holdinvcode;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  v_invcode_string := '';
  WHILE (_fs = 0) LOOP
    v_invcode_string := ((v_invcode_string || v_holdinvcode) || ', ');
    FETCH NEXT FROM cur_tempcursor INTO v_holdinvcode;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_tempcursor;
  -- DEALLOCATE tempcursor
  RETURN (v_invcode_string)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_getPOInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getpoinvtotal(pocode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_pocode integer;
  v_netamount numeric(15,2);
  _r1 record;
BEGIN
  v_pocode := pocode;
  FOR _r1 IN SELECT (round((((((sum(round(((((((pod.rate - pod.itemflatdisc)) * ((1 - (pod.discperc * 0.01))))) * pod.qty))::numeric, 2)) * ((1 - (poh.discperc * 0.01))))) - poh.flatdisc) + poh.misccharges))::numeric, 0) + round((((sum((pod.packsalestax * ((pod.qty + pod.bonusqty)))) + sum(round((((round(((((((pod.rate - pod.itemflatdisc)) * ((1 - (pod.discperc * 0.01))))) * pod.qty))::numeric, 2) * 0.01) * pod.gstperc))::numeric, 2))) + ((((((sum(round(((((((pod.rate - pod.itemflatdisc)) * ((1 - (pod.discperc * 0.01))))) * pod.qty))::numeric, 2)) * ((1 - (poh.discperc * 0.01))))) - poh.flatdisc)) * poh.invgstperc1) * 0.01)))::numeric, 0)) AS c1 FROM dbo.purorderdetail AS pod, dbo.purorderheader AS poh WHERE ((poh.pocode = v_pocode) AND (poh.pocode = pod.pocode)) GROUP BY poh.pocode, poh.flatdisc, poh.discperc, poh.invgstperc1, poh.misccharges LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetPreference ====
CREATE OR REPLACE FUNCTION dbo.fn_getpreference(prefname citext)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_prefname citext;
  v_prefvalue citext;
BEGIN
  v_prefname := prefname;
  v_prefvalue := coalesce((SELECT prefvalue FROM dbo.softwarepreferences WHERE ((lower(name))::citext = (lower(v_prefname))::citext)), '');
  RETURN (ltrim(rtrim(v_prefvalue)))::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_getPurInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getpurinvtotal(purinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_purinvcode integer;
  v_netamount numeric(15,2);
  v_roundupyo smallint;
  _r1 record;
BEGIN
  v_purinvcode := purinvcode;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundpurinvon') AS a);
  FOR _r1 IN SELECT (round((((coalesce(sum(((((pd.looseqty + pd.packqty) + pd.bonusqty)) * pd.unitsalestax)), 0) + coalesce(sum(round((((((((pd.looseqty + pd.packqty)) * pd.purprice) * ((1 - ((.01 * pd.discperc))))) * pd.gstperc) * .01))::numeric, 2)), 0)) + round((coalesce(((((sum((((((pd.looseqty + pd.packqty)) * pd.purprice)) * ((1 - ((.01 * pd.discperc)))))) * ((1 - ((.01 * pl.discperc))))) - pl.flatdisc)) * ((pl.invgstperc1 * .01))), 2))::numeric, 0)))::numeric, v_roundupyo) + round(((((coalesce((sum(((((pd.looseqty + pd.packqty)) * pd.purprice) * ((1 - ((.01 * pd.discperc)))))) * ((1 - ((.01 * pl.discperc))))), 0) + pl.misccharges) + pl.salestax) - pl.flatdisc))::numeric, v_roundupyo)) AS c1 FROM dbo.purledger AS pl, dbo.purdetail AS pd WHERE ((pl.purinvcode = v_purinvcode) AND (pl.purinvcode = pd.purinvcode)) GROUP BY pl.purinvcode, pl.flatdisc, pl.misccharges, pl.discperc, pl.invgstperc1, pl.salestax LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetQuotationTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getquotationtotal(code integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_code integer;
  v_netamount numeric(15,2);
BEGIN
  v_code := code;
  v_netamount := coalesce((SELECT (CASE WHEN (round((sum(((((((sd.qty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc) + misccharges)))::numeric, 2) IS NULL) THEN 0 ELSE round((((sum(round((((((sd.qty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))))::numeric, 2)) - flatdisc) + misccharges))::numeric, 2) END + round(((sum(round((((((sd.qty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.qty * ((sd.saleprice - sd.itemflatdisc))) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.qty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.qty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, 2)) AS netamount FROM dbo.quotationheader AS sl, dbo.quotationdetail AS sd WHERE ((sl.quotationcode = v_code) AND (sl.quotationcode = sd.quotationcode)) GROUP BY sl.quotationcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1), 0);
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetQuotProcessedRejectItemList ====
CREATE OR REPLACE FUNCTION dbo.fn_getquotprocessedrejectitemlist(sdate timestamp, edate timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_sdate timestamp(3);
  v_edate timestamp(3);
  v_quotlist citext;
  _r1 record;
BEGIN
  v_sdate := sdate;
  v_edate := edate;
  v_quotlist := '';
  FOR _r1 IN SELECT (a.quotationcode)::text AS c1 FROM (SELECT qh.quotationcode, qd.icode AS icode, sum(CASE qh.loosepack WHEN 1 THEN qd.qty WHEN 2 THEN (qd.qty * qd.packunits) END) AS qty FROM dbo.quotationheader AS qh JOIN dbo.quotationdetail AS qd ON (qh.quotationcode = qd.quotationcode) JOIN dbo.saleledger AS sl ON (sl.quotationno = qh.quotationcode) WHERE (qh.date BETWEEN v_sdate AND v_edate) GROUP BY qh.quotationcode, qd.icode) AS a LEFT JOIN (SELECT qh.quotationcode, sd.icode AS icode, sum(sd.looseqty) AS qty FROM dbo.quotationheader AS qh JOIN dbo.quotationdetail AS qd ON (qh.quotationcode = qd.quotationcode) JOIN dbo.saleledger AS sl ON (qh.quotationcode = sl.quotationno) JOIN dbo.saledetail AS sd ON (sl.saleinvcode = sd.saleinvcode) WHERE ((qh.date BETWEEN v_sdate AND v_edate) AND (qd.icode = sd.icode)) GROUP BY qh.quotationcode, sd.icode) AS b ON ((a.icode = b.icode) AND (a.quotationcode = b.quotationcode)) WHERE (((a.qty - coalesce(b.qty, 0))) > 0) GROUP BY a.quotationcode ORDER BY a.quotationcode LOOP
    v_quotlist := ((v_quotlist || CASE v_quotlist WHEN '' THEN '' ELSE ',' END) || _r1.c1);
  END LOOP;
  RETURN (v_quotlist)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_getSaleInvLoyaltyTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getsaleinvloyaltytotal(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_amount numeric(15,2);
BEGIN
  v_saleinvcode := saleinvcode;
  v_amount := coalesce((SELECT round((sum(((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01)))) - sl.flatdisc) + sl.misccharges)))::numeric, 0) AS amount FROM dbo.saleledger AS sl, dbo.saledetail AS sd, dbo.item AS i WHERE ((((sl.saleinvcode = v_saleinvcode) AND (sl.saleinvcode = sd.saleinvcode)) AND (sd.icode = i.icode)) AND (i.loyaltyitem = 'Y')) GROUP BY sl.saleinvcode, sl.flatdisc, sl.misccharges, sl.discperc), 0);
  RETURN v_amount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getSaleInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getsaleinvtotal(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_netamount numeric(15,2);
  v_roundupyo smallint;
  _r1 record;
  _r2 record;
  _rc integer;
BEGIN
  v_saleinvcode := saleinvcode;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundsaleinvon') AS a);
  _rc := 0;
  FOR _r1 IN SELECT (CASE WHEN (round((sum(((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc) + misccharges)))::numeric, 2) IS NULL) THEN 0 ELSE round((((sum(round((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))))::numeric, 2)) - flatdisc) + misccharges))::numeric, v_roundupyo) END + round(((sum(round((((((sd.looseqty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc))) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, v_roundupyo)) AS c1 FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((sl.saleinvcode = v_saleinvcode) AND (sl.saleinvcode = sd.saleinvcode)) GROUP BY sl.saleinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1 LOOP
    _rc := _rc + 1;
    v_netamount := _r1.c1;
  END LOOP;
  IF (_rc = 0) THEN
    _rc := 0;
    FOR _r2 IN SELECT (CASE WHEN (round((sum(((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc) + misccharges)))::numeric, 2) IS NULL) THEN 0 ELSE round((((sum(round((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))))::numeric, 2)) - flatdisc) + misccharges))::numeric, v_roundupyo) END + round(((sum(round((((((sd.looseqty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc))) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, v_roundupyo)) AS c1 FROM dbo.saleledger AS sl, dbo.saleinvdetail AS sd WHERE ((sl.saleinvcode = v_saleinvcode) AND (sl.saleinvcode = sd.saleinvcode)) GROUP BY sl.saleinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1 LOOP
      _rc := _rc + 1;
      v_netamount := _r2.c1;
    END LOOP;
  END IF;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_getSaleInvTotal_with_AssocSaleInv ====
CREATE OR REPLACE FUNCTION dbo.fn_getsaleinvtotal_with_assocsaleinv(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_netamount numeric(15,2);
  _r1 record;
BEGIN
  v_saleinvcode := saleinvcode;
  v_netamount := (SELECT dbo.fn_getsaleinvtotal(v_saleinvcode));
  FOR _r1 IN SELECT dbo.fn_getsaleinvtotal((assocsaleinvcode)::integer) AS c1 FROM dbo.assocsaleinvlist WHERE (saleinvcode = v_saleinvcode) LOOP
    v_netamount := (v_netamount + _r1.c1);
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetSaleQtyAndInvNoListForAnItem ====
CREATE OR REPLACE FUNCTION dbo.fn_getsaleqtyandinvnolistforanitem(icode integer, custlist citext, startinvno integer, endinvno integer)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_custlist citext;
  v_startinvno integer;
  v_endinvno integer;
  v_rowid integer;
  v_totrows integer;
  v_list citext;
BEGIN
  v_icode := icode;
  v_custlist := custlist;
  v_startinvno := startinvno;
  v_endinvno := endinvno;
  DROP TABLE IF EXISTS tv_fn_getsaleqtyandinvnolistforanitem_saleinvoices;
  CREATE TEMP TABLE tv_fn_getsaleqtyandinvnolistforanitem_saleinvoices (
    qty numeric(15,4) NOT NULL,
    saleinvcode integer NOT NULL,
    rowid integer GENERATED BY DEFAULT AS IDENTITY
) ON COMMIT DROP;
  INSERT INTO tv_fn_getsaleqtyandinvnolistforanitem_saleinvoices (qty, saleinvcode) SELECT sum(sd.looseqty) AS qty, sd.saleinvcode FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE (((((sd.icode = v_icode) AND (sd.saleinvcode = sl.saleinvcode)) AND (sl.saleinvcode BETWEEN v_startinvno AND v_endinvno)) AND (sl.custcode IN (SELECT code FROM dbo.udf_stringtotabl(v_custlist, ',') AS udf_stringtotabl))) AND (sl.salecatcode IN (1, 2, 3))) GROUP BY sd.saleinvcode, sd.icode;
  v_totrows := coalesce((SELECT count(qty) FROM tv_fn_getsaleqtyandinvnolistforanitem_saleinvoices AS saleinvoices), 0);
  v_rowid := 1;
  v_list := '';
  WHILE (v_rowid <= v_totrows) LOOP
    v_list := ((v_list || coalesce((SELECT ((ltrim(rtrim(dbo.tsql_str((qty)::numeric, 10))) || '/') || ltrim(rtrim(dbo.tsql_str((saleinvcode)::numeric, 10)))) FROM tv_fn_getsaleqtyandinvnolistforanitem_saleinvoices AS saleinvoices WHERE (rowid = v_rowid)), '')) || ', ');
    v_rowid := (v_rowid + 1);
  END LOOP;
  RETURN (v_list)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_GetSaleQtyListForAnItem ====
CREATE OR REPLACE FUNCTION dbo.fn_getsaleqtylistforanitem(icode integer, custlist citext, startdate timestamp, enddate timestamp)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_icode integer;
  v_custlist citext;
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_rowid integer;
  v_totrows integer;
  v_list citext;
BEGIN
  v_icode := icode;
  v_custlist := custlist;
  v_startdate := startdate;
  v_enddate := enddate;
  DROP TABLE IF EXISTS tv_fn_getsaleqtylistforanitem_saleinvoices;
  CREATE TEMP TABLE tv_fn_getsaleqtylistforanitem_saleinvoices (
    qty numeric(15,4) NOT NULL,
    rowid integer GENERATED BY DEFAULT AS IDENTITY
) ON COMMIT DROP;
  INSERT INTO tv_fn_getsaleqtylistforanitem_saleinvoices (qty) SELECT sum(sd.looseqty) AS qty FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((((((sd.icode = v_icode) AND (sd.saleinvcode = sl.saleinvcode)) AND (sl.originaldate >= v_startdate)) AND (sl.originaldate <= v_enddate)) AND (sl.custcode IN (SELECT code FROM dbo.udf_stringtotabl(v_custlist, ',') AS udf_stringtotabl))) AND (sl.salecatcode IN (1, 2, 3))) GROUP BY sd.saleinvcode, sd.icode;
  v_totrows := coalesce((SELECT count(qty) FROM tv_fn_getsaleqtylistforanitem_saleinvoices AS saleinvoices), 0);
  v_rowid := 1;
  v_list := '';
  WHILE (v_rowid <= v_totrows) LOOP
    v_list := ((v_list || coalesce((SELECT ltrim(rtrim(dbo.tsql_str((qty)::numeric))) FROM tv_fn_getsaleqtylistforanitem_saleinvoices AS saleinvoices WHERE (rowid = v_rowid)), '')) || ',');
    v_rowid := (v_rowid + 1);
  END LOOP;
  RETURN (v_list)::citext;
  RETURN NULL;
END
$body$;

-- ==== function fn_getServiceInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getserviceinvtotal(invcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_invcode integer;
  v_netamount numeric(15,2);
BEGIN
  v_invcode := invcode;
  v_netamount := (SELECT (round((((sum((((sd.qty * ((sd.price - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc) + misccharges))::numeric, 0) + round((((sum((((((sd.qty * ((sd.price - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01))))) * 0.01) * sd.servicegstperc)) + sum((sd.qty * sd.serviceflattax))) + round((((((sum((((sd.qty * ((sd.price - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc)) * 0.01) * sl.serviceinvgstperc))::numeric, 2)))::numeric, 0)) AS a FROM dbo.serviceheader AS sl, dbo.servicedetail AS sd WHERE ((sl.serviceinvcode = v_invcode) AND (sl.serviceinvcode = sd.serviceinvcode)) GROUP BY sl.serviceinvcode, sl.flatdisc, sl.serviceinvgstperc, sl.misccharges, sl.discperc);
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getServiceOrderTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getserviceordertotal(invcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_invcode integer;
  v_netamount numeric(15,2);
BEGIN
  v_invcode := invcode;
  v_netamount := coalesce((SELECT (coalesce(((round((((sum((((d.qty * ((d.price - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (h.discperc * 0.01))))) - h.flatdisc) + h.misccharges))::numeric, 0) + round((((sum((((((d.qty * ((d.price - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01))))) * 0.01) * d.servicegstperc)) + sum((d.qty * d.serviceflattax))) + round((((((sum((((d.qty * ((d.price - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (h.discperc * 0.01))))) - h.flatdisc)) * 0.01) * h.serviceinvgstperc))::numeric, 2)))::numeric, 0))), 0) + CASE WHEN ((SELECT count(ih.issueinvcode) FROM dbo.issueheader AS ih WHERE (ih.serviceocode = h.serviceocode)) > 0) THEN coalesce((SELECT sum((id.qty * id.price)) AS netamt FROM dbo.issuedetail AS id, dbo.issueheader AS ih WHERE ((ih.serviceocode = h.serviceocode) AND (ih.issueinvcode = id.issueinvcode))), 0) ELSE coalesce((SELECT sum((id.qty * id.saleprice)) AS netamt FROM dbo.issuereqdetail AS id, dbo.issuereqheader AS ih WHERE ((h.serviceocode = ih.serviceocode) AND (ih.issuereqinvcode = id.issuereqinvcode))), 0) END) AS netamt FROM dbo.serviceoheader AS h, dbo.serviceodetail AS d WHERE ((h.serviceocode = v_invcode) AND (h.serviceocode = d.serviceocode)) GROUP BY h.serviceocode, h.date, h.posted, h.cancelled, h.serviceorderstatuscode, h.serviceinvcode, h.saleinvcode, h.custcode, h.patientcode, h.flatdisc, h.discperc, h.misccharges, h.serviceinvgstperc), 0);
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getServiceReturnInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getservicereturninvtotal(invcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_invcode integer;
  v_netamount numeric(15,2);
BEGIN
  v_invcode := invcode;
  v_netamount := (SELECT (round((((sum((((sd.qty * ((sd.serviceprice - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc) + misccharges))::numeric, 0) + round((((coalesce(sum((((((sd.qty * ((sd.serviceprice - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01))))) * 0.01) * sd.servicegstperc)), 0) + coalesce(sum((sd.qty * sd.serviceflattax)), 0)) + coalesce(round((((((sum((((sd.qty * ((sd.serviceprice - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc)) * 0.01) * sl.serviceinvgstperc))::numeric, 2), 0)))::numeric, 0)) AS a FROM dbo.servicerheader AS sl, dbo.servicerdetail AS sd WHERE ((sl.servicerinvcode = v_invcode) AND (sl.servicerinvcode = sd.servicerinvcode)) GROUP BY sl.servicerinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.serviceinvgstperc);
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_getSRBufferInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getsrbufferinvtotal(srbufferinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_srbufferinvcode integer;
  v_netamount numeric(15,2);
  _r1 record;
BEGIN
  v_srbufferinvcode := srbufferinvcode;
  FOR _r1 IN SELECT (round((((((sum((((srbufferdetail.looseqty * srbufferdetail.srprice)) * ((1 - ((.01 * srbufferdetail.discperc)))))) * ((1 - ((.01 * srbufferledger.discperc))))) + srbufferledger.misccharges) + srbufferledger.salestax) - srbufferledger.flatdisc))::numeric, 0) + round((((sum((((srbufferdetail.looseqty + srbufferdetail.bonusqty)) * srbufferdetail.unitsalestax)) + sum(round(((((((srbufferdetail.looseqty * srbufferdetail.srprice)) * ((1 - ((.01 * srbufferdetail.discperc))))) * srbufferdetail.gstperc) * .01))::numeric, 2))) + round((((((sum((((srbufferdetail.looseqty * srbufferdetail.srprice)) * ((1 - ((.01 * srbufferdetail.discperc)))))) * ((1 - ((.01 * srbufferledger.discperc))))) - srbufferledger.flatdisc)) * ((srbufferledger.invgstperc1 * .01))))::numeric, 2)))::numeric, 0)) AS c1 FROM dbo.srbufferledger, dbo.srbufferdetail WHERE ((srbufferledger.srbufferinvcode = v_srbufferinvcode) AND (srbufferledger.srbufferinvcode = srbufferdetail.srbufferinvcode)) GROUP BY srbufferledger.srbufferinvcode, srbufferledger.discperc, srbufferledger.misccharges, srbufferledger.salestax, srbufferledger.flatdisc, srbufferledger.invgstperc1 LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getSRInvLoyaltyTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getsrinvloyaltytotal(srinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_srinvcode integer;
  v_amount numeric(15,2);
BEGIN
  v_srinvcode := srinvcode;
  v_amount := coalesce((SELECT round((sum(((((((sd.looseqty * sd.srprice) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - sl.flatdisc) + sl.misccharges)))::numeric, 0) AS amount FROM dbo.srledger AS sl, dbo.srdetail AS sd, dbo.item AS i WHERE ((((sl.srinvcode = v_srinvcode) AND (sl.srinvcode = sd.srinvcode)) AND (sd.icode = i.icode)) AND (i.loyaltyitem = 'Y')) GROUP BY sl.srinvcode, sl.flatdisc, sl.misccharges, sl.discperc), 0);
  RETURN v_amount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetSRInvoicesStringForSpecificSaleInvoice ====
CREATE OR REPLACE FUNCTION dbo.fn_getsrinvoicesstringforspecificsaleinvoice(saleinvcode integer)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_srinvcode_string citext;
  v_holdsrinvcode citext;
  cur_tempcursor refcursor;
  _fs integer := -1;
BEGIN
  v_saleinvcode := saleinvcode;
  OPEN cur_tempcursor FOR SELECT ((((' (' || (srinvcode)::text) || ',') || (invtotal)::text) || ') ') FROM dbo.srledger WHERE (saleinvcode = v_saleinvcode);
  FETCH NEXT FROM cur_tempcursor INTO v_holdsrinvcode;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  v_srinvcode_string := '';
  WHILE (_fs = 0) LOOP
    v_srinvcode_string := ((v_srinvcode_string || v_holdsrinvcode) || ',');
    FETCH NEXT FROM cur_tempcursor INTO v_holdsrinvcode;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_tempcursor;
  -- DEALLOCATE tempcursor
  RETURN (v_srinvcode_string)::citext;
  RETURN NULL;
END
$body$;

-- ==== function Fn_getSRInvTotal ====
CREATE OR REPLACE FUNCTION dbo.fn_getsrinvtotal(srinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_srinvcode integer;
  v_netamount numeric(15,2);
  v_roundupyo smallint;
  _r1 record;
BEGIN
  v_srinvcode := srinvcode;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundsalereturninvon') AS a);
  FOR _r1 IN SELECT (round((((((sum((((srdetail.looseqty * srdetail.srprice)) * ((1 - ((.01 * srdetail.discperc)))))) * ((1 - ((.01 * srledger.discperc))))) + srledger.misccharges) + srledger.salestax) - srledger.flatdisc))::numeric, v_roundupyo) + round((((sum((((srdetail.looseqty + srdetail.bonusqty)) * srdetail.unitsalestax)) + sum(round(((((((srdetail.looseqty * srdetail.srprice)) * ((1 - ((.01 * srdetail.discperc))))) * srdetail.gstperc) * .01))::numeric, 2))) + round((((((sum((((srdetail.looseqty * srdetail.srprice)) * ((1 - ((.01 * srdetail.discperc)))))) * ((1 - ((.01 * srledger.discperc))))) - srledger.flatdisc)) * ((srledger.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo)) AS c1 FROM dbo.srledger, dbo.srdetail WHERE ((srledger.srinvcode = v_srinvcode) AND (srledger.srinvcode = srdetail.srinvcode)) GROUP BY srledger.srinvcode, srledger.discperc, srledger.misccharges, srledger.salestax, srledger.flatdisc, srledger.invgstperc1 LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_getSRTotalValue_ReferencedSale ====
CREATE OR REPLACE FUNCTION dbo.fn_getsrtotalvalue_referencedsale(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_netamount numeric(15,2);
BEGIN
  v_saleinvcode := saleinvcode;
  v_netamount := (SELECT sum(invtotal) FROM dbo.srledger WHERE (saleinvcode = v_saleinvcode));
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getTaxOnSaleInv ====
CREATE OR REPLACE FUNCTION dbo.fn_gettaxonsaleinv(saleinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_netamount numeric(15,2);
  v_roundupyo smallint;
  _r1 record;
BEGIN
  v_saleinvcode := saleinvcode;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundsaleinvon') AS a);
  FOR _r1 IN SELECT round(((sum(round((((((sd.looseqty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc))) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.looseqty * ((sd.saleprice - sd.itemflatdisc)))) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, v_roundupyo) AS c1 FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((sl.saleinvcode = v_saleinvcode) AND (sl.saleinvcode = sd.saleinvcode)) GROUP BY sl.saleinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1 LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getTaxOnServiceInvoice ====
CREATE OR REPLACE FUNCTION dbo.fn_gettaxonserviceinvoice(invcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_invcode integer;
  v_taxamount numeric(15,2);
BEGIN
  v_invcode := invcode;
  v_taxamount := (SELECT round((((sum((((((sd.qty * ((sd.price - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01))))) * 0.01) * sd.servicegstperc)) + sum((sd.qty * sd.serviceflattax))) + round((((((sum((((sd.qty * ((sd.price - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc)) * 0.01) * sl.serviceinvgstperc))::numeric, 2)))::numeric, 0) AS a FROM dbo.serviceheader AS sl, dbo.servicedetail AS sd WHERE ((sl.serviceinvcode = v_invcode) AND (sl.serviceinvcode = sd.serviceinvcode)) GROUP BY sl.serviceinvcode, sl.flatdisc, sl.serviceinvgstperc, sl.misccharges, sl.discperc);
  RETURN v_taxamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getTaxOnServiceReturn ====
CREATE OR REPLACE FUNCTION dbo.fn_gettaxonservicereturn(invcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_invcode integer;
  v_taxamount numeric(15,2);
BEGIN
  v_invcode := invcode;
  v_taxamount := (SELECT round((((coalesce(sum((((((sd.qty * ((sd.serviceprice - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01))))) * 0.01) * sd.servicegstperc)), 0) + coalesce(sum((sd.qty * sd.serviceflattax)), 0)) + coalesce(round((((((sum((((sd.qty * ((sd.serviceprice - sd.serviceflatdisc))) * ((1 - (sd.discperc * 0.01)))) * ((1 - (sl.discperc * 0.01))))) - flatdisc)) * 0.01) * sl.serviceinvgstperc))::numeric, 2), 0)))::numeric, 0) AS a FROM dbo.servicerheader AS sl, dbo.servicerdetail AS sd WHERE ((sl.servicerinvcode = v_invcode) AND (sl.servicerinvcode = sd.servicerinvcode)) GROUP BY sl.servicerinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.serviceinvgstperc);
  RETURN v_taxamount;
  RETURN NULL;
END
$body$;

-- ==== function fn_getTaxOnSRInv ====
CREATE OR REPLACE FUNCTION dbo.fn_gettaxonsrinv(srinvcode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_srinvcode integer;
  v_netamount numeric(15,2);
  v_roundupto smallint;
  _r1 record;
BEGIN
  v_srinvcode := srinvcode;
  v_roundupto := (SELECT dbo.fn_get_int_preference('roundsalereturninvon') AS a);
  FOR _r1 IN SELECT round(((sum(round((((((sd.looseqty + sd.bonusqty)) * sd.unitsalestax) + round((((round((((sd.looseqty * sd.srprice) * ((1 - (sd.discperc * 0.01)))))::numeric, 2) * sd.gstperc) * 0.01))::numeric, 2)))::numeric, 2)) + (CASE WHEN ((((round((sum((((((sd.looseqty * sd.srprice)) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100)))) - sl.flatdisc)))::numeric, 2)) * sl.invgstperc1) * 0.01) IS NULL) THEN 0 ELSE (((round(((sum(((((sd.looseqty * sd.srprice)) * ((1 - (sd.discperc / 100)))) * ((1 - (sl.discperc / 100))))) - flatdisc))::numeric, 2)) * sl.invgstperc1) * 0.01) END)))::numeric, v_roundupto) AS c1 FROM dbo.srledger AS sl, dbo.srdetail AS sd WHERE ((sl.srinvcode = v_srinvcode) AND (sl.srinvcode = sd.srinvcode)) GROUP BY sl.srinvcode, sl.flatdisc, sl.misccharges, sl.discperc, sl.invgstperc1 LOOP
    v_netamount := _r1.c1;
  END LOOP;
  RETURN v_netamount;
  RETURN NULL;
END
$body$;

-- ==== function Fn_GetUnposted_AccTrans ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_acctrans()
  RETURNS TABLE(documentcode integer, documenttype citext, acccode smallint, catcode smallint, alternateacccode smallint, debit numeric, credit numeric, date timestamp(3), checkno citext, remarks citext, usercode smallint, patientcode integer, vouchercode integer, invoicecode integer, outstandingamt numeric, balance numeric, invoicetype smallint, vrow smallint, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_ln_invacc integer;
  v_ln_cgs integer;
  v_ln_salestaxonsvc integer;
  v_ln_advincometaxpur integer;
  v_ln_advincometaxsale integer;
  v_ln_fbrposfeeacc numeric(5,0);
  v_invsys citext;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_acctrans_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_acctrans_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    acccode smallint NOT NULL,
    catcode smallint NOT NULL,
    alternateacccode smallint NULL,
    debit numeric(15,2) NOT NULL,
    credit numeric(15,2) NOT NULL,
    date timestamp(3) NOT NULL,
    checkno citext NULL,
    remarks citext NULL,
    usercode smallint NOT NULL,
    patientcode integer NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    invoicetype smallint NULL,
    vrow smallint NOT NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_getunposted_acctrans_uptrans;
  CREATE TEMP TABLE tv_fn_getunposted_acctrans_uptrans (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_cgs := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CostOfGoodsSoldAcc')))::integer;
  v_ln_purchaseacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseAccount')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_equityacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_EquityACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_purchaseretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseReturnsAccount')))::integer;
  v_ln_revfromservice := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_RevenueFromServices')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_ln_salestaxonsvc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesTaxPayableOnServices')))::integer;
  v_ln_advincometaxpur := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvIncomeTaxPur')))::integer;
  v_ln_advincometaxsale := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvIncomeTaxSale')))::integer;
  v_ln_fbrposfeeacc := (SELECT code FROM dbo.global WHERE (name = 'GT_FBRPOSFeeAcc'));
  INSERT INTO tv_fn_getunposted_acctrans_uptrans SELECT * FROM dbo.fn_getunposted_sales() AS fn_getunposted_sales UNION ALL SELECT * FROM dbo.fn_getunposted_salesreturn() AS fn_getunposted_salesreturn UNION ALL SELECT * FROM dbo.fn_getunposted_saleorder() AS fn_getunposted_saleorder UNION ALL SELECT * FROM dbo.fn_getunposted_services() AS fn_getunposted_services UNION ALL SELECT * FROM dbo.fn_getunposted_transwindow() AS fn_getunposted_transwindow UNION ALL SELECT * FROM dbo.fn_getunposted_purservices() AS fn_getunposted_purservices UNION ALL SELECT * FROM dbo.fn_getunposted_purchase() AS fn_getunposted_purchase UNION ALL SELECT * FROM dbo.fn_getunposted_purchasereturn() AS fn_getunposted_purchasereturn UNION ALL SELECT * FROM dbo.fn_getunposted_adjustment() AS fn_getunposted_adjustment;
  INSERT INTO tv_fn_getunposted_acctrans_rettable (documentcode, documenttype, catcode, acccode, alternateacccode, date, debit, credit, remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt, balance, vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs, currencycode, conversionrate) SELECT documentcode, documenttype, catcode, dr_acccode AS dr_acccode, CASE dr_acccode WHEN v_ln_cashacc THEN alternateacccode ELSE NULL END AS alternateacccode, date, CASE WHEN (dr_acccode IN (SELECT acccode FROM dbo.accounts WHERE (acccode IN (v_ln_purchaseacc, v_ln_salesacc, v_ln_salesretacc, v_ln_purchaseretacc, v_ln_revfromservice)))) THEN ((gross - coalesce(advincometax, 0)) - coalesce(fbrposfee, 0)) ELSE (coalesce(gross, 0) + coalesce(saletax, 0)) END AS debit, 0 AS credit, dr_remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 0 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans UNION ALL SELECT documentcode, documenttype, catcode, cr_acccode AS cr_acccode, CASE cr_acccode WHEN v_ln_cashacc THEN alternateacccode ELSE NULL END AS alternateacccode, date, 0 AS debit, CASE WHEN (cr_acccode IN (SELECT acccode FROM dbo.accounts WHERE (acccode IN (v_ln_purchaseacc, v_ln_salesacc, v_ln_salesretacc, v_ln_purchaseretacc, v_ln_revfromservice)))) THEN ((gross - coalesce(advincometax, 0)) - coalesce(fbrposfee, 0)) ELSE (coalesce(gross, 0) + coalesce(saletax, 0)) END AS credit, cr_remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 1 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans UNION ALL SELECT documentcode, documenttype, catcode, CASE WHEN ((documenttype = 'RS') OR (documenttype = 'RR')) THEN v_ln_salestaxonsvc ELSE v_ln_salestaxacc END AS acccode, NULL::smallint AS alternateacccode, date, CASE documenttype WHEN 'PV' THEN saletax WHEN 'SR' THEN saletax WHEN 'RR' THEN saletax ELSE 0 END AS debit, CASE documenttype WHEN 'SV' THEN saletax WHEN 'PR' THEN saletax WHEN 'RS' THEN saletax ELSE 0 END AS credit, saletax_remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 2 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE (saletax <> 0) UNION ALL SELECT documentcode, documenttype, catcode, CASE WHEN ((documenttype = 'SV') OR (documenttype = 'SR')) THEN v_ln_advincometaxsale ELSE v_ln_advincometaxpur END AS acccode, NULL::smallint AS alternateacccode, date, CASE documenttype WHEN 'PV' THEN advincometax WHEN 'SR' THEN advincometax ELSE 0 END AS debit, CASE documenttype WHEN 'SV' THEN advincometax WHEN 'PR' THEN advincometax ELSE 0 END AS credit, ('Adv. Income Tax ' || CASE WHEN ((documenttype = 'SR') OR (documenttype = 'PR')) THEN 'Reversed' ELSE 'Accounted For' END) AS saletax_remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 2 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE ((((((documenttype = 'SV') OR (documenttype = 'SR')) OR (documenttype = 'PV')) OR (documenttype = 'PR'))) AND (advincometax <> 0)) UNION ALL SELECT documentcode, documenttype, catcode, CASE WHEN ((documenttype = 'SV') OR (documenttype = 'SR')) THEN v_ln_fbrposfeeacc ELSE v_ln_fbrposfeeacc END AS acccode, NULL::smallint AS alternateacccode, date, CASE documenttype WHEN 'SR' THEN coalesce(fbrposfee, 0) ELSE 0 END AS debit, CASE documenttype WHEN 'SV' THEN coalesce(fbrposfee, 0) ELSE 0 END AS credit, ('FBR POS Service Fee ' || CASE documenttype WHEN 'SR' THEN 'Reversed' ELSE 'Accounted For' END) AS saletax_remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 2 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE ((((documenttype = 'SV') OR (documenttype = 'SR'))) AND (coalesce(fbrposfee, 0) <> 0)) UNION ALL SELECT documentcode, documenttype, catcode, dramtacccode AS dramtacccode, NULL::smallint AS alternateacccode, amtdate, amt AS debit, 0 AS credit, (((((CASE documenttype WHEN 'PV' THEN 'Paid during pur. inv. no.' WHEN 'PR' THEN 'Received during p/return no.' WHEN 'SV' THEN 'Received during sale inv. no.' ELSE 'Paid during s/return no.' END || ':') || ltrim(rtrim(dbo.tsql_str((invoicecode)::numeric)))) || ' (') || coalesce((SELECT ltrim(rtrim(a.name)) FROM dbo.accounts AS a WHERE (a.acccode = dr_acccode)), '')) || ')') AS remarks, amtref AS checkno, amtby, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 3 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE (amt > 0) UNION ALL SELECT documentcode, documenttype, catcode, cramtacccode AS cramtacccode, NULL::smallint AS alternateacccode, amtdate, 0 AS debit, amt AS credit, (((((CASE documenttype WHEN 'PV' THEN 'Paid during pur. inv. no.' WHEN 'PR' THEN 'Received during p/return no.' WHEN 'SV' THEN 'Received during sale inv. no.' ELSE 'Paid during s/return no.' END || ':') || ltrim(rtrim(dbo.tsql_str((invoicecode)::numeric)))) || ' (') || coalesce((SELECT ltrim(rtrim(a.name)) FROM dbo.accounts AS a WHERE (a.acccode = dr_acccode)), '')) || ')') AS remarks, amtref AS checkno, amtby, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 4 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE (amt > 0) UNION ALL SELECT h.glvochcode AS documentcode, vc.shortname AS documenttype, h.vochcatcode AS catcode, d.acccode AS acccode, NULL::smallint AS alternateacccode, h.date AS date, d.debit AS debit, d.credit AS credit, CASE WHEN (h.acccode = d.acccode) THEN h.remarks ELSE d.remarks END AS remarks, CASE WHEN (h.acccode = d.acccode) THEN h.chkno ELSE d.chkno END AS checkno, h.salesmancode AS usercode, h.vouchercode, d.invoicecode, vc.invoicetype, d.outstandingamt AS outstandingamt, d.balance AS balance, CASE d.debit WHEN 0 THEN 1 ELSE 0 END AS vrow, d.patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, d.guestcode AS guestcode, d.studentcode AS studentcode, 0 AS cgs, h.currencycode, h.conversionrate FROM dbo.glheader AS h, dbo.gldetail AS d, dbo.vochercategory AS vc WHERE (((h.posted = 'N') AND (h.glvochcode = d.glvochcode)) AND (h.vochcatcode = vc.vochcatcode)) UNION ALL SELECT notes.notecode AS documentcode, CASE notes.notecatcode WHEN 1 THEN 'NR' ELSE 'NP' END AS documenttype, notes.notecatcode AS catcode, notes.bankacccode AS acccode, NULL::smallint AS alternateacccode, CASE WHEN (notes.duedate IS NULL) THEN notes.issuedate ELSE notes.duedate END AS date, CASE notes.notecatcode WHEN 1 THEN notes.amount ELSE 0 END AS debit, CASE notes.notecatcode WHEN 2 THEN notes.amount ELSE 0 END AS credit, notes.remarks AS remarks, left(notes.documentnumber, 20) AS checkno, notes.salesmancode AS usercode, notes.vouchercode AS vouchercode, NULL::integer AS invoicecode, NULL::smallint AS invoicetype, 0 AS outstandingamt, 0 AS balance, CASE notes.notecatcode WHEN 1 THEN 0 ELSE 1 END AS vrow, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate FROM dbo.notes WHERE ((notes.posted = 'N') AND (notes.bankacccode IS NOT NULL)) UNION ALL SELECT notes.notecode AS documentcode, CASE notes.notecatcode WHEN 1 THEN 'NR' ELSE 'NP' END AS documenttype, notes.notecatcode AS catcode, notes.acccode AS acccode, NULL::smallint AS alternateacccode, CASE WHEN (notes.duedate IS NULL) THEN notes.issuedate ELSE notes.duedate END AS date, CASE notes.notecatcode WHEN 2 THEN notes.amount ELSE 0 END AS debit, CASE notes.notecatcode WHEN 1 THEN notes.amount ELSE 0 END AS credit, notes.remarks AS remarks, left(notes.documentnumber, 20) AS checkno, notes.salesmancode AS usercode, notes.vouchercode AS vouchercode, NULL::integer AS invoicecode, NULL::smallint AS invoicetype, 0 AS outstandingamt, 0 AS balance, CASE notes.notecatcode WHEN 1 THEN 0 ELSE 1 END AS vrow, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate FROM dbo.notes WHERE ((notes.posted = 'N') AND (notes.bankacccode IS NOT NULL)) UNION ALL SELECT documentcode, documenttype, catcode, CASE WHEN (documenttype = 'SV') THEN v_ln_cgs ELSE v_ln_invacc END AS dr_acccode, NULL::smallint AS alternateacccode, date, cgs AS debit, 0 AS credit, (CASE WHEN (documenttype = 'SV') THEN 'Cost of Sale charged for Sale Inv. #' ELSE 'Inventory Accounted for S/R  Inv. #' END || ltrim(rtrim(dbo.tsql_str((documentcode)::numeric)))) AS remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 0 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE (((v_invsys <> 'P') AND (documenttype IN ('SV', 'SR'))) AND (cgs <> 0)) UNION ALL SELECT documentcode, documenttype, catcode, CASE WHEN (documenttype = 'SV') THEN v_ln_invacc ELSE v_ln_cgs END AS dr_acccode, NULL::smallint AS alternateacccode, date, 0 AS debit, cgs AS credit, (CASE WHEN (documenttype = 'SV') THEN 'Inventory Accounted for Sale Inv. #' ELSE 'Cost of Sale Reversed for S/R Inv. #' END || ltrim(rtrim(dbo.tsql_str((documentcode)::numeric)))) AS remarks, checkno, usercode, vouchercode, invoicecode, invoicetype, outstandingamt AS outstandingamt, balance AS balance, 0 AS vrow, patientcode, grn, gccode, vehicle, shipto, guestcode, studentcode, cgs AS cgs, currencycode, conversionrate FROM tv_fn_getunposted_acctrans_uptrans AS uptrans WHERE (((v_invsys <> 'P') AND (documenttype IN ('SV', 'SR'))) AND (cgs <> 0));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_acctrans_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_acctrans_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_Adjustment ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_adjustment()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_invacc integer;
  v_ln_cgs integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_sremks citext;
  v_invsys citext;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_adjustment_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_adjustment_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_cgs := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CostOfGoodsSoldAcc')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  INSERT INTO tv_fn_getunposted_adjustment_rettable SELECT a.adjcode AS documentcode, CASE a.adjcatcode WHEN 1 THEN 'AI' ELSE 'AD' END AS documenttype, a.adjcatcode AS catcode, CASE a.adjcatcode WHEN 1 THEN v_ln_invacc ELSE a.acccode END AS dr_acccode, CASE a.adjcatcode WHEN 1 THEN a.acccode ELSE v_ln_invacc END AS cr_acccode, NULL::smallint AS alternateacccode, a.date AS date, 0 AS saletax, round((sum((d.looseqty * d.price)))::numeric, 0) AS gross, (CASE a.adjcatcode WHEN 1 THEN 'Stock Adjustment Increase # ' ELSE 'Stock Adjustment Decrease # ' END || ltrim(rtrim(dbo.tsql_str((a.adjcode)::numeric)))) AS dr_remarks, (CASE a.adjcatcode WHEN 1 THEN 'Stock Adjustment Increase # ' ELSE 'Stock Adjustment Decrease # ' END || ltrim(rtrim(dbo.tsql_str((a.adjcode)::numeric)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, a.usercode AS usercode, a.adjcode AS vouchercode, a.adjcode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.adjheader AS a, dbo.adjdetail AS d WHERE (((a.posted = 'N') AND (a.adjcode = d.adjcode)) AND (a.acccode IS NOT NULL)) GROUP BY a.adjcode, a.acccode, a.adjcatcode, a.date, a.usercode, a.remarks;
  RETURN QUERY SELECT * FROM tv_fn_getunposted_adjustment_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_adjustment_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_Purchase ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_purchase()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_invacc integer;
  v_ln_salestaxacc integer;
  v_ln_purexpacc integer;
  v_premks citext;
  v_reportpuronpostdate citext;
  v_invsys citext;
  v_roundupto smallint;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_purchase_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_purchase_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_roundupto := (SELECT dbo.fn_get_int_preference('roundpurinvon') AS a);
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_purchaseacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseAccount')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_equityacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_EquityACC')))::integer;
  v_ln_purchaseretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseReturnsAccount')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_ln_purexpacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurExpPayableAcc')))::integer;
  v_premks := (SELECT dbo.fn_getpreference('ShowPurRemarksInLedger') AS a);
  v_reportpuronpostdate := (SELECT dbo.fn_getpreference('reportpurchaseonpostingdate') AS a);
  IF (v_reportpuronpostdate IS NULL) THEN
    v_reportpuronpostdate := 'Y';
  END IF;
  INSERT INTO tv_fn_getunposted_purchase_rettable SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, CASE WHEN (v_invsys = 'P') THEN v_ln_purchaseacc ELSE v_ln_invacc END AS dr_acccode, CASE p.purcatcode WHEN 3 THEN v_ln_equityacc ELSE CASE WHEN (p.custcode > 0) THEN p.custcode ELSE p.suppcode END END AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((sum(((((d.looseqty + d.packqty) + d.bonusqty)) * d.unitsalestax)) + sum(round((((((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((((d.looseqty + d.packqty)) * d.purprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto) ELSE 0.00 END AS saletax, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum(((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) ELSE (round((((((sum(((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) + round((((sum(((((d.looseqty + d.packqty) + d.bonusqty)) * d.unitsalestax)) + sum(round((((((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((((d.looseqty + d.packqty)) * d.purprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto)) END AS gross, ((('Stock accounted for ' || CASE p.purcatcode WHEN 3 THEN 'open.' WHEN 7 THEN 'loose' WHEN 8 THEN 'loose' ELSE 'pack' END) || ' pur. #: ') || rtrim(ltrim((p.purinvcode)::text))) AS dr_remarks, CASE v_premks WHEN 'Y' THEN p.remarks ELSE CASE p.suppinvcode WHEN NULL THEN (CASE p.purcatcode WHEN 3 THEN 'Opening Purchase #: ' WHEN 7 THEN 'Payable on loose purchase #: ' WHEN 8 THEN 'Payable on loose purchase #: ' ELSE 'Payable on pack purchase #: ' END || rtrim(ltrim((p.purinvcode)::text))) ELSE ((('Supp. Inv. # : ' || ltrim(rtrim(p.suppinvcode))) || ', Date : ') || ltrim(rtrim(left(to_char(p.suppinvdate, 'DD/MM/YYYY'), 12)))) END END AS cr_remarks, ((('S.Tax payable on ' || CASE p.purcatcode WHEN 3 THEN 'open' WHEN 7 THEN 'loose' WHEN 8 THEN 'loose' ELSE 'pack' END) || ' pur. #: ') || rtrim(ltrim((p.purinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, p.amt AS amt, p.suppcode AS dramtacccode, p.paymentacccode AS cramtacccode, p.amtby AS amtby, p.amtdate AS amtdate, p.amtreference AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, CASE WHEN (p.advancetax = 'Y') THEN coalesce(p.advancetaxamt, 0) ELSE 0 END AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) GROUP BY p.purinvcode, p.suppcode, p.custcode, p.purcatcode, p.date, p.postdate, p.discperc, p.misccharges, p.salestax, p.flatdisc, p.invgstperc1, p.salesmancode, p.amt, p.paymentacccode, p.amtby, p.amtdate, p.amtreference, p.outstandingamt, p.suppinvcode, p.suppinvdate, p.remarks, p.grn, p.gccode, p.vehicle, p.shipto, p.updateavgpricewithnetrate, p.currencycode, p.conversionfactor, p.advancetax, p.advancetaxamt UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, CASE WHEN (v_invsys = 'P') THEN v_ln_purchaseacc ELSE v_ln_invacc END AS dr_acccode, CASE p.purcatcode WHEN 3 THEN v_ln_equityacc ELSE CASE WHEN (p.custcode > 0) THEN p.custcode ELSE p.suppcode END END AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((sum(((((d.looseqty + d.packqty) + d.bonusqty)) * d.unitsalestax)) + sum(round((((((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((((d.looseqty + d.packqty)) * d.purprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto) ELSE 0.00 END AS saletax, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum(((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) ELSE (round((((((sum(((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) + round((((sum(((((d.looseqty + d.packqty) + d.bonusqty)) * d.unitsalestax)) + sum(round((((((((d.looseqty + d.packqty)) * d.purprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((((d.looseqty + d.packqty)) * d.purprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto)) END AS gross, ((('Stock accounted for ' || CASE p.purcatcode WHEN 3 THEN 'open.' WHEN 7 THEN 'loose' WHEN 8 THEN 'loose' ELSE 'pack' END) || ' pur. #: ') || rtrim(ltrim((p.purinvcode)::text))) AS dr_remarks, CASE v_premks WHEN 'Y' THEN p.remarks ELSE CASE p.suppinvcode WHEN NULL THEN (CASE p.purcatcode WHEN 3 THEN 'Opening Purchase #: ' WHEN 7 THEN 'Payable on loose purchase #: ' WHEN 8 THEN 'Payable on loose purchase #: ' ELSE 'Payable on pack purchase #: ' END || rtrim(ltrim((p.purinvcode)::text))) ELSE ((('Supp. Inv. # : ' || ltrim(rtrim(p.suppinvcode))) || ', Date : ') || ltrim(rtrim(left(to_char(p.suppinvdate, 'DD/MM/YYYY'), 12)))) END END AS cr_remarks, ((('S.Tax payable on ' || CASE p.purcatcode WHEN 3 THEN 'open' WHEN 7 THEN 'loose' WHEN 8 THEN 'loose' ELSE 'pack' END) || ' pur. #: ') || rtrim(ltrim((p.purinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, p.amt AS amt, p.suppcode AS dramtacccode, p.paymentacccode AS cramtacccode, p.amtby AS amtby, p.amtdate AS amtdate, p.amtreference AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, CASE WHEN (p.advancetax = 'Y') THEN coalesce(p.advancetaxamt, 0) ELSE 0 END AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.proformapurdetail AS d WHERE (((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) GROUP BY p.purinvcode, p.suppcode, p.custcode, p.purcatcode, p.date, p.postdate, p.discperc, p.misccharges, p.salestax, p.flatdisc, p.invgstperc1, p.salesmancode, p.amt, p.paymentacccode, p.amtby, p.amtdate, p.amtreference, p.outstandingamt, p.suppinvcode, p.suppinvdate, p.remarks, p.grn, p.gccode, p.vehicle, p.shipto, p.updateavgpricewithnetrate, p.currencycode, p.conversionfactor, p.advancetax, p.advancetaxamt UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, pe.acccode AS dr_acccode, v_ln_purexpacc AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, pe.amount AS gross, CASE WHEN (length(rtrim(pe.remarks)) > 0) THEN pe.remarks ELSE ('Purchase Expenses on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = pe.acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purexp AS pe WHERE ((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = pe.purinvcode)) AND (pe.amount > 0)) UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.qe1_acccode AS dr_acccode, p.qexp1_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum((d.qe1 * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.qe1_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.qe1 > 0)) AND (p.qe1_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.qe1_acccode, p.qexp1_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.qe2_acccode AS dr_acccode, p.qexp2_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum((d.qe2 * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.qe2_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.qe2 > 0)) AND (p.qe2_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.qe2_acccode, p.qexp2_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.qe3_acccode AS dr_acccode, p.qexp3_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum((d.qe3 * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.qe3_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.qe3 > 0)) AND (p.qe3_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.qe3_acccode, p.qexp3_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.qe4_acccode AS dr_acccode, p.qexp4_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum((d.qe4 * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.qe4_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.qe4 > 0)) AND (p.qe4_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.qe4_acccode, p.qexp4_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.qe5_acccode AS dr_acccode, p.qexp5_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum((d.qe5 * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.qe5_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.qe5 > 0)) AND (p.qe5_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.qe5_acccode, p.qexp5_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.we1_acccode AS dr_acccode, p.wexp1_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum(((d.we1 * d.unitweight) * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.we1_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.we1 > 0)) AND (p.we1_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.we1_acccode, p.wexp1_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.we2_acccode AS dr_acccode, p.wexp2_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum(((d.we2 * d.unitweight) * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.we2_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.we2 > 0)) AND (p.we2_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.we2_acccode, p.wexp2_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.we3_acccode AS dr_acccode, p.wexp3_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum(((d.we3 * d.unitweight) * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.we3_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.we3 > 0)) AND (p.we3_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.we3_acccode, p.wexp3_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.we4_acccode AS dr_acccode, p.wexp4_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum(((d.we4 * d.unitweight) * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.we4_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.we4 > 0)) AND (p.we4_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.we4_acccode, p.wexp4_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor UNION ALL SELECT p.purinvcode AS documentcode, 'PV' AS documenttype, p.purcatcode AS catcode, p.we5_acccode AS dr_acccode, p.wexp5_cracccode AS cr_acccode, NULL::smallint AS alternateacccode, CASE v_reportpuronpostdate WHEN 'Y' THEN p.postdate ELSE p.date END AS date, 0.00 AS saletax, coalesce(round((sum(((d.we5 * d.unitweight) * (((d.packqty + d.looseqty) + d.bonusqty)))))::numeric, 2), 0) AS gross, CASE WHEN (length(rtrim(p.remarks)) > 0) THEN p.remarks ELSE ('Item Purchase Exp. on Inv #: ' || rtrim(ltrim((p.purinvcode)::text))) END AS dr_remarks, ((SELECT a.name FROM dbo.accounts AS a WHERE (a.acccode = p.we5_acccode)) || ' Payable') AS cr_remarks, NULL::citext AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.purinvcode AS vouchercode, p.purinvcode AS invoicecode, 2 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, p.grn AS grn, p.gccode AS gccode, p.vehicle AS vehicle, p.shipto AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, p.currencycode, p.conversionfactor, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.purledger AS p, dbo.purdetail AS d WHERE (((((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.purinvcode = d.purinvcode)) AND (d.we5 > 0)) AND (p.we5_acccode > 0)) GROUP BY p.purinvcode, p.purcatcode, p.postdate, p.date, p.we5_acccode, p.wexp5_cracccode, p.remarks, p.salesmancode, p.outstandingamt, p.grn, p.gccode, p.vehicle, p.shipto, p.currencycode, p.conversionfactor;
  RETURN QUERY SELECT * FROM tv_fn_getunposted_purchase_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_purchase_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_PurchaseReturn ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_purchasereturn()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_ln_invacc integer;
  v_prremks citext;
  v_invsys citext;
  v_roundupto smallint;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_purchasereturn_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_purchasereturn_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_roundupto := (SELECT dbo.fn_get_int_preference('roundpurinvon') AS a);
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_purchaseacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseAccount')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_equityacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_EquityACC')))::integer;
  v_ln_purchaseretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_PurchaseReturnsAccount')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_prremks := (SELECT dbo.fn_getpreference('ShowPRetRemarksInLedger') AS a);
  INSERT INTO tv_fn_getunposted_purchasereturn_rettable SELECT p.prinvcode AS documentcode, 'PR' AS documenttype, p.prcatcode AS catcode, CASE p.prcatcode WHEN 6 THEN v_ln_equityacc ELSE CASE WHEN (p.custcode > 0) THEN p.custcode ELSE p.suppcode END END AS dr_acccode, CASE WHEN (v_invsys = 'P') THEN v_ln_purchaseretacc ELSE v_ln_invacc END AS cr_acccode, NULL::smallint AS alternateacccode, p.date AS date, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round((((((d.looseqty * d.prprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * d.prprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto) ELSE 0.00 END AS saletax, CASE p.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum((((d.looseqty * d.prprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) ELSE (round((((((sum((((d.looseqty * d.prprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) + p.misccharges) + p.salestax) - p.flatdisc))::numeric, v_roundupto) + round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round((((((d.looseqty * d.prprice) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * d.prprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * p.discperc))))) - p.flatdisc)) * ((p.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupto)) END AS gross, CASE v_prremks WHEN 'Y' THEN p.remarks ELSE ((CASE p.prcatcode WHEN 6 THEN 'Open' ELSE 'Receivable on ' END || ' pur. return #: ') || rtrim(ltrim((p.prinvcode)::text))) END AS dr_remarks, ((('Stock returned on ' || CASE p.prcatcode WHEN 6 THEN 'open' ELSE '' END) || ' pur. return #: ') || rtrim(ltrim((p.prinvcode)::text))) AS cr_remarks, ((('S.Tax receivable on ' || CASE p.prcatcode WHEN 6 THEN 'open' ELSE ':' END) || ' pur. return #: ') || rtrim(ltrim((p.prinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, p.salesmancode AS usercode, p.prinvcode AS vouchercode, p.prinvcode AS invoicecode, 4 AS invoicetype, p.amt AS amt, p.paymentacccode AS dramtacccode, p.suppcode AS cramtacccode, p.amtby AS amtby, p.amtdate AS amtdate, p.amtreference AS amtref, p.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.prledger AS p, dbo.prdetail AS d WHERE (((p.posted = 'N') AND (p.accountfor = 'Y')) AND (p.prinvcode = d.prinvcode)) GROUP BY p.prinvcode, p.suppcode, p.custcode, p.prcatcode, p.date, p.discperc, p.misccharges, p.salestax, p.flatdisc, p.invgstperc1, p.salesmancode, p.amt, p.paymentacccode, p.updateavgpricewithnetrate, p.amtby, p.amtdate, p.amtreference, p.outstandingamt, p.remarks;
  RETURN QUERY SELECT * FROM tv_fn_getunposted_purchasereturn_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_purchasereturn_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_PurServices ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_purservices()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_exponsvc integer;
  v_ln_salestaxacc integer;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_purservices_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_purservices_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_exponsvc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_ExpensesOnServices')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  INSERT INTO tv_fn_getunposted_purservices_rettable SELECT h.servicepurinvcode AS documentcode, 'SP' AS documenttype, 1 AS catcode, v_ln_exponsvc AS dr_acccode, h.suppcode AS cr_acccode, NULL::smallint AS alternateacccode, h.date AS date, 0 AS saletax, coalesce(round(((((sum((((d.qty * coalesce((d.price - d.serviceflatdisc), 0))) * ((1 - ((.01 * coalesce(d.discperc, 0))))))) * ((1 - ((.01 * coalesce(h.discperc, 0)))))) + coalesce(h.misccharges, 0)) - coalesce(h.flatdisc, 0)))::numeric, 0), 0) AS gross, ('Purchased Services Against Inv. #: ' || rtrim(ltrim((h.servicepurinvcode)::text))) AS dr_remarks, ('Payable On Services Purchased Against Inv. #: ' || rtrim(ltrim((h.servicepurinvcode)::text))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, coalesce(h.usercode, 0) AS usercode, h.servicepurinvcode AS vouchercode, h.servicepurinvcode AS invoicecode, 6 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, h.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicepurheader AS h, dbo.servicepurdetail AS d WHERE ((h.posted = 'N') AND (h.servicepurinvcode = d.servicepurinvcode)) GROUP BY h.servicepurinvcode, h.suppcode, h.date, h.discperc, h.misccharges, h.flatdisc, h.usercode, h.outstandingamt, h.remarks UNION ALL SELECT s.servicepurinvcode AS documentcode, 'SP' AS documenttype, 1 AS catcode, s.suppcode AS dr_acccode, s.cashacccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, ('Cash Paid for Services Purchased on Inv. #: ' || ltrim(rtrim(dbo.tsql_str((s.servicepurinvcode)::numeric, 10)))) AS dr_remarks, ('Cash Paid for Services Purchased on Inv. #: ' || ltrim(rtrim(dbo.tsql_str((s.servicepurinvcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.usercode AS usercode, s.servicepurinvcode AS vouchercode, s.servicepurinvcode AS invoicecode, 6 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicepurheader AS s WHERE ((s.posted = 'N') AND (s.cashcharged > 0)) UNION ALL SELECT s.servicepurinvcode AS documentcode, 'SP' AS documenttype, 1 AS catcode, s.suppcode AS dr_acccode, d.acccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.usercode AS usercode, s.servicepurinvcode AS vouchercode, s.servicepurinvcode AS invoicecode, 6 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicepurheader AS s, dbo.mastercashwin AS d WHERE (((s.posted = 'N') AND (d.documenttype = 'SP')) AND (s.servicepurinvcode = d.documentcode)) UNION ALL SELECT h.servicepurinvcode AS documentcode, 'RP' AS documenttype, 1 AS catcode, h.suppcode AS dr_acccode, v_ln_exponsvc AS cr_acccode, NULL::smallint AS alternateacccode, h.date AS date, 0 AS saletax, coalesce(round(((((sum((((d.qty * coalesce((d.price - d.serviceflatdisc), 0))) * ((1 - ((.01 * coalesce(d.discperc, 0))))))) * ((1 - ((.01 * coalesce(h.discperc, 0)))))) + coalesce(h.misccharges, 0)) - coalesce(h.flatdisc, 0)))::numeric, 0), 0) AS gross, (('Services P/R Inv. #: ' || rtrim(ltrim((h.serviceprinvcode)::text))) || CASE WHEN (h.servicepurinvcode > 0) THEN (', Against Pur. # :' || rtrim(ltrim((h.servicepurinvcode)::text))) ELSE '' END) AS dr_remarks, (('Services P/R Inv. #: ' || rtrim(ltrim((h.serviceprinvcode)::text))) || CASE WHEN (h.servicepurinvcode > 0) THEN (', Against Pur. # :' || rtrim(ltrim((h.servicepurinvcode)::text))) ELSE '' END) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, coalesce(h.usercode, 0) AS usercode, h.serviceprinvcode AS vouchercode, h.serviceprinvcode AS invoicecode, 8 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, h.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceprheader AS h, dbo.serviceprdetail AS d WHERE ((h.posted = 'N') AND (h.serviceprinvcode = d.serviceprinvcode)) GROUP BY h.serviceprinvcode, h.servicepurinvcode, h.suppcode, h.date, h.discperc, h.misccharges, h.flatdisc, h.usercode, h.outstandingamt, h.remarks UNION ALL SELECT s.serviceprinvcode AS documentcode, 'RP' AS documenttype, 1 AS catcode, s.cashacccode AS dr_acccode, s.suppcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, (('Cash Received for Services P/R Inv. #: ' || ltrim(rtrim(dbo.tsql_str((s.serviceprinvcode)::numeric, 10)))) || CASE WHEN (s.servicepurinvcode > 0) THEN (', Ref. Pur. # :' || rtrim(ltrim((s.servicepurinvcode)::text))) ELSE '' END) AS dr_remarks, (('Cash Received for Services P/R Inv. #: ' || ltrim(rtrim(dbo.tsql_str((s.serviceprinvcode)::numeric, 10)))) || CASE WHEN (s.servicepurinvcode > 0) THEN (', Ref. Pur. # :' || rtrim(ltrim((s.servicepurinvcode)::text))) ELSE '' END) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.usercode AS usercode, s.serviceprinvcode AS vouchercode, s.serviceprinvcode AS invoicecode, 8 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceprheader AS s WHERE ((s.posted = 'N') AND (s.cashcharged > 0)) UNION ALL SELECT s.serviceprinvcode AS documentcode, 'RP' AS documenttype, 1 AS catcode, d.acccode AS dr_acccode, s.suppcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.usercode AS usercode, s.serviceprinvcode AS vouchercode, s.serviceprinvcode AS invoicecode, 8 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, NULL::integer AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceprheader AS s, dbo.mastercashwin AS d WHERE (((s.posted = 'N') AND (d.documenttype = 'RP')) AND (s.servicepurinvcode = d.documentcode));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_purservices_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_purservices_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_SaleOrder ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_saleorder()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_saleorder_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_saleorder_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_revfromservice := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_RevenueFromServices')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  INSERT INTO tv_fn_getunposted_saleorder_rettable SELECT s.saleordercode AS documentcode, 'SO' AS documenttype, 1 AS catcode, s.paymentacccode AS dr_acccode, s.custcode AS cr_acccode, NULL::smallint AS alternateacccode, s.amtdate AS date, 0 AS saletax, s.amt AS gross, ('Advance received on sale order #: ' || rtrim(ltrim((s.saleordercode)::text))) AS dr_remarks, ('Advance received on sale order #: ' || rtrim(ltrim((s.saleordercode)::text))) AS cr_remarks, NULL::citext AS saletax_remarks, s.amtreference AS checkno, s.amtby AS usercode, s.saleordercode AS vouchercode, s.saleordercode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, s.patientcode AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.saleorderheader AS s WHERE (((s.posted = 'N') AND (s.amt <> 0)) AND (s.amtdate IS NOT NULL));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_saleorder_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_saleorder_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_Sales ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_sales()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_ln_invacc integer;
  v_ln_cgs integer;
  v_ln_fbrposfeeacc numeric(5,0);
  v_sremks citext;
  v_invsys citext;
  v_roundupyo smallint;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_sales_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_sales_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundsaleinvon') AS a);
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_cgs := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CostOfGoodsSoldAcc')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_ln_fbrposfeeacc := (SELECT code FROM dbo.global WHERE (name = 'GT_FBRPOSFeeAcc'));
  v_sremks := (SELECT dbo.fn_getpreference('ShowSaleRemarksInLedger') AS a);
  INSERT INTO tv_fn_getunposted_sales_rettable SELECT s.saleinvcode AS documentcode, 'SV' AS documenttype, s.salecatcode AS catcode, CASE s.salecatcode WHEN 1 THEN s.cashacccode WHEN 3 THEN s.cashacccode ELSE s.custcode END AS dr_acccode, v_ln_salesacc AS cr_acccode, CASE s.salecatcode WHEN 1 THEN s.custcode WHEN 3 THEN s.custcode ELSE NULL END AS alternateacccode, s.date AS date, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo) ELSE 0.00 END AS saletax, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) ELSE (round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) + round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo)) END AS gross, CASE v_sremks WHEN 'Y' THEN s.remarks ELSE (CASE s.salecatcode WHEN 3 THEN 'Cash receipt on sale #: ' WHEN 1 THEN 'Cash receipt on sale #: ' ELSE 'Receivable on cr. sale #: ' END || rtrim(ltrim((s.saleinvcode)::text))) END AS dr_remarks, ((('Revenue from ' || CASE s.salecatcode WHEN 3 THEN 'cash' WHEN 1 THEN 'cash' ELSE 'cr.' END) || ' sale #: ') || rtrim(ltrim((s.saleinvcode)::text))) AS cr_remarks, ((((('S.Tax ' || CASE s.salecatcode WHEN 3 THEN 'received' WHEN 1 THEN 'received' ELSE 'receivable' END) || ' on ') || CASE s.salecatcode WHEN 3 THEN 'cash' WHEN 1 THEN 'cash' ELSE 'cr.' END) || ' sale #: ') || rtrim(ltrim((s.saleinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.saleinvcode AS vouchercode, s.saleinvcode AS invoicecode, 1 AS invoicetype, CASE s.salecatcode WHEN 2 THEN s.amt ELSE 0 END AS amt, s.paymentacccode AS dramtacccode, s.custcode AS cramtacccode, s.amtby AS amtby, s.amtdate AS amtdate, s.amtreference AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, s.grn AS grn, s.gccode AS gccode, s.vehicle AS vehicle, s.shipto AS shipto, s.guestcode, s.studentcode, coalesce(sum((((d.looseqty + d.bonusqty)) * d.avgprice)), 0) AS cgs, s.currencycode, s.conversionrate, CASE WHEN (s.advancetax = 'Y') THEN coalesce(s.advancetaxamt, 0) ELSE 0 END AS advincometax, s.fbrposfee FROM dbo.saleledger AS s, dbo.saledetail AS d WHERE (((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.saleinvcode = d.saleinvcode)) GROUP BY s.saleinvcode, s.custcode, s.salecatcode, s.date, s.discperc, s.misccharges, s.salestax, s.flatdisc, s.invgstperc1, s.salesmancode, s.amt, s.paymentacccode, s.amtby, s.amtdate, s.amtreference, s.outstandingamt, s.patientcode, s.admissioncode, s.remarks, s.grn, s.gccode, s.vehicle, s.shipto, s.cashacccode, s.guestcode, s.studentcode, s.currencycode, s.conversionrate, s.updateavgpricewithnetrate, s.advancetax, s.advancetaxamt, s.fbrposfee UNION ALL SELECT s.saleinvcode AS documentcode, 'SV' AS documenttype, s.salecatcode AS catcode, CASE s.salecatcode WHEN 1 THEN s.cashacccode WHEN 3 THEN s.cashacccode ELSE s.custcode END AS dr_acccode, v_ln_salesacc AS cr_acccode, CASE s.salecatcode WHEN 1 THEN s.custcode WHEN 3 THEN s.custcode ELSE NULL END AS alternateacccode, s.date AS date, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo) ELSE 0.00 END AS saletax, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) ELSE (round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) + round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * ((d.saleprice - d.itemflatdisc)))) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo)) END AS gross, CASE v_sremks WHEN 'Y' THEN s.remarks ELSE (CASE s.salecatcode WHEN 3 THEN 'Cash receipt on sale #: ' WHEN 1 THEN 'Cash receipt on sale #: ' ELSE 'Receivable on cr. sale #: ' END || rtrim(ltrim((s.saleinvcode)::text))) END AS dr_remarks, ((('Revenue from ' || CASE s.salecatcode WHEN 3 THEN 'cash' WHEN 1 THEN 'cash' ELSE 'cr.' END) || ' sale #: ') || rtrim(ltrim((s.saleinvcode)::text))) AS cr_remarks, ((((('S.Tax ' || CASE s.salecatcode WHEN 3 THEN 'received' WHEN 1 THEN 'received' ELSE 'receivable' END) || ' on ') || CASE s.salecatcode WHEN 3 THEN 'cash' WHEN 1 THEN 'cash' ELSE 'cr.' END) || ' sale #: ') || rtrim(ltrim((s.saleinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.saleinvcode AS vouchercode, s.saleinvcode AS invoicecode, 1 AS invoicetype, CASE s.salecatcode WHEN 2 THEN s.amt ELSE 0 END AS amt, s.paymentacccode AS dramtacccode, s.custcode AS cramtacccode, s.amtby AS amtby, s.amtdate AS amtdate, s.amtreference AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, s.grn AS grn, s.gccode AS gccode, s.vehicle AS vehicle, s.shipto AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, CASE WHEN (s.advancetax = 'Y') THEN coalesce(s.advancetaxamt, 0) ELSE 0 END AS advincometax, s.fbrposfee FROM dbo.saleledger AS s, dbo.saleinvdetail AS d WHERE (((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.saleinvcode = d.saleinvcode)) GROUP BY s.saleinvcode, s.custcode, s.salecatcode, s.date, s.discperc, s.misccharges, s.salestax, s.flatdisc, s.invgstperc1, s.salesmancode, s.amt, s.paymentacccode, s.amtby, s.amtdate, s.amtreference, s.outstandingamt, s.patientcode, s.admissioncode, s.remarks, s.grn, s.gccode, s.vehicle, s.shipto, s.cashacccode, s.guestcode, s.studentcode, s.currencycode, s.conversionrate, s.updateavgpricewithnetrate, s.advancetax, s.advancetaxamt, s.fbrposfee UNION ALL SELECT s.saleinvcode AS documentcode, 'SV' AS documenttype, s.salecatcode AS catcode, CASE WHEN (d.debit > 0) THEN acccode ELSE s.custcode END AS dr_acccode, CASE WHEN (d.debit > 0) THEN s.custcode ELSE acccode END AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, CASE WHEN (d.debit > 0) THEN d.debit ELSE d.credit END AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, d.checkno AS checkno, s.salesmancode AS usercode, s.saleinvcode AS vouchercode, s.saleinvcode AS invoicecode, 1 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, s.grn AS grn, s.gccode AS gccode, s.vehicle AS vehicle, s.shipto AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.saleledger AS s, dbo.salereceivableadj AS d WHERE (((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.saleinvcode = d.saleinvcode)) UNION ALL SELECT s.saleinvcode AS documentcode, 'SV' AS documenttype, s.salecatcode AS catcode, s.cashacccode AS dr_acccode, s.custcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, ('Cash Received on Sale Inv. No.' || ltrim(rtrim(dbo.tsql_str((s.saleinvcode)::numeric, 10)))) AS dr_remarks, ('Cash Received on Sale Inv. No.' || ltrim(rtrim(dbo.tsql_str((s.saleinvcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.saleinvcode AS vouchercode, s.saleinvcode AS invoicecode, 1 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, s.grn AS grn, s.gccode AS gccode, s.vehicle AS vehicle, s.shipto AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.saleledger AS s WHERE ((((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.salecatcode <> 3)) AND (s.cashcharged > 0)) UNION ALL SELECT s.saleinvcode AS documentcode, 'SV' AS documenttype, s.salecatcode AS catcode, d.acccode AS dr_acccode, s.custcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.saleinvcode AS vouchercode, s.saleinvcode AS invoicecode, 1 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, s.grn AS grn, s.gccode AS gccode, s.vehicle AS vehicle, s.shipto AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.saleledger AS s, dbo.cashierwindow AS d WHERE (((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.saleinvcode = d.saleinvcode));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_sales_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_sales_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_SalesReturn ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_salesreturn()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_ln_invacc integer;
  v_ln_cgs integer;
  v_srremks citext;
  v_invsys citext;
  v_roundupyo smallint;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_salesreturn_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_salesreturn_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_roundupyo := (SELECT dbo.fn_get_int_preference('roundsalereturninvon') AS a);
  v_invsys := coalesce((SELECT dbo.fn_getpreference('InventorySystemUsed') AS a), 'P');
  v_ln_invacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_InventoryAcc')))::integer;
  v_ln_cgs := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CostOfGoodsSoldAcc')))::integer;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_srremks := (SELECT dbo.fn_getpreference('ShowSRetRemarksInLedger') AS a);
  INSERT INTO tv_fn_getunposted_salesreturn_rettable SELECT s.srinvcode AS documentcode, 'SR' AS documenttype, s.srcatcode AS catcode, v_ln_salesretacc AS dr_acccode, CASE s.srcatcode WHEN 6 THEN s.cashacccode WHEN 8 THEN s.cashacccode ELSE s.custcode END AS cr_acccode, CASE s.srcatcode WHEN 6 THEN s.custcode WHEN 8 THEN s.custcode ELSE NULL END AS alternateacccode, s.date AS date, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo) ELSE 0.00 END AS saletax, CASE s.updateavgpricewithnetrate WHEN 'N' THEN round((((((sum((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) ELSE (round((((((sum((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) + s.misccharges) + s.salestax) - s.flatdisc))::numeric, v_roundupyo) + round((((sum((((d.looseqty + d.bonusqty)) * d.unitsalestax)) + sum(round(((((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc))))) * d.gstperc) * .01))::numeric, 2))) + round((((((sum((((d.looseqty * d.srprice)) * ((1 - ((.01 * d.discperc)))))) * ((1 - ((.01 * s.discperc))))) - s.flatdisc)) * ((s.invgstperc1 * .01))))::numeric, 2)))::numeric, v_roundupyo)) END AS gross, (((('Revenue (reversal) on ' || CASE s.srcatcode WHEN 6 THEN 'cash' WHEN 8 THEN 'cash' ELSE 'cr.' END) || ' sale ret. #: ') || rtrim(ltrim((s.srinvcode)::text))) || CASE WHEN (s.saleinvcode IS NULL) THEN '' ELSE (', Sale #:' || rtrim(ltrim((s.saleinvcode)::text))) END) AS dr_remarks, CASE v_srremks WHEN 'Y' THEN s.remarks ELSE ((CASE s.srcatcode WHEN 6 THEN 'Cash paid on sale ret.#: ' WHEN 8 THEN 'Cash paid on sale ret.#: ' ELSE 'Payable on cr. sale ret.#: ' END || rtrim(ltrim((s.srinvcode)::text))) || CASE WHEN (s.saleinvcode IS NULL) THEN '' ELSE (', Sale #:' || rtrim(ltrim((s.saleinvcode)::text))) END) END AS cr_remarks, (((('S.Tax ' || CASE s.srcatcode WHEN 6 THEN 'Paid' WHEN 8 THEN 'Paid' ELSE 'Payable' END) || ' on sale ret. #: ') || rtrim(ltrim((s.srinvcode)::text))) || CASE WHEN (s.saleinvcode IS NULL) THEN '' ELSE (', sale #:' || rtrim(ltrim((s.saleinvcode)::text))) END) AS saletax_remarks, NULL::citext AS checkno, coalesce(s.salesmancode, 0) AS usercode, s.srinvcode AS vouchercode, s.srinvcode AS invoicecode, 3 AS invoicetype, CASE s.srcatcode WHEN 8 THEN 0 ELSE s.amt END AS amt, s.custcode AS dramtacccode, s.paymentacccode AS cramtacccode, s.amtby AS amtby, s.amtdate AS amtdate, s.amtreference AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode, s.studentcode, coalesce(sum((((d.looseqty + d.bonusqty)) * d.avgprice)), 0) AS cgs, s.currencycode, s.conversionrate, coalesce(s.advancetaxamt, 0) AS advincometax, coalesce(s.fbrposfee, 0) AS fbrposfee FROM dbo.srledger AS s, dbo.srdetail AS d WHERE (((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.srinvcode = d.srinvcode)) GROUP BY s.srinvcode, s.custcode, s.srcatcode, s.cashacccode, s.date, s.discperc, s.misccharges, s.salestax, s.flatdisc, s.invgstperc1, s.salesmancode, s.saleinvcode, s.amt, s.paymentacccode, s.amtby, s.amtdate, s.amtreference, s.outstandingamt, s.patientcode, s.admissioncode, s.cashacccode, s.remarks, s.guestcode, s.studentcode, s.currencycode, s.conversionrate, s.updateavgpricewithnetrate, s.advancetaxamt, s.fbrposfee UNION ALL SELECT s.srinvcode AS documentcode, 'SR' AS documenttype, s.srcatcode AS catcode, s.custcode AS dr_acccode, s.cashacccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, ('Cash Paid on S/R No.' || ltrim(rtrim(dbo.tsql_str((s.srinvcode)::numeric, 10)))) AS dr_remarks, ('Cash Paid on S/R No.' || ltrim(rtrim(dbo.tsql_str((s.srinvcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.srinvcode AS vouchercode, s.srinvcode AS invoicecode, 3 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.srledger AS s WHERE ((((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.srcatcode <> 8)) AND (s.cashcharged > 0)) UNION ALL SELECT s.srinvcode AS documentcode, 'SR' AS documenttype, s.srcatcode AS catcode, s.custcode AS dr_acccode, d.acccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.srinvcode AS vouchercode, s.srinvcode AS invoicecode, 3 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, s.outstandingamt AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode, s.studentcode, 0 AS cgs, s.currencycode, s.conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.srledger AS s, dbo.mastercashwin AS d WHERE ((((s.posted = 'N') AND (s.accountfor = 'Y')) AND (s.srinvcode = d.documentcode)) AND (d.documenttype = 'SR'));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_salesreturn_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_salesreturn_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_Services ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_services()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ln_purchaseacc integer;
  v_ln_cashacc integer;
  v_ln_equityacc integer;
  v_ln_salesacc integer;
  v_ln_salesretacc integer;
  v_ln_purchaseretacc integer;
  v_ln_revfromservice integer;
  v_ln_salestaxacc integer;
  v_svcremks citext;
  v_svcrremks citext;
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_services_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_services_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  v_ln_cashacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_CashACC')))::integer;
  v_ln_salesacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesACC')))::integer;
  v_ln_salesretacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_SalesReturnACC')))::integer;
  v_ln_revfromservice := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_RevenueFromServices')))::integer;
  v_ln_salestaxacc := trunc((SELECT code FROM dbo.global WHERE (name = 'GT_AdvanceSalesTaxACC')))::integer;
  v_svcremks := (SELECT dbo.fn_getpreference('ShowSvcRemarksInLedger') AS a);
  v_svcrremks := (SELECT dbo.fn_getpreference('ShowSvcRetRemarksInLedger') AS a);
  INSERT INTO tv_fn_getunposted_services_rettable SELECT h.serviceinvcode AS documentcode, 'RS' AS documenttype, h.servicecatcode AS catcode, CASE h.servicecatcode WHEN 10 THEN h.cashacccode WHEN 12 THEN h.cashacccode ELSE h.custcode END AS dr_acccode, v_ln_revfromservice AS cr_acccode, CASE h.servicecatcode WHEN 10 THEN h.custcode WHEN 12 THEN h.custcode ELSE NULL END AS alternateacccode, h.date AS date, round((((coalesce(sum((((((d.qty * ((d.price - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01))))) * 0.01) * d.servicegstperc)), 0) + coalesce(sum((d.qty * d.serviceflattax)), 0)) + coalesce(round((((((sum((((d.qty * ((d.price - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (h.discperc * 0.01))))) - h.flatdisc)) * 0.01) * h.serviceinvgstperc))::numeric, 2), 0)))::numeric, 0) AS saletax, coalesce(round(((((sum((((d.qty * coalesce((d.price - d.serviceflatdisc), 0))) * ((1 - ((.01 * coalesce(d.discperc, 0))))))) * ((1 - ((.01 * coalesce(h.discperc, 0)))))) + coalesce(h.misccharges, 0)) - coalesce(h.flatdisc, 0)))::numeric, 0), 0) AS gross, CASE v_svcremks WHEN 'Y' THEN h.remarks ELSE ((CASE h.servicecatcode WHEN 10 THEN 'Cash receipt on service sale #: ' WHEN 12 THEN 'Cash receipt on service sale #: ' ELSE 'Receivable on cr. service #: ' END || rtrim(ltrim((h.serviceinvcode)::text))) || CASE WHEN (h.saleinvcode IS NULL) THEN '' ELSE (', sale #:' || rtrim(ltrim((h.saleinvcode)::text))) END) END AS dr_remarks, (CASE h.servicecatcode WHEN 6 THEN 'Revenue from cash service #: ' ELSE 'Revenue from credit service #: ' END || rtrim(ltrim((h.serviceinvcode)::text))) AS cr_remarks, ('Sales Tax Payable on Service Inv. #: ' || rtrim(ltrim((h.serviceinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, coalesce(h.salesmancode, 0) AS usercode, h.serviceinvcode AS vouchercode, h.serviceinvcode AS invoicecode, 5 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (h.patientcode IS NULL) THEN CASE WHEN (h.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (h.admissioncode = a.admissioncode)) END ELSE h.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, h.guestcode AS guestcode, h.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceheader AS h, dbo.servicedetail AS d WHERE ((h.posted = 'N') AND (h.serviceinvcode = d.serviceinvcode)) GROUP BY h.serviceinvcode, h.custcode, h.servicecatcode, h.cashacccode, h.date, h.discperc, h.misccharges, h.flatdisc, h.serviceinvgstperc, h.salesmancode, h.saleinvcode, h.patientcode, h.admissioncode, h.remarks, h.guestcode, h.studentcode UNION ALL SELECT s.serviceinvcode AS documentcode, 'RS' AS documenttype, s.servicecatcode AS catcode, s.cashacccode AS dr_acccode, s.custcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, ('Cash Received on Service Inv. No.' || ltrim(rtrim(dbo.tsql_str((s.serviceinvcode)::numeric, 10)))) AS dr_remarks, ('Cash Received on Service Inv. No.' || ltrim(rtrim(dbo.tsql_str((s.serviceinvcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.serviceinvcode AS vouchercode, s.serviceinvcode AS invoicecode, 5 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode AS guestcode, s.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceheader AS s WHERE (((s.posted = 'N') AND (s.servicecatcode <> 10)) AND (s.cashcharged > 0)) UNION ALL SELECT s.serviceinvcode AS documentcode, 'RS' AS documenttype, s.servicecatcode AS catcode, d.acccode AS dr_acccode, s.custcode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.serviceinvcode AS vouchercode, s.serviceinvcode AS invoicecode, 5 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode AS guestcode, s.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.serviceheader AS s, dbo.mastercashwin AS d WHERE (((s.posted = 'N') AND (d.documenttype = 'RS')) AND (s.serviceinvcode = d.documentcode)) UNION ALL SELECT h.servicerinvcode AS documentcode, 'RR' AS documenttype, h.servicercatcode AS catcode, v_ln_revfromservice AS dr_acccode, CASE h.servicercatcode WHEN 13 THEN h.cashacccode WHEN 15 THEN h.cashacccode ELSE h.custcode END AS cr_acccode, CASE h.servicercatcode WHEN 13 THEN h.custcode WHEN 15 THEN h.custcode ELSE NULL END AS alternateacccode, h.date AS date, round((((coalesce(sum((((((d.qty * ((d.serviceprice - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01))))) * 0.01) * d.servicegstperc)), 0) + coalesce(sum((d.qty * d.serviceflattax)), 0)) + coalesce(round((((((sum((((d.qty * ((d.serviceprice - d.serviceflatdisc))) * ((1 - (d.discperc * 0.01)))) * ((1 - (h.discperc * 0.01))))) - h.flatdisc)) * 0.01) * h.serviceinvgstperc))::numeric, 2), 0)))::numeric, 0) AS saletax, coalesce(round(((((sum(((d.qty * (coalesce((d.serviceprice - d.serviceflatdisc), 0))) * ((1 - ((.01 * coalesce(d.discperc, 0))))))) * ((1 - ((.01 * h.discperc))))) + coalesce(h.misccharges, 0)) - coalesce(h.flatdisc, 0)))::numeric, 0), 0) AS gross, (((('Revenue (reversal) for ' || CASE h.servicercatcode WHEN 13 THEN 'cash' WHEN 15 THEN 'cash' ELSE 'cr.' END) || ' service return #: ') || rtrim(ltrim((h.servicerinvcode)::text))) || CASE WHEN (h.serviceinvcode IS NULL) THEN '' ELSE (', service #:' || rtrim(ltrim((h.serviceinvcode)::text))) END) AS dr_remarks, CASE v_svcrremks WHEN 'Y' THEN h.remarks ELSE (((CASE h.servicercatcode WHEN 13 THEN 'cash paid on' WHEN 15 THEN 'cash paid on' ELSE 'Payable on cr.' END || ' service return #: ') || rtrim(ltrim((h.servicerinvcode)::text))) || CASE WHEN (h.serviceinvcode IS NULL) THEN '' ELSE (', service #:' || rtrim(ltrim((h.serviceinvcode)::text))) END) END AS cr_remarks, ('Sales Tax Payable (Reveral) on Service Ret Inv. #: ' || rtrim(ltrim((h.servicerinvcode)::text))) AS saletax_remarks, NULL::citext AS checkno, h.salesmancode AS usercode, h.servicerinvcode AS vouchercode, h.servicerinvcode AS invoicecode, 7 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (h.patientcode IS NULL) THEN CASE WHEN (h.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (h.admissioncode = a.admissioncode)) END ELSE h.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, h.guestcode AS guestcode, h.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicerheader AS h, dbo.servicerdetail AS d WHERE ((h.posted = 'N') AND (h.servicerinvcode = d.servicerinvcode)) GROUP BY h.servicerinvcode, h.custcode, h.servicercatcode, h.cashacccode, h.date, h.discperc, h.misccharges, h.flatdisc, h.serviceinvgstperc, h.salesmancode, h.serviceinvcode, h.patientcode, h.admissioncode, h.remarks, h.guestcode, h.studentcode UNION ALL SELECT s.servicerinvcode AS documentcode, 'RR' AS documenttype, s.servicercatcode AS catcode, s.custcode AS dr_acccode, s.cashacccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, s.cashcharged AS gross, ('Cash paid on Service Ret. No.' || ltrim(rtrim(dbo.tsql_str((s.servicerinvcode)::numeric, 10)))) AS dr_remarks, ('Cash paid on Service Ret. No.' || ltrim(rtrim(dbo.tsql_str((s.servicerinvcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.servicerinvcode AS vouchercode, s.servicerinvcode AS invoicecode, 7 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode AS guestcode, s.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicerheader AS s WHERE (((s.posted = 'N') AND (s.servicercatcode <> 13)) AND (s.cashcharged > 0)) UNION ALL SELECT s.servicerinvcode AS documentcode, 'RR' AS documenttype, s.servicercatcode AS catcode, s.custcode AS dr_acccode, d.acccode AS cr_acccode, NULL::smallint AS alternateacccode, s.date AS date, 0 AS saletax, amount AS gross, d.remarks AS dr_remarks, d.remarks AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, s.salesmancode AS usercode, s.servicerinvcode AS vouchercode, s.servicerinvcode AS invoicecode, 7 AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, CASE WHEN (s.patientcode IS NULL) THEN CASE WHEN (s.admissioncode IS NULL) THEN NULL ELSE (SELECT a.patientcode FROM dbo.patientadmission AS a WHERE (s.admissioncode = a.admissioncode)) END ELSE s.patientcode END AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, s.guestcode AS guestcode, s.studentcode AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.servicerheader AS s, dbo.mastercashwin AS d WHERE (((s.posted = 'N') AND (d.documenttype = 'RR')) AND (s.servicerinvcode = d.documentcode));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_services_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_services_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_GetUnposted_TransWindow ====
CREATE OR REPLACE FUNCTION dbo.fn_getunposted_transwindow()
  RETURNS TABLE(documentcode integer, documenttype citext, catcode smallint, dr_acccode smallint, cr_acccode smallint, alternateacccode smallint, date timestamp(3), saletax numeric, gross numeric, dr_remarks citext, cr_remarks citext, saletax_remarks citext, checkno citext, usercode smallint, vouchercode integer, invoicecode integer, invoicetype smallint, amt numeric, dramtacccode integer, cramtacccode integer, amtby smallint, amtdate timestamp(3), amtref citext, outstandingamt numeric, balance numeric, patientcode integer, grn citext, gccode smallint, vehicle citext, shipto citext, guestcode integer, studentcode integer, cgs numeric, currencycode smallint, conversionrate numeric, advincometax numeric, fbrposfee numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  DROP TABLE IF EXISTS tv_fn_getunposted_transwindow_rettable;
  CREATE TEMP TABLE tv_fn_getunposted_transwindow_rettable (
    documentcode integer NOT NULL,
    documenttype citext NOT NULL,
    catcode smallint NOT NULL,
    dr_acccode smallint NOT NULL,
    cr_acccode smallint NOT NULL,
    alternateacccode smallint NULL,
    date timestamp(3) NOT NULL,
    saletax numeric(15,2) NOT NULL,
    gross numeric(15,2) NOT NULL,
    dr_remarks citext NULL,
    cr_remarks citext NULL,
    saletax_remarks citext NULL,
    checkno citext NULL,
    usercode smallint NULL,
    vouchercode integer NULL,
    invoicecode integer NULL,
    invoicetype smallint NULL,
    amt numeric(15,2) NOT NULL,
    dramtacccode integer NULL,
    cramtacccode integer NULL,
    amtby smallint NULL,
    amtdate timestamp(3) NULL,
    amtref citext NULL,
    outstandingamt numeric(15,2) NOT NULL,
    balance numeric(15,2) NOT NULL,
    patientcode integer NULL,
    grn citext NULL,
    gccode smallint NULL,
    vehicle citext NULL,
    shipto citext NULL,
    guestcode integer NULL,
    studentcode integer NULL,
    cgs numeric(15,2) NOT NULL,
    currencycode smallint NULL,
    conversionrate numeric(11,5) NULL,
    advincometax numeric(12,2) NOT NULL,
    fbrposfee numeric(5,2) NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_fn_getunposted_transwindow_rettable SELECT th.documentcode AS documentcode, tt.shortname AS documenttype, th.transactiontypecode AS catcode, th.cashacccode AS dr_acccode, th.acccode AS cr_acccode, NULL::smallint AS alternateacccode, th.date AS date, 0 AS saletax, th.cashcharged AS gross, ('Cash Recvd. Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS dr_remarks, ('Cash Recvd. Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, th.usercode AS usercode, th.transactioncode AS vouchercode, th.transactioncode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, th.patientcode AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.transactionheader AS th, dbo.transactiontype AS tt WHERE ((((th.cashcharged > 0) AND (th.posted = 'N')) AND (th.transactiontypecode = tt.transactiontypecode)) AND (tt.transactioncatcode = 1)) UNION ALL SELECT th.documentcode AS documentcode, tt.shortname AS documenttype, th.transactiontypecode AS catcode, td.acccode AS dr_acccode, th.acccode AS cr_acccode, NULL::smallint AS alternateacccode, th.date AS date, 0 AS saletax, td.amount AS gross, ('Amount Recvd. Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS dr_remarks, ('Amount Recvd. Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, th.usercode AS usercode, th.transactioncode AS vouchercode, th.transactioncode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, th.patientcode AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.transactionheader AS th, dbo.transactiondetail AS td, dbo.transactiontype AS tt WHERE (((((th.posted = 'N') AND (th.transactiontypecode = tt.transactiontypecode)) AND (tt.transactioncatcode = 1)) AND (th.documentcode = td.documentcode)) AND (td.amount > 0)) UNION ALL SELECT th.documentcode AS documentcode, tt.shortname AS documenttype, th.transactiontypecode AS catcode, th.acccode AS dr_acccode, th.cashacccode AS cr_acccode, NULL::smallint AS alternateacccode, th.date AS date, 0 AS saletax, th.cashcharged AS gross, ('Cash Paid Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS dr_remarks, ('Cash Paid Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, th.usercode AS usercode, th.transactioncode AS vouchercode, th.transactioncode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, th.patientcode AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.transactionheader AS th, dbo.transactiontype AS tt WHERE ((((th.cashcharged > 0) AND (th.posted = 'N')) AND (th.transactiontypecode = tt.transactiontypecode)) AND (tt.transactioncatcode = 2)) UNION ALL SELECT th.documentcode AS documentcode, tt.shortname AS documenttype, th.transactiontypecode AS catcode, th.acccode AS dr_acccode, td.acccode AS cr_acccode, NULL::smallint AS alternateacccode, th.date AS date, 0 AS saletax, td.amount AS gross, ('Amount Paid Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS dr_remarks, ('Amount Paid Against Transaction Doc. Code: ' || ltrim(rtrim(dbo.tsql_str((th.documentcode)::numeric, 10)))) AS cr_remarks, '' AS saletax_remarks, NULL::citext AS checkno, th.usercode AS usercode, th.transactioncode AS vouchercode, th.transactioncode AS invoicecode, NULL::smallint AS invoicetype, 0 AS amt, NULL::integer AS dramtacccode, NULL::integer AS cramtacccode, NULL::smallint AS amtby, NULL::timestamp(3) AS amtdate, NULL::citext AS amtref, 0 AS outstandingamt, 0 AS balance, th.patientcode AS patientcode, NULL::citext AS grn, NULL::smallint AS gccode, NULL::citext AS vehicle, NULL::citext AS shipto, NULL::integer AS guestcode, NULL::integer AS studentcode, 0 AS cgs, NULL::smallint AS currencycode, NULL::numeric(11,5) AS conversionrate, 0.00 AS advincometax, 0.00 AS fbrposfee FROM dbo.transactionheader AS th, dbo.transactiondetail AS td, dbo.transactiontype AS tt WHERE (((((th.posted = 'N') AND (th.transactiontypecode = tt.transactiontypecode)) AND (tt.transactioncatcode = 2)) AND (th.documentcode = td.documentcode)) AND (td.amount > 0));
  RETURN QUERY SELECT * FROM tv_fn_getunposted_transwindow_rettable;
  DROP TABLE IF EXISTS tv_fn_getunposted_transwindow_rettable;
  RETURN;
END
$body$;

-- ==== function Fn_LockSaleDetailRow ====
CREATE OR REPLACE FUNCTION dbo.fn_locksaledetailrow(saleinvcode integer, icode integer, salerowid integer)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_saleinvcode integer;
  v_icode integer;
  v_salerowid integer;
  v_count integer;
BEGIN
  v_saleinvcode := saleinvcode;
  v_icode := icode;
  v_salerowid := salerowid;
  SELECT count(*) INTO v_count FROM dbo.saledetail WHERE (((saledetail.saleinvcode = v_saleinvcode) AND (saledetail.icode = v_icode)) AND (saledetail.rowid = v_salerowid));
  RETURN v_count;
  RETURN NULL;
END
$body$;

-- ==== function Fn_OverDueBalance ====
CREATE OR REPLACE FUNCTION dbo.fn_overduebalance(type citext, date timestamp, acccode integer, overduedays integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_type citext;
  v_date timestamp(3);
  v_acccode integer;
  v_overduedays integer;
  v_oldacccode integer;
  v_ll_acccode integer;
  v_rowid integer;
  v_daysold integer;
  v_startlimit integer;
  v_endlimit integer;
  v_weekofmonth integer;
  v_weekday integer;
  v_tdate timestamp(3);
  v_amt numeric(15,5);
  v_paid numeric(15,5);
  v_pmt numeric(15,5);
  v_overduebal numeric(15,5);
  cur_c1 refcursor;
  _fs integer := -1;
BEGIN
  v_type := type;
  v_date := date;
  v_acccode := acccode;
  v_overduedays := overduedays;
  DROP TABLE IF EXISTS tv_fn_overduebalance_lt_amt;
  CREATE TEMP TABLE tv_fn_overduebalance_lt_amt (
    acccode integer NOT NULL,
    date timestamp(3) NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0,
    paid numeric(15,5) NOT NULL DEFAULT 0,
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    daysold integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_overduebalance_lt_pmt;
  CREATE TEMP TABLE tv_fn_overduebalance_lt_pmt (
    acccode integer NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_overduebalance_lt_interval;
  CREATE TEMP TABLE tv_fn_overduebalance_lt_interval (
    intervalid integer GENERATED BY DEFAULT AS IDENTITY (START WITH 0 INCREMENT BY 1) NOT NULL,
    lowerlimit integer NOT NULL DEFAULT 0,
    upperlimit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  v_startlimit := 0;
  WHILE (v_startlimit <= v_overduedays) LOOP
    v_endlimit := (v_startlimit + CASE v_startlimit WHEN 0 THEN 0 ELSE (v_overduedays - 1) END);
    v_endlimit := CASE WHEN (v_endlimit > v_overduedays) THEN v_overduedays ELSE v_endlimit END;
    INSERT INTO tv_fn_overduebalance_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, v_endlimit);
    v_startlimit := (v_endlimit + 1);
  END LOOP;
  INSERT INTO tv_fn_overduebalance_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, 99999999);
  IF (v_type = 'C') THEN
    INSERT INTO tv_fn_overduebalance_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, debit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode = v_acccode)) ORDER BY acccode, date, debit;
    INSERT INTO tv_fn_overduebalance_lt_pmt SELECT acccode, sum(credit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode = v_acccode)) GROUP BY acccode ORDER BY acccode;
  ELSE
    INSERT INTO tv_fn_overduebalance_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, credit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode = v_acccode)) ORDER BY acccode, date, credit;
    INSERT INTO tv_fn_overduebalance_lt_pmt SELECT acccode, sum(debit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode = v_acccode)) GROUP BY acccode ORDER BY acccode;
  END IF;
  OPEN cur_c1 FOR SELECT * FROM tv_fn_overduebalance_lt_amt AS lt_amt;
  FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  WHILE (_fs = 0) LOOP
    v_pmt := coalesce((SELECT coalesce(amount, 0) FROM tv_fn_overduebalance_lt_pmt AS lt_pmt WHERE (acccode = v_ll_acccode)), 0);
    IF (v_pmt <> 0) THEN
      UPDATE tv_fn_overduebalance_lt_amt AS lt_amt SET paid = (paid + CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END) WHERE (rowid = v_rowid);
      v_pmt := (v_pmt - (SELECT CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END));
      UPDATE tv_fn_overduebalance_lt_pmt AS lt_pmt SET amount = v_pmt WHERE (acccode = v_ll_acccode);
    END IF;
    FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_c1;
  -- DEALLOCATE C1
  DELETE FROM tv_fn_overduebalance_lt_amt AS lt_amt WHERE ((amount - paid) = 0);
  v_overduebal := coalesce((SELECT sum((amount - paid)) AS b FROM tv_fn_overduebalance_lt_amt AS lt_amt WHERE (daysold > v_overduedays)), 0);
  RETURN (v_overduebal);
  RETURN NULL;
END
$body$;

-- ==== function Fn_OverDueBalanceAll ====
CREATE OR REPLACE FUNCTION dbo.fn_overduebalanceall(type citext, date timestamp, overduedays integer)
  RETURNS TABLE(acccode smallint, odbalance numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_type citext;
  v_date timestamp(3);
  v_overduedays integer;
  v_oldacccode integer;
  v_ll_acccode integer;
  v_rowid integer;
  v_daysold integer;
  v_startlimit integer;
  v_endlimit integer;
  v_weekofmonth integer;
  v_weekday integer;
  v_tdate timestamp(3);
  v_amt numeric(15,5);
  v_paid numeric(15,5);
  v_pmt numeric(15,5);
  v_overduebal numeric(15,5);
  cur_c1 refcursor;
  _fs integer := -1;
BEGIN
  v_type := type;
  v_date := date;
  v_overduedays := overduedays;
  DROP TABLE IF EXISTS tv_fn_overduebalanceall_rettable;
  CREATE TEMP TABLE tv_fn_overduebalanceall_rettable (
    acccode smallint,
    odbalance numeric(15,5)
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_overduebalanceall_lt_amt;
  CREATE TEMP TABLE tv_fn_overduebalanceall_lt_amt (
    acccode integer NOT NULL,
    date timestamp(3) NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0,
    paid numeric(15,5) NOT NULL DEFAULT 0,
    rowid integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    daysold integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_overduebalanceall_lt_pmt;
  CREATE TEMP TABLE tv_fn_overduebalanceall_lt_pmt (
    acccode integer NOT NULL,
    amount numeric(15,5) NOT NULL DEFAULT 0
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_fn_overduebalanceall_lt_interval;
  CREATE TEMP TABLE tv_fn_overduebalanceall_lt_interval (
    intervalid integer GENERATED BY DEFAULT AS IDENTITY (START WITH 0 INCREMENT BY 1) NOT NULL,
    lowerlimit integer NOT NULL DEFAULT 0,
    upperlimit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
  v_startlimit := 0;
  WHILE (v_startlimit <= v_overduedays) LOOP
    v_endlimit := (v_startlimit + CASE v_startlimit WHEN 0 THEN 0 ELSE (v_overduedays - 1) END);
    v_endlimit := CASE WHEN (v_endlimit > v_overduedays) THEN v_overduedays ELSE v_endlimit END;
    INSERT INTO tv_fn_overduebalanceall_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, v_endlimit);
    v_startlimit := (v_endlimit + 1);
  END LOOP;
  INSERT INTO tv_fn_overduebalanceall_lt_interval (lowerlimit, upperlimit) VALUES (v_startlimit, 99999999);
  IF (v_type = 'C') THEN
    INSERT INTO tv_fn_overduebalanceall_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, debit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer))) ORDER BY acccode, date, debit;
    INSERT INTO tv_fn_overduebalanceall_lt_pmt SELECT acccode, sum(credit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode IN (SELECT custcode FROM dbo.customer))) GROUP BY acccode ORDER BY acccode;
  ELSE
    INSERT INTO tv_fn_overduebalanceall_lt_amt (acccode, date, amount, paid, daysold) SELECT acccode, date, credit AS amount, 0 AS paid, ((v_date)::date - (date)::date) AS daysold FROM dbo.virtualgl WHERE (((date <= v_date) AND (credit > 0)) AND (acccode IN (SELECT suppcode FROM dbo.supplier))) ORDER BY acccode, date, credit;
    INSERT INTO tv_fn_overduebalanceall_lt_pmt SELECT acccode, sum(debit) AS amount FROM dbo.virtualgl WHERE (((date <= v_date) AND (debit > 0)) AND (acccode IN (SELECT suppcode FROM dbo.supplier))) GROUP BY acccode ORDER BY acccode;
  END IF;
  OPEN cur_c1 FOR SELECT * FROM tv_fn_overduebalanceall_lt_amt AS lt_amt;
  FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
  IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  WHILE (_fs = 0) LOOP
    v_pmt := coalesce((SELECT coalesce(amount, 0) FROM tv_fn_overduebalanceall_lt_pmt AS lt_pmt WHERE (acccode = v_ll_acccode)), 0);
    IF (v_pmt <> 0) THEN
      UPDATE tv_fn_overduebalanceall_lt_amt AS lt_amt SET paid = (paid + CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END) WHERE ((rowid = v_rowid) AND (acccode = v_ll_acccode));
      v_pmt := (v_pmt - (SELECT CASE WHEN (v_amt >= v_pmt) THEN v_pmt ELSE v_amt END));
      UPDATE tv_fn_overduebalanceall_lt_pmt AS lt_pmt SET amount = v_pmt WHERE (acccode = v_ll_acccode);
    END IF;
    FETCH NEXT FROM cur_c1 INTO v_ll_acccode, v_tdate, v_amt, v_paid, v_rowid, v_daysold;
    IF FOUND THEN _fs := 0; ELSE _fs := -1; END IF;
  END LOOP;
  CLOSE cur_c1;
  -- DEALLOCATE C1
  INSERT INTO tv_fn_overduebalanceall_rettable SELECT a.acccode, coalesce(sum((t.amount - t.paid)), 0) AS overduebal FROM dbo.accounts AS a, tv_fn_overduebalanceall_lt_amt AS t WHERE ((a.acccode = t.acccode) AND (t.daysold > v_overduedays)) GROUP BY a.acccode ORDER BY a.acccode;
  RETURN QUERY SELECT * FROM tv_fn_overduebalanceall_rettable;
  DROP TABLE IF EXISTS tv_fn_overduebalanceall_rettable;
  RETURN;
END
$body$;

-- ==== function fn_Value ====
CREATE OR REPLACE FUNCTION dbo.fn_value(string citext)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_string citext;
  v_counter integer;
BEGIN
  v_string := string;
  IF (((v_string IS NULL) OR (v_string = '')) OR (length(rtrim(v_string)) <= 0)) THEN
    RETURN 0;
  END IF;
  v_counter := 1;
  WHILE (v_counter <= length(rtrim(v_string))) LOOP
    IF ((ascii(substring(v_string, v_counter, 1)) < 48) OR (ascii(substring(v_string, v_counter, 1)) > 57)) THEN
      RETURN 0;
    END IF;
    v_counter := (v_counter + 1);
  END LOOP;
  RETURN (trunc((v_string)::numeric))::integer;
  RETURN NULL;
END
$body$;

-- ==== function Fn_WeekDayCountInMonth ====
CREATE OR REPLACE FUNCTION dbo.fn_weekdaycountinmonth(date timestamp)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_date timestamp(3);
  v_day_freq integer;
  v_date_month integer;
  v_date_year integer;
BEGIN
  v_date := date;
  v_date_month := extract(month from v_date)::integer;
  v_date_year := extract(year from v_date)::integer;
  v_day_freq := (SELECT count((extract(dow from date)::integer + 1)) AS a FROM dbo.udf_daysofmonthlist((v_date_month)::smallint, v_date_year) AS udf_daysofmonthlist WHERE (((extract(dow from date)::integer + 1) = (extract(dow from v_date)::integer + 1)) AND (date <= v_date)));
  RETURN v_day_freq;
  RETURN NULL;
END
$body$;

-- ==== function udf_Count_DayOfWeek ====
CREATE OR REPLACE FUNCTION dbo.udf_count_dayofweek(startdate timestamp, enddate timestamp, dayofweek citext)
  RETURNS integer
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_startdate timestamp(3);
  v_enddate timestamp(3);
  v_dayofweek citext;
  v_counter integer;
  v_tmpdate timestamp(3);
BEGIN
  v_startdate := startdate;
  v_enddate := enddate;
  v_dayofweek := dayofweek;
  v_counter := 0;
  v_tmpdate := v_startdate;
  WHILE (v_tmpdate <= v_enddate) LOOP
    v_tmpdate := (v_tmpdate + (1) * interval '1 day');
    IF ((upper(trim(to_char(v_tmpdate, 'Day'))))::citext = (upper(v_dayofweek))::citext) THEN
      v_counter := (v_counter + 1);
    END IF;
  END LOOP;
  RETURN v_counter;
  RETURN NULL;
END
$body$;

-- ==== function udf_DaysOfMonthList ====
CREATE OR REPLACE FUNCTION dbo.udf_daysofmonthlist(month smallint, year integer)
  RETURNS TABLE(date timestamp(0))
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_month smallint;
  v_year integer;
  v_tmpdate timestamp(3);
  v_counter integer;
BEGIN
  v_month := month;
  v_year := year;
  DROP TABLE IF EXISTS tv_udf_daysofmonthlist_rettable;
  CREATE TEMP TABLE tv_udf_daysofmonthlist_rettable (
    date timestamp(0) NOT NULL
) ON COMMIT DROP;
  v_counter := 1;
  WHILE (dbo.tsql_isdate(((((rtrim(ltrim(dbo.tsql_str((v_month)::numeric))) || '-') || rtrim(ltrim(dbo.tsql_str((v_counter)::numeric)))) || '-') || rtrim(ltrim(dbo.tsql_str((v_year)::numeric))))) = 1) LOOP
    v_tmpdate := (((((rtrim(ltrim(dbo.tsql_str((v_month)::numeric))) || '-') || rtrim(ltrim(dbo.tsql_str((v_counter)::numeric)))) || '-') || rtrim(ltrim(dbo.tsql_str((v_year)::numeric)))))::timestamp(3);
    INSERT INTO tv_udf_daysofmonthlist_rettable VALUES (v_tmpdate);
    v_counter := (v_counter + 1);
  END LOOP;
  RETURN QUERY SELECT * FROM tv_udf_daysofmonthlist_rettable;
  DROP TABLE IF EXISTS tv_udf_daysofmonthlist_rettable;
  RETURN;
END
$body$;

-- ==== function udf_GetSummaryAccountList ====
CREATE OR REPLACE FUNCTION dbo.udf_getsummaryaccountlist(p_acccode integer)
  RETURNS TABLE(acccode integer)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_acccode integer;
BEGIN
  v_acccode := p_acccode;
  DROP TABLE IF EXISTS tv_udf_getsummaryaccountlist_rettable;
  CREATE TEMP TABLE tv_udf_getsummaryaccountlist_rettable (
    acccode integer NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_udf_getsummaryaccountlist_rettable SELECT acccode FROM dbo.summaryaccountdetail WHERE (summaryacccode IN (SELECT summaryacccode FROM dbo.summaryaccountdetail WHERE (acccode = v_acccode))) UNION SELECT v_acccode;
  RETURN QUERY SELECT * FROM tv_udf_getsummaryaccountlist_rettable;
  DROP TABLE IF EXISTS tv_udf_getsummaryaccountlist_rettable;
  RETURN;
END
$body$;

-- ==== function udf_GodownOpeningStock ====
CREATE OR REPLACE FUNCTION dbo.udf_godownopeningstock(ar_gcode smallint, ar_startdate timestamp, reportgrouping citext, grouplist citext, pricetype smallint)
  RETURNS TABLE(code integer, qty numeric, value numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ar_gcode smallint;
  v_ar_startdate timestamp(3);
  v_reportgrouping citext;
  v_grouplist citext;
  v_pricetype smallint;
BEGIN
  v_ar_gcode := ar_gcode;
  v_ar_startdate := ar_startdate;
  v_reportgrouping := reportgrouping;
  v_grouplist := grouplist;
  v_pricetype := pricetype;
  DROP TABLE IF EXISTS tv_udf_godownopeningstock_rettable;
  CREATE TEMP TABLE tv_udf_godownopeningstock_rettable (
    code integer,
    qty numeric(15,4),
    value numeric(15,5)
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_udf_godownopeningstock_tab_itemlist;
  CREATE TEMP TABLE tv_udf_godownopeningstock_tab_itemlist (
    code integer NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_udf_godownopeningstock_tab_itemlist SELECT code FROM dbo.udf_selectitems(v_reportgrouping, v_grouplist) AS udf_selectitems;
  INSERT INTO tv_udf_godownopeningstock_rettable SELECT a.icode, sum(a.qty) AS qty, round((sum((a.qty * CASE v_pricetype WHEN 1 THEN round(((i.saleprice / CASE i.packunits WHEN 0 THEN 1 ELSE i.packunits END))::numeric, 2) WHEN 2 THEN round(((i.purprice / CASE i.packunits WHEN 0 THEN 1 ELSE i.packunits END))::numeric, 2) WHEN 3 THEN i.avgprice END)))::numeric, 5) AS value FROM (SELECT pd.icode, sum(coalesce(CASE pl.purcatcode WHEN 1 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) WHEN 2 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) ELSE (pd.looseqty + pd.bonusqty) END, 0)) AS qty FROM dbo.purledger AS pl, dbo.purdetail AS pd WHERE (((((pl.posted = 'Y') AND (pl.purinvcode = pd.purinvcode)) AND (pl.postdate < v_ar_startdate)) AND (pd.gcode = v_ar_gcode)) AND (pd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY pd.icode UNION ALL SELECT pd.icode, (-sum(((pd.looseqty + pd.bonusqty) + (pd.packqty * pd.packunits)))) AS qty FROM dbo.prledger AS pl, dbo.prdetail AS pd WHERE (((((pl.posted = 'Y') AND (pl.prinvcode = pd.prinvcode)) AND (pl.date < v_ar_startdate)) AND (pd.gcode = v_ar_gcode)) AND (pd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY pd.icode UNION ALL SELECT sd.icode, (-sum((sd.looseqty + sd.bonusqty))) AS qty FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE (((((sl.saleinvcode = sd.saleinvcode) AND (sl.date < v_ar_startdate)) AND (sd.due IS NULL)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum((sd.looseqty + sd.bonusqty)) AS qty FROM dbo.srledger AS sl, dbo.srdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.srinvcode = sd.srinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.qty)) AS qty FROM dbo.issueheader AS sl, dbo.issuedetail AS sd WHERE ((((sl.issueinvcode = sd.issueinvcode) AND (sl.date < v_ar_startdate)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.qty) AS qty FROM dbo.receiptheader AS sl, dbo.receiptdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.receiptinvcode = sd.receiptinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.looseqty) AS qty FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE ((((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 1)) AND (sl.posteddate < v_ar_startdate)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.looseqty)) AS qty FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE ((((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 2)) AND (sl.posteddate < v_ar_startdate)) AND (sd.gcode = v_ar_gcode)) AND (sd.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT d.icode, (-sum(d.duesatisfyqty)) AS qty FROM dbo.duesatisfyheader AS h, dbo.duesatisfydetail AS d WHERE ((((h.duesatisfycode = d.duesatisfycode) AND (h.duesatisfydate < v_ar_startdate)) AND (d.gcode = v_ar_gcode)) AND (d.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY d.icode UNION ALL SELECT d.icode, (-sum(d.qty)) AS qty FROM dbo.theader AS h, dbo.tdetail AS d WHERE ((((h.transcode = d.transcode) AND (h.date < v_ar_startdate)) AND (h.sgcode = v_ar_gcode)) AND (d.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY d.icode UNION ALL SELECT d.icode, sum(d.qty) AS qty FROM dbo.theader AS h, dbo.tdetail AS d WHERE ((((h.transcode = d.transcode) AND (h.date < v_ar_startdate)) AND (h.dgcode = v_ar_gcode)) AND (d.icode IN (SELECT code FROM tv_udf_godownopeningstock_tab_itemlist AS tab_itemlist))) GROUP BY d.icode) AS a, dbo.item AS i WHERE (i.icode = a.icode) GROUP BY a.icode;
  RETURN QUERY SELECT * FROM tv_udf_godownopeningstock_rettable;
  DROP TABLE IF EXISTS tv_udf_godownopeningstock_rettable;
  RETURN;
END
$body$;

-- ==== function udf_openingstock ====
CREATE OR REPLACE FUNCTION dbo.udf_openingstock(ar_startdate timestamp, reportgrouping citext, grouplist citext, pricetype smallint)
  RETURNS TABLE(code integer, qty numeric, value numeric)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ar_startdate timestamp(3);
  v_reportgrouping citext;
  v_grouplist citext;
  v_pricetype smallint;
BEGIN
  v_ar_startdate := ar_startdate;
  v_reportgrouping := reportgrouping;
  v_grouplist := grouplist;
  v_pricetype := pricetype;
  DROP TABLE IF EXISTS tv_udf_openingstock_rettable;
  CREATE TEMP TABLE tv_udf_openingstock_rettable (
    code integer,
    qty numeric(15,4),
    value numeric(15,5)
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_udf_openingstock_tab_itemlist;
  CREATE TEMP TABLE tv_udf_openingstock_tab_itemlist (
    code integer NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_udf_openingstock_tab_itemlist SELECT code FROM dbo.udf_selectitems(v_reportgrouping, v_grouplist) AS udf_selectitems;
  INSERT INTO tv_udf_openingstock_rettable SELECT a.icode, sum(a.qty) AS qty, round((sum((a.qty * CASE v_pricetype WHEN 1 THEN round(((i.saleprice / CASE i.packunits WHEN 0 THEN 1 ELSE i.packunits END))::numeric, 2) WHEN 2 THEN round(((i.purprice / CASE i.packunits WHEN 0 THEN 1 ELSE i.packunits END))::numeric, 2) WHEN 3 THEN i.avgprice END)))::numeric, 5) AS value FROM (SELECT pd.icode, sum(coalesce(CASE pl.purcatcode WHEN 1 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) WHEN 2 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) ELSE (pd.looseqty + pd.bonusqty) END, 0)) AS qty FROM dbo.purledger AS pl, dbo.purdetail AS pd WHERE ((((pl.posted = 'Y') AND (pl.purinvcode = pd.purinvcode)) AND (pl.postdate < v_ar_startdate)) AND (pd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY pd.icode UNION ALL SELECT pd.icode, (-sum(((pd.looseqty + pd.bonusqty) + (pd.packqty * pd.packunits)))) AS qty FROM dbo.prledger AS pl, dbo.prdetail AS pd WHERE ((((pl.posted = 'Y') AND (pl.prinvcode = pd.prinvcode)) AND (pl.date < v_ar_startdate)) AND (pd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY pd.icode UNION ALL SELECT sd.icode, (-sum((sd.looseqty + sd.bonusqty))) AS qty FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((((sl.saleinvcode = sd.saleinvcode) AND (sl.date < v_ar_startdate)) AND (sd.due IS NULL)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum((sd.looseqty + sd.bonusqty)) AS qty FROM dbo.srledger AS sl, dbo.srdetail AS sd WHERE ((((sl.posted = 'Y') AND (sl.srinvcode = sd.srinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.qty)) AS qty FROM dbo.issueheader AS sl, dbo.issuedetail AS sd WHERE (((sl.issueinvcode = sd.issueinvcode) AND (sl.date < v_ar_startdate)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.qty) AS qty FROM dbo.receiptheader AS sl, dbo.receiptdetail AS sd WHERE ((((sl.posted = 'Y') AND (sl.receiptinvcode = sd.receiptinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.looseqty) AS qty FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 1)) AND (sl.posteddate < v_ar_startdate)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.looseqty)) AS qty FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 2)) AND (sl.posteddate < v_ar_startdate)) AND (sd.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY sd.icode UNION ALL SELECT d.icode, (-sum(d.duesatisfyqty)) AS qty FROM dbo.duesatisfyheader AS h, dbo.duesatisfydetail AS d WHERE (((h.duesatisfycode = d.duesatisfycode) AND (h.duesatisfydate < v_ar_startdate)) AND (d.icode IN (SELECT code FROM tv_udf_openingstock_tab_itemlist AS tab_itemlist))) GROUP BY d.icode) AS a, dbo.item AS i WHERE (i.icode = a.icode) GROUP BY a.icode;
  RETURN QUERY SELECT * FROM tv_udf_openingstock_rettable;
  DROP TABLE IF EXISTS tv_udf_openingstock_rettable;
  RETURN;
END
$body$;

-- ==== function udf_openingstocksingleitem ====
CREATE OR REPLACE FUNCTION dbo.udf_openingstocksingleitem(ar_startdate timestamp, ar_icode integer)
  RETURNS numeric
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_ar_startdate timestamp(3);
  v_ar_icode integer;
  v_qty numeric(15,4);
BEGIN
  v_ar_startdate := ar_startdate;
  v_ar_icode := ar_icode;
  SELECT sum(a.qty) INTO v_qty FROM (SELECT pd.icode, sum(coalesce(CASE pl.purcatcode WHEN 1 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) WHEN 2 THEN (((pd.packqty + pd.bonusqty)) * pd.packunits) ELSE (pd.looseqty + pd.bonusqty) END, 0)) AS qty, 0 AS openingdue FROM dbo.purledger AS pl, dbo.purdetail AS pd WHERE ((((pl.posted = 'Y') AND (pl.purinvcode = pd.purinvcode)) AND (pl.postdate < v_ar_startdate)) AND (pd.icode IN (v_ar_icode))) GROUP BY pd.icode UNION ALL SELECT pd.icode, (-sum(((pd.looseqty + pd.bonusqty) + (pd.packqty * pd.packunits)))) AS qty, 0 AS openingdue FROM dbo.prledger AS pl, dbo.prdetail AS pd WHERE ((((pl.posted = 'Y') AND (pl.prinvcode = pd.prinvcode)) AND (pl.date < v_ar_startdate)) AND (pd.icode IN (v_ar_icode))) GROUP BY pd.icode UNION ALL SELECT sd.icode, (-sum((sd.looseqty + sd.bonusqty))) AS qty, 0 AS openingdue FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((((sl.saleinvcode = sd.saleinvcode) AND (sl.date < v_ar_startdate)) AND (sd.due IS NULL)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum((sd.looseqty + sd.bonusqty)) AS qty, 0 AS openingdue FROM dbo.srledger AS sl, dbo.srdetail AS sd WHERE ((((sl.posted = 'Y') AND (sl.srinvcode = sd.srinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.qty)) AS qty, 0 AS openingdue FROM dbo.issueheader AS sl, dbo.issuedetail AS sd WHERE (((sl.issueinvcode = sd.issueinvcode) AND (sl.date < v_ar_startdate)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.qty) AS qty, 0 AS openingdue FROM dbo.receiptheader AS sl, dbo.receiptdetail AS sd WHERE ((((sl.posted = 'Y') AND (sl.receiptinvcode = sd.receiptinvcode)) AND (sl.postdate < v_ar_startdate)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT sd.icode, sum(sd.looseqty) AS qty, 0 AS openingdue FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 1)) AND (sl.posteddate < v_ar_startdate)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT sd.icode, (-sum(sd.looseqty)) AS qty, 0 AS openingdue FROM dbo.adjheader AS sl, dbo.adjdetail AS sd WHERE (((((sl.posted = 'Y') AND (sl.adjcode = sd.adjcode)) AND (sl.adjcatcode = 2)) AND (sl.posteddate < v_ar_startdate)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT d.icode, (-sum(d.duesatisfyqty)) AS qty, (-sum(d.duesatisfyqty)) AS openingdue FROM dbo.duesatisfyheader AS h, dbo.duesatisfydetail AS d WHERE (((h.duesatisfycode = d.duesatisfycode) AND (h.duesatisfydate < v_ar_startdate)) AND (d.icode IN (v_ar_icode))) GROUP BY d.icode UNION ALL SELECT sd.icode, 0 AS qty, sum(sd.looseqty) AS openingdue FROM dbo.saleledger AS sl, dbo.saledetail AS sd WHERE ((((sl.saleinvcode = sd.saleinvcode) AND (sl.date < v_ar_startdate)) AND (sd.due IS NOT NULL)) AND (sd.icode IN (v_ar_icode))) GROUP BY sd.icode UNION ALL SELECT d.icode, (-sum(d.deletedqty)) AS qty, (-sum(d.deletedqty)) AS openingdue FROM dbo.duesatisfyheader AS h, dbo.duedeletedetail AS d WHERE (((h.duesatisfycode = d.duesatisfycode) AND (h.duesatisfydate < v_ar_startdate)) AND (d.icode IN (v_ar_icode))) GROUP BY d.icode) AS a;
  RETURN v_qty;
  RETURN NULL;
END
$body$;

-- ==== function udf_salesmanscopebased_weekdaylist ====
CREATE OR REPLACE FUNCTION dbo.udf_salesmanscopebased_weekdaylist(salesmancode smallint, manfcode smallint, subareacode smallint)
  RETURNS citext
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_salesmancode smallint;
  v_manfcode smallint;
  v_subareacode smallint;
  v_counter integer;
  v_rows integer;
  v_daylist citext;
  v_rowid integer;
BEGIN
  v_salesmancode := salesmancode;
  v_manfcode := manfcode;
  v_subareacode := subareacode;
  DROP TABLE IF EXISTS tv_udf_salesmanscopebased_weekdaylist_weekdaylist;
  CREATE TEMP TABLE tv_udf_salesmanscopebased_weekdaylist_weekdaylist (
    code integer,
    name citext,
    rowid integer GENERATED BY DEFAULT AS IDENTITY
) ON COMMIT DROP;
  INSERT INTO tv_udf_salesmanscopebased_weekdaylist_weekdaylist (code, name) SELECT DISTINCT salesmanscope.weekdaycode, weekdays.name FROM dbo.salesmanscope, dbo.weekdays WHERE (((((salesmanscope.salesmancode IN (v_salesmancode))) AND ((salesmanscope.manfcode = v_manfcode))) AND ((salesmanscope.subareacode = v_subareacode))) AND ((salesmanscope.weekdaycode = weekdays.weekdaycode))) ORDER BY salesmanscope.weekdaycode;
  v_counter := 1;
  v_rows := coalesce((SELECT count(*) FROM tv_udf_salesmanscopebased_weekdaylist_weekdaylist AS weekdaylist), 0);
  v_rowid := 1;
  v_daylist := '';
  WHILE (v_counter <= v_rows) LOOP
    v_daylist := ((v_daylist || coalesce((SELECT left(name, 3) FROM tv_udf_salesmanscopebased_weekdaylist_weekdaylist AS weekdaylist WHERE (rowid = v_rowid)), '')) || ',');
    v_counter := (v_counter + 1);
    v_rowid := (v_rowid + 1);
  END LOOP;
  RETURN (v_daylist)::citext;
  RETURN NULL;
END
$body$;

-- ==== function udf_selectitems ====
CREATE OR REPLACE FUNCTION dbo.udf_selectitems(filtercriteria citext, filterby citext)
  RETURNS TABLE(code integer)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_filtercriteria citext;
  v_filterby citext;
BEGIN
  v_filtercriteria := filtercriteria;
  v_filterby := filterby;
  DROP TABLE IF EXISTS tv_udf_selectitems_rettable;
  CREATE TEMP TABLE tv_udf_selectitems_rettable (
    code integer NOT NULL
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_udf_selectitems_tab_filterby;
  CREATE TEMP TABLE tv_udf_selectitems_tab_filterby (
    code integer NOT NULL
) ON COMMIT DROP;
  INSERT INTO tv_udf_selectitems_tab_filterby SELECT code FROM dbo.udf_stringtotabl(v_filterby, ',') AS udf_stringtotabl;
  INSERT INTO tv_udf_selectitems_rettable SELECT icode FROM dbo.item WHERE (CASE v_filtercriteria WHEN 'M' THEN manfcode WHEN 'C' THEN icatcode WHEN 'L' THEN iccode ELSE packcode END IN (SELECT code FROM tv_udf_selectitems_tab_filterby AS tab_filterby));
  RETURN QUERY SELECT * FROM tv_udf_selectitems_rettable;
  DROP TABLE IF EXISTS tv_udf_selectitems_rettable;
  RETURN;
END
$body$;

-- ==== function udf_StringToTabl ====
CREATE OR REPLACE FUNCTION dbo.udf_stringtotabl(strlist citext, strsep citext)
  RETURNS TABLE(code integer)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_strlist citext;
  v_strsep citext;
  v_strlen integer;
  v_startpos integer;
  v_endpos integer;
BEGIN
  v_strlist := strlist;
  v_strsep := strsep;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_rettable;
  CREATE TEMP TABLE tv_udf_stringtotabl_rettable (
    code integer NOT NULL
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_rettemp;
  CREATE TEMP TABLE tv_udf_stringtotabl_rettemp (
    code integer NOT NULL
) ON COMMIT DROP;
  v_strlen := length(rtrim(v_strlist));
  v_startpos := 1;
  WHILE (v_startpos <= v_strlen) LOOP
    v_endpos := dbo.tsql_charindex((v_strsep)::citext, (v_strlist)::citext, v_startpos);
    IF ((v_endpos = 0) OR (v_endpos IS NULL)) THEN
      INSERT INTO tv_udf_stringtotabl_rettemp VALUES ((trunc((substring(v_strlist, v_startpos, ((v_strlen + 1) - v_startpos)))::numeric))::integer);
      v_startpos := (v_strlen + 1);
    ELSE
      INSERT INTO tv_udf_stringtotabl_rettemp VALUES ((trunc((substring(v_strlist, v_startpos, (v_endpos - v_startpos)))::numeric))::integer);
      v_startpos := (v_endpos + 1);
    END IF;
  END LOOP;
  INSERT INTO tv_udf_stringtotabl_rettable SELECT DISTINCT code FROM tv_udf_stringtotabl_rettemp AS rettemp WHERE (code IS NOT NULL);
  RETURN QUERY SELECT * FROM tv_udf_stringtotabl_rettable;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_rettable;
  RETURN;
END
$body$;

-- ==== function udf_StringToTabl_STRING ====
CREATE OR REPLACE FUNCTION dbo.udf_stringtotabl_string(strlist citext, strsep citext)
  RETURNS TABLE(code citext)
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_strlist citext;
  v_strsep citext;
  v_strlen integer;
  v_startpos integer;
  v_endpos integer;
BEGIN
  v_strlist := strlist;
  v_strsep := strsep;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_string_rettable;
  CREATE TEMP TABLE tv_udf_stringtotabl_string_rettable (
    code citext NOT NULL
) ON COMMIT DROP;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_string_rettemp;
  CREATE TEMP TABLE tv_udf_stringtotabl_string_rettemp (
    code citext NOT NULL
) ON COMMIT DROP;
  v_strlen := length(rtrim(v_strlist));
  v_startpos := 1;
  WHILE (v_startpos <= v_strlen) LOOP
    v_endpos := dbo.tsql_charindex((v_strsep)::citext, (v_strlist)::citext, v_startpos);
    IF ((v_endpos = 0) OR (v_endpos IS NULL)) THEN
      INSERT INTO tv_udf_stringtotabl_string_rettemp VALUES (substring(v_strlist, v_startpos, ((v_strlen + 1) - v_startpos)));
      v_startpos := (v_strlen + 1);
    ELSE
      INSERT INTO tv_udf_stringtotabl_string_rettemp VALUES (substring(v_strlist, v_startpos, (v_endpos - v_startpos)));
      v_startpos := (v_endpos + 1);
    END IF;
  END LOOP;
  INSERT INTO tv_udf_stringtotabl_string_rettable SELECT DISTINCT code FROM tv_udf_stringtotabl_string_rettemp AS rettemp WHERE (code IS NOT NULL);
  RETURN QUERY SELECT * FROM tv_udf_stringtotabl_string_rettable;
  DROP TABLE IF EXISTS tv_udf_stringtotabl_string_rettable;
  RETURN;
END
$body$;
