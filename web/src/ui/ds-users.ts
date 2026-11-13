/**
 * Users & rights page of the approved design: the user accounts as cards and, for the chosen user, the rights their groups grant,
 * module by module (the original keeps rights per group as a list of menu commands; see Manage › Groups).  Read-only: adding a user,
 * changing a user and changing rights go through the original Manage › Users and Manage › Groups windows.
 */
type Query = (sql: string, params?: unknown[]) => Promise<unknown[][]>
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export interface UserCard { code: number; name: string; groups: string; active: boolean }
export interface ModuleRights { module: string; open: boolean | null; allowed: number; total: number; modify: number; modifyTotal: number; post: number; postTotal: number }
export interface UsersState { users: UserCard[]; selected: number | null; rights: ModuleRights[] | null; seq: number; loaded: boolean }

export function newUsersState(): UsersState { return { users: [], selected: null, rights: null, seq: 0, loaded: false } }

export async function loadUsers(query: Query, state: UsersState, current: string): Promise<void> {
  const rows = await query(`SELECT u.usercode, trim(u.username::text), coalesce(string_agg(g.groupname::text, ', ' ORDER BY g.groupname), ''), (upper(coalesce(u.active::text, 'Y')) = 'Y')::int
    FROM dbo.users u LEFT JOIN dbo.usergroups ug ON ug.usercode = u.usercode LEFT JOIN dbo.groups g ON g.groupcode = ug.groupcode
    GROUP BY u.usercode, u.username, u.active ORDER BY upper(trim(u.username::text))`)
  state.users = rows.map((r) => ({ code: Number(r[0]), name: String(r[1] ?? ''), groups: String(r[2] ?? ''), active: Number(r[3]) === 1 }))
  state.loaded = true
  if (state.selected === null || !state.users.some((u) => u.code === state.selected)) {
    state.selected = (state.users.find((u) => u.name.toUpperCase() === current.trim().toUpperCase()) ?? state.users[0])?.code ?? null
  }
}

/** The rights the user's groups grant, per top-level menu (module), from the rights catalogue. */
export async function loadRights(query: Query, state: UsersState): Promise<void> {
  const user = state.selected
  const seq = ++state.seq
  state.rights = null
  if (user === null) return
  const rows = await query(`WITH granted AS (SELECT DISTINCT gr.rightcode FROM dbo.usergroups ug JOIN dbo.grouprights gr ON gr.groupcode = ug.groupcode AND gr.status = 1 WHERE ug.usercode = $1),
      r AS (SELECT r.rightcode, trim(split_part(r.rightname::text, ',', 1)) module, r.levelindex, r.rightname::text rn, g.rightcode IS NOT NULL ok FROM dbo.rights r LEFT JOIN granted g ON g.rightcode = r.rightcode)
    SELECT module, (bool_or(ok) FILTER (WHERE levelindex = 1))::int, count(*) FILTER (WHERE ok), count(*),
      count(*) FILTER (WHERE ok AND rn ~* 'modify'), count(*) FILTER (WHERE rn ~* 'modify'),
      count(*) FILTER (WHERE ok AND rn ~* 'post'), count(*) FILTER (WHERE rn ~* 'post')
    FROM r WHERE module <> '' GROUP BY module ORDER BY min(rightcode)`, [user])
  if (seq !== state.seq) return
  state.rights = rows.map((r) => ({ module: String(r[0] ?? ''), open: r[1] === null || r[1] === undefined ? null : Number(r[1]) === 1, allowed: Number(r[2] ?? 0), total: Number(r[3] ?? 0),
    modify: Number(r[4] ?? 0), modifyTotal: Number(r[5] ?? 0), post: Number(r[6] ?? 0), postTotal: Number(r[7] ?? 0) }))
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const ICON = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
}
const svg = (body: string) => `<svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`

export interface UsersActions { addUser: (() => void) | null; editUsers: (() => void) | null; editRights: (() => void) | null; select(code: number): void }

