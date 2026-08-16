import { useState, useMemo, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, FileDown, Eye, ChevronDown, Plus, Minus } from 'lucide-react'
import { useAppStore } from '@/store'
import { buildPrintHTML, PRINT_THEMES, presetToSides, PAPER_SIZE_ELECTRON, PAPER_SIZE_INCHES } from '@/lib/notePreviewRender'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomExportEntry, type IdiomsExportOptions, type IdiomsOrganization, type IdiomsDensity, type IdiomsLayout } from '@/lib/idiomsExport'
import type { PrintThemeId } from '@/lib/notePreviewRender'
import type { Note } from '@/types'
import { loadPdfFromBytes, type PDFDocumentProxy, type PDFPageProxy } from '@/lib/pdfjs'

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

/**
 * One page of a REAL generated PDF, rendered to a canvas via pdf.js — same canvas-render
 * pattern as PdfPage.tsx (the app's own PDF viewer), trimmed down (no text layer/highlights,
 * this is a preview, not an interactive document). Each page self-measures via
 * `page.getViewport()`, so its on-screen size is always exactly what the real PDF says —
 * never an estimate.
 */
function PreviewPdfPage({ doc, pageNumber, scale }: { doc: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    doc.getPage(pageNumber).then(async (page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale })
      setSize({ w: vp.width, h: vp.height })
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${vp.width}px`
      canvas.style.height = `${vp.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderTask = page.render({ canvasContext: ctx, viewport: vp })
      try {
        await renderTask.promise
      } catch {
        /* render cancellations are expected (rapid scale/page changes); other errors ignored
           — a blank canvas is a harmless failure mode for a preview */
      }
    }).catch(() => {})
    return () => { cancelled = true; try { renderTask?.cancel() } catch { /* ignore */ } }
  }, [doc, pageNumber, scale])

  return (
    <canvas
      ref={canvasRef}
      className="block shadow-xl rounded flex-shrink-0"
      style={{ width: size?.w, height: size?.h }}
    />
  )
}

