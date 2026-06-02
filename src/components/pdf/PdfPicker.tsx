/**
 * PdfPicker — popover listing imported PDFs with type-to-filter, an Import
 * button, and per-item open/delete. Opened from the scripture toolbar.
 *
 * Logging prefix: [pdf-picker]
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Upload, Trash2, Search, X } from 'lucide-react'
import { useAppStore } from '@/store'
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
    window.pdf.list().then(setPdfs).catch((e) => console.error('[pdf-picker] list error', e))
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
    console.log('[pdf-picker] import clicked')
    setImporting(true)
    try {
      const res = await window.pdf.import()
      console.log('[pdf-picker] import result', res)
      if (res.success && res.pdf) {
        reload()
        window.dispatchEvent(new CustomEvent('berean:pdfsChanged'))
        openPdf(res.pdf.id, res.pdf.title)
        onClose()
      } else if (res.error) {
        console.error('[pdf-picker] import error', res.error)
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
    <div ref={ref} className="fixed z-[9999] bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl overflow-hidden flex flex-col"
      style={{ left, top, width: W, maxHeight: '60vh' }}>
      {/* Search + import */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
        <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter PDFs…"
          className="flex-1 bg-transparent text-sm outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] min-w-0" />
        {filter && <button onClick={() => setFilter('')} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"><X size={12} /></button>}
      </div>

      <button onClick={handleImport} disabled={importing}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10] border-b border-[rgb(var(--color-surface-4))] cursor-pointer disabled:opacity-50">
        <Upload size={13} /> {importing ? 'Importing…' : 'Import a PDF…'}
      </button>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">
            {pdfs.length === 0 ? 'No PDFs yet — import one above' : 'No matches'}
          </div>
        )}
        {filtered.map((p) => (
          <button key={p.id} onClick={() => { console.log('[pdf-picker] open', p.id); openPdf(p.id, p.title); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-left group">
            <FileText size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">{p.title}</p>
              <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
                {p.pageCount ? `${p.pageCount} pages · ` : ''}{(p.fileSize / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <button onClick={(e) => handleDelete(e, p.id)} title="Delete"
              className="p-1 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-opacity cursor-pointer">
              <Trash2 size={12} />
            </button>
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
