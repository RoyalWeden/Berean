import { App as CapApp } from '@capacitor/app'
import { handleDeepLink, isDeepLink, type DeepLinkTarget } from '../../lib/deepLinks'

/**
 * iOS entry point for deep links (docs/mobile: developer decision Q5). `berean://` and the
 * legacy `berean-pdf://` schemes are registered in Info.plist (CFBundleURLTypes); Capacitor
 * delivers them as `appUrlOpen` (and `getLaunchUrl()` for a cold start). Universal Links land in
 * the same `appUrlOpen` event later, and `parseDeepLink` already understands the https form, so
 * adding them is an entitlement + AASA file, not new routing.
 *
 * The mobile shell (Phase 10) registers its `DeepLinkTarget`; URLs that arrive before that are
 * queued and replayed, so a cold-start link is never lost.
 */
let target: DeepLinkTarget | null = null
let pending: string[] = []
let installed = false

export function setIosDeepLinkTarget(t: DeepLinkTarget | null): void {
  target = t
  if (t) { const urls = pending; pending = []; for (const u of urls) handleDeepLink(u, t) }
}

export function openIosDeepLink(url: string): boolean {
  if (!isDeepLink(url)) return false
  if (target) return handleDeepLink(url, target)
  pending.push(url)
  return true
}

export async function installIosDeepLinks(): Promise<void> {
  if (installed) return
  installed = true
  try {
    const launch = await CapApp.getLaunchUrl()
    if (launch?.url) openIosDeepLink(launch.url)
  } catch { /* plugin unavailable (web preview) */ }
  try {
    await CapApp.addListener('appUrlOpen', ({ url }) => { openIosDeepLink(url) })
  } catch { /* plugin unavailable (web preview) */ }
}

/** Test/inspection hook. */
export function __iosPendingDeepLinks(): string[] { return [...pending] }
