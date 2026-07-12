import { useState, useEffect, useRef } from 'react'
import { Printer, ChevronDown, FolderOpen, X, Eye } from 'lucide-react'
import { buildPrintHTML, PRINT_THEMES, presetToSides } from '@/components/notes/NoteEditor'
import { ScaledPagePreview, CustomMarginInputs } from '@/components/notes/PrintPreviewModal'
import Switch from '@/components/shell/Switch'
import { useAppStore } from '@/store'

const PRINT_PRESETS: { id: 'compact' | 'standard' | 'spacious' | 'manuscript'; label: string; desc: string;
  margin: 'none' | 'narrow' | 'normal' | 'wide'; fontSize: number; fontFamily: 'system' | 'serif' | 'sansserif' }[] = [
  { id: 'compact',    label: 'Compact',    desc: 'Narrow margins, 10pt sans — fit more per page', margin: 'narrow', fontSize: 10, fontFamily: 'sansserif' },
  { id: 'standard',   label: 'Standard',   desc: 'Normal margins, 12pt system font',               margin: 'normal', fontSize: 12, fontFamily: 'system' },
  { id: 'spacious',   label: 'Spacious',   desc: 'Wide margins, 13pt — easy reading',              margin: 'wide',   fontSize: 13, fontFamily: 'system' },
  { id: 'manuscript', label: 'Manuscript', desc: 'Wide margins, 13pt serif — study printout',      margin: 'wide',   fontSize: 13, fontFamily: 'serif' },
]

