import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/store'
import { bookName } from '@/lib/parseRef'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { ViewerPayload, ViewerSidePanel } from '@/types/viewer'
import type { Note, LexiconEntry } from '@/types'
import ViewerBiblePage from './ViewerBiblePage'
import ViewerCrossRefs from './ViewerCrossRefs'
import { renderPreviewContent } from '@/components/notes/NoteEditor'

const ALL_PRESETS = [
  'theme-neon','theme-midnight','theme-bible','theme-forest','theme-royal',
  'theme-ember','theme-ocean','theme-slate','theme-rose','theme-terminal','theme-sand','theme-obsidian',
  'theme-ivory','theme-arctic','theme-dawn',
  'theme-neon-light','theme-midnight-light','theme-obsidian-light','theme-forest-light',
  'theme-royal-light','theme-ember-light','theme-ocean-light','theme-slate-light','theme-terminal-light',
  'theme-bible-dark','theme-sand-dark','theme-rose-dark','theme-ivory-dark','theme-arctic-dark','theme-dawn-dark',
]
const NATURALLY_DARK = new Set([
  'theme-neon','theme-midnight','theme-obsidian','theme-forest',
  'theme-royal','theme-ember','theme-ocean','theme-slate','theme-terminal',
])

// Fetch a note for displaying in the side panel or standalone
function useNote(noteId: string | undefined) {
  const [data, setData] = useState<{ title: string; html: string } | null>(null)
  // Re-render the preview when note-format / word-replacer settings change (synced from main)
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  useEffect(() => {
    if (!noteId) { setData(null); return }
    window.notes.getNote(noteId).then((n: Note | null) => {
      if (!n) { setData(null); return }
      setData({ title: n.title ?? '', html: renderPreviewContent(n.content ?? '') })
    }).catch(() => setData(null))
  }, [noteId, noteScriptureBlock, wordReplacerEnabled, wordReplacerRules])
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

function NoteView({ noteId, fontScale, muteColor, textColor, scrollRef }: { noteId: string; fontScale: number; muteColor: string; textColor: string; scrollRef?: React.RefObject<HTMLDivElement> }) {
  const data = useNote(noteId)
  const fs = Math.round(14 * fontScale)
  if (!data) return <div style={{ fontSize: fs, color: muteColor }} className="flex items-center justify-center h-full">Loading…</div>
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8 pb-6 pt-12" style={{ fontSize: fs, color: textColor }}>
      {data.title && <h2 style={{ fontSize: Math.round(20 * fontScale), marginBottom: '1rem' }} className="font-semibold">{data.title}</h2>}
      <div className="note-preview-content" style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: data.html }} />
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
          <p style={{ fontSize: Math.round(13 * fontScale), color: muteColor, lineHeight: 1.6, fontStyle: 'italic' }}>{wr(data.derivation)}</p>
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
  const [showSidePanel, setShowSidePanel] = useState(true)
  const [hovered, setHovered] = useState(false)
  const hideOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidePanelScrollRef = useRef<HTMLDivElement>(null)
  const sidePanelScrollRAFRef = useRef<number | null>(null)

  const storeScale = useAppStore((s) => s.viewerFontScale)
  const setViewerFontScale = useAppStore((s) => s.setViewerFontScale)
  const viewerTheme = useAppStore((s) => s.viewerTheme)
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
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

  // Apply theme classes to <html>
  useEffect(() => {
    const html = document.documentElement
    ALL_PRESETS.forEach((cls) => html.classList.remove(cls))
    const baseIsDark = theme === 'system' ? systemIsDark : theme === 'dark'
    const effectiveDark = viewerTheme === 'system' ? baseIsDark : viewerTheme === 'dark'
    if (viewerTheme === 'system' && themePreset) {
      const baseId = themePreset.replace(/-(?:dark|light)$/, '')
      html.classList.remove('dark', 'light')
      const isNatDark = NATURALLY_DARK.has(baseId)
      html.classList.add(isNatDark
        ? (effectiveDark ? baseId : `${baseId}-light`)
        : (effectiveDark ? `${baseId}-dark` : baseId)
      )
    } else {
      html.classList.toggle('dark', effectiveDark)
      html.classList.toggle('light', !effectiveDark)
    }
  }, [viewerTheme, theme, themePreset, systemIsDark])

  const handleContent = useCallback((raw: unknown) => {
    console.log('[ViewerApp] handleContent called with:', JSON.stringify(raw))
    setPayload(raw as ViewerPayload)
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
      const next = Math.max(0.5, Math.min(3, Math.round((prev + delta) * 8) / 8))
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
  if (payload.kind === 'bible') title = `${bookName(payload.bookId)} ${payload.chapter}${payload.textId === 'lxx' ? ' LXX' : ''}`
  else if (payload.kind === 'note') title = titleNote?.title || 'Note'
  else if (payload.kind === 'lexicon') title = `${titleLex?.strongsNum ?? payload.strongsId}${titleLex?.lemma ? ` · ${titleLex.lemma}` : ''}`

  // ── Transient "flash" overlay: shows the content label big, then fades ─────────
  // Keyed to the content identity so it re-fires on each navigation (chapter/note/lexicon).
  const contentKey =
    payload.kind === 'bible' ? `b:${payload.bookId}:${payload.chapter}`
    : payload.kind === 'note' ? `n:${payload.noteId}`
    : payload.kind === 'lexicon' ? `l:${payload.strongsId}`
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

  // Auto-reveal the side panel whenever one appears (e.g. opening the presenter while a
  // side panel is already open in the main window). Hiding it stays a manual user choice.
  const hadSidePanelRef = useRef(false)
  useEffect(() => {
    if (bibleSidePanel && !hadSidePanelRef.current) setShowSidePanel(true)
    hadSidePanelRef.current = !!bibleSidePanel
  }, [bibleSidePanel])

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
              <div className="opacity-20 font-serif" style={{ fontSize: Math.round(32 * localScale), color: muteColor }}>✦</div>
              <p style={{ fontSize: Math.round(14 * localScale), color: muteColor }}>Awaiting navigation…</p>
            </div>
          )}
          {payload.kind === 'bible' && (
            <ViewerBiblePage
              bookId={payload.bookId}
              chapter={payload.chapter}
              verse={payload.verse}
              textId={payload.textId}
              fontScale={localScale}
              scrollPercent={payload.scrollPercent}
            />
          )}
          {payload.kind === 'note' && (
            <NoteView noteId={payload.noteId} fontScale={localScale} muteColor={muteColor} textColor={textColor} />
          )}
          {payload.kind === 'lexicon' && (
            <LexiconView strongsId={payload.strongsId} fontScale={localScale} muteColor={muteColor} textColor={textColor} accentColor={accentColor} />
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
          {/* Side panel toggle — only show if a side panel exists */}
          {payload.kind === 'bible' && bibleSidePanel && (
            <>
              <button
                onClick={() => setShowSidePanel(p => !p)}
                className="text-xs px-2 py-0.5 rounded-full transition-all"
                style={{
                  color: showSidePanel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)',
                  background: showSidePanel ? 'rgba(255,255,255,0.15)' : 'transparent',
                }}
                title={showSidePanel ? 'Hide side panel' : 'Show side panel'}
              >
                {bibleSidePanel.type === 'note' ? '📝' : bibleSidePanel.type === 'crossrefs' ? '🔗' : '📖'} {showSidePanel ? 'Hide' : 'Show'}
              </button>
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
            </>
          )}

          {/* Zoom controls */}
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
