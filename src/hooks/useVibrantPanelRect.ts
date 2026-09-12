import { useEffect, type RefObject } from 'react'

/**
 * Publishes a panel's live on-screen rect as `--berean-panel-{x,y,w,h}` on <html> so
 * global.css's ambient background-animation layer (html.theme-anim-bg body::before) can
 * punch a hole for it — the same reason Sidebar.tsx/ShellHeader.tsx publish
 * `--berean-sidebar-w`/`--berean-header-h`, except this panel isn't pinned to a screen
 * edge (its mosaic layout position varies), so it needs its own x/y, not just one
 * dimension. See global.css's mask-image comment on that rule for the full picture.
 *
 * Only call this from a panel that's genuinely vibrant on mac — i.e. one that doesn't
 * self-paint an opaque background and so shows the mac-only translucent .mosaic-window
 * rule through (BibleRightPanel.tsx, LexiconPanel.tsx). Panels that self-paint opaque
 * (BiblePanel.tsx, YouTubeTab.tsx) never need this — the ambient layer already can't tint
 * anything through their opaque paint.
 *
 * KNOWN LIMITATION (accepted, see global.css / docs/native-mac-checklist.md): only one
 * panel's rect can be excluded at a time — global.css's mask only has room for a single
 * extra hole. If more than one vibrant panel mounts at once, whichever one last wrote the
 * vars "wins"; unmounting resets to a no-op rect unconditionally, so a second still-mounted
 * vibrant panel's hole can also disappear until its own observer next fires. Not attempting
 * a multi-panel registry here — revisit only if this turns out to matter in practice (the
 * default Bible-left/Notes-right layout never has more than one).
 */
export function useVibrantPanelRect(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Mask math still runs on non-mac harmlessly (0×0 rect is a no-op hole), but there's
    // nothing to exclude there — .mosaic-window never goes translucent off-mac — so skip
    // the observer entirely rather than pay for it on every panel mount.
    if (document.documentElement.dataset.platform !== 'darwin') return

    const root = document.documentElement
    const publish = () => {
      const rect = el.getBoundingClientRect()
      root.style.setProperty('--berean-panel-x', `${rect.left}px`)
      root.style.setProperty('--berean-panel-y', `${rect.top}px`)
      root.style.setProperty('--berean-panel-w', `${rect.width}px`)
      root.style.setProperty('--berean-panel-h', `${rect.height}px`)
    }
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    // Width/height changes fire the observer, but a pure reposition (e.g. dragging a
    // mosaic split without resizing this pane) wouldn't — catch that too.
    window.addEventListener('resize', publish)
    publish()

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', publish)
      root.style.setProperty('--berean-panel-x', '-9999px')
      root.style.setProperty('--berean-panel-y', '-9999px')
      root.style.setProperty('--berean-panel-w', '0px')
      root.style.setProperty('--berean-panel-h', '0px')
    }
  }, [ref])
}
