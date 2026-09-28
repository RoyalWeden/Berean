import { Geolocation } from '@capacitor/geolocation'
import { useAppStore } from '@/store'

/**
 * Device location for the daily-note sunrise boundary (R048 / R101). Desktop asks
 * `navigator.geolocation` once per launch (src/App.tsx); on the phone the native plugin is used
 * so the system prompt carries `NSLocationWhenInUseUsageDescription` and the answer is
 * remembered by iOS.
 *
 * Policy: the app never prompts at launch. At boot it refreshes the cached fix only when the
 * user has already granted access; the first prompt happens the first time a daily note is
 * opened (`ensureDailyNoteLocation({ prompt: true })`), i.e. when the feature that needs it is
 * used. A denied or failed request keeps the previously cached value (or none) — daily notes
 * then fall back to the plain midnight boundary exactly as desktop does.
 */
let inflight: Promise<void> | null = null
let refreshedThisLaunch = false

export async function ensureDailyNoteLocation(opts: { prompt: boolean }): Promise<void> {
  if (refreshedThisLaunch) return
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const status = await Geolocation.checkPermissions()
      let state = status.location
      if (state === 'prompt' || state === 'prompt-with-rationale') {
        if (!opts.prompt) return
        state = (await Geolocation.requestPermissions({ permissions: ['location'] })).location
      }
      if (state !== 'granted') return
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, maximumAge: 6 * 60 * 60 * 1000, timeout: 10_000 })
      useAppStore.getState().setDailyNoteLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      refreshedThisLaunch = true
    } catch {
      /* denied, unavailable, or timed out — keep the cached value */
    } finally {
      inflight = null
    }
  })()
  return inflight
}