const PAGE_W_PX = 816 // US Letter width: 8.5in @ 96dpi — fallback default; the main modal below
                       // computes its own paperSize-aware width (see pageWidthPx) since a
                       // hardcoded Letter width made the on-screen preview inaccurate for
                       // anyone using A4/Legal. ScaledPagePreview (Settings' small sample
                       // preview) still uses this fixed fallback — lower-stakes, cosmetic-only.

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
  // No in-modal picker for this (yet) — it's set in Settings → Print & Export
  // (PrintExportSection.tsx) and just needs to actually reach the export pipeline, which it
  // previously didn't at all (a real no-op bug: changing Letter/A4/Legal in Settings never
  // affected anything). Read reactively so it stays correct if changed while this is open.
  const printPaperSize = useAppStore((s) => s.printPaperSize)
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

  // Regression: this used to be the hardcoded module-level PAGE_W_PX (always Letter width)
  // regardless of the actual paperSize setting — the on-screen preview's page width silently
  // disagreed with A4/Legal output. Paired with buildPrintHTML's own paperSize plumbing.
  // Still used as the pre-load layout guess (spinner sizing, initial fit calc) before the
  // real PDF below has loaded — once it has, actual per-page pixel dimensions come from
  // pdf.js's own getViewport(), not this estimate.
  const pageWidthPx = Math.round((PAPER_SIZE_INCHES[printPaperSize] ?? PAPER_SIZE_INCHES.letter).w * 96)
  const pageHeightPx = Math.round((PAPER_SIZE_INCHES[printPaperSize] ?? PAPER_SIZE_INCHES.letter).h * 96)

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
    return Math.min(1, Math.max(0.2, avail / pageWidthPx))
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
  const opts = { theme, marginPreset: margin, customMargins, fontSize, fontFamily, includeTitle, colorMode, linkedNotes: resolvedLinkedNotes, rawHtml: !!idiomEntries, paperSize: printPaperSize }

  // In idioms mode, regenerate the body from the entries + in-modal options, colouring it to
  // match the chosen print theme so the preview updates live as the user tweaks settings.
  const effectiveContent = useMemo(() => {
    if (!idiomEntries) return content
    const th = PRINT_THEMES[theme] ?? PRINT_THEMES.classic
    return buildIdiomsExportHtml(idiomEntries, idiomOpts, { term: th.verseBorder, rule: th.h2Border, muted: th.verseRef })
  }, [idiomEntries, idiomOpts, theme, content])

  // Strip interactive styling (Strong's chip spans) — the live editor's chip look (monospace,
  // bold, colored background) is appropriate on-screen but not on a printed/exported page
  // where nothing is clickable. This used to be applied ONLY at doPrint/doDownload time, so
  // the on-screen preview showed styled chips the real output never had — a direct, visible
  // preview/output mismatch, and a text-reflow difference that could shift line wraps and
  // page-break positions between what was previewed and what actually printed. Now applied
  // once, here, so the iframe preview and the real output are always built from the exact
  // same HTML — "the print preview needs to be accurate always" means never diverging on
  // content, not just on page dimensions.
  function stripForExport(h: string) {
    return h.replace(/<span class="berean-strongs-chip"[^>]*>(.*?)<\/span>/g, '$1')
  }

  const html = useMemo(
    () => stripForExport(buildPrintHTML(title || 'Untitled', effectiveContent, opts)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, effectiveContent, theme, margin, customMargins, fontSize, fontFamily, colorMode, includeTitle, resolvedLinkedNotes, printPaperSize]
  )

  // Passed alongside the HTML's own @page CSS size (buildPrintHTML) as belt-and-suspenders —
  // honoring @page CSS `size` for page dimensions isn't guaranteed without Electron's
  // preferCSSPageSize option, so the native `pageSize` param is the actually-authoritative one.
  const electronPageSize = PAPER_SIZE_ELECTRON[printPaperSize] ?? PAPER_SIZE_ELECTRON.letter

  // ── Real-PDF preview ─────────────────────────────────────────────────────────
  // Regression fix: the preview used to be a client-side approximation — one continuous
  // scaled iframe, sliced into fixed-height "page" windows by dividing pixel height, with no
  // real per-page margin reservation and no awareness of `page-break-inside: avoid`. That's
  // structurally incapable of matching the real output: a normal HTML document rendered
  // on-screen doesn't paginate at all (CSS `@page`/break rules only take effect during actual
  // print/PDF generation), so no amount of client-side slicing can correctly predict where
  // margins repeat or where a block gets pushed whole to the next page. Generating the real
  // PDF (electron/main.ts's app:renderPreviewPDF, sharing the exact same code path as the
  // actual Export-PDF button) and rendering ITS pages via pdf.js makes this a non-issue by
  // construction: the preview literally IS the document that would be saved/printed, not an
  // approximation of it — margins, page breaks, and image placement are pixel-identical.
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)
  // Regression fix ("shows a block for a second"): the debounce delay used to apply to the
  // VERY FIRST generation too — opening the modal always waited a fixed 350ms doing nothing
  // before even starting the (already-latent) PDF round trip. Debouncing only matters for
  // settling a BURST of rapid settings changes; the first generation has nothing to debounce
  // against, so it fires immediately. main.ts's app:renderPreviewPDF also got its own latency
  // cut (a reused hidden window instead of a fresh one, a data: URL instead of a temp-file
  // round trip, and waiting on real font-load completion instead of a blind 300ms guess).
  const hasGeneratedOnceRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    setPdfLoading(true)
    const delay = hasGeneratedOnceRef.current ? 350 : 0
    const id = setTimeout(() => {
      hasGeneratedOnceRef.current = true
      window.app.renderPreviewPDF(html, electronPageSize)
        .then((bytes) => loadPdfFromBytes(bytes))
        .then((doc) => { if (!cancelled) { setPdfDoc(doc); setPdfError(null); setPdfLoading(false) } })
        .catch((e) => { if (!cancelled) { setPdfError(String(e)); setPdfLoading(false) } })
    }, delay)
    return () => { cancelled = true; clearTimeout(id) }
  }, [html, electronPageSize])

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

  // `html` is already stripped (see the useMemo above) — printed/exported now, so it's
  // byte-identical to what was just shown in the preview.
  function doPrint() { persist(); window.app.printNote(html, electronPageSize).catch(() => {}); onClose() }
  function doDownload() { persist(); window.app.exportNotePDF(html, title || 'note', pdfDownloadLocation, electronPageSize).catch(() => {}); onClose() }

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
          // Was max-w-5xl (1024px) — with the 224px controls sidebar plus padding, the
          // preview pane never had more than ~760px available, LESS than an 8.5in Letter
          // page at 96dpi (816px). True 100% zoom therefore ALWAYS needed horizontal
          // scrolling, on any window size, which is what "the 100% zoom is too close" was
          // reporting. Widened so a true 100%-zoom Letter/Legal page (816px) comfortably
          // fits the preview pane without scrolling on any normal window.
          className="glass-panel-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[90vw] max-w-[1400px] h-[85vh]
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

            {/* Preview — fits to width by default (no horizontal scroll); renders the real
                generated PDF via pdf.js (see the pdfDoc effect above). */}
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
              {/*
                Regression fix: `overflow-x-hidden` in Fit mode had NO escape hatch — if
                `fitScale` was ever even slightly too large for the real available width (a
                real race: the ResizeObserver correction runs in a useEffect, after first
                paint), the page's right edge rendered outside the clipped, non-scrollable
                container and was permanently unreachable — "can't see part of the right
                edge... even after scrolling" is exactly what a *disabled* scrollbar looks
                like. Always keeping horizontal scroll available costs nothing when the fit
                calculation IS correct (no overflow, nothing to scroll) and is the only real
                fix for when it briefly isn't.
              */}
              <div ref={previewWrapRef} className="flex-1 min-w-0 bg-[rgb(var(--color-surface-2))] p-4 overflow-auto">
                {/*
                  Regression fix: this used to be a client-side approximation — one continuous
                  scaled iframe sliced into fixed-height "page" windows purely by dividing
                  pixel height. A normal HTML document rendered on-screen never actually
                  paginates (CSS @page/break rules only apply during real print/PDF
                  generation), so that slicing had no way to know where margins really repeat
                  or where a block (image, table, verse block) gets pushed whole to the next
                  page instead of being split. It now renders the REAL generated PDF (pdfDoc,
                  from app:renderPreviewPDF — the exact same code path as the actual
                  Export-PDF button) via pdf.js, one canvas per real page: margins, page
                  breaks, and "does this get cut off" are no longer guessed, they're read
                  directly off the document that would actually be saved/printed.
                */}
                {pdfDoc ? (
                  <div className="flex flex-col items-center gap-6">
                    {Array.from({ length: pdfDoc.numPages }, (_, i) => (
                      <PreviewPdfPage key={i} doc={pdfDoc} pageNumber={i + 1} scale={scale * (96 / 72)} />
                    ))}
                  </div>
                ) : (
                  // First load ONLY — the real PDF round trip (offscreen window, printToPDF,
                  // IPC transfer, pdf.js decode) has an unavoidable floor of a few hundred ms
                  // no matter how much it's optimized (main.ts's app:renderPreviewPDF already
                  // reuses one hidden window and skips the temp-file/blind-delay steps used by
                  // the real Export-PDF path). A blank/colored placeholder for that whole
                  // window reads as "stuck" ("shows blank for a second"). This is instead a
                  // real, INSTANT render of the SAME html the real PDF is being built from —
                  // a plain non-paginated iframe, not yet split into real pages/margins-per-
                  // page (that accuracy is what the real PDF above is FOR) — shown only until
                  // the first real PDF arrives, then never shown again for the rest of this
                  // modal's lifetime (pdfDoc stays populated across later regenerations, see
                  // the debounced effect above, so this never reappears on a settings tweak).
                  <div
                    className="mx-auto shadow-xl rounded overflow-hidden relative"
                    style={{ width: Math.ceil(pageWidthPx * scale), height: Math.ceil(pageHeightPx * scale), background: currentTheme.bg }}
                  >
                    <iframe
                      title="Print preview (loading exact pagination…)"
                      srcDoc={html}
                      scrolling="no"
                      style={{
                        width: pageWidthPx,
                        height: pageHeightPx,
                        border: 'none',
                        display: 'block',
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                      }}
                    />
                    {pdfError && (
                      <div className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] text-center bg-black/60 text-white">
                        Preview failed: {pdfError}
                      </div>
                    )}
                  </div>
                )}
                {pdfLoading && pdfDoc && (
                  <div className="fixed bottom-20 right-8 px-2.5 py-1 rounded-shell bg-[rgb(var(--color-surface-4))] text-[10px] text-[rgb(var(--color-text-secondary))] shadow-lg pointer-events-none">
                    Updating preview…
                  </div>
                )}
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