export default function PrintExportSection() {
  const printMarginPreset    = useAppStore((s) => s.printMarginPreset)
  const printCustomMargins   = useAppStore((s) => s.printCustomMargins)
  const printFontSizePt      = useAppStore((s) => s.printFontSizePt)
  const printFontFamily      = useAppStore((s) => s.printFontFamily)
  const printPaperSize       = useAppStore((s) => s.printPaperSize)
  const printIncludeTitle    = useAppStore((s) => s.printIncludeTitle)
  const printColorMode       = useAppStore((s) => s.printColorMode)
  const printTheme           = useAppStore((s) => s.printTheme)
  const pdfDownloadLocation  = useAppStore((s) => s.pdfDownloadLocation)
  const setPrintMarginPreset = useAppStore((s) => s.setPrintMarginPreset)
  const setPrintCustomMargins = useAppStore((s) => s.setPrintCustomMargins)
  const setPrintFontSizePt   = useAppStore((s) => s.setPrintFontSizePt)
  const setPrintFontFamily   = useAppStore((s) => s.setPrintFontFamily)
  const setPrintPaperSize    = useAppStore((s) => s.setPrintPaperSize)
  const setPrintIncludeTitle = useAppStore((s) => s.setPrintIncludeTitle)
  const setPrintColorMode    = useAppStore((s) => s.setPrintColorMode)
  const setPrintTheme        = useAppStore((s) => s.setPrintTheme)
  const setPdfDownloadLocation = useAppStore((s) => s.setPdfDownloadLocation)

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
  const currentTheme = PRINT_THEMES[printTheme] ?? PRINT_THEMES.classic

  // Which preset (if any) matches the current granular settings
  const activePreset = PRINT_PRESETS.find(p =>
    p.margin === printMarginPreset && p.fontSize === printFontSizePt && p.fontFamily === printFontFamily
  )

  function applyPreset(p: typeof PRINT_PRESETS[number]) {
    setPrintMarginPreset(p.margin)
    setPrintFontSizePt(p.fontSize)
    setPrintFontFamily(p.fontFamily)
  }

  const SAMPLE = `# Sample Note

Genesis 1:1 In the **beginning** Yehovah created the heavens and the earth

- A *formatted* list item
- [x] A completed task

> [!NOTE] Callout
> Keep the **Sabbath** holy.`

  const previewHtml = buildPrintHTML('Sample Note', SAMPLE, {
    theme: printTheme, marginPreset: printMarginPreset, customMargins: printCustomMargins,
    fontSize: printFontSizePt, fontFamily: printFontFamily,
    includeTitle: printIncludeTitle, colorMode: printColorMode,
  })

  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5'
  const segBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${active
      ? 'bg-[rgb(var(--color-accent))] text-white font-medium'
      : 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'}`

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Printer size={14} className="text-[rgb(var(--color-text-muted))]" />
        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Print &amp; Export</p>
      </div>
      <p className="text-xs text-[rgb(var(--color-text-muted))] -mt-3">
        Controls how notes look when printed or exported to PDF. Applies to the Print and Export-PDF buttons in the notes editor.
      </p>

      {/* Presets */}
      <div>
        <p className={labelCls}>Presets</p>
        <div className="grid grid-cols-2 gap-2">
          {PRINT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                activePreset?.id === p.id
                  ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                  : 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] hover:border-[rgb(var(--color-accent))/50]'
              }`}
            >
              <div className="text-xs font-medium text-[rgb(var(--color-text-primary))]">{p.label}</div>
              <div className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 leading-snug">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Theme & style — button + popover grid */}
      <div>
        <p className={labelCls}>Theme &amp; style</p>
        <div className="relative" ref={themePickerRef}>
          <button
            onClick={() => setThemeOpen(v => !v)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
              themeOpen
                ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
                : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))]'
            }`}
          >
            <span className="w-6 h-6 rounded flex-shrink-0 border overflow-hidden" style={{ background: currentTheme.bg, borderColor: currentTheme.h2Border }}>
              <span className="block w-full h-1.5" style={{ background: currentTheme.verseBorder }} />
              <span className="block mx-0.5 mt-1 h-1 rounded" style={{ background: currentTheme.verseBg === 'transparent' ? currentTheme.h2Border : currentTheme.verseBg }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-[rgb(var(--color-text-primary))]">{currentTheme.label}</span>
              <span className="block text-[9px] text-[rgb(var(--color-text-muted))] truncate leading-tight">{currentTheme.desc}</span>
            </span>
            <ChevronDown size={13} className={`flex-shrink-0 text-[rgb(var(--color-text-muted))] transition-transform ${themeOpen ? 'rotate-180' : ''}`} />
          </button>

          {themeOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl p-2 grid grid-cols-3 gap-1 max-h-72 overflow-y-auto">
              {Object.values(PRINT_THEMES).map((th) => (
                <button
                  key={th.id}
                  onClick={() => { setPrintTheme(th.id); setPrintFontFamily(th.suggestedFont); setThemeOpen(false) }}
                  title={th.desc}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border cursor-pointer transition-colors text-center ${
                    printTheme === th.id
                      ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                      : 'border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))]'
                  }`}
                >
                  <span className="w-5 h-5 rounded flex-shrink-0 border overflow-hidden" style={{ background: th.bg, borderColor: th.h2Border }}>
                    <span className="block w-full" style={{ height: 5, background: th.verseBorder }} />
                    <span className="block mx-0.5 mt-0.5 rounded-sm" style={{ height: 3, background: th.verseBg === 'transparent' ? th.h2Border : th.verseBg }} />
                  </span>
                  <span className="text-[9px] font-medium text-[rgb(var(--color-text-secondary))] leading-none">{th.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live preview — scaled to true page proportions so margins look accurate */}
      <div>
        <p className={labelCls}>Live preview</p>
        <ScaledPagePreview html={previewHtml} />
      </div>

      {/* Margins */}
      <div>
        <p className={labelCls}>Margins</p>
        <div className="flex flex-wrap gap-1.5">
          {(['none', 'narrow', 'normal', 'wide', 'custom'] as const).map((m) => (
            <button key={m} onClick={() => {
              if (m === 'custom' && printMarginPreset !== 'custom') setPrintCustomMargins(presetToSides(printMarginPreset))
              setPrintMarginPreset(m)
            }} className={segBtn(printMarginPreset === m)}>
              {m === 'none' ? 'None' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {printMarginPreset === 'custom' && (
          <CustomMarginInputs value={printCustomMargins} onChange={setPrintCustomMargins} />
        )}
      </div>

      {/* Font size */}
      <div>
        <p className={labelCls}>Font size — {printFontSizePt}pt</p>
        <input
          type="range" min={8} max={18} step={1} value={printFontSizePt}
          onChange={(e) => setPrintFontSizePt(parseInt(e.target.value))}
          className="w-full accent-[rgb(var(--color-accent))] cursor-pointer"
        />
      </div>

      {/* Font family */}
      <div>
        <p className={labelCls}>Font family</p>
        <div className="flex gap-1.5">
          {([['system', 'System'], ['serif', 'Serif'], ['sansserif', 'Sans-serif']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setPrintFontFamily(id)} className={segBtn(printFontFamily === id)}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Paper size */}
      <div>
        <p className={labelCls}>Paper size</p>
        <div className="flex gap-1.5">
          {([['letter', 'Letter'], ['a4', 'A4'], ['legal', 'Legal']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setPrintPaperSize(id)} className={segBtn(printPaperSize === id)}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Color mode */}
      <div>
        <p className={labelCls}>Color</p>
        <div className="flex gap-1.5">
          {([['color', 'Color'], ['grayscale', 'Grayscale']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setPrintColorMode(id)} className={segBtn(printColorMode === id)}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Include title toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[rgb(var(--color-text-primary))]">Include note title</p>
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5">Print the note title as a heading at the top</p>
        </div>
        <Switch checked={printIncludeTitle} onCheckedChange={() => setPrintIncludeTitle(!printIncludeTitle)} />
      </div>

      {/* Default download location */}
      <div>
        <p className={labelCls}>Default download location</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={pdfDownloadLocation}
            onChange={(e) => setPdfDownloadLocation(e.target.value)}
            placeholder="Ask each time (system default)"
            className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
          />
          <button
            onClick={async () => { const picked = await window.app.openFolderDialog(); if (picked) setPdfDownloadLocation(picked) }}
            title="Choose folder"
            className="p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
          >
            <FolderOpen size={14} />
          </button>
          {pdfDownloadLocation && (
            <button
              onClick={() => setPdfDownloadLocation('')}
              title="Clear (ask each time)"
              className="p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-1.5">
          When set, exported PDFs default to this folder. Leave empty to be prompted each time.
        </p>
      </div>

      <p className="text-[10px] text-[rgb(var(--color-text-muted))] flex items-center gap-1.5">
        <Eye size={11} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
        These settings are the defaults. You can also adjust them per-note in the print preview (the Print / Export buttons in the notes editor).
      </p>
    </div>
  )
}
