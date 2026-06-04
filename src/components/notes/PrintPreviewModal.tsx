import { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, FileDown, Eye } from 'lucide-react'
import { useAppStore } from '@/store'
import { buildPrintHTML, PRINT_THEMES } from './NoteEditor'
import type { PrintThemeId } from './NoteEditor'

interface Props {
  title: string
  content: string
  onClose: () => void
}

type Margin = 'none' | 'narrow' | 'normal' | 'wide'
type FontFam = 'system' | 'serif' | 'sansserif'
type ColorMode = 'color' | 'grayscale'

export default function PrintPreviewModal({ title, content, onClose }: Props) {
  // Persisted defaults
  const store = useAppStore()

  // Live-editable local copies (seeded from saved settings)
  const [theme, setTheme] = useState<PrintThemeId>(store.printTheme)
  const [margin, setMargin] = useState<Margin>(store.printMarginPreset)
  const [fontSize, setFontSize] = useState(store.printFontSizePt)
  const [fontFamily, setFontFamily] = useState<FontFam>(store.printFontFamily)
  const [colorMode, setColorMode] = useState<ColorMode>(store.printColorMode)
  const [includeTitle, setIncludeTitle] = useState(store.printIncludeTitle)

  const opts = { theme, marginPreset: margin, fontSize, fontFamily, includeTitle, colorMode }

  const html = useMemo(
    () => buildPrintHTML(title || 'Untitled', content, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, content, theme, margin, fontSize, fontFamily, colorMode, includeTitle]
  )

  // Persist the chosen settings so they become the new defaults
  function persist() {
    store.setPrintTheme(theme)
    store.setPrintMarginPreset(margin)
    store.setPrintFontSizePt(fontSize)
    store.setPrintFontFamily(fontFamily)
    store.setPrintColorMode(colorMode)
    store.setPrintIncludeTitle(includeTitle)
  }

  function doPrint() {
    persist()
    window.app.printNote(html).catch(() => {})
    onClose()
  }

  function doDownload() {
    persist()
    window.app.exportNotePDF(html, title || 'note', store.pdfDownloadLocation).catch(() => {})
    onClose()
  }

  const segBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${active
      ? 'bg-[rgb(var(--color-accent))] text-white font-medium'
      : 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'}`
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5'

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[90vw] max-w-5xl h-[85vh]
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl flex flex-col overflow-hidden"
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
            {/* Controls */}
            <div className="w-60 flex-shrink-0 border-r border-[rgb(var(--color-surface-4))] overflow-y-auto p-4 space-y-5">
              {/* Theme cards */}
              <div>
                <p className={labelCls}>Theme &amp; style</p>
                <div className="space-y-1.5">
                  {Object.values(PRINT_THEMES).map((th) => (
                    <button
                      key={th.id}
                      onClick={() => { setTheme(th.id); setFontFamily(th.suggestedFont) }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors cursor-pointer flex items-center gap-2.5 ${
                        theme === th.id
                          ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                          : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50]'
                      }`}
                    >
                      {/* swatch */}
                      <span
                        className="w-7 h-7 rounded flex-shrink-0 border"
                        style={{ background: th.bg, borderColor: th.h2Border }}
                      >
                        <span className="block w-full h-1.5 rounded-t" style={{ background: th.verseBorder }} />
                        <span className="block mx-1 mt-1 h-1 rounded" style={{ background: th.verseBg === 'transparent' ? th.h2Border : th.verseBg }} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-[rgb(var(--color-text-primary))]">{th.label}</span>
                        <span className="block text-[9px] text-[rgb(var(--color-text-muted))] leading-tight truncate">{th.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Margins */}
              <div>
                <p className={labelCls}>Margins</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['none', 'narrow', 'normal', 'wide'] as const).map((m) => (
                    <button key={m} onClick={() => setMargin(m)} className={segBtn(margin === m)}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
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
                <div className="flex flex-wrap gap-1.5">
                  {([['system', 'System'], ['serif', 'Serif'], ['sansserif', 'Sans']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setFontFamily(id)} className={segBtn(fontFamily === id)}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div>
                <p className={labelCls}>Color</p>
                <div className="flex gap-1.5">
                  {([['color', 'Color'], ['grayscale', 'Gray']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setColorMode(id)} className={segBtn(colorMode === id)}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Include title */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[rgb(var(--color-text-secondary))]">Include title</span>
                <button
                  onClick={() => setIncludeTitle(v => !v)}
                  className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer ${includeTitle ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${includeTitle ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            </div>

            {/* Preview iframe */}
            <div className="flex-1 min-w-0 bg-[rgb(var(--color-surface-1))] p-4 overflow-auto flex justify-center">
              <iframe
                title="Print preview"
                srcDoc={html}
                className="bg-white shadow-xl rounded"
                style={{ width: '8.5in', minHeight: '11in', border: 'none' }}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
              {store.pdfDownloadLocation ? `Saves to: ${store.pdfDownloadLocation}` : 'You’ll be asked where to save'}
            </p>
            <div className="flex-1" />
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors">
              Cancel
            </button>
            <button onClick={doPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors">
              <Printer size={13} /> Print
            </button>
            <button onClick={doDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white font-medium hover:opacity-90 cursor-pointer transition-opacity">
              <FileDown size={13} /> Download PDF
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
