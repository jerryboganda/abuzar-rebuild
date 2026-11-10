-- ==== compat tsql_float17 ====
CREATE OR REPLACE FUNCTION dbo.tsql_float17(x float8) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE STRICT AS $body$
-- The decimal SQL Server formats a float from: the exact binary value rounded to 17 significant digits (%.17g).
-- STR rounds this value, so STR(2.675, 12, 2) is 2.67 while STR(1.45, 10, 1) is 1.5 (measured on SQL Server 2022).
DECLARE
  a float8 := abs(x);
  s float8;
  e integer;
  k integer;
  r integer;
  m numeric;
  b numeric;
  f numeric := 1;
  t text;
  v numeric;
  p integer;
BEGIN
  IF a = 0 OR a = 'Infinity'::float8 OR x <> x THEN RETURN 0; END IF;
  e := floor(ln(a) / ln(2::float8))::integer;
  WHILE power(2::float8, e) > a LOOP e := e - 1; END LOOP;
  WHILE power(2::float8, e + 1) <= a LOOP e := e + 1; END LOOP;
  -- a = m * 2^-k with an integer mantissa m < 2^53; scaling by powers of two is exact
  k := 52 - e;
  s := a;
  r := k;
  WHILE r > 1000 LOOP s := s * power(2::float8, 1000); r := r - 1000; END LOOP;
  WHILE r < -1000 LOOP s := s * power(2::float8, -1000); r := r + 1000; END LOOP;
  m := (s * power(2::float8, r))::bigint;
  b := CASE WHEN k > 0 THEN 5 ELSE 2 END;
  r := abs(k);
  WHILE r > 0 LOOP
    IF r % 2 = 1 THEN f := f * b; END IF;
    b := b * b;
    r := r / 2;
  END LOOP;
  IF k > 0 THEN
    -- m / 2^k = m * 5^k / 10^k: the digits of m * 5^k with the point k places from the right
    t := (m * f)::text;
    -- lpad would also cut a longer string: pad only a value below 1
    IF length(t) <= k THEN t := lpad(t, k + 1, '0'); END IF;
    v := (left(t, length(t) - k) || '.' || right(t, k))::numeric;
  ELSE
    v := m * f;
  END IF;
  IF v >= 1 THEN
    p := length(trunc(v)::text) - 1;
  ELSE
    p := -(length(substring(v::text from '\.(0*)')) + 1);
  END IF;
  v := round(v, 16 - p);
  RETURN CASE WHEN x < 0 THEN -v ELSE v END;
END
$body$;
-- ==== compat tsql_str ====
CREATE OR REPLACE FUNCTION dbo.tsql_str(n numeric, len integer DEFAULT 10, d integer DEFAULT 0) RETURNS text
  LANGUAGE plpgsql IMMUTABLE AS $body$
-- SQL Server STR(float, length, decimal): rounds the 17-digit decimal of the float half away from zero; a too long integer part
-- gives length asterisks, the decimals shrink to the room left (at most 16), a negative value keeps its sign at zero (-0, -0.00)
-- and a length outside 1..8000 or a negative decimal count gives NULL (measured on SQL Server 2022).
DECLARE
  v numeric;
  neg boolean;
  intlen integer;
  dd integer;
  s text;
BEGIN
  IF n IS NULL OR len IS NULL OR d IS NULL OR len < 1 OR len > 8000 OR d < 0 THEN RETURN NULL; END IF;
  v := dbo.tsql_float17(n::float8);
  neg := v < 0;
  intlen := length(trunc(abs(v))::text) + CASE WHEN neg THEN 1 ELSE 0 END;
  IF intlen > len THEN RETURN repeat('*', len); END IF;
  dd := least(d, 16, greatest(len - intlen - 1, 0));
  s := round(abs(v), dd)::text;
  IF neg THEN s := '-' || s; END IF;
  IF length(s) > len THEN RETURN repeat('*', len); END IF;
  RETURN lpad(s, len);
END
$body$;
-- ==== compat tsql_convert_dt ====
CREATE OR REPLACE FUNCTION dbo.tsql_convert_dt(ts timestamp, style integer) RETURNS text
  LANGUAGE sql IMMUTABLE AS $body$
-- CONVERT(varchar, datetime, 0 | 100 | 9 | 109 | 126 | 127) and CAST(datetime AS varchar) as SQL Server prints them:
-- day and hour padded with a blank ('Jan  9 2024  3:05PM', 'Dec  1 2024  9:00:59:003AM'), 126 without the
-- milliseconds when they are 0 ('2024-11-23T00:00:00')  (measured on SQL Server 2022)
  SELECT CASE
    WHEN ts IS NULL THEN NULL
    WHEN style IN (9, 109) THEN to_char(ts, 'Mon ') || lpad(to_char(ts, 'FMDD'), 2) || to_char(ts, ' YYYY ')
      || lpad(to_char(ts, 'FMHH12'), 2) || to_char(ts, ':MI:SS:MSAM')
    WHEN style IN (126, 127) THEN to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS') || CASE WHEN to_char(ts, 'MS') = '000' THEN '' ELSE to_char(ts, '.MS') END
    ELSE to_char(ts, 'Mon ') || lpad(to_char(ts, 'FMDD'), 2) || to_char(ts, ' YYYY ') || lpad(to_char(ts, 'FMHH12'), 2) || to_char(ts, ':MIAM')
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
-- ==== compat tsql_dyn ====
CREATE OR REPLACE FUNCTION dbo.tsql_dyn(q text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $body$
  SELECT regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(q,
           '^\s*DELETE\s+(?!FROM\b)', 'DELETE FROM ', 'i'),
           '\mISNULL\s*\(', 'COALESCE(', 'gi'),
           '\mGETDATE\s*\(\s*\)', 'localtimestamp(3)', 'gi'),
           '\mLEN\s*\(', 'length(', 'gi'),
           '#(\w+)', 'tmp_\1', 'g'),
           '\[(\w+)\]', '\1', 'g')
$body$;
