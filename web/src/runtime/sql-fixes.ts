// Runtime corrections for generated SQL tables.
//
// The external class/SQL rebuild can rewrite data/sql/*.json and lose the
// hand-derived admin/report translations.  These entries are re-applied in
// memory, the same way class-fixes.ts protects the class data.
type Entry = { sql: string; params: string[] }
type Tables = { dw?: Record<string, Entry>; stmt?: Record<string, Entry>; proc?: Record<string, unknown> }

const ADMIN: Record<string, Entry> = {
 "d_databasesname": {
  "sql": "SELECT datname AS name FROM pg_database WHERE datallowconn ORDER BY datname",
  "params": []
 },
 "d_backupschedule": {
  "sql": "SELECT NULL::integer AS schedule_id, NULL::text AS unit, NULL::integer AS unitvalue, NULL::text AS occurancetime WHERE false",
  "params": [
   "as_jobname",
   "as_backupschedulename"
  ]
 },
 "d_backupschedule_2012": {
  "sql": "SELECT NULL::integer AS schedule_id, NULL::text AS unit, NULL::integer AS unitvalue, NULL::text AS occurancetime WHERE false",
  "params": [
   "as_jobname",
   "as_backupschedulename"
  ]
 },
 "d_linkedservers": {
  "sql": "SELECT NULL::integer AS srvid, NULL::integer AS srvstatus, NULL::text AS srvname, NULL::text AS srvproduct, NULL::text AS providername, NULL::text AS datasource, NULL::text AS catalog WHERE false",
  "params": []
 },
 "ddd_exportrestricted_column_list": {
  "sql": "SELECT (row_number() OVER (ORDER BY ordinal_position))::integer AS position, column_name::text AS itemname FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = $1::text AND data_type IN ('real','double precision','numeric','money') ORDER BY ordinal_position",
  "params": [
   "as_tablename"
  ]
 },
 "ddd_restricted_column_list": {
  "sql": "SELECT ordinal_position::integer AS position, column_name::text AS itemname FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = $1::text ORDER BY ordinal_position",
  "params": [
   "as_tablename"
  ]
 },
 "ddd_objectcolumnlist": {
  "sql": "SELECT ordinal_position::integer AS position, column_name::text AS columnname FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = $1::text ORDER BY column_name",
  "params": [
   "as_name"
  ]
 },
 "d_conectionmonitorlist": {
  "sql": "SELECT pid::integer AS id, datname::text AS databasename, client_hostname::text AS computername, client_port::text AS connection, usename::text AS username, $2::integer AS mysession, application_name::text AS program, backend_start::timestamp(3) AS startedon, NULL::text AS domainname, NULL::text AS osusername FROM pg_stat_activity WHERE datname = $1::text ORDER BY pid",
  "params": [
   "as_db",
   "ai_mysessionid"
  ]
 },
 "d_conectionmonitorlist2": {
  "sql": "SELECT pid::integer AS processid, 0::integer AS ecid, datid::integer AS databaseid, datname::text AS dbname, backend_start::timestamp(3) AS startedon, state::text AS status, client_hostname::text AS machinename, application_name::text AS programname, client_port::text AS hostprocess, query::text AS taskinprogress, NULL::text AS domainname, usename::text AS username, $1::integer AS myprocess FROM pg_stat_activity WHERE datname = current_database() ORDER BY pid, ecid",
  "params": [
   "ai_thisprocess"
  ]
 }
}

const REPLACE: Record<string, (sql: string) => string> = {
  d_medocalldist_saleinvreport_copied_rp: (s) => s.replaceAll('saleledgerl.saleinvcode', 'saleledger.saleinvcode'),
  d_medocalldist_saleinvreport_copied_rp2: (s) => s.replaceAll('saleledgerl.saleinvcode', 'saleledger.saleinvcode'),
  d_wholesaleinvreport_manfwise_full: (s) => s.replace(/(?<!\.)\bprintbalance\b/g, 'saleledger.printbalance'),
  d_zafartractor_transferinvreport: (s) => s.replaceAll('max(headerno)', 'max(th.headerno)'),
  d_stockinhand_transitstock_crosstab: (s) => s.replaceAll('ORDER BY t.name, t.gcode', 'ORDER BY max(t.name), t.gcode'),
  d_cust_student_servicetemplatedetail: (s) => s.replace(/(?<!customer)studentservicetemplatedetail\.rowid/g, 'customerstudentservicetemplatedetail.rowid'),
}

/** Apply the corrections to the parsed sql.json tables. Returns what changed. */
export function fixSqlTables(tables: Tables): string[] {
  const out: string[] = []
  tables.dw ??= {}
  for (const [name, entry] of Object.entries(ADMIN)) {
    const cur = tables.dw[name]
    if (!cur || cur.sql !== entry.sql) {
      tables.dw[name] = entry
      out.push(name)
    }
  }
  for (const [name, fn] of Object.entries(REPLACE)) {
    const cur = tables.dw[name]
    if (!cur) continue
    const next = fn(cur.sql)
    if (next !== cur.sql) {
      cur.sql = next
      out.push(name)
    }
  }
  return out
}
