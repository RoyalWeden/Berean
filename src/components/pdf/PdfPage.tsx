/**
 * PdfPage — renders one PDF page: canvas + text layer + highlight overlays.
 * Canvas/text paint lazily when the page scrolls near the viewport.
 *
 * Logging prefix: [pdf-page]
 */
import { useEffect, useRef, useState } from 'react'
import { pdfjsLib, type PDFDocumentProxy } from '@/lib/pdfjs'
import type { PdfHighlight } from '@/types'

interface Props {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  highlights: PdfHighlight[]
  onRemoveHighlight: (id: string) => void
  // Report intrinsic (unscaled) size once known, so the parent can compute layout
  onSize?: (page: number, w: number, h: number) => void
  registerPageEl?: (page: number, el: HTMLDivElement | null) => void
  registerTextLayerEl?: (page: number, el: HTMLDivElement | null) => void
}

export default function PdfPage({
  doc, pageNumber, scale, highlights, onRemoveHighlight, onSize, registerPageEl, registerTextLayerEl,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null)
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const renderTaskRef = useRef<ReturnType<pdfjsLib.PDFPageProxy['render']> | null>(null)

  // Register element refs with parent for find / scroll
  useEffect(() => {
    registerPageEl?.(pageNumber, wrapRef.current)
    return () => registerPageEl?.(pageNumber, null)
  }, [pageNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  // Determine page size up-front (cheap) so the scroll container has correct height
  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale })
      setViewportSize({ w: vp.width, h: vp.height })
      const base = page.getViewport({ scale: 1 })
      onSize?.(pageNumber, base.width, base.height)
    }).catch((e) => console.error('[pdf-page] getPage size error', pageNumber, e))
    return () => { cancelled = true }
  }, [doc, pageNumber, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-render: only paint when near viewport
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) setVisible(true)
      }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Render canvas + text layer when visible (and re-render on scale change)
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setRendered(false)
    doc.getPage(pageNumber).then(async (page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale })
      const canvas = canvasRef.current
      const textDiv = textLayerRef.current
      if (!canvas || !textDiv) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${vp.width}px`
      canvas.style.height = `${vp.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Cancel any in-flight render
      try { renderTaskRef.current?.cancel() } catch { /* ignore */ }
      const task = page.render({ canvasContext: ctx, viewport: vp })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch (e) {
        if ((e as { name?: string })?.name !== 'RenderingCancelledException') console.error('[pdf-page] render error', pageNumber, e)
        return
      }

      // Text layer
      textDiv.innerHTML = ''
      textDiv.style.setProperty('--scale-factor', String(scale))
      try {
        const textContent = await page.getTextContent()
        const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textDiv, viewport: vp })
        await tl.render()
      } catch (e) {
        console.error('[pdf-page] text layer error', pageNumber, e)
      }
      if (!cancelled) setRendered(true)
    }).catch((e) => console.error('[pdf-page] getPage render error', pageNumber, e))

    return () => { cancelled = true; try { renderTaskRef.current?.cancel() } catch { /* ignore */ } }
  }, [visible, doc, pageNumber, scale])

  useEffect(() => {
    registerTextLayerEl?.(pageNumber, rendered ? textLayerRef.current : null)
  }, [rendered, pageNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  const w = viewportSize?.w ?? 612 * scale
  const h = viewportSize?.h ?? 792 * scale

  return (
    <div
      ref={wrapRef}
      data-pdf-page={pageNumber}
      className="relative mx-auto my-3 bg-white shadow-lg"
      style={{ width: w, height: h }}
    >
      <canvas ref={canvasRef} className="block" />
      {/* pdf.js text layer (selectable). Styled by pdf_viewer.css (.textLayer) */}
      <div ref={textLayerRef} className="textLayer" />
      {/* Persisted highlight overlays */}
      <div className="absolute inset-0 pointer-events-none">
        {highlights.map((hl) => (
          <div key={hl.id} className="group/hl">
            {hl.rects.map((r, i) => (
              <div
                key={i}
                className="absolute pointer-events-auto cursor-pointer"
                style={{
                  left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                  backgroundColor: hlColor(hl.color),
                  mixBlendMode: 'multiply',
                }}
                title={hl.note ? `Note: ${hl.note}` : hl.text}
                onClick={(e) => { e.stopPropagation(); if (confirm('Remove this highlight?')) onRemoveHighlight(hl.id) }}
              />
            ))}
          </div>
        ))}
      </div>
      {!rendered && visible && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">Rendering…</div>
      )}
      <div className="absolute -bottom-2 right-1 text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-2))] px-1 rounded pointer-events-none">{pageNumber}</div>
    </div>
  )
}

export function hlColor(color: string): string {
  const map: Record<string, string> = {
    yellow: 'rgba(250,204,21,0.45)',
    green:  'rgba(74,222,128,0.45)',
    blue:   'rgba(96,165,250,0.45)',
    pink:   'rgba(244,114,182,0.45)',
    orange: 'rgba(251,146,60,0.45)',
    purple: 'rgba(192,132,252,0.45)',
  }
  return map[color] ?? map.yellow
}
