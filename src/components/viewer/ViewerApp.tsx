import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/store'
import { hermasAwareChapterLabel } from '@/lib/hermasMap'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { normalizeStrongsNums } from '@/components/lexicon/LexiconPanel'
import type { ViewerPayload, ViewerSidePanel } from '@/types/viewer'
import type { Note, LexiconEntry } from '@/types'
import ViewerBiblePage from './ViewerBiblePage'
import type { ViewerHighlight } from './ViewerBiblePage'
import ViewerCrossRefs from './ViewerCrossRefs'
import ViewerCompare from './ViewerCompare'
import { renderMarkdownToHTML } from '@/components/notes/pm/staticRender'
import { ALL_PRESET_CLASSES } from '@/lib/themePresets'
import { applyThemeToDocument } from '@/lib/applyTheme'

// Fetch a note for displaying in the side panel or standalone
function useNote(noteId: string | undefined) {
  const [data, setData] = useState<{ title: string; html: string } | null>(null)
  // Re-render the preview when note-format / word-replacer settings change, or when the note
  // content itself changes in the main window (noteChangeToken, synced via viewer settings).
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  useEffect(() => {
    if (!noteId) { setData(null); return }
    window.notes.getNote(noteId).then((n: Note | null) => {
      if (!n) { setData(null); return }
      setData({ title: n.title ?? '', html: renderMarkdownToHTML(n.content ?? '') })
    }).catch(() => setData(null))
  }, [noteId, noteScriptureBlock, wordReplacerEnabled, wordReplacerRules, noteChangeToken])
  return data
}

function useLexicon(strongsId: string | undefined) {
  const [data, setData] = useState<LexiconEntry | null>(null)
  useEffect(() => {
    if (!strongsId) { setData(null); return }
    window.lexicon.getEntry(strongsId).then(setData).catch(() => setData(null))
  }, [strongsId])
  return data
}

function NoteView({ noteId, fontScale, muteColor, textColor, scrollRef, scrollPercent }: { noteId: string; fontScale: number; muteColor: string; textColor: string; scrollRef?: React.RefObject<HTMLDivElement>; scrollPercent?: number }) {
  const data = useNote(noteId)
  const localRef = useRef<HTMLDivElement>(null)
  const ref = scrollRef ?? localRef
  const fs = Math.round(14 * fontScale)
  // Mirror the main window's note scroll position (proportional).
  useEffect(() => {
    if (scrollPercent === undefined || scrollPercent === null) return
    const el = ref.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) el.scrollTop = scrollPercent * max
    })
    return () => cancelAnimationFrame(raf)
  }, [scrollPercent, data, ref])
  if (!data) return <div style={{ fontSize: fs, color: muteColor }} className="flex items-center justify-center h-full">Loading…</div>
  return (
    <div ref={ref} className="h-full overflow-y-auto px-8 pb-6 pt-12" style={{ fontSize: fs, color: textColor }}>
      {data.title && <h2 style={{ fontSize: Math.round(20 * fontScale), marginBottom: '1rem' }} className="font-semibold">{data.title}</h2>}
      <div style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: data.html }} />
    </div>
  )
}

