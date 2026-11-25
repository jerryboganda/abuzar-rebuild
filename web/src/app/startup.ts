// Start-up sequence of the application.
//
// The original `traderappv1.open` event does three things: (1) environment work (local settings file, licence / dongle,
// session rows, schema upgrade scripts, backup health), (2) the login window `w_login1` and (3) the initialisation after login
// (preference and security data stores, item lists, report headers, ...) followed by `openwithparm(w_main, gl_usercode)`.
// Part 1 has no meaning in the rebuild (own configuration, own licensing decision, proper migrations).  Parts 2 and 3 are the
// recovered code itself: the login window is opened like the original, and the code after the login is executed from the
// decompiled `open` routine, so every preference lookup, cache and menu rule behaves as it did.
import { setAppUser } from './httpdb.ts'
import type { Runtime } from '../runtime/interp.ts'
import { Frame, HaltSignal, Ref } from '../runtime/interp.ts'
import type { Stmt } from '../pbscript/ast.ts'
import type { PBObject } from '../runtime/object.ts'

export interface AppConfig {
  /** deployment key used by `if gs_company = ...` branches of the original (print layouts, rules) */
  company: string
  server: string
  database: string
  appVersion: number
  computer: string
}

export const DEFAULT_CONFIG: AppConfig = { company: '', server: 'localhost', database: 'trader', appVersion: 0, computer: 'WORKSTATION' }

export interface AuthenticatedPresentationContext {
  appUser: string
  config: Readonly<AppConfig>
}

export interface StartupOptions {
  /** Called after successful login closes and before any post-login business window opens. */
  onAuthenticated?: (context: AuthenticatedPresentationContext) => Promise<void>
}

/**
 * Names of the SQL Server Agent jobs and their schedules the original installation uses (read from the shop's msdb, 2026-11-25).  The application's global
 * variables carry them as initial values that the decompiler did not recover, so the Job Schedule window and the preferences read an empty name.  Here they are rows
 * of `dbo.sysjobs` / `dbo.sysjobschedules`, written by `sp_ActivateJob` / `sp_AdjustJobSchedule`, run by `server/src/jobs.rs` (JOBS=schedule).
 */
export const JOB_GLOBALS: Record<string, string> = {
  gs_clientjob: 'autobackupclient', gs_clientjobschedule: 'autobackupscheduleclient',
  gs_autocashsalepostingjob: 'autocashsaleposting', gs_autocashsalepostingjobschedule: 'autocashsalepostingschedule',
  gs_autocreditsalepostingjob: 'autocreditsaleposting', gs_autocreditsalepostingjobschedule: 'autocreditsalepostingschedule',
  gs_autoinpatientservicesjob: 'autoinpatientservice', gs_autoinpatientservicesjobschedule: 'autoinpatientserviceschedule',
  gs_autosatisfyduejob: 'AutoSatisfyDue', gs_autosatisfyduejobschedule: 'AutoSatisfyDue_Schedule',
  gs_autocreatescheduledsmsjob: 'AutoCreateScheduledSMS', gs_autocreatescheduledsmsjobschedule: 'AutoCreateScheduledSMS_Schedule',
  gs_autocheckedinguestservicesjob: 'AutoCheckedInGuestService', gs_autocheckedinguestservicesjobschedule: 'AutoCheckedInGuestServiceschedule',
  gs_stockverificationjob: 'AutoStockVerification', gs_stockverificationjobschedule: 'autostockverification',
  gs_stockreportjob: 'TSQL_Job_StockReport', gs_stockreportjobschedule: 'TSQL_Job_StockReportSchedule 1',
  gs_stockledgerjob: 'TSQL_Job_StockLedger', gs_stockledgerjobschedule: 'TSQL_Job_StockLedgerSchedule 1',
  gs_autosendcrsdatajob: 'AutoSendStockAndSalesToCRS', gs_autosendcrsdatajobschedule: 'AutoSendStockAndSalesToCRS',
  gs_autoimportstockjob: 'AutoImportStockFromParentServer', gs_autoimportstockjobschedule: 'AutoImportStockFromParentServerSchedule',
  gs_autodatafetchfromchildserver: 'AutoDataFetchFromChildServer', gs_autodatafetchfromchildserver_schedule: 'AutoDataFetchFromChildServer_Schedule',
  gs_autodatamigration: 'AutoDataMigration', gs_autodatamigrationschedule: 'AutoDataMigration_Schedule',
  gs_autodoctortokenreset: 'AutoDoctorTokenReset', gs_autodoctortokenresetschedule: 'AutoDoctorTokenReset_Schedule',
  gs_autoemployeetimout: 'AutoEmployeeTimout', gs_autotimeout_attendance_schedule: 'SP_AutoTimeOut_Attendance_Schedule',
  gs_autopatientrecservice: 'AutoPatientRecService', gs_autopatientrecserviceschedule: 'AutoPatientRecServiceschedule',
  gs_autopostvisit: 'AutoPostVisit', gs_autopostvisitschedule: 'AutoPostVisitschedule',
  gs_autopostvisitappointmentjob: 'AutoPostVisitAppointment', gs_autopostvisitappointmentjobschedule: 'AutoPostVisitAppointmentschedule',
  gs_autopurgepostedsales: 'AutoPurgePostedSales', gs_autopurgepostedsales_schedule: 'AutoPurgePostedSales_Schedule',
  gs_autorestrictselectedclassitems: 'AutoRestrictSelectedClassItems', gs_autorestrictselectedclassitemsschedule: 'AutoRestrictSelectedClassItems_Schedule',
}