export function renderUsers(host: HTMLElement, state: UsersState, actions: UsersActions): void {
  const user = state.users.find((u) => u.code === state.selected)
  const admin = !!user && /admin/i.test(user.groups)
  const count = (a: number, b: number) => `<span class="num">${a.toLocaleString('en-PK')}</span><span class="ds-faint"> / ${b.toLocaleString('en-PK')}</span>`
  host.innerHTML = `<div class="ds-home ds-page"><div class="ds-users-grid">
    <section class="ds-card"><div class="ds-card-h"><h2>Users</h2><span class="hint">${state.users.length} accounts · ${state.users.filter((u) => u.active).length} active</span><span class="ds-grow"></span>
      <button class="ds-btn" type="button" data-u-add ${actions.addUser ? '' : 'disabled'}>${svg(ICON.user)}Add user</button></div>
      <div class="ds-card-b"><div class="ds-ucards ds-stagger">${state.users.map((u, i) => `<button class="ds-ucard" type="button" data-user="${u.code}" aria-pressed="${u.code === state.selected}" style="--i:${Math.min(i, 20)}">
        <span class="ds-uav">${esc(initials(u.name))}${u.active ? '<span class="on" aria-label="active"></span>' : ''}</span><span class="ds-ucard-t"><b>${esc(u.name)}</b><small>${esc(u.groups || 'No group')}${u.active ? '' : ' · inactive'}</small></span></button>`).join('')
        || `<p class="ds-empty">${state.loaded ? 'No user accounts.' : 'Loading users…'}</p>`}</div></div></section>
    <section class="ds-card"><div class="ds-card-h"><h2>Rights${user ? ` · ${esc(user.name)}` : ''}</h2><span class="hint">${esc(user?.groups ?? '')}</span><span class="ds-grow"></span>
      <button class="ds-btn ds-btn-ghost" type="button" data-u-edit ${actions.editUsers ? '' : 'disabled'}>${svg(ICON.edit)}Edit user</button>
      <button class="ds-btn ds-btn-ghost" type="button" data-u-rights ${actions.editRights ? '' : 'disabled'}>${svg(ICON.shield)}Edit group rights</button></div>
      <div class="ds-tblw"><table class="ds-table ds-matrix"><thead><tr><th>Module</th><th>Menu open</th><th>Commands allowed</th><th>Modify</th><th>Post</th></tr></thead><tbody>${
        state.rights === null ? '<tr><td colspan="5" class="ds-empty">Loading rights…</td></tr>'
          : state.rights.map((m) => `<tr><td><b>${esc(m.module)}</b></td><td>${m.open === null ? '<span class="ds-faint" title="Not a menu of its own">—</span>' : `<span class="ds-switch ds-switch-ro" role="switch" aria-checked="${m.open}" aria-readonly="true" aria-label="${esc(m.module)} menu open"></span>`}</td>
            <td><span class="ds-meter"><i style="width:${m.total ? Math.max(2, m.allowed / m.total * 100) : 0}%"></i></span>${count(m.allowed, m.total)}</td>
            <td>${m.modifyTotal ? count(m.modify, m.modifyTotal) : '<span class="ds-faint">—</span>'}</td><td>${m.postTotal ? count(m.post, m.postTotal) : '<span class="ds-faint">—</span>'}</td></tr>`).join('')
            || '<tr><td colspan="5" class="ds-empty">This user is in no group, so no rights are granted.</td></tr>'}</tbody></table></div>
      <p class="ds-help ds-users-note">${admin ? 'Administrators have every right their group grants. ' : ''}Rights are granted to groups; change them in Manage › Groups. This page only shows them.</p></section></div></div>`
  host.onclick = (event) => {
    const target = event.target as HTMLElement
    const card = target.closest<HTMLElement>('[data-user]')
    if (card) { actions.select(Number(card.dataset.user)); return }
    if (target.closest('[data-u-add]')) actions.addUser?.()
    if (target.closest('[data-u-edit]')) actions.editUsers?.()
    if (target.closest('[data-u-rights]')) actions.editRights?.()
  }
  host.onkeydown = null
}

export const USERS_CSS = `
.ds-users-grid {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:18px;align-items:start;}
.ds-card-h {display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--p-hair);flex-wrap:wrap;}
.ds-card-h h2 {font-size:15px;margin:0;font-weight:600;}
.ds-card-h .hint {color:var(--p-muted);font-size:12.5px;}
.ds-card-b {padding:18px;}
.ds-ucards {display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;}
.ds-ucard {display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--p-hair);border-radius:12px;background:var(--p-surface);color:var(--p-text);cursor:pointer;text-align:left;font:14px var(--p-font);transition:all .2s;}
.ds-ucard:hover {border-color:var(--p-accent);}
.ds-ucard[aria-pressed=true] {border-color:var(--p-accent);box-shadow:0 0 0 3px var(--p-glow);}
.ds-ucard-t {min-width:0;}
.ds-ucard-t b {display:block;font-weight:600;}
.ds-ucard-t small {color:var(--p-muted);font-size:12px;}
.ds-uav {position:relative;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:600;flex:none;}
.ds-uav .on {position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;background:#4ec98a;border:2px solid var(--p-surface);}
.ds-matrix td:not(:first-child),.ds-matrix th:not(:first-child) {text-align:center;}
.ds-matrix b {font-weight:500;}
.ds-switch-ro {display:inline-block;position:relative;width:40px;height:24px;border-radius:999px;background:var(--p-line);vertical-align:middle;}
.ds-switch-ro::after {content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / .3);}
.ds-switch-ro[aria-checked=true] {background:var(--p-accent);}
.ds-switch-ro[aria-checked=true]::after {transform:translateX(16px);}
.ds-meter {display:inline-block;width:70px;height:7px;border-radius:999px;background:var(--p-sunk);overflow:hidden;vertical-align:middle;margin-right:8px;}
.ds-meter i {display:block;height:100%;border-radius:999px;background:var(--p-accent);}
.ds-users-note {padding:0 18px 16px;margin:10px 0 0;}
.ds-btn-ghost {border-color:transparent!important;background:none!important;color:var(--p-muted)!important;}
.ds-btn-ghost:hover:not(:disabled) {background:var(--p-sunk)!important;color:var(--p-text)!important;}
.ds-btn .ds-i {width:15px;height:15px;}
@media (max-width:1050px){.ds-users-grid{grid-template-columns:minmax(0,1fr)}}
`
