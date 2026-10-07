import type { AppIdentityName } from '../src/platform/appIdentity'

/**
 * Whether developer-only tooling (transcript fetching, Full Sync via the Data API key, the
 * transcript-coverage filter, …) is available in this process. True for a development build
 * (`npm run dev`, not packaged) OR any build running as the development identity ("Berean Dev",
 * config/app-identity.json). A packaged production-identity build is always false — production
 * users only ever read the already-stored data (see electron/ipc/youtube.ts fetchTranscripts).
 *
 * Pure so it can be unit-tested; main.ts / youtube.ts pass `is.dev` and `APP_IDENTITY.name`.
 */
export function devToolsEnabled(opts: { isDev: boolean; identity: AppIdentityName }): boolean {
  return opts.isDev || opts.identity === 'development'
}
