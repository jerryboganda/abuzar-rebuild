// Run-time translation of the statements the application builds as text (EXECUTE IMMEDIATE, DataWindow SQL overrides).
// Almost all of the 122 dynamic sites are SQL Server session settings, backup / restore and linked-server data transfer, which have
// no meaning on PostgreSQL (docs/ROADMAP.md); what remains are plain data statements that only need the dialect basics changed.

/** `Set ANSI_NULLS ON Set ANSI_WARNINGS ON` ... : session options PostgreSQL does not have */
const SET_ONLY = /^\s*(set\s+\w+\s+(on|off)\s*;?\s*)+$/i

export function translateDynamicSql(text: string): { sql: string; params: string[] } | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (SET_ONLY.test(t)) return { sql: 'SELECT 1', params: [] }
  if (!/^(insert|update|delete|select)\b/i.test(t)) return undefined
  const sql = t
    .replace(/\[(\w+)\]/g, '$1')
    .replace(/\bisnull\s*\(/gi, 'coalesce(')
    .replace(/\bgetdate\s*\(\s*\)/gi, 'localtimestamp(3)')
    .replace(/\blen\s*\(/gi, 'length(')
  return { sql, params: [] }
}
