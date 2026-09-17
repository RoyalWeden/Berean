/**
 * PdfPicker — popover listing imported PDFs with type-to-filter, an Import
 * button, and per-item open/delete. Opened from the scripture toolbar.
 *
 * Logging prefix: [pdf-picker]
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Upload, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { SearchField, MenuItem, IconButton } from '@/components/ui'
import type { PdfDoc } from '@/types'

interface Props {
  anchor: { x: number; y: number }
  onClose: () => void
}

export default function PdfPicker({ anchor, onClose }: Props) {
  const openPdf = useAppStore((s) => s.openPdf)
  const [pdfs, setPdfs] = useState<PdfDoc[]>([])
  const [filter, setFilter] = useState('')
  const [importing, setImporting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  function reload() {
    window.pdf.list().then(setPdfs).catch(() => {})
  }
  useEffect(() => { reload() }, [])

  // Close on outside click / escape
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  async function handleImport() {
    setImporting(true)
    try {
      const res = await window.pdf.import()
      if (res.success && res.pdf) {
        reload()
        window.dispatchEvent(new CustomEvent('berean:pdfsChanged'))
        openPdf(res.pdf.id, res.pdf.title)
        onClose()
      } else if (res.error) {
      }
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Delete this PDF and its highlights? This cannot be undone.')) return
    await window.pdf.delete(id)
    reload()
    window.dispatchEvent(new CustomEvent('berean:pdfsChanged'))
  }

  const filtered = filter.trim()
    ? pdfs.filter((p) => p.title.toLowerCase().includes(filter.trim().toLowerCase()))
    : pdfs

  const W = 340
  const left = Math.min(anchor.x, window.innerWidth - W - 8)
  const top = anchor.y

  return createPortal(
    <div ref={ref} className="fixed z-popover material-popover rounded-menu overflow-hidden flex flex-col"
      style={{ left, top, width: W, maxHeight: '60vh' }}>
      {/* Search */}
      <div className="px-2 pt-2 pb-1.5">
        <SearchField value={filter} onValueChange={setFilter} placeholder="Filter PDFs…" autoFocus />
      </div>

      <div className="px-1 pb-1 border-b border-separator">
        <MenuItem icon={Upload} label={importing ? 'Importing…' : 'Import a PDF…'} onClick={handleImport} disabled={importing} className="text-accent" />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-caption2 text-text-muted">
            {pdfs.length === 0 ? 'No PDFs yet — import one above' : 'No matches'}
          </div>
        )}
        {filtered.map((p) => (
          <button key={p.id} onClick={() => { openPdf(p.id, p.title); onClose() }}
            className="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-row hover:bg-surface-hover cursor-pointer text-left">
            <FileText size={14} className="text-text-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-footnote font-medium text-text-primary truncate">{p.title}</p>
              <p className="text-caption2 text-text-muted">
                {p.pageCount ? `${p.pageCount} pages · ` : ''}{(p.fileSize / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <IconButton icon={Trash2} label="Delete" size={20} danger tooltip={false}
              className="opacity-0 group-hover:opacity-100" onClick={(e) => handleDelete(e, p.id)} />
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