function LexiconView({ strongsId, fontScale, muteColor, textColor, accentColor, scrollRef }: { strongsId: string; fontScale: number; muteColor: string; textColor: string; accentColor: string; scrollRef?: React.RefObject<HTMLDivElement> }) {
  const data = useLexicon(strongsId)
  const wrEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wrRules = useAppStore((s) => s.wordReplacerRules)
  const wr = (t: string) => (wrEnabled && wrRules.length > 0 ? applyWordReplacer(t, wrRules) : t)
  const fs = Math.round(14 * fontScale)
  const labelFs = Math.round(10 * fontScale)
  if (!data) return <div style={{ fontSize: fs, color: muteColor }} className="flex items-center justify-center h-full">{strongsId}</div>
  const isHebrew = data.strongsNum.startsWith('H')
  // Bare cross-reference numbers in the derivation are Strong's numbers — restore the H/G prefix.
  const lang: 'H' | 'G' = isHebrew ? 'H' : 'G'
  const sectionLabel = (t: string) => (
    <p style={{ fontSize: labelFs, color: muteColor, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>{t}</p>
  )
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8 pb-6 pt-12 space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span style={{ fontSize: Math.round(16 * fontScale), color: accentColor }} className="font-mono font-bold">{data.strongsNum}</span>
        {data.lemma && <span style={{ fontSize: Math.round(26 * fontScale), fontFamily: 'serif', color: textColor }} className="font-bold"><span dir="rtl">{data.lemma}</span></span>}
        {data.transliteration && <span style={{ fontSize: Math.round(14 * fontScale), color: muteColor }} className="italic">({data.transliteration})</span>}
      </div>
      {data.gloss && <p style={{ fontSize: Math.round(14 * fontScale), color: textColor }} className="font-medium">{wr(data.gloss)}</p>}
      {data.definition && (
        <div>
          {sectionLabel('Definition')}
          <p style={{ fontSize: fs, color: textColor, lineHeight: 1.7 }}>{wr(data.definition)}</p>
        </div>
      )}
      {data.derivation && (
        <div>
          {sectionLabel('Derivation')}
          <p style={{ fontSize: Math.round(13 * fontScale), color: muteColor, lineHeight: 1.6, fontStyle: 'italic' }}>{normalizeStrongsNums(wr(data.derivation), lang)}</p>
        </div>
      )}
      {data.extendedDef && (
        <div>
          {sectionLabel(isHebrew ? 'Brown-Driver-Briggs Notes' : 'Extended')}
          <p style={{ fontSize: Math.round(13 * fontScale), color: muteColor, lineHeight: 1.6 }}>{wr(data.extendedDef)}</p>
        </div>
      )}
    </div>
  )
}

export default function ViewerApp() {
  const [payload, setPayload] = useState<ViewerPayload>({ kind: 'idle' })
  // Side-panel visibility is controlled from the main window's PresenterControls (synced).
  const showSidePanel = useAppStore((s) => s.viewerSidePanelEnabled)
  const [hovered, setHovered] = useState(false)
  // Viewer-only highlights, keyed by chapter so they persist until the window closes.
  const [viewerHls, setViewerHls] = useState<Record<string, Record<number, ViewerHighlight[]>>>({})
  const hideOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidePanelScrollRef = useRef<HTMLDivElement>(null)
  const sidePanelScrollRAFRef = useRef<number | null>(null)
  // Live scroll percent pushed straight from IPC (see handleContent) so ViewerBiblePage's rAF
  // loop can apply it WITHOUT a React re-render — the render pipeline was the choppiness source.
  const viewerScrollPctRef = useRef<number | null>(null)
  // The `bookId:chapter` the pct above belongs to, so a stale pct isn't applied to a chapter
  // that has just changed under it.
  const viewerScrollTargetKeyRef = useRef<string>('')
  // Latest payload, readable inside the stable handleContent callback without adding it to deps.
  const payloadRef = useRef<ViewerPayload>({ kind: 'idle' })

  const storeScale = useAppStore((s) => s.viewerFontScale)
  const setViewerFontScale = useAppStore((s) => s.setViewerFontScale)
  const viewerTheme = useAppStore((s) => s.viewerTheme)
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const [localScale, setLocalScale] = useState(storeScale)

  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Sync local scale when store changes from outside
  useEffect(() => { setLocalScale(storeScale) }, [storeScale])

  // Belt-and-suspenders persistence of the presenter zoom on window close. setViewerFontScale
  // already writes the dedicated non-debounced 'berean-viewer-font-scale' key synchronously on
  // every change (and debouncedStorage.ts flushes the main blob on beforeunload), so this is a
  // final guard that the very latest localScale lands even if a render/commit race left the
  // store a step behind. No debounced writer is involved, so nothing extra needs flushing.
  useEffect(() => {
    const persistNow = () => {
      try { localStorage.setItem('berean-viewer-font-scale', JSON.stringify(localScale)) } catch { /* storage disabled/quota */ }
    }
    window.addEventListener('beforeunload', persistNow)
    return () => window.removeEventListener('beforeunload', persistNow)
  }, [localScale])

  // Apply theme classes to <html>. "Follow app" (viewerTheme === 'system', labeled that way in
  // Settings → Presenter) uses the same shared applyThemeToDocument App.tsx/FloatingShell.tsx
  // use, so the presenter window gets the exact same preset/animation/accent-color as the main
  // window — this used to be its own third hand-maintained copy of the preset class list (stuck
  // at the original 15 themes, plus a `system-accent` mishandling bug the shared version already
  // fixed), so anything added there since silently didn't apply here. A forced Light/Dark
  // override (the OTHER two viewerTheme options) deliberately still ignores the preset/animation
  // — that's for presenting on a projector with plain, predictable contrast regardless of
  // whatever colorful theme the main window happens to be on, not a bug to fix here.
  useEffect(() => {
    if (viewerTheme === 'system') {
      applyThemeToDocument({
        theme, themePreset, systemIsDark, systemAccentColor,
        backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity,
      })
      return
    }
    const html = document.documentElement
    ALL_PRESET_CLASSES.forEach((cls) => html.classList.remove(cls))
    html.classList.remove('theme-anim-bg')
    delete html.dataset.animStyle
    delete html.dataset.animIntensity
    html.style.removeProperty('--color-accent')
    const effectiveDark = viewerTheme === 'dark'
    html.classList.toggle('dark', effectiveDark)
    html.classList.toggle('light', !effectiveDark)
  }, [viewerTheme, theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity])

  // Keep the ref in sync every render so handleContent (stable, deps []) sees the latest payload.
  payloadRef.current = payload

  const handleContent = useCallback((raw: unknown) => {
    if (window.__bereanPresenterDebug) console.log('[PD viewer-receive] onContent payload', raw)
    const next = raw as ViewerPayload
    // Fast path: apply an incoming chapter scroll percent straight to a ref the ViewerBiblePage
    // rAF loop reads, bypassing React's render pipeline (setPayload → re-map every verse →
    // commit → effect → lerp), which is what made the presenter scroll choppy.
    if (next.kind === 'bible' && typeof next.scrollPercent === 'number') {
      viewerScrollPctRef.current = next.scrollPercent
      viewerScrollTargetKeyRef.current = `${next.bookId}:${next.chapter}`
    }
    // Skip the re-render when ONLY the chapter scroll position moved — the ref update above is
    // enough, the loop picks it up. Everything else (chapter nav, verse, annotations, side
    // panel, side-panel scroll, kind changes) still goes through setPayload. sidePanelScrollPercent
    // is deliberately NOT stripped here so side-panel scroll sync keeps working (more
    // conservative than the spec's "strip both").
    const cur = payloadRef.current
    const stripChapterScroll = (p: ViewerPayload) => {
      if (p.kind !== 'bible') return JSON.stringify(p)
      const { scrollPercent: _s, ...rest } = p
      return JSON.stringify(rest)
    }
    if (cur.kind !== 'bible' || next.kind !== 'bible' || stripChapterScroll(cur) !== stripChapterScroll(next)) {
      setPayload(next)
    }
  }, [])

  useEffect(() => {
    console.log('[ViewerApp] registering onContent listener')
    window.viewer?.onContent(handleContent)
    // Apply display/format settings pushed from the main window so the viewer renders
    // scripture/notes/lexicon identically (word replacer, note blocks, theme, idioms…).
    window.viewer?.onSettings?.((settings) => {
      console.log('[ViewerApp] viewer:settings received')
      useAppStore.setState(settings as Partial<ReturnType<typeof useAppStore.getState>>)
    })
    console.log('[ViewerApp] calling signalReady')
    window.viewer?.signalReady?.()
  }, [handleContent])

  // Apply side panel scroll percentage from main window
  useEffect(() => {
    if (payload.kind !== 'bible' || payload.sidePanelScrollPercent === undefined) return
    const pct = payload.sidePanelScrollPercent
    if (sidePanelScrollRAFRef.current) cancelAnimationFrame(sidePanelScrollRAFRef.current)
    sidePanelScrollRAFRef.current = requestAnimationFrame(() => {
      sidePanelScrollRAFRef.current = null
      const el = sidePanelScrollRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) el.scrollTop = pct * max
    })
  }, [payload])

  const changeScale = (delta: number) => {
    setLocalScale(prev => {
      const next = Math.max(0.5, Math.min(6, Math.round((prev + delta) * 8) / 8))
      setViewerFontScale(next)
      return next
    })
  }

  // Linger overlay 1s after mouse leaves
  const handleMouseEnter = () => {
    if (hideOverlayTimerRef.current) clearTimeout(hideOverlayTimerRef.current)
    setHovered(true)
  }
  const handleMouseLeave = () => {
    if (hideOverlayTimerRef.current) clearTimeout(hideOverlayTimerRef.current)
    hideOverlayTimerRef.current = setTimeout(() => setHovered(false), 1000)
  }

  const muteColor   = 'rgb(var(--color-text-muted, 120 120 140))'
  const textColor   = 'rgb(var(--color-text-primary, 220 220 230))'
  const accentColor = 'rgb(var(--color-accent, 100 130 200))'

  // ── Title (always visible in the top bar) for the primary content ──────────────
  const titleNote = useNote(payload.kind === 'note' ? payload.noteId : undefined)
  const titleLex = useLexicon(payload.kind === 'lexicon' ? payload.strongsId : undefined)
  let title = 'Berean'
  if (payload.kind === 'bible') title = `${hermasAwareChapterLabel(payload.bookId, payload.chapter, payload.textId)}${payload.textId === 'lxx' ? ' LXX' : ''}`
  else if (payload.kind === 'note') title = titleNote?.title || 'Note'
  else if (payload.kind === 'lexicon') title = `${titleLex?.strongsNum ?? payload.strongsId}${titleLex?.lemma ? ` · ${titleLex.lemma}` : ''}`
  else if (payload.kind === 'compare' && payload.columns[0]) title = `Compare — ${hermasAwareChapterLabel(payload.columns[0].bookId, payload.columns[0].chapter, payload.columns[0].textId)}`

  // ── Transient "flash" overlay: shows the content label big, then fades ─────────
  // Keyed to the content identity so it re-fires on each navigation (chapter/note/lexicon).
  const contentKey =
    payload.kind === 'bible' ? `b:${payload.bookId}:${payload.chapter}`
    : payload.kind === 'note' ? `n:${payload.noteId}`
    : payload.kind === 'lexicon' ? `l:${payload.strongsId}`
    : payload.kind === 'compare' ? `c:${payload.columns.map(c => `${c.textId}@${c.bookId}.${c.chapter}`).join('|')}`
    : 'idle'
  const [flashVisible, setFlashVisible] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (payload.kind === 'idle') return
    setFlashVisible(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashVisible(false), 1600)
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }
  }, [contentKey])

  // Derive side panel info from bible payload
  const bibleSidePanel: ViewerSidePanel | undefined =
    payload.kind === 'bible' ? payload.sidePanel : undefined

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ background: 'rgb(var(--color-surface-1))' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Title bar — the strip itself is fully clear (content shows through where there's no
          text); only a translucent pill sits behind the centered title for legibility.
          The whole strip stays draggable and clears the macOS traffic lights. */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center"
        style={{
          height: 34,
          paddingLeft: 78, // clear macOS traffic lights
          paddingRight: 16,
          WebkitAppRegion: 'drag',
          background: 'transparent',
        } as React.CSSProperties}
      >
        <span
          className="truncate"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: textColor,
            letterSpacing: '0.01em',
            maxWidth: '78%',
            padding: '2px 12px',
            borderRadius: 9999,
            // Translucent only behind the text — "almost see through it"
            background: 'rgb(var(--color-surface-2, 24 24 32) / 0.42)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgb(var(--color-surface-3, 50 50 70) / 0.45)',
          }}
        >
          {title}
        </span>
      </div>

      {/* Main content — fills the full height so scripture scrolls UNDER the translucent
          title bar (each scroll view adds its own top padding to clear the bar initially). */}
      <div className="flex h-full">

        {/* Primary content */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {payload.kind === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <style>{`@keyframes berean-idle-spin{to{transform:rotate(360deg)}}@keyframes berean-idle-breathe{0%,100%{opacity:.15;transform:scale(.92)}50%{opacity:.4;transform:scale(1.08)}}`}</style>
              <div
                className="font-serif"
                style={{ fontSize: Math.round(40 * localScale), color: 'rgb(var(--color-accent, 100 130 200))', animation: 'berean-idle-spin 9s linear infinite, berean-idle-breathe 3.2s ease-in-out infinite' }}
              >✦</div>
              <p style={{ fontSize: Math.round(14 * localScale), color: muteColor, animation: 'berean-idle-breathe 3.2s ease-in-out infinite' }}>Awaiting navigation…</p>
            </div>
          )}
          {payload.kind === 'bible' && (() => {
            const hlKey = `${payload.bookId}:${payload.chapter}:${payload.textId}`
            return (
              <ViewerBiblePage
                bookId={payload.bookId}
                chapter={payload.chapter}
                verse={payload.verse}
                textId={payload.textId}
                fontScale={localScale}
                scrollPercent={payload.scrollPercent}
                scrollPctRef={viewerScrollPctRef}
                scrollPctKeyRef={viewerScrollTargetKeyRef}
                hiddenAnnotations={payload.hiddenAnnotations}
                viewerHighlights={viewerHls[hlKey] ?? {}}
                onAddViewerHighlight={(verseNum, hl) => setViewerHls(prev => {
                  const chap = prev[hlKey] ?? {}
                  return { ...prev, [hlKey]: { ...chap, [verseNum]: [...(chap[verseNum] ?? []), hl] } }
                })}
                onRemoveViewerHighlight={(verseNum, sc, ec) => setViewerHls(prev => {
                  const chap = prev[hlKey] ?? {}
                  const verseHls = chap[verseNum] ?? []
                  // Drop any highlight overlapping the selected range.
                  const kept = verseHls.filter(h => !(h.startChar < ec && h.endChar > sc))
                  return { ...prev, [hlKey]: { ...chap, [verseNum]: kept } }
                })}
              />
            )
          })()}
          {payload.kind === 'note' && (
            <NoteView noteId={payload.noteId} fontScale={localScale} muteColor={muteColor} textColor={textColor} scrollPercent={payload.scrollPercent} />
          )}
          {payload.kind === 'lexicon' && (
            <LexiconView strongsId={payload.strongsId} fontScale={localScale} muteColor={muteColor} textColor={textColor} accentColor={accentColor} />
          )}
          {payload.kind === 'compare' && (
            <ViewerCompare columns={payload.columns} fontScale={localScale} scrollPercents={payload.scrollPercents} muteColor={muteColor} textColor={textColor} accentColor={accentColor} />
          )}
        </div>

        {/* Side panel (only for bible payloads with an active side panel) */}
        {payload.kind === 'bible' && bibleSidePanel && showSidePanel && (
          <div
            className="flex-shrink-0 h-full overflow-hidden"
            style={{
              width: '38%',
              borderLeft: '1px solid rgb(var(--color-surface-3, 50 50 70))',
              background: 'rgb(var(--color-surface-2, 24 24 32))',
            }}
          >
            {bibleSidePanel.type === 'note' && (
              <NoteView noteId={bibleSidePanel.noteId} fontScale={localScale} muteColor={muteColor} textColor={textColor} scrollRef={sidePanelScrollRef} />
            )}
            {bibleSidePanel.type === 'lexicon' && (
              <LexiconView strongsId={bibleSidePanel.strongsId} fontScale={localScale} muteColor={muteColor} textColor={textColor} accentColor={accentColor} scrollRef={sidePanelScrollRef} />
            )}
            {bibleSidePanel.type === 'crossrefs' && (
              <ViewerCrossRefs
                bookId={bibleSidePanel.bookId}
                chapter={bibleSidePanel.chapter}
                source={bibleSidePanel.source}
                activeVerse={bibleSidePanel.activeVerse}
                fontScale={localScale}
                muteColor={muteColor}
                textColor={textColor}
                accentColor={accentColor}
                scrollRef={sidePanelScrollRef}
              />
            )}
          </div>
        )}
      </div>

      {/* Transient content-label flash — appears on navigation, then fades. Lets the
          presenter audience see what's now showing even when scrolled past the header. */}
      {payload.kind !== 'idle' && (
        <div
          className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none"
          style={{
            top: 50,
            opacity: flashVisible ? 1 : 0,
            transition: 'opacity 600ms ease',
          }}
        >
          <div
            style={{
              padding: '8px 20px',
              borderRadius: 9999,
              background: 'rgba(0,0,0,0.62)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.12)',
              fontSize: Math.round(20 * localScale),
              fontWeight: 700,
              color: '#fff',
              maxWidth: '80%',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        </div>
      )}

      {/* Hover overlay — zoom + side panel toggle */}
      {hovered && (
        <div
          className="absolute bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-3 py-2 shadow-2xl"
          style={{
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            WebkitAppRegion: 'no-drag',
            border: '1px solid rgba(255,255,255,0.12)',
          } as React.CSSProperties}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Zoom controls (side-panel visibility is controlled from the main window) */}
          <button
            onClick={() => changeScale(-0.125)}
            className="w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.8)' }}
          >
            −
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', minWidth: 34, textAlign: 'center' }}>
            {Math.round(localScale * 100)}%
          </span>
          <button
            onClick={() => changeScale(0.125)}
            className="w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.8)' }}
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}
