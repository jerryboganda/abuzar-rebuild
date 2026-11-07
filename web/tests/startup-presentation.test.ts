import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { PBObject } from '../src/runtime/object.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import type { Routine } from '../src/pbscript/ast.ts'
import { DEFAULT_CONFIG, startApplication } from '../src/app/startup.ts'

function fixture(success = true, user: unknown = 17) {
  const open: Routine = {
    owner: 'traderappv1', name: 'open', params: [], ret: '0', locals: [], event: true, line: 1,
    body: [{ k: 'sql', kind: 'select', text: 'synthetic post-login marker', hv: ['gl_remotegroup'] }],
  }
  const definition: ClassDef = {
    name: 'traderappv1', ancestor: null, kind: 'application', library: 'synthetic', fields: [], controls: [],
    routines: new Map([['traderappv1', new Map([['open', [open]]])]]),
  }
  const rt = new Runtime({ load: async (name) => name === 'traderappv1' ? definition : undefined })
  const message = new PBObject(rt, 'message', 'message')
  rt.globals.set('message', message)
  const events: string[] = []
  rt.sys.set('open', { fn: () => {
    events.push('login')
    message.props.set('doubleparm', success ? 1 : 0)
    rt.globals.set('gl_usercode', user)
    return 1
  } })
  rt.sql = async () => { events.push('business-startup') }
  return { rt, events, config: { ...DEFAULT_CONFIG, company: 'SYNTHETIC' } }
}

test('presentation hook runs after authentication and before business startup', async () => {
  const f = fixture()
  assert.equal(await startApplication(f.rt, f.config, { onAuthenticated: async (context) => {
    f.events.push('presentation')
    assert.equal(context.appUser, '17')
    assert.ok(Object.isFrozen(context.config))
  } }), true)
  assert.deepEqual(f.events, ['login', 'presentation', 'business-startup'])
})

test('cancelled login never invokes presentation selection or business startup', async () => {
  const f = fixture(false)
  assert.equal(await startApplication(f.rt, f.config, { onAuthenticated: async () => { throw new Error('must not run') } }), false)
  assert.deepEqual(f.events, ['login'])
})

test('presentation errors stop startup explicitly rather than opening a wrong-user host', async () => {
  const f = fixture()
  await assert.rejects(startApplication(f.rt, f.config, { onAuthenticated: async () => { throw new Error('fixture failure') } }), /fixture failure/)
  assert.deepEqual(f.events, ['login'])
})

test('presentation selection requires identity; existing callers without the hook remain compatible', async () => {
  const invalid = fixture(true, null)
  await assert.rejects(startApplication(invalid.rt, invalid.config, { onAuthenticated: async () => {} }), /authenticated application user/)
  const existing = fixture()
  assert.equal(await startApplication(existing.rt, existing.config), true)
  assert.deepEqual(existing.events, ['login', 'business-startup'])
})
