// Remote procedure calls declared on the transaction object (449 RPCFUNC declarations of u_transaction): the translated
// stored procedures are called with named notation; INOUT values go back into the `ref` arguments, the status code is the result.
import type { PBObject } from '../object.ts'
import { Ref } from '../interp.ts'
import { fromWire, toWire } from '../wire.ts'
import { NTransaction } from './transaction.ts'

export interface ProcSig {
  call: string
  params: { name: string; mode: string }[]
  inout: string[]
  rs: number
}

const RPC_ALIASES: Record<string, string> = {
  // recovered RPCFUNC name -> translated procedure name
  getmaxutn: 'sp_maxutn',
}

export class ProcCaller {
  sigs: Record<string, ProcSig>
  /** result sets of the last call per transaction (read by the cursor-style statements that follow) */
  last = new WeakMap<PBObject, { columns: { name: string; type: string }[]; rows: unknown[][] }[]>()
  constructor(sigs: Record<string, ProcSig>) {
    this.sigs = sigs
  }

  /** argument positions that are OUT / INOUT parameters of the procedure behind an RPC name */
  private signature(name: string): ProcSig | undefined {
    const n = name.toLowerCase()
    return this.sigs[n] ?? this.sigs['sp_' + n] ?? this.sigs[RPC_ALIASES[n]]
  }

  refPositions(name: string): number[] | undefined {
    const sig = this.signature(name)
    if (!sig) return undefined
    const idx = sig.params.map((p, i) => (p.mode !== 'in' ? i : -1)).filter((i) => i >= 0)
    return idx.length ? idx : undefined
  }

  async call(t: PBObject, name: string, args: unknown[]): Promise<unknown> {
    // RPC declarations alias the PowerScript name to the procedure: getitemstocktotal -> sp_getitemstocktotal
    const sig = this.signature(name)
    if (!(t instanceof NTransaction)) return null
    if (!sig) {
      t.rt.noteMissing('rpc:' + name)
      t.setError(-1, `procedure ${name} has no PostgreSQL translation`)
      return -1
    }
    const db = await t.ensureDb()
    if (!db) return -1
    const values = sig.params.map((_, i) => {
      const a = args[i]
      return toWire(a instanceof Ref ? a.get() : a)
    })
    try {
      const r = await db.call(sig.call, values)
      t.setOk(0)
      const cols = r.columns.map((c) => c.name)
      const row = r.row
      let status: unknown = 0
      if (row) {
        const at = (n: string) => cols.indexOf(n)
        const rv = at('return_value')
        if (rv >= 0 && row[rv] !== null) status = Number(row[rv])
        // INOUT parameters come back under their own names
        for (let i = 0; i < sig.params.length; i++) {
          const a = args[i]
          if (a instanceof Ref && sig.params[i].mode !== 'in') {
            const ci = at(sig.params[i].name)
            if (ci >= 0) await a.set(fromWire(r.columns[ci].type, row[ci]))
          }
        }
      }
      this.last.set(t, r.resultsets.map((s) => ({ columns: s.columns, rows: s.rows })))
      return status
    } catch (e) {
      t.setError(-1, (e as Error).message)
      return -1
    }
  }
}
