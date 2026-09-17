import { useState, useEffect, useRef } from 'react'
import { Printer, ChevronDown, FolderOpen, X, Eye } from 'lucide-react'
import { buildPrintHTML, PRINT_THEMES, presetToSides } from '@/lib/notePreviewRender'
import { ScaledPagePreview, CustomMarginInputs } from '@/components/notes/PrintPreviewModal'
import { Switch, SectionLabel, SegmentedControl, TextField, IconButton } from '@/components/ui'
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
    paperSize: printPaperSize,
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Printer size={14} className="text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Print &amp; Export</p>
      </div>
      <p className="text-xs text-text-muted -mt-3">
        Controls how notes look when printed or exported to PDF. Applies to the Print and Export-PDF buttons in the notes editor.
      </p>

      {/* Presets */}
      <div>
        <SectionLabel className="mb-1.5">Presets</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {PRINT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={`text-left px-3 py-2 rounded-card border transition-colors cursor-pointer ${
                activePreset?.id === p.id
                  ? 'border-accent bg-accent-muted'
                  : 'border-border bg-surface-3 hover:border-accent/50'
              }`}
            >
              <div className="text-xs font-medium text-text-primary">{p.label}</div>
              <div className="text-caption2 text-text-muted mt-0.5 leading-snug">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Theme & style — button + popover grid */}
      <div>
        <SectionLabel className="mb-1.5">Theme &amp; style</SectionLabel>
        <div className="relative" ref={themePickerRef}>
          <button
            onClick={() => setThemeOpen(v => !v)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-card border text-left cursor-pointer transition-colors ${
              themeOpen
                ? 'border-accent bg-accent-muted'
                : 'border-border hover:border-accent/50 bg-surface-3'
            }`}
          >
            <span className="w-6 h-6 rounded-chip flex-shrink-0 border overflow-hidden" style={{ background: currentTheme.bg, borderColor: currentTheme.h2Border }}>
              <span className="block w-full h-1.5" style={{ background: currentTheme.verseBorder }} />
              <span className="block mx-0.5 mt-1 h-1 rounded-chip" style={{ background: currentTheme.verseBg === 'transparent' ? currentTheme.h2Border : currentTheme.verseBg }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-text-primary">{currentTheme.label}</span>
              <span className="block text-micro text-text-muted truncate leading-tight">{currentTheme.desc}</span>
            </span>
            <ChevronDown size={13} className={`flex-shrink-0 text-text-muted transition-transform ${themeOpen ? 'rotate-180' : ''}`} />
          </button>

          {themeOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-menu material-popover rounded-menu p-2 grid grid-cols-3 gap-1 max-h-72 overflow-y-auto">
              {Object.values(PRINT_THEMES).map((th) => (
                <button
                  key={th.id}
                  onClick={() => { setPrintTheme(th.id); setPrintFontFamily(th.suggestedFont); setThemeOpen(false) }}
                  title={th.desc}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-card border cursor-pointer transition-colors text-center ${
                    printTheme === th.id
                      ? 'border-accent bg-accent-muted'
                      : 'border-transparent hover:border-border hover:bg-surface-hover'
                  }`}
                >
                  <span className="w-5 h-5 rounded-chip flex-shrink-0 border overflow-hidden" style={{ background: th.bg, borderColor: th.h2Border }}>
                    <span className="block w-full" style={{ height: 5, background: th.verseBorder }} />
                    <span className="block mx-0.5 mt-0.5 rounded-chip" style={{ height: 3, background: th.verseBg === 'transparent' ? th.h2Border : th.verseBg }} />
                  </span>
                  <span className="text-micro font-medium text-text-secondary leading-none">{th.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live preview — scaled to true page proportions so margins look accurate */}
      <div>
        <SectionLabel className="mb-1.5">Live preview</SectionLabel>
        <ScaledPagePreview html={previewHtml} />
      </div>

      {/* Margins */}
      <div>
        <SectionLabel className="mb-1.5">Margins</SectionLabel>
        <SegmentedControl
          aria-label="Margins"
          value={printMarginPreset}
          onChange={(m) => {
            if (m === 'custom' && printMarginPreset !== 'custom') setPrintCustomMargins(presetToSides(printMarginPreset))
            setPrintMarginPreset(m)
          }}
          options={(['none', 'narrow', 'normal', 'wide', 'custom'] as const).map((m) => ({
            value: m, label: m === 'none' ? 'None' : m.charAt(0).toUpperCase() + m.slice(1),
          }))}
        />
        {printMarginPreset === 'custom' && (
          <CustomMarginInputs value={printCustomMargins} onChange={setPrintCustomMargins} />
        )}
      </div>

      {/* Font size */}
      <div>
        <SectionLabel className="mb-1.5">Font size — {printFontSizePt}pt</SectionLabel>
        <input
          type="range" min={8} max={18} step={1} value={printFontSizePt}
          onChange={(e) => setPrintFontSizePt(parseInt(e.target.value))}
          className="w-full accent-accent cursor-pointer"
        />
      </div>

      {/* Font family */}
      <div>
        <SectionLabel className="mb-1.5">Font family</SectionLabel>
        <SegmentedControl
          aria-label="Font family"
          value={printFontFamily}
          onChange={setPrintFontFamily}
          options={[
            { value: 'system', label: 'System' },
            { value: 'serif', label: 'Serif' },
            { value: 'sansserif', label: 'Sans-serif' },
          ]}
        />
      </div>

      {/* Paper size */}
      <div>
        <SectionLabel className="mb-1.5">Paper size</SectionLabel>
        <SegmentedControl
          aria-label="Paper size"
          value={printPaperSize}
          onChange={setPrintPaperSize}
          options={[
            { value: 'letter', label: 'Letter' },
            { value: 'a4', label: 'A4' },
            { value: 'legal', label: 'Legal' },
          ]}
        />
      </div>

      {/* Color mode */}
      <div>
        <SectionLabel className="mb-1.5">Color</SectionLabel>
        <SegmentedControl
          aria-label="Color mode"
          value={printColorMode}
          onChange={setPrintColorMode}
          options={[
            { value: 'color', label: 'Color' },
            { value: 'grayscale', label: 'Grayscale' },
          ]}
        />
      </div>

      {/* Include title toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-primary">Include note title</p>
          <p className="text-caption2 text-text-muted mt-0.5">Print the note title as a heading at the top</p>
        </div>
        <Switch checked={printIncludeTitle} onCheckedChange={() => setPrintIncludeTitle(!printIncludeTitle)} />
      </div>

      {/* Default download location */}
      <div>
        <SectionLabel className="mb-1.5">Default download location</SectionLabel>
        <div className="flex items-center gap-2">
          <TextField
            value={pdfDownloadLocation}
            onChange={(e) => setPdfDownloadLocation(e.target.value)}
            placeholder="Ask each time (system default)"
            wrapperClassName="flex-1"
          />
          <IconButton
            icon={FolderOpen}
            label="Choose folder"
            size={28}
            onClick={async () => { const picked = await window.app.openFolderDialog(); if (picked) setPdfDownloadLocation(picked) }}
          />
          {pdfDownloadLocation && (
            <IconButton icon={X} label="Clear (ask each time)" size={28} danger onClick={() => setPdfDownloadLocation('')} />
          )}
        </div>
        <p className="text-caption2 text-text-muted mt-1.5">
          When set, exported PDFs default to this folder. Leave empty to be prompted each time.
        </p>
      </div>

      <p className="text-caption2 text-text-muted flex items-center gap-1.5">
        <Eye size={11} className="text-accent flex-shrink-0" />
        These settings are the defaults. You can also adjust them per-note in the print preview (the Print / Export buttons in the notes editor).
      </p>
    </div>
  )
}
