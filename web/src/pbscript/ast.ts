// AST of the PowerScript recovered from the compiled application (see recovered/scripts in the research project).
// Identifiers are lower-cased: PowerScript is case-insensitive.

export type Expr =
  | { k: 'num'; v: number; dec: boolean }
  | { k: 'str'; v: string }
  | { k: 'enum'; v: string } // keyenter!, arrow! ...
  | { k: 'id'; n: string }
  | { k: 'global'; n: string } // ::name
  | { k: 'mem'; o: Expr; n: string }
  | { k: 'idx'; o: Expr; i: Expr[] }
  | { k: 'call'; o: Expr | null; n: string; a: Expr[]; m?: string; sc?: { kind: string; n?: number; distinct?: Expr } } // m: modifiers (post/dynamic/event); sc: DataWindow aggregate scope
  | { k: 'case'; e: Expr; w: { v: Expr[]; r: Expr }[]; d?: Expr } // DataWindow case(x when a then b ... else c)
  | { k: 'super'; n: string; a: Expr[] }
  | { k: 'un'; op: '-' | 'not'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'arr'; e: Expr[] }
  | { k: 'new'; t: string | Expr; using: boolean; a: Expr[] }

export type CaseTest =
  | { k: 'val'; e: Expr }
  | { k: 'range'; a: Expr; b: Expr }
  | { k: 'is'; op: string; e: Expr }

export type Stmt =
  | { k: 'decl'; t: string; arr: boolean; vars: { n: string; dims?: Expr[][]; init?: Expr }[]; prec?: string; constant?: boolean }
  | { k: 'assign'; l: Expr; op: string; r: Expr }
  | { k: 'expr'; e: Expr }
  | { k: 'if'; c: Expr; t: Stmt[]; ei: { c: Expr; b: Stmt[] }[]; e?: Stmt[] }
  | { k: 'choose'; e: Expr; cs: { t: CaseTest[]; b: Stmt[] }[]; d?: Stmt[] }
  | { k: 'for'; v: Expr; a: Expr; b: Expr; s?: Expr; body: Stmt[] }
  | { k: 'while'; c: Expr; until: boolean; body: Stmt[]; post: boolean }
  | { k: 'try'; body: Stmt[]; catches: { t: string; v: string; b: Stmt[] }[]; fin?: Stmt[] }
  | { k: 'return'; e?: Expr }
  | { k: 'exit' }
  | { k: 'continue' }
  | { k: 'halt'; close: boolean }
  | { k: 'goto'; l: string }
  | { k: 'label'; l: string }
  | { k: 'throw'; e: Expr }
  | { k: 'callsuper'; n: string }
  | { k: 'destroy'; e: Expr }
  | { k: 'sql'; kind: string; text: string; hv: string[]; using?: string; note?: string }

export interface Param {
  n: string
  t: string
  arr: boolean
  ref: boolean
  readonly: boolean
}

export interface Routine {
  owner: string
  name: string
  params: Param[]
  ret: string
  locals: { n: string; t: string; arr: boolean }[]
  body: Stmt[]
  line: number
}

export interface ScriptFile {
  kind: string
  name: string
  library: string
  ancestor: string
  routines: Routine[]
}
