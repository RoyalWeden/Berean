import { useState, useMemo, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, FileDown, Eye, ChevronDown, Plus, Minus } from 'lucide-react'
import { useAppStore } from '@/store'
import { buildPrintHTML, PRINT_THEMES, presetToSides } from '@/lib/notePreviewRender'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomExportEntry, type IdiomsExportOptions, type IdiomsOrganization, type IdiomsDensity, type IdiomsLayout } from '@/lib/idiomsExport'
import type { PrintThemeId } from '@/lib/notePreviewRender'
import type { Note } from '@/types'

interface Props {
  title: string
  content: string
  notes?: Note[]
  /** When provided, the modal is in "idioms" mode: it generates the content from these
   *  entries using in-modal idiom controls (so options can be tweaked while previewing). */
  idiomEntries?: IdiomExportEntry[]
  onClose: () => void
}

type Margin = 'none' | 'narrow' | 'normal' | 'wide' | 'custom'
type FontFam = 'system' | 'serif' | 'sansserif'
type ColorMode = 'color' | 'grayscale'
type Sides = { top: number; right: number; bottom: number; left: number }

/** Compact colour swatch showing a theme's background + verse-block accent. */
function ThemeSwatch({ th, size = 'md' }: { th: (typeof PRINT_THEMES)[PrintThemeId]; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 20 : 26
  return (
    <span
      className="flex-shrink-0 rounded border overflow-hidden"
      style={{ width: dim, height: dim, background: th.bg, borderColor: th.h2Border }}
    >
      <span className="block w-full" style={{ height: size === 'sm' ? 5 : 7, background: th.verseBorder }} />
      <span className="block mx-0.5 mt-0.5 rounded-sm" style={{ height: size === 'sm' ? 3 : 4, background: th.verseBg === 'transparent' ? th.h2Border : th.verseBg }} />
    </span>
  )
}

const PAGE_W_PX = 816 // US Letter width: 8.5in @ 96dpi

/**
 * Renders print HTML at true page width (8.5in) then scales it down to fit the
 * container, so margins/layout are PROPORTIONALLY ACCURATE (unlike a width:100%
 * iframe which exaggerates inch-based padding). Auto-heights to content; the page
 * is scrolling="no" so it never shows its own scrollbar.
 */
export function ScaledPagePreview({ html, maxHeight = 360 }: { html: string; maxHeight?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0.5)
  const [contentH, setContentH] = useState(1056)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / PAGE_W_PX)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function syncHeight() {
    const doc = iframeRef.current?.contentWindow?.document
    if (doc) setContentH(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight))
  }
  useEffect(() => { const id = setTimeout(syncHeight, 60); return () => clearTimeout(id) }, [html])

  const scaledH = Math.min(contentH * scale, maxHeight)
  return (
    <div
      ref={wrapRef}
      className="w-full overflow-hidden rounded-shell border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
      style={{ height: scaledH || 180 }}
    >
      <iframe
        ref={iframeRef}
        title="Print sample preview"
        srcDoc={html}
        onLoad={syncHeight}
        scrolling="no"
        style={{ width: PAGE_W_PX, height: contentH, border: 'none', transformOrigin: 'top left', transform: `scale(${scale})` }}
      />
    </div>
  )
}

/** 2×2 grid of per-side margin inputs (inches). Shared by the modal and Settings. */
export function CustomMarginInputs({
  value, onChange,
}: { value: Sides; onChange: (v: Sides) => void }) {
  const set = (side: keyof Sides) => (e: ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value)
    onChange({ ...value, [side]: isNaN(n) ? 0 : Math.max(0, Math.min(4, n)) })
  }
  const field = (side: keyof Sides, label: string) => (
    <label className="flex items-center gap-1">
      <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-9 flex-shrink-0">{label}</span>
      <input
        type="number" min={0} max={4} step={0.25} value={value[side]}
        onChange={set(side)}
        className="w-full min-w-0 px-1.5 py-1 text-xs text-center rounded border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-shrink-0">in</span>
    </label>
  )
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-2">
      {field('top', 'Top')}
      {field('bottom', 'Bottom')}
      {field('left', 'Left')}
      {field('right', 'Right')}
    </div>
  )
}