export function applyConfig(rt: Runtime, c: AppConfig): void {
  const g = rt.globals
  for (const [name, value] of Object.entries(JOB_GLOBALS)) g.set(name, value)
  g.set('gs_company', c.company)
  g.set('gs_servername', c.server)
  g.set('gs_dbname', c.database)
  g.set('gs_app', 'Waseela')
  g.set('gs_appsetting', 'N')
  g.set('gs_localcomputername', c.computer)
  g.set('gs_isreportserver', 'N')
  g.set('gl_appversion', c.appVersion)
  g.set('gl_currentlanguage', 0)
}

/** statements of `traderappv1.open` that run after the login: everything from the group lookup of the logged-in user */
export async function postLoginStatements(rt: Runtime): Promise<{ decls: Stmt[]; tail: Stmt[]; idx: number } | null> {
  const cls = await rt.getClass('traderappv1')
  const open = cls?.routines.get('traderappv1')?.get('open')?.[0]
  if (!cls || !open) return null
  const at = open.body.findIndex((s) => s.k === 'sql' && s.hv.includes('gl_remotegroup'))
  if (at < 0) return null
  return { decls: open.body.filter((s) => s.k === 'decl'), tail: open.body.slice(at), idx: 0 }
}

export async function startApplication(rt: Runtime, cfg: AppConfig = DEFAULT_CONFIG, options: StartupOptions = {}): Promise<boolean> {
  applyConfig(rt, cfg)
  const app = await rt.instantiate('traderappv1')
  rt.globals.set('traderappv1', app)
  // The original open event starts with af_get_app_setting(), which reads mgmtcomp.pbd:
  // gs_company (used to pick rows from serviceheads.pbd), server/database names, limits.
  // The licence / remote-server work that follows it stays out of the rebuild, but this read
  // is what makes the deployed company key and the report-header lists behave like the original.
  if (!cfg.company) {
    try {
      await rt.callMethod(app, 'af_get_app_setting', [])
    } catch {
      // no settings file: the rebuild's own configuration and licensing apply
    }
  }
  const msg = rt.globals.get('message') as PBObject
  // login (modal): the window closes with 1 after a successful login
  const ref = new Ref(() => null, () => {})
  ref.name = 'w_login1'
  await rt.sys.get('open')!.fn(rt, [ref], undefined as never)
  if (msg.props.get('doubleparm') !== 1) return false
  const user = rt.globals.get('gl_usercode')
  if (user !== undefined && user !== null) await setAppUser(String(user)) // audit trail
  if (options.onAuthenticated) {
    if ((typeof user !== 'number' && typeof user !== 'string') || !String(user).trim() || (typeof user === 'number' && !Number.isFinite(user))) {
      throw new Error('Presentation selection requires the authenticated application user.')
    }
    await options.onAuthenticated({ appUser: String(user), config: Object.freeze({ ...cfg }) })
  }
  const pl = await postLoginStatements(rt)
  if (!pl) throw new Error('traderappv1.open has no post-login section')
  const open = (await rt.getClass('traderappv1'))!.routines.get('traderappv1')!.get('open')![0]
  const f = new Frame(app, open, 0)
  try {
    await rt.execBlock([...pl.decls, ...pl.tail], f)
  } catch (e) {
    if (e instanceof HaltSignal) return false
    throw e
  }
  return true
}
