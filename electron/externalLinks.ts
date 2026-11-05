import { shell, type WebContents } from 'electron'

// The renderer shows text from notes, models and the web, so a link it hands over isn't trusted:
// file:, custom app schemes and the like could launch something on the Mac.
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export async function openExternalSafely(url: unknown): Promise<void> {
  if (isSafeExternalUrl(url)) await shell.openExternal(url)
}

/** True when a page navigating from `current` to `next` would leave the app itself. */
export function leavesApp(current: string, next: string): boolean {
  try {
    const a = new URL(current), b = new URL(next)
    return a.protocol !== b.protocol || a.host !== b.host
  } catch {
    return true
  }
}

/** App windows never become browsers: a link opens in the user's browser and the window stays. */
export function keepLinksOutOfApp(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!leavesApp(contents.getURL(), url)) return
    event.preventDefault()
    void openExternalSafely(url)
  })
}
