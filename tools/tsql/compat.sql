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
