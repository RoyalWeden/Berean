import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Incremental rendering for long lists: exposes a row `limit` that starts at one chunk and
 * grows by a chunk whenever the sentinel element (attach `sentinelRef` to a div after the
 * last rendered row) scrolls into view. Resets to one chunk whenever `resetKey` changes
 * (a new result set). Falls back to "show one chunk + a Show more button" where
 * IntersectionObserver is unavailable (tests, very old WebViews) — `grow()` is exposed for that.
 */
export function useIncrementalLimit(resetKey: unknown, chunk = 50): { limit: number; grow: () => void; sentinelRef: (el: HTMLElement | null) => void } {
  const [limit, setLimit] = useState(chunk)
  const observer = useRef<IntersectionObserver | null>(null)
  const grow = useCallback(() => setLimit((l) => l + chunk), [chunk])

  useEffect(() => { setLimit(chunk) }, [resetKey, chunk])
  useEffect(() => () => { observer.current?.disconnect(); observer.current = null }, [])

  const sentinelRef = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof IntersectionObserver === 'undefined') return
    // A generous bottom margin so the next chunk is mounted before the user reaches the end.
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) grow() }, { rootMargin: '0px 0px 600px 0px' })
    io.observe(el)
    observer.current = io
  }, [grow])

  return { limit, grow, sentinelRef }
}
