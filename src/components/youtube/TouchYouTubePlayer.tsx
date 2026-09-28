import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useAppStore } from '@/store'
import { BereanWebView } from '@/platform/ios/plugins'

/**
 * The phone's video player (docs/mobile Phase 17). Electron's `<webview>` does not exist in
 * WKWebView, and YouTube's embed refuses the app's capacitor:// origin as a Referer (error 153),
 * so the player is a native WKWebView (BereanWebViewPlugin) positioned over this placeholder,
 * loading the embed from an https base URL. The native player gives inline / fullscreen / system
 * Picture in Picture and keeps playing under the audio session; WebKit does not allow entering
 * PiP without a user gesture (documented limitation — the fullscreen player has the PiP button).
 * The wrapper relays IFrame API state here for position tracking and end detection.
 */
export default function TouchYouTubePlayer({ videoId, startTime, onReady, onEnded, onPosition, onEmbedBlocked }: {
  videoId: string
  startTime: number
  onReady: () => void
  onEnded: () => void
  onPosition: (seconds: number) => void
  onEmbedBlocked: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [blocked, setBlocked] = useState(false)
  const activeSpace = useAppStore((s) => s.activeSpace)

  useEffect(() => {
    setBlocked(false)
    const el = host.current
    if (!el) return
    const rectOf = () => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } }
    let closed = false
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [
      BereanWebView.addListener('ready', () => { if (!closed) onReady() }),
      BereanWebView.addListener('state', ({ state }) => { if (closed) return; if (state === 1) onReady(); if (state === 0) onEnded() }),
      BereanWebView.addListener('error', ({ code }) => { if (closed) return; if (code === 101 || code === 150 || code === 153) { setBlocked(true); onEmbedBlocked() } }),
      BereanWebView.addListener('position', ({ t }) => { if (!closed) onPosition(t) }),
    ]
    void BereanWebView.open({ videoId, startTime, rect: rectOf() }).catch(() => { setBlocked(true); onEmbedBlocked() })
    // Follow layout changes (rotation, panel resize, list scroll) so the native view stays put.
    const ro = new ResizeObserver(() => { void BereanWebView.setRect({ rect: rectOf() }).catch(() => {}) })
    ro.observe(el)
    const onScroll = () => { void BereanWebView.setRect({ rect: rectOf() }).catch(() => {}) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      closed = true
      ro.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      for (const h of handles) h.then((x) => x.remove()).catch(() => {})
      void BereanWebView.close().catch(() => {})
    }
  }, [videoId, startTime, onReady, onEnded, onPosition, onEmbedBlocked])

  // Leaving the YouTube space hides the native layer (audio continues); coming back shows it.
  useEffect(() => {
    if (activeSpace === 'youtube') void BereanWebView.show().catch(() => {})
    else void BereanWebView.hide().catch(() => {})
  }, [activeSpace])

  return (
    <div ref={host} className="absolute inset-0 bg-black">
      {blocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-1 p-6 text-center">
          <p className="text-subhead text-text-primary">This video can't be embedded.</p>
          <button type="button" className="mobile-button is-primary" onClick={() => window.app.openExternal(`https://www.youtube.com/watch?v=${videoId}`)}>
            <ExternalLink size={16} aria-hidden /> Open in YouTube
          </button>
        </div>
      )}
    </div>
  )
}