export default function PrintPreviewModal({ title, content, notes, idiomEntries, onClose }: Props) {
  // Was `useAppStore()` (whole-store subscription — re-renders this modal on ANY store
  // change app-wide). Only `pdfDownloadLocation` is actually read reactively in the render
  // below; everything else here is either a one-time seed value for local state (read via
  // the non-reactive getState() snapshot, since useState's initializer only runs once
  // anyway) or a stable action function grabbed imperatively inside its own handler.
  const pdfDownloadLocation = useAppStore((s) => s.pdfDownloadLocation)
  const initialStore = useAppStore.getState()
  const [idiomOpts, setIdiomOpts] = useState<IdiomsExportOptions>(DEFAULT_IDIOMS_OPTIONS)

  // Live-editable local copies seeded from saved settings
  const [theme, setTheme] = useState<PrintThemeId>(initialStore.printTheme)
  const [margin, setMargin] = useState<Margin>(initialStore.printMarginPreset)
  const [customMargins, setCustomMargins] = useState<Sides>(initialStore.printCustomMargins)
  const [fontSize, setFontSize] = useState(initialStore.printFontSizePt)
  const [fontFamily, setFontFamily] = useState<FontFam>(initialStore.printFontFamily)
  const [colorMode, setColorMode] = useState<ColorMode>(initialStore.printColorMode)
  const [includeTitle, setIncludeTitle] = useState(initialStore.printIncludeTitle)
  const [includeLinkedNotes, setIncludeLinkedNotes] = useState(initialStore.printIncludeLinkedNotes)

  // Auto-size the preview iframe to its content so there's a single (outer) scrollbar.
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeHeight, setIframeHeight] = useState(1056) // 11in @ 96dpi initial

  // Preview zoom: fit-to-width by default (no horizontal scroll); user can zoom in/out.
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const [userZoom, setUserZoom] = useState<number | null>(null) // null = fit-to-width
  const [zoomEditing, setZoomEditing] = useState(false)
  const [zoomInputVal, setZoomInputVal] = useState('')
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const scale = userZoom ?? fitScale

  function calcFitScale(el: HTMLDivElement) {
    // p-4 = 16px each side (32 total). Extra 8px buffer ensures the scaled page
    // never triggers a horizontal scrollbar even with sub-pixel rounding.
    const avail = el.clientWidth - 32 - 8
    return Math.min(1, Math.max(0.2, avail / PAGE_W_PX))
  }

  // ResizeObserver fires when the element reaches its final size (including after dialog animations).
  // It fires immediately on observation if the element already has a non-zero size.
  useEffect(() => {
    const el = previewWrapRef.current
    if (!el) return
    const update = () => { if (el.clientWidth > 0) setFitScale(calcFitScale(el)) }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // Also try immediately in case the element already has its size
    update()
    return () => ro.disconnect()
  }, [])

  function commitZoomInput() {
    const n = parseInt(zoomInputVal, 10)
    if (!isNaN(n)) {
      const clamped = Math.max(50, Math.min(250, n))
      setUserZoom(clamped / 100)
    }
    setZoomEditing(false)
  }

  // Theme picker popover
  const [themeOpen, setThemeOpen] = useState(false)
  const themePickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!themeOpen) return
    function onDown(e: MouseEvent) {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) setThemeOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [themeOpen])

  const currentTheme = PRINT_THEMES[theme] ?? PRINT_THEMES.classic

  // Resolve wikilinks in content to their full note objects for linked-note printing.
  const resolvedLinkedNotes = useMemo(() => {
    if (!includeLinkedNotes || !notes) return undefined
    const wikilinkRe = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g
    const titles = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = wikilinkRe.exec(content)) !== null) titles.add(m[1].trim())
    return Array.from(titles)
      .map(t => notes.find(n => (n.title || 'Untitled').toLowerCase() === t.toLowerCase()))
      .filter((n): n is Note => n != null)
      .map(n => ({ title: n.title || 'Untitled', content: n.content }))
  }, [includeLinkedNotes, notes, content])

  // Idiom export builds its own standalone HTML (buildIdiomsExportHtml), not
  // markdown source — rawHtml tells buildPrintHTML to skip the markdown
  // parse step, which otherwise HTML-escapes the raw <div style="..."> tags
  // and prints them as visible tag soup (markdown-it runs with html:false).
  const opts = { theme, marginPreset: margin, customMargins, fontSize, fontFamily, includeTitle, colorMode, linkedNotes: resolvedLinkedNotes, rawHtml: !!idiomEntries }

  // In idioms mode, regenerate the body from the entries + in-modal options, colouring it to
  // match the chosen print theme so the preview updates live as the user tweaks settings.
  const effectiveContent = useMemo(() => {
    if (!idiomEntries) return content
    const th = PRINT_THEMES[theme] ?? PRINT_THEMES.classic
    return buildIdiomsExportHtml(idiomEntries, idiomOpts, { term: th.verseBorder, rule: th.h2Border, muted: th.verseRef })
  }, [idiomEntries, idiomOpts, theme, content])

  const html = useMemo(
    () => buildPrintHTML(title || 'Untitled', effectiveContent, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, effectiveContent, theme, margin, customMargins, fontSize, fontFamily, colorMode, includeTitle, resolvedLinkedNotes]
  )

  // Measure rendered content height and size the iframe to it (removes the iframe's own scrollbar)
  function syncIframeHeight() {
    const doc = iframeRef.current?.contentWindow?.document
    if (doc) setIframeHeight(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight))
  }
  useEffect(() => {
    // Re-measure shortly after the srcDoc updates (layout needs a tick to settle)
    const id = setTimeout(syncIframeHeight, 60)
    return () => clearTimeout(id)
  }, [html])

  function persist() {
    const store = useAppStore.getState()
    store.setPrintTheme(theme)
    store.setPrintMarginPreset(margin)
    store.setPrintCustomMargins(customMargins)
    store.setPrintFontSizePt(fontSize)
    store.setPrintFontFamily(fontFamily)
    store.setPrintColorMode(colorMode)
    store.setPrintIncludeTitle(includeTitle)
    store.setPrintIncludeLinkedNotes(includeLinkedNotes)
  }

  // Strip interactive styling (strongs chip spans) from the PDF/print output.
  // The preview keeps them for reference, but the exported document should be clean.
  function stripForExport(h: string) {
    return h.replace(/<span class="berean-strongs-chip"[^>]*>(.*?)<\/span>/g, '$1')
  }

  function doPrint() { persist(); window.app.printNote(stripForExport(html)).catch(() => {}); onClose() }
  function doDownload() { persist(); window.app.exportNotePDF(stripForExport(html), title || 'note', pdfDownloadLocation).catch(() => {}); onClose() }

  const segBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-shell cursor-pointer transition-colors ${active
      ? 'bg-[rgb(var(--color-accent))] text-white font-medium'
      : 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'}`
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5'

  const themeList = Object.values(PRINT_THEMES)

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" style={{ backdropFilter: 'blur(4px)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="glass-panel-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[90vw] max-w-5xl h-[85vh]
            rounded-shell-lg flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Eye size={15} className="text-[rgb(var(--color-accent))]" />
            <Dialog.Title className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Print preview</Dialog.Title>
            <span className="text-xs text-[rgb(var(--color-text-muted))] truncate">— {title || 'Untitled'}</span>
            <div className="flex-1" />
            <Dialog.Close className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Body: controls + preview */}
          <div className="flex-1 flex min-h-0">
            {/* Controls sidebar */}
            <div className="w-56 flex-shrink-0 border-r border-[rgb(var(--color-surface-4))] overflow-y-auto p-4 space-y-4">

              {/* ── Theme picker button + popover ── */}
              <div>
                <p className={labelCls}>Theme &amp; style</p>
                <div className="relative" ref={themePickerRef}>
                  <button
                    onClick={() => setThemeOpen(v => !v)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-shell border text-left cursor-pointer transition-colors ${
                      themeOpen
                        ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
                        : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))]'
                    }`}
                  >
                    <ThemeSwatch th={currentTheme} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-[rgb(var(--color-text-primary))]">{currentTheme.label}</span>
                      <span className="block text-[9px] text-[rgb(var(--color-text-muted))] truncate leading-tight">{currentTheme.desc}</span>
                    </span>
                    <ChevronDown size={13} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${themeOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Popover — 3-column grid of all themes */}
                  {themeOpen && (
                    <div
                      className="absolute left-0 right-0 top-full mt-1.5 z-50
                        bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))]
                        rounded-shell-lg shadow-2xl p-2 grid grid-cols-3 gap-1"
                    >
                      {themeList.map((th) => (
                        <button
                          key={th.id}
                          onClick={() => { setTheme(th.id); setFontFamily(th.suggestedFont); setThemeOpen(false) }}
                          title={th.desc}
                          className={`flex flex-col items-center gap-1 p-1.5 rounded-shell border cursor-pointer transition-colors text-center ${
                            theme === th.id
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                              : 'border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))]'
                          }`}
                        >
                          <ThemeSwatch th={th} size="sm" />
                          <span className="text-[9px] font-medium text-[rgb(var(--color-text-secondary))] leading-none">{th.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Margins */}
              <div>
                <p className={labelCls}>Margins</p>
                <div className="grid grid-cols-3 gap-1">
                  {(['none', 'narrow', 'normal', 'wide', 'custom'] as const).map((m) => (
                    <button key={m} onClick={() => {
                      if (m === 'custom' && margin !== 'custom') setCustomMargins(presetToSides(margin))
                      setMargin(m)
                    }} className={segBtn(margin === m)}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
                {margin === 'custom' && (
                  <CustomMarginInputs value={customMargins} onChange={setCustomMargins} />
                )}
              </div>

              {/* Font size */}
              <div>
                <p className={labelCls}>Font size — {fontSize}pt</p>
                <input type="range" min={8} max={18} step={1} value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full accent-[rgb(var(--color-accent))] cursor-pointer" />
              </div>

              {/* Font family */}
              <div>
                <p className={labelCls}>Font</p>
                <div className="flex flex-wrap gap-1">
                  {([['system', 'System'], ['serif', 'Serif'], ['sansserif', 'Sans']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setFontFamily(id)} className={segBtn(fontFamily === id)}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div>
                <p className={labelCls}>Color</p>
                <div className="flex gap-1">
                  {([['color', 'Color'], ['grayscale', 'Gray']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setColorMode(id)} className={segBtn(colorMode === id)}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Include title toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[rgb(var(--color-text-secondary))]">Include title</span>
                <button
                  onClick={() => setIncludeTitle(v => !v)}
                  className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer ${includeTitle ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${includeTitle ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {/* Include linked notes toggle — only shown when notes are available */}
              {!idiomEntries && notes && notes.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[rgb(var(--color-text-secondary))]">Include linked notes</span>
                  <button
                    onClick={() => setIncludeLinkedNotes(v => !v)}
                    className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer ${includeLinkedNotes ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${includeLinkedNotes ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              )}

              {/* Idiom-specific options — live-update the preview */}
              {idiomEntries && (
                <div className="flex flex-col gap-3 pt-2 border-t border-[rgb(var(--color-surface-4))]">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Idioms — include</span>
                    {([
                      ['includeMeaning',     'Definition'],
                      ['includeAliases',     'Aliases'],
                      ['includeExplanation', 'Explanation'],
                      ['includeCompare',     'Compare to'],
                      ['includeReferences',  'Scripture references'],
                    ] as [keyof IdiomsExportOptions, string][]).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-primary))] cursor-pointer">
                        <input type="checkbox" checked={Boolean(idiomOpts[key])} onChange={(e) => setIdiomOpts((o) => ({ ...o, [key]: e.target.checked }))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {([
                    ['Layout', 'layout', [['two-column', 'Two col'], ['single', 'Single']]],
                    ['Organize', 'organization', [['flat', 'Flat'], ['grouped', 'By letter'], ['contents', 'Contents']]],
                    ['Density', 'density', [['spacious', 'Spacious'], ['compact', 'Compact']]],
                  ] as [string, keyof IdiomsExportOptions, [string, string][]][]).map(([heading, key, choices]) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{heading}</span>
                      <div className="flex gap-1">
                        {choices.map(([val, label]) => (
                          <button
                            key={val}
                            onClick={() => setIdiomOpts((o) => ({ ...o, [key]: val as IdiomsLayout | IdiomsOrganization | IdiomsDensity }))}
                            className={segBtn(idiomOpts[key] === val) + ' flex-1 !text-[10px]'}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Preview — fits to width by default (no horizontal scroll); the iframe is
                sized to its content so it never shows its own (second) scrollbar. */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Zoom toolbar */}
              <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
                <button
                  title="Zoom out (10%)"
                  onClick={() => setUserZoom(Math.max(0.5, Math.round((scale * 100 - 10)) / 100))}
                  className="w-6 h-6 flex items-center justify-center rounded text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                >
                  <Minus size={13} />
                </button>
                {zoomEditing ? (
                  <input
                    ref={zoomInputRef}
                    type="number"
                    min={50}
                    max={250}
                    value={zoomInputVal}
                    onChange={(e) => setZoomInputVal(e.target.value)}
                    onBlur={commitZoomInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitZoomInput()
                      if (e.key === 'Escape') setZoomEditing(false)
                    }}
                    className="w-14 text-center text-[11px] tabular-nums rounded border border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] outline-none px-1 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                ) : (
                  <button
                    title="Click to set custom zoom (50%–250%)"
                    onClick={() => { setZoomInputVal(String(Math.round(scale * 100))); setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 10) }}
                    className="text-[11px] tabular-nums text-[rgb(var(--color-text-secondary))] w-12 text-center hover:bg-[rgb(var(--color-surface-4))] rounded cursor-pointer transition-colors px-1 py-0.5"
                  >
                    {Math.round(scale * 100)}%
                  </button>
                )}
                <button
                  title="Zoom in (10%)"
                  onClick={() => setUserZoom(Math.min(2.5, Math.round((scale * 100 + 10)) / 100))}
                  className="w-6 h-6 flex items-center justify-center rounded text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                >
                  <Plus size={13} />
                </button>
                <button
                  title="Fit to width"
                  onClick={() => {
                    // Recalculate from the live container size so the displayed % is always accurate.
                    const el = previewWrapRef.current
                    if (el) setFitScale(calcFitScale(el))
                    setUserZoom(null)
                  }}
                  className={`ml-1 px-2 h-6 flex items-center justify-center rounded text-[11px] cursor-pointer transition-colors ${
                    userZoom === null
                      ? 'bg-[rgb(var(--color-accent))] text-white'
                      : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  Fit
                </button>
              </div>
              <div ref={previewWrapRef} className={`flex-1 min-w-0 bg-[rgb(var(--color-surface-1))] p-4 overflow-y-auto ${userZoom === null ? 'overflow-x-hidden' : 'overflow-x-auto'}`}>
                {/* Page wrapper — includes the iframe and page-break overlay lines */}
                <div
                  className="shadow-xl rounded"
                  style={{ width: Math.floor(PAGE_W_PX * scale), height: Math.ceil(iframeHeight * scale), marginInline: 'auto', overflow: 'hidden', position: 'relative' }}
                >
                  <iframe
                    ref={iframeRef}
                    title="Print preview"
                    srcDoc={html}
                    onLoad={syncIframeHeight}
                    scrolling="no"
                    style={{
                      width: PAGE_W_PX,
                      height: iframeHeight,
                      border: 'none',
                      display: 'block',
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                  />
                  {/* Page break lines — rendered over the iframe so they're scale-accurate */}
                  {Array.from(
                    { length: Math.max(0, Math.ceil(iframeHeight / 1056) - 1) },
                    (_, i) => (i + 1) * 1056 * scale
                  ).map((y) => (
                    <div
                      key={y}
                      style={{
                        position: 'absolute',
                        top: Math.round(y) - 1,
                        left: 0,
                        right: 0,
                        height: 3,
                        background: 'rgba(80,80,80,0.45)',
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
              {pdfDownloadLocation ? `Saves to: ${pdfDownloadLocation}` : 'You\'ll be asked where to save'}
            </p>
            <div className="flex-1" />
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors">
              Cancel
            </button>
            <button onClick={doPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-shell bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors">
              <Printer size={13} /> Print
            </button>
            <button onClick={doDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-shell bg-[rgb(var(--color-accent))] text-white font-medium hover:opacity-90 cursor-pointer transition-opacity">
              <FileDown size={13} /> Download PDF
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
