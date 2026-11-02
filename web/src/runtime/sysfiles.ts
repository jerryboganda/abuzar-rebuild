// File functions (fileopen, filewrite, filedelete ...), colour / sound / process helpers and the TSC label-printer DLL functions.
// Files live on the machine of the server (the desktop shell runs it locally); every call goes through /api/fs.
import { authHeaders } from './apiauth.ts'
import type { Runtime } from './interp.ts'
import { Ref } from './interp.ts'
import { toNum, toStr, PBArray } from './values.ts'

let apiBase = ''
export function setApiBase(b: string): void {
  apiBase = b
}

async function api<T>(path: string, body: unknown): Promise<T> {
  try {
    const r = await fetch(apiBase + path, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
    return (await r.json()) as T
  } catch {
    return {} as T // no server (headless runs): behaves like a missing file
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8')
const b64 = (u: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

interface Handle {
  path: string
  write: boolean
  append: boolean
  linemode: boolean
  data: Uint8Array // read mode: whole file
  pos: number
  out: number[][] // write mode: pending chunks
}
const handles = new Map<number, Handle>()
let nextHandle = 1

const mode = (v: unknown) => String(v ?? '').toLowerCase()

export function registerFileFuncs(rt: Runtime): void {
  const def = (name: string, fn: (r: Runtime, a: unknown[]) => unknown | Promise<unknown>, refs?: number[]) => rt.sys.set(name, refs ? { fn: (r, a) => fn(r, a), refs } : { fn: (r, a) => fn(r, a) })

  def('fileexists', async (_r, a) => (await api<{ exists?: boolean }>('/api/fs/exists', { path: toStr(a[0]) })).exists === true)
  def('filedelete', async (_r, a) => (await api<{ ok?: boolean }>('/api/fs/delete', { path: toStr(a[0]) })).ok === true)
  def('filecopy', async (_r, a) => (await api<{ ok?: boolean }>('/api/fs/copy', { from: toStr(a[0]), to: toStr(a[1]), overwrite: a[2] === true })).ok === true)

  /** fileopen(name {, filemode {, fileaccess {, filelock {, writemode {, encoding}}}}}) -> handle or -1 */
  def('fileopen', async (_r, a) => {
    const path = toStr(a[0])
    const rest = a.slice(1).map(mode)
    const write = rest.includes('write!')
    const h: Handle = { path, write, append: rest.includes('append!'), linemode: !rest.includes('streammode!') && !rest.includes('textmode!'), data: new Uint8Array(0), pos: 0, out: [] }
    if (!write) {
      const r = await api<{ exists?: boolean; data?: string }>('/api/fs/read', { path })
      if (!r.exists) return -1
      h.data = unb64(r.data || '')
    } else if (!h.append) {
      const w = await api<{ ok?: boolean }>('/api/fs/write', { path, data: '', append: false })
      if (!w.ok) return -1
    }
    const id = nextHandle++
    handles.set(id, h)
    return id
  })

  const flush = async (h: Handle): Promise<void> => {
    if (!h.out.length) return
    const bytes = Uint8Array.from(h.out.flat())
    h.out = []
    await api('/api/fs/write', { path: h.path, data: b64(bytes), append: true })
  }

  def('fileclose', async (_r, a) => {
    const h = handles.get(toNum(a[0]))
    if (!h) return -1
    if (h.write) await flush(h)
    handles.delete(toNum(a[0]))
    return 1
  })
  def('filewrite', async (_r, a) => {
    const h = handles.get(toNum(a[0]))
    if (!h || !h.write) return -1
    const bytes = enc.encode(toStr(a[1]) + (h.linemode ? '\r\n' : ''))
    h.out.push(Array.from(bytes))
    if (h.out.length > 500) await flush(h)
    return bytes.length
  })
  def('filewriteex', async (_r, a) => {
    const h = handles.get(toNum(a[0]))
    if (!h || !h.write) return -1
    const bytes = a[1] instanceof Uint8Array ? a[1] : enc.encode(toStr(a[1]))
    h.out.push(Array.from(bytes))
    await flush(h)
    return bytes.length
  })
  /** fileread(handle, ref string|blob): one line (line mode) or the next 32K block */
  const readInto = async (a: unknown[], whole: boolean): Promise<number> => {
    const h = handles.get(toNum(a[0]))
    const ref = a[1]
    if (!h || h.write || !(ref instanceof Ref)) return -1
    if (h.pos >= h.data.length) return -100
    let end: number
    if (whole) end = h.data.length
    else if (h.linemode) {
      end = h.data.indexOf(10, h.pos)
      end = end < 0 ? h.data.length : end
    } else end = Math.min(h.data.length, h.pos + 32765)
    let chunk = h.data.subarray(h.pos, end)
    h.pos = h.linemode && !whole ? Math.min(h.data.length, end + 1) : end
    if (h.linemode && !whole && chunk.length && chunk[chunk.length - 1] === 13) chunk = chunk.subarray(0, chunk.length - 1)
    const cur = ref.get()
    if (cur instanceof Uint8Array) await ref.set(chunk.slice())
    else await ref.set(dec.decode(chunk))
    return chunk.length
  }
  def('fileread', (_r, a) => readInto(a, false), [1])
  def('filereadex', (_r, a) => readInto(a, true), [1])
  def('fileseek', (_r, a) => {
    const h = handles.get(toNum(a[0]))
    if (!h) return -1
    h.pos = Math.max(0, toNum(a[1]))
    return h.pos
  })
  def('filelength', async (_r, a) => (await api<{ size?: number }>('/api/fs/exists', { path: toStr(a[0]) })).size ?? -1)

  // dialogs: the shell offers a prompt for the path (the desktop shell can replace this with the native dialog)
  const dialog = (kind: string) => async (r: Runtime, a: unknown[]): Promise<number> => {
    const ui = r.ui as { prompt?: (title: string, text: string, def: string) => Promise<string | null> } | null
    const nameRef = a[1]
    const def0 = nameRef instanceof Ref ? toStr(nameRef.get()) : ''
    const v = ui?.prompt ? await ui.prompt(toStr(a[0]) || kind, kind, def0) : null
    if (v === null) return 0
    if (nameRef instanceof Ref) await nameRef.set(v)
    if (a[2] instanceof Ref) await a[2].set(v.replace(/^.*[\\/]/, ''))
    return 1
  }
  def('getfilesavename', dialog('Save as'), [1, 2])
  def('getfileopenname', dialog('Open'), [1, 2])
  def('getfolder', async (r, a) => {
    const ui = r.ui as { prompt?: (title: string, text: string, def: string) => Promise<string | null> } | null
    const v = ui?.prompt ? await ui.prompt(toStr(a[0]) || 'Folder', 'Folder', '') : null
    if (v === null) return 0
    if (a[1] instanceof Ref) await a[1].set(v)
    return 1
  }, [1])

  // ---- plain-text print jobs (PrintOpen / PrintSend / PrintClose): receipts and simple lists, printed through the shell
  const jobs = new Map<number, string[]>()
  let nextJob = 1
  def('printopen', () => {
    jobs.set(nextJob, [])
    return nextJob++
  })
  def('printsend', (_r, a) => {
    const j = jobs.get(toNum(a[0]))
    if (!j) return -1
    j.push(toStr(a[1]))
    return 1
  })
  def('printtext', (_r, a) => {
    const j = jobs.get(toNum(a[0]))
    if (!j) return -1
    j.push(toStr(a[1]) + String.fromCharCode(10))
    return 1
  })
  def('printpage', () => 1)
  def('printdefinefont', () => 1)
  def('printsetup', () => 1)
  def('printsetprinter', () => 1)
  def('printgetprinter', () => '')
  def('printclose', async (r, a) => {
    const j = jobs.get(toNum(a[0]))
    if (!j) return -1
    jobs.delete(toNum(a[0]))
    const ui = r.ui as { printText?: (t: string) => Promise<boolean> } | null
    return ui?.printText ? ((await ui.printText(j.join(''))) ? 1 : -1) : 1
  })
  def('getfocus', (r) => (r.ui as { focused?: () => unknown } | null)?.focused?.() ?? null)

  // ---- handle() / send(): `send(handle(this), 256, 9, 0)` presses Tab for the object (used by Enter-key navigation everywhere)
  const byHandle = new Map<number, unknown>()
  const handleOf = new WeakMap<object, number>()
  let nextHandle2 = 1000
  def('handle', (_r, a) => {
    const o = a[0]
    if (!o || typeof o !== 'object') return 0
    let h = handleOf.get(o)
    if (!h) {
      h = nextHandle2++
      handleOf.set(o, h)
      byHandle.set(h, o)
    }
    return h
  })
  def('send', async (r, a) => {
    const o = byHandle.get(toNum(a[0]))
    const ui = r.ui as { sendKey?: (o: unknown, vk: number) => Promise<void> | void } | null
    if (o && toNum(a[1]) === 256 && ui?.sendKey) await ui.sendKey(o, toNum(a[2]))
    return 0
  })
  def('keydown', (r, a) => (r.ui as { keyIsDown?: (k: string) => boolean } | null)?.keyIsDown?.(toStr(a[0]).toLowerCase()) === true)

  // ---- misc
  def('rgb', (_r, a) => (toNum(a[0]) & 255) + (toNum(a[1]) & 255) * 256 + (toNum(a[2]) & 255) * 65536)
  def('beep', () => 1)
  def('sleep', (_r, a) => new Promise((res) => setTimeout(() => res(1), Math.min(toNum(a[0]) * 1000, 100))))
  def('run', () => 1) // starting other programs is not part of the rebuild (the original used it for notepad / explorer shortcuts)
  def('blobmid', (_r, a) => {
    const b = a[0] instanceof Uint8Array ? a[0] : new Uint8Array(0)
    const start = Math.max(1, toNum(a[1])) - 1
    return a.length > 2 ? b.slice(start, start + toNum(a[2])) : b.slice(start)
  })
  def('blob', (_r, a) => (typeof a[0] === 'string' ? enc.encode(a[0]) : new Uint8Array(0)))

  registerLabelPrinter(rt, def)
}

/** TSC label printers (tsclib.dll): the DLL calls become TSPL text that is sent raw to the printer queue */
function registerLabelPrinter(rt: Runtime, def: (name: string, fn: (r: Runtime, a: unknown[]) => unknown | Promise<unknown>, refs?: number[]) => void): void {
  void rt
  let printer = ''
  let buf: string[] = []
  const q = (s: unknown) => '"' + toStr(s).replace(/"/g, '\\["]') + '"'
  const add = (line: string) => {
    buf.push(line)
    return 1
  }
  def('tsc_openport_new', (_r, a) => {
    printer = toStr(a[0])
    buf = []
    return 1
  })
  def('tsc_setup_new', (_r, a) => {
    // width, height (mm), speed, density, sensor, vertical gap, offset
    add(`SIZE ${toStr(a[0])} mm,${toStr(a[1])} mm`)
    add(`SPEED ${toStr(a[2])}`)
    add(`DENSITY ${toStr(a[3])}`)
    add(a[4] === '0' || a[4] === 0 ? `GAP ${toStr(a[5])} mm,${toStr(a[6])} mm` : `BLINE ${toStr(a[5])} mm,${toStr(a[6])} mm`)
    return 1
  })
  def('tsc_clearbuffer_new', () => add('CLS'))
  def('tsc_sendcommand_new', (_r, a) => add(toStr(a[0])))
  def('tsc_printerfont_new', (_r, a) => add(`TEXT ${toStr(a[0])},${toStr(a[1])},${q(a[2])},${toStr(a[3])},${toStr(a[4])},${toStr(a[5])},${q(a[6])}`))
  // windows fonts are drawn as bitmaps by the DLL; the closest printer-side equivalent is the built-in scalable font
  def('tsc_windowsfont_new', (_r, a) => add(`TEXT ${toStr(a[0])},${toStr(a[1])},"0",${toStr(a[3])},${Math.max(1, Math.round(toNum(a[2]) / 12))},${Math.max(1, Math.round(toNum(a[2]) / 12))},${q(a[7])}`))
  def('tsc_barcode_new', (_r, a) => add(`BARCODE ${toStr(a[0])},${toStr(a[1])},${q(a[2])},${toStr(a[3])},${toStr(a[4])},${toStr(a[5])},${toStr(a[6])},${toStr(a[7])},${q(a[8])}`))
  def('tsc_printlabel_new', (_r, a) => add(`PRINT ${toStr(a[0])},${toStr(a[1])}`))
  def('tsc_closeport_new', async () => {
    const data = enc.encode(buf.join('\r\n') + '\r\n')
    buf = []
    if (!printer) return 1
    const r = await api<{ ok?: boolean }>('/api/print/raw', { printer, data: b64(data) })
    return r.ok ? 1 : 0
  })
  void PBArray
}
