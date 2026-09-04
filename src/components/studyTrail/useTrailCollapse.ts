import { useCallback, useEffect, useRef, useState } from 'react'

// Persisted fold state for the Study Trail map, per direct feedback: "if the user collapses any
// branch or whatever, remember that so even if the app is closed or the study trail or session is
// switched or whatever, that thing remembers that the user collapsed it."
//
// Backed by the v38 `trail_collapse` table rather than localStorage (trailWindowPrefs.ts) because
// that's per-window and wouldn't survive a reinstall. Loaded once per window into a Set and kept
// there: a fold has to feel instant, so the set is updated optimistically and the write goes out
// in the background — a failed write just means the fold isn't remembered next launch, which is
// far better than a UI that stutters on every toggle.
//
// A key that isn't in the set is EXPANDED. That's deliberate: it means nothing needs backfilling
// for existing sessions, and clearing the table simply re-opens everything.

export type CollapseScope = 'branch' | 'section' | 'session' | 'day'

export interface TrailCollapse {
  isCollapsed: (scope: CollapseScope, key: string) => boolean
  toggle: (scope: CollapseScope, key: string) => void
  set: (scope: CollapseScope, key: string, collapsed: boolean) => void
  /** True until the first load resolves — lets a caller avoid a visible expand-then-collapse
   *  flash on mount by rendering nothing (or a skeleton) until the real state is known. */
  loading: boolean
}

export function useTrailCollapse(): TrailCollapse {
  const [keys, setKeys] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  // Read inside the stable callbacks below so they never need `keys` as a dependency — a toggle
  // handler that changes identity on every fold would re-render every row in the spine.
  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    let cancelled = false
    window.studyTrail.getCollapse().then((list) => {
      if (cancelled) return
      setKeys(new Set(list))
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const set = useCallback((scope: CollapseScope, key: string, collapsed: boolean) => {
    const full = `${scope}:${key}`
    setKeys((prev) => {
      if (prev.has(full) === collapsed) return prev
      const next = new Set(prev)
      if (collapsed) next.add(full)
      else next.delete(full)
      return next
    })
    void window.studyTrail.setCollapse(scope, key, collapsed).catch(() => {})
  }, [])

  const toggle = useCallback((scope: CollapseScope, key: string) => {
    set(scope, key, !keysRef.current.has(`${scope}:${key}`))
  }, [set])

  const isCollapsed = useCallback((scope: CollapseScope, key: string) => keysRef.current.has(`${scope}:${key}`), [])

  // `isCollapsed` reads a ref, so it alone can't drive a re-render — the `keys` state changing is
  // what does that, and every consumer of this hook re-renders together when it does.
  return { isCollapsed, toggle, set, loading }
}
