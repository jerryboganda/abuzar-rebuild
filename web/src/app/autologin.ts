// Test hook (`?autologin=user:password`): signs in through the original login window the way a user would (fill the two fields, press OK),
// so a browser test can drive the real DOM user interface without typing.  Not used in normal operation.
import type { Runtime } from '../runtime/interp.ts'
import type { PBObject } from '../runtime/object.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'

export async function autoLogin(rt: Runtime, user: string, password: string): Promise<boolean> {
  const t0 = Date.now()
  let login: PBObject | undefined
  while (!login && Date.now() - t0 < 30000) {
    login = rt.windowInstances.get('w_login1')
    if (!login) await new Promise((r) => setTimeout(r, 50))
  }
  if (!login) return false
  const dw = login.children.get('dw_password') as NDwBase | undefined
  const ok = login.children.get('cb_ok')
  if (!dw || !ok) return false
  await dw.ready
  await dw.n_setitem(1, 'login', user)
  await dw.n_setitem(1, 'password', password)
  await rt.fire(ok, 'clicked', [])
  return true
}
