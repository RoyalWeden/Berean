import type { DatabaseAdapter } from '../src/platform/db/DatabaseAdapter'
import type { ServiceContext } from '../src/platform/services/context'
import { createServices, type Services } from '../src/platform/services'

/**
 * Process-wide registry of the shared services for the Electron main process.
 *
 * This module deliberately imports nothing from `electron` so the thin IPC modules that import
 * `services()` stay loadable under vitest (whose `electron` package resolves to a path string,
 * not the runtime API). The real ServiceContext — better-sqlite3 adapters over the resource
 * paths, electron-log, cross-window broadcast — is built by electron/servicesHost.ts and handed
 * in once at startup via `initServices()`.
 */
let _ctx: ServiceContext | null = null
let _services: Services | null = null

export function initServices(ctx: ServiceContext): Services {
  _ctx = ctx
  _services = createServices(ctx)
  return _services
}

export function services(): Services {
  if (!_services) throw new Error('services() called before initServices() — main.ts must initialise the service host after opening berean.db')
  return _services
}

export function serviceContext(): ServiceContext {
  if (!_ctx) throw new Error('serviceContext() called before initServices()')
  return _ctx
}

/** The user-DB adapter (for desktop-only modules that want the async surface). */
export function userDbAdapter(): DatabaseAdapter {
  return serviceContext().userDb
}
