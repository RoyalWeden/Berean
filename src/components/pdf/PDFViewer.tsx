/**
 * PDFViewer — full PDF reading view: lazy page rendering, text selection,
 * highlights (persisted), a find bar (current page / whole book), and
 * "copy link to selection" for pasting into notes.
 *
 * Logging prefix: [pdf-viewer]
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ZoomIn, ZoomOut, Search, X, ChevronUp, ChevronDown,
  Link2, StickyNote, FileText, Trash2, BookOpen,
  ChevronDown as ChevronDownIcon, BookmarkPlus, Bookmark as BookmarkIcon, PanelRight as PanelRightIcon,
} from 'lucide-react'
import { loadPdfFromBytes, type PDFDocumentProxy } from '@/lib/pdfjs'
import { useAppStore } from '@/store'
import { useWindowDrag, isInteractiveDragTarget } from '@/lib/useWindowDrag'
import PdfPage, { hlColor } from './PdfPage'
import PdfPicker from './PdfPicker'
import type { PdfTabState, PdfHighlight } from '@/types'

const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'] as const

interface SelToolbar {
  page: number
  rects: Array<{ x: number; y: number; w: number; h: number }>   // normalised to page
  text: string
  x: number; y: number   // screen coords for the toolbar
}

interface FindMatch { page: number; index: number }

interface TocItem { title: string; page: number | null; depth: number }
interface Bookmark { page: number; label: string; createdAt: number }
// Shape of a raw pdf.js outline node (typed loosely; pdf.js types are permissive)
interface RawOutlineNode { title: string; dest: string | unknown[] | null; items?: RawOutlineNode[] }

export default function PDFViewer({ floating = false }: { floating?: boolean }) {
  const windowDragMouseDown = useWindowDrag(isInteractiveDragTarget)
  const activeTabId = useAppStore((s) => s.activeTabId.scripture)
  // Narrowed to this panel's own space — see BiblePanel.tsx's identical comment for why.
  const tabs = useAppStore((s) => s.tabs.scripture)
  const updateTabState = useAppStore((s) => s.updateTabState)

  const tabId = activeTabId
  const tab = tabs.find((t) => t.id === tabId)
  const tabState = tab?.state as PdfTabState | undefined
  const pdfId = tabState?.pdfId ?? null
  const title = tabState?.title ?? 'PDF'

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [highlights, setHighlights] = useState<PdfHighlight[]>([])
  const [selToolbar, setSelToolbar] = useState<SelToolbar | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  // Find state
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findScope, setFindScope] = useState<'page' | 'book'>('book')
  const [matches, setMatches] = useState<FindMatch[]>([])
  const [matchIdx, setMatchIdx] = useState(0)
  const [findOverlay, setFindOverlay] = useState<{ page: number; rects: Array<{ x: number; y: number; w: number; h: number }> } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map())
  const textLayerEls = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageTextCache = useRef<Map<number, string>>(new Map())
  const lastScrollTopRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Side panel + outline + bookmarks
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'outline' | 'highlights'>('outline')
  const [pdfSwitcher, setPdfSwitcher] = useState<{ x: number; y: number } | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  const bookmarkKey = pdfId ? `berean:pdfBookmarks:${pdfId}` : ''
  function loadBookmarks() {
    if (!bookmarkKey) return
    try { setBookmarks(JSON.parse(localStorage.getItem(bookmarkKey) ?? '[]')) } catch { setBookmarks([]) }
  }
  function addBookmark() {
    if (!bookmarkKey) return
    const label = prompt('Bookmark label:', `Page ${currentPage}`)
    if (label === null) return
    const next = [...bookmarks, { page: currentPage, label: label || `Page ${currentPage}`, createdAt: Date.now() }]
      .sort((a, b) => a.page - b.page)
    setBookmarks(next)
    localStorage.setItem(bookmarkKey, JSON.stringify(next))
    setPanelOpen(true)
  }
  function removeBookmark(idx: number) {
    const next = bookmarks.filter((_, i) => i !== idx)
    setBookmarks(next)
    localStorage.setItem(bookmarkKey, JSON.stringify(next))
  }

  // ── Load document ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfId) return
    let cancelled = false
    setDoc(null); setLoadError(null); setNumPages(0)
    window.pdf.readBytes(pdfId)
      .then((bytes) => {
        if (!bytes) throw new Error('Could not read PDF file')
        return loadPdfFromBytes(bytes)
      })
      .then((d) => {
        if (cancelled) return
        setDoc(d); setNumPages(d.numPages)
        window.pdf.setPageCount(pdfId, d.numPages).catch(() => {})
      })
      .catch((e) => { if (!cancelled) setLoadError(String(e)) })
    return () => { cancelled = true }
  }, [pdfId])

  // Load highlights
  useEffect(() => {
    if (!pdfId) return
    window.pdf.highlightsList(pdfId).then(setHighlights).catch(() => {})
  }, [pdfId])

  // Restore page from tab state once doc is ready — only if no exact scrollTop saved
  // (the scrollTop restore effect handles precise position when available).
  useEffect(() => {
    if (!doc || !tabState?.page || tabState?.scrollTop) return
    const t = setTimeout(() => scrollToPage(tabState.page!), 200)
    return () => clearTimeout(t)
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load outline (TOC) from the document + bookmarks from localStorage
  useEffect(() => {
    if (!doc || !pdfId) return
    doc.getOutline().then(async (outline) => {
      if (!outline) { setToc([]); return }
      // Resolve each outline item's destination to a page number (best-effort)
      const items: TocItem[] = []
      async function walk(nodes: RawOutlineNode[], depth: number) {
        for (const node of nodes) {
          let page: number | null = null
          try {
            const dest = typeof node.dest === 'string' ? await doc!.getDestination(node.dest) : node.dest
            if (Array.isArray(dest) && dest[0]) {
              const idx = await doc!.getPageIndex(dest[0] as never)
              page = idx + 1
            }
          } catch { /* unresolved dest */ }
          items.push({ title: node.title, page, depth })
          if (node.items?.length) await walk(node.items, depth + 1)
        }
      }
      await walk(outline as RawOutlineNode[], 0)
      setToc(items)
    }).catch(() => { setToc([]) })
    loadBookmarks()
  }, [doc, pdfId]) // eslint-disable-line react-hooks/exhaustive-deps

  // External "go to page" event (from note links / openPdf reuse)
  useEffect(() => {
    function onGoto(e: Event) {
      const detail = (e as CustomEvent<{ pdfId: string; page: number }>).detail
      if (detail.pdfId !== pdfId) return
      scrollToPage(detail.page)
    }
    window.addEventListener('berean:pdfGoToPage', onGoto)
    return () => window.removeEventListener('berean:pdfGoToPage', onGoto)
  }, [pdfId]) // eslint-disable-line react-hooks/exhaustive-deps

  const registerPageEl = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el); else pageEls.current.delete(page)
  }, [])
  const registerTextLayerEl = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) textLayerEls.current.set(page, el); else textLayerEls.current.delete(page)
  }, [])

  function scrollToPage(page: number) {
    const el = pageEls.current.get(page)
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentPage(page)
    } else {
      setTimeout(() => {
        const el2 = pageEls.current.get(page)
        el2?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
    }
  }

  // Track current page on scroll — uses bounding rects relative to the scroll
  // container (offsetTop is unreliable because each page sits in a wrapper div).
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    function onScroll() {
      const scRect = sc!.getBoundingClientRect()
      const mid = scRect.top + sc!.clientHeight / 2
      let best = 1, bestDist = Infinity
      pageEls.current.forEach((el, page) => {
        const r = el.getBoundingClientRect()
        const center = (r.top + r.bottom) / 2
        const dist = Math.abs(center - mid)
        if (dist < bestDist) { bestDist = dist; best = page }
      })
      setCurrentPage(best)
      lastScrollTopRef.current = sc!.scrollTop
      // Debounced persist of exact scroll position
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (tabId) updateTabState('scripture', tabId, { page: best, scrollTop: sc!.scrollTop })
      }, 250)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [doc, tabId, updateTabState])

  // Flush the latest scroll position on unmount (tab switch away from this PDF) — the onScroll
  // handler above debounces its persist by 250ms, so a switch inside that window would otherwise
  // abandon the timer and lose the last bit of scrolling. Mirrors the same fix used for
  // ScriptureSearchView/SearchTab/LexiconPanel scroll persistence.
  const currentPageRef = useRef(currentPage)
  useEffect(() => { currentPageRef.current = currentPage })
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (tabId) updateTabState('scripture', tabId, { page: currentPageRef.current, scrollTop: lastScrollTopRef.current })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore exact scroll position once pages have laid out
  useEffect(() => {
    if (!doc) return
    const saved = tabState?.scrollTop
    if (!saved) return
    let tries = 0
    const restore = () => {
      const sc = scrollRef.current
      if (sc && sc.scrollHeight > sc.clientHeight + saved) { sc.scrollTop = saved; return }
      if (tries++ < 20) setTimeout(restore, 100)
    }
    setTimeout(restore, 150)
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  const scaleRef = useRef(scale)
  useEffect(() => { scaleRef.current = scale }, [scale])

  // Change zoom while keeping the same vertical spot in view.
  const changeScale = useCallback((next: number) => {
    const clamped = Math.max(0.5, Math.min(3, next))
    const sc = scrollRef.current
    const anchorPage = currentPage
    const el = pageEls.current.get(anchorPage)
    let withinFrac = 0
    if (el && sc) {
      const r = el.getBoundingClientRect()
      const scRect = sc.getBoundingClientRect()
      withinFrac = (scRect.top - r.top) / r.height   // scale-invariant fraction into the page
    }
    setScale(clamped)
    // After pages re-measure at the new scale, restore the anchor position
    let tries = 0
    const restore = () => {
      const sc2 = scrollRef.current
      const el2 = pageEls.current.get(anchorPage)
      if (sc2 && el2) {
        const r2 = el2.getBoundingClientRect()
        const scRect2 = sc2.getBoundingClientRect()
        const pageTopInContent = r2.top - scRect2.top + sc2.scrollTop
        sc2.scrollTop = pageTopInContent + withinFrac * el2.offsetHeight
      }
      if (tries++ < 6) setTimeout(restore, 60)
    }
    setTimeout(restore, 50)
  }, [currentPage])

  // Pinch / ctrl-wheel zoom
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    function onWheel(e: WheelEvent) {
      // Trackpad pinch-zoom reports a wheel event with ctrlKey set (even without
      // the physical Ctrl key). That's our zoom signal; plain scroll is untouched.
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.06 : 0.94
      changeScale(scaleRef.current * factor)
    }
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => sc.removeEventListener('wheel', onWheel)
  }, [changeScale])

  // ── Text selection → toolbar ───────────────────────────────────────────────
  const onMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelToolbar(null); return }
    const text = sel.toString().trim()
    if (!text) { setSelToolbar(null); return }
    const range = sel.getRangeAt(0)
    const clientRects = Array.from(range.getClientRects())
    if (clientRects.length === 0) { setSelToolbar(null); return }

    // Determine the page that contains the start of the selection
    let startPage = currentPage
    let pageEl: HTMLDivElement | null = null
    pageEls.current.forEach((el, page) => {
      const r = el.getBoundingClientRect()
      const c = clientRects[0]
      if (c.top >= r.top - 2 && c.top <= r.bottom + 2 && c.left >= r.left - 2 && c.left <= r.right + 2) {
        startPage = page; pageEl = el
      }
    })
    if (!pageEl) { setSelToolbar(null); return }
    const pr = (pageEl as HTMLDivElement).getBoundingClientRect()

    // Normalise only the rects that fall on the start page
    const rects = clientRects
      .filter((c) => c.top >= pr.top - 4 && c.bottom <= pr.bottom + 4)
      .map((c) => ({
        x: (c.left - pr.left) / pr.width,
        y: (c.top - pr.top) / pr.height,
        w: c.width / pr.width,
        h: c.height / pr.height,
      }))
    if (rects.length === 0) { setSelToolbar(null); return }

    const last = clientRects[clientRects.length - 1]
    setSelToolbar({ page: startPage, rects, text, x: last.right, y: last.bottom })
  }, [currentPage])

  async function addHighlight(color: string) {
    if (!selToolbar || !pdfId) return
    const res = await window.pdf.highlightsAdd({
      pdfId, page: selToolbar.page, rects: selToolbar.rects, color, text: selToolbar.text,
    })
    setHighlights((prev) => [...prev, {
      id: res.id, pdfId, page: selToolbar.page, rects: selToolbar.rects,
      color, text: selToolbar.text, note: null, createdAt: Date.now(),
    }])
    window.getSelection()?.removeAllRanges()
    setSelToolbar(null)
  }

  async function removeHighlight(id: string) {
    await window.pdf.highlightsRemove(id)
    setHighlights((prev) => prev.filter((h) => h.id !== id))
  }

  // Copy a markdown link to the selection, for pasting into a note.
  function copyLinkToSelection() {
    if (!selToolbar || !pdfId) return
    const quoted = selToolbar.text.length > 120 ? selToolbar.text.slice(0, 120) + '…' : selToolbar.text
    const md = `[${title} — p.${selToolbar.page}](berean-pdf://${pdfId}/${selToolbar.page})\n> ${quoted}`
    navigator.clipboard.writeText(md).catch(() => {})
    window.getSelection()?.removeAllRanges()
    setSelToolbar(null)
  }

  // Highlight + create a verse-style note from the selection
  async function highlightAndNote() {
    if (!selToolbar || !pdfId) return
    await addHighlight('yellow')
    const content = `> ${selToolbar.text}\n\n[${title} — p.${selToolbar.page}](berean-pdf://${pdfId}/${selToolbar.page})\n\n`
    const res = await window.notes.createNote({ title: `${title} — p.${selToolbar.page}`, content, tags: ['pdf'] })
    if (res.success && res.note) {
      const store = useAppStore.getState()
      // ensureTab first — requestOpenNote's pending value is picked up by
      // whichever Notes tab is active at that moment.
      store.ensureTab('note'); store.requestOpenNote(res.note.id); store.setActiveSpace('notes')
    }
  }

  // ── Find ───────────────────────────────────────────────────────────────────
  async function ensurePageText(page: number): Promise<string> {
    if (pageTextCache.current.has(page)) return pageTextCache.current.get(page)!
    if (!doc) return ''
    try {
      const p = await doc.getPage(page)
      const tc = await p.getTextContent()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (tc.items as any[]).map((it) => it.str ?? '').join(' ')
      pageTextCache.current.set(page, text)
      return text
    } catch { return '' }
  }

  const runFind = useCallback(async (q: string, scope: 'page' | 'book') => {
    if (!doc || !q.trim()) { setMatches([]); setMatchIdx(0); setFindOverlay(null); return }
    const needle = q.trim().toLowerCase()
    const found: FindMatch[] = []
    const pagesToSearch = scope === 'page' ? [currentPage] : Array.from({ length: numPages }, (_, i) => i + 1)
    for (const page of pagesToSearch) {
      const text = (await ensurePageText(page)).toLowerCase()
      let from = 0, idx = 0
      while ((from = text.indexOf(needle, from)) !== -1) {
        found.push({ page, index: idx })
        from += needle.length; idx++
      }
    }
    setMatches(found)
    setMatchIdx(0)
    if (found.length > 0) goToMatch(found, 0, needle)
  }, [doc, numPages, currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  function goToMatch(list: FindMatch[], i: number, needle: string) {
    const m = list[i]
    if (!m) return
    scrollToPage(m.page)
    // After the page renders its text layer, compute the match rects
    let tries = 0
    const tryHighlight = () => {
      const tl = textLayerEls.current.get(m.page)
      const pageEl = pageEls.current.get(m.page)
      if (tl && pageEl) {
        const rects = rectsForOccurrence(tl, pageEl, needle, m.index)
        if (rects.length) { setFindOverlay({ page: m.page, rects }); return }
      }
      if (tries++ < 12) setTimeout(tryHighlight, 200)
    }
    tryHighlight()
  }

  function navMatch(delta: number) {
    if (matches.length === 0) return
    const next = (matchIdx + delta + matches.length) % matches.length
    setMatchIdx(next)
    goToMatch(matches, next, findQuery.trim().toLowerCase())
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!pdfId) {
    return <div className="flex items-center justify-center h-full text-sm text-[rgb(var(--color-text-muted))]">No PDF selected</div>
  }

  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* Toolbar — window-drag via useWindowDrag (manual JS-tracked drag), not a real
          `-webkit-app-region: drag` region; see that hook's comment (same fix as
          PanelHeader.tsx, for the same reported "drag doesn't work"/text-selection bug). */}
      <div
        onMouseDown={windowDragMouseDown}
        className={`flex items-center gap-2 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 min-h-[40px] no-drag select-none ${floating ? 'pl-[76px] pr-3' : 'px-3'}`}
      >
        {/* Title doubles as the PDF switcher / library button */}
        <button
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPdfSwitcher({ x: r.left, y: r.bottom + 4 }) }}
          title="Switch PDF / library"
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left group cursor-pointer"
        >
          <FileText size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
          <span className="flex-1 min-w-0 text-sm font-medium text-[rgb(var(--color-text-primary))] truncate group-hover:text-[rgb(var(--color-accent))] transition-colors">{title}</span>
          <ChevronDownIcon size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
        </button>
        {!floating && (
          <button onClick={() => useAppStore.getState().createTab('bible')} title="New Scripture tab"
            className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] cursor-pointer flex-shrink-0"><BookOpen size={14} /></button>
        )}
        <span className="text-[11px] text-[rgb(var(--color-text-muted))] tabular-nums flex-shrink-0">
          {numPages ? `${currentPage} / ${numPages}` : '…'}
        </span>
        <button onClick={() => changeScale(scale - 0.15)} title="Zoom out" className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><ZoomOut size={14} /></button>
        <button onClick={() => changeScale(scale + 0.15)} title="Zoom in" className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><ZoomIn size={14} /></button>
        <button onClick={addBookmark} title="Add bookmark at current page" className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] cursor-pointer"><BookmarkPlus size={14} /></button>
        <button onClick={() => setFindOpen((v) => !v)} title="Find (⌘F)" className={`p-1 rounded cursor-pointer transition-colors ${findOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}><Search size={14} /></button>
        {!floating && (
          <button onClick={() => setPanelOpen((v) => !v)} title="Outline & highlights"
            className={`p-1 rounded cursor-pointer transition-colors ${panelOpen ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'}`}><PanelRightIcon size={14} /></button>
        )}
      </div>

      {/* Find bar */}
      {findOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0">
          <Search size={12} className="text-[rgb(var(--color-text-muted))]" />
          <input
            autoFocus value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); runFind(e.target.value, findScope) }}
            onKeyDown={(e) => { if (e.key === 'Enter') navMatch(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setFindOpen(false) }}
            placeholder={findScope === 'page' ? 'Find on this page…' : 'Find in entire book…'}
            className="flex-1 bg-transparent text-xs outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
          />
          <div className="flex items-center bg-[rgb(var(--color-surface-4))] rounded p-0.5">
            {(['page', 'book'] as const).map((s) => (
              <button key={s} onClick={() => { setFindScope(s); runFind(findQuery, s) }}
                className={`text-[10px] px-1.5 py-0.5 rounded capitalize cursor-pointer ${findScope === s ? 'bg-[rgb(var(--color-surface-2))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
                {s === 'page' ? 'Page' : 'Book'}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-[rgb(var(--color-text-muted))] tabular-nums">{matches.length ? `${matchIdx + 1}/${matches.length}` : '0'}</span>
          <button onClick={() => navMatch(-1)} className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><ChevronUp size={13} /></button>
          <button onClick={() => navMatch(1)} className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><ChevronDown size={13} /></button>
          <button onClick={() => setFindOpen(false)} className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><X size={13} /></button>
        </div>
      )}

      {/* Body: pages + optional side panel */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Pages scroll area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-w-0" onMouseUp={onMouseUp} style={{ contain: 'paint' }}>
          {loadError && <div className="p-6 text-center text-sm text-red-400">Failed to load PDF: {loadError}</div>}
          {!doc && !loadError && <div className="p-6 text-center text-sm text-[rgb(var(--color-text-muted))]">Loading PDF…</div>}
          {doc && Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
            <div key={page} className="relative">
              <PdfPage
                doc={doc} pageNumber={page} scale={scale}
                highlights={highlights.filter((h) => h.page === page)}
                onRemoveHighlight={removeHighlight}
                registerPageEl={registerPageEl}
                registerTextLayerEl={registerTextLayerEl}
              />
              {/* Find overlay for current match on this page */}
              {findOverlay?.page === page && (
                <FindOverlayLayer page={page} rects={findOverlay.rects} pageEls={pageEls} />
              )}
            </div>
          ))}
        </div>

        {/* Side panel: outline (TOC + bookmarks) and highlights */}
        {panelOpen && !floating && (
          <div className="w-64 flex-shrink-0 flex flex-col border-l border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] overflow-hidden">
            <div className="flex items-center border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
              {(['outline', 'highlights'] as const).map((t) => (
                <button key={t} onClick={() => setPanelTab(t)}
                  className={`flex-1 text-[11px] font-medium py-2 capitalize cursor-pointer transition-colors ${panelTab === t ? 'text-[rgb(var(--color-accent))] border-b-2 border-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {panelTab === 'outline' && (
                <div className="py-1">
                  {/* Bookmarks */}
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-[rgb(var(--color-text-muted))] font-semibold flex items-center justify-between">
                    Bookmarks
                    <button onClick={addBookmark} title="Add bookmark" className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer"><BookmarkPlus size={11} /></button>
                  </div>
                  {bookmarks.length === 0 && <div className="px-3 py-1 text-[11px] text-[rgb(var(--color-text-muted))] italic">No bookmarks</div>}
                  {bookmarks.map((b, i) => (
                    <div key={i} className="group flex items-center gap-1.5 px-3 py-1 hover:bg-[rgb(var(--color-surface-4))] cursor-pointer" onClick={() => scrollToPage(b.page)}>
                      <BookmarkIcon size={11} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-xs text-[rgb(var(--color-text-secondary))]">{b.label}</span>
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]">p.{b.page}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeBookmark(i) }} className="opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"><X size={11} /></button>
                    </div>
                  ))}
                  {/* TOC */}
                  <div className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-widest text-[rgb(var(--color-text-muted))] font-semibold">Contents</div>
                  {toc.length === 0 && <div className="px-3 py-1 text-[11px] text-[rgb(var(--color-text-muted))] italic">No table of contents</div>}
                  {toc.map((item, i) => (
                    <button key={i} onClick={() => item.page && scrollToPage(item.page)}
                      disabled={!item.page}
                      style={{ paddingLeft: 12 + item.depth * 12 }}
                      className="w-full text-left pr-2 py-1 text-xs text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer truncate disabled:opacity-40 disabled:cursor-default">
                      {item.title}
                    </button>
                  ))}
                </div>
              )}
              {panelTab === 'highlights' && (
                <div className="py-1">
                  {highlights.length === 0 && <div className="px-3 py-3 text-[11px] text-[rgb(var(--color-text-muted))] italic">No highlights yet — select text to add one</div>}
                  {highlights.map((h) => (
                    <div key={h.id} className="group flex items-start gap-1.5 px-3 py-1.5 hover:bg-[rgb(var(--color-surface-4))] cursor-pointer border-b border-[rgb(var(--color-surface-4))/50]" onClick={() => scrollToPage(h.page)}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: hlColor(h.color).replace('0.45', '0.9') }} />
                      <span className="flex-1 min-w-0 text-[11px] text-[rgb(var(--color-text-secondary))] line-clamp-2">{h.text || '(no text)'}</span>
                      <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-shrink-0">p.{h.page}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeHighlight(h.id) }} title="Remove" className="opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer flex-shrink-0"><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PDF switcher popover */}
      {pdfSwitcher && <PdfPicker anchor={pdfSwitcher} onClose={() => setPdfSwitcher(null)} />}

      {/* Selection toolbar */}
      {selToolbar && (
        <div
          className="fixed z-[200] flex items-center gap-1 px-1.5 py-1 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-2xl"
          style={{ left: Math.min(selToolbar.x, window.innerWidth - 240), top: selToolbar.y + 6 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {HL_COLORS.map((c) => (
            <button key={c} onClick={() => addHighlight(c)} title={`Highlight ${c}`}
              className="w-5 h-5 rounded-full border border-black/10 cursor-pointer hover:scale-110 transition-transform"
              style={{ backgroundColor: hlColor(c).replace('0.45', '0.9') }} />
          ))}
          <div className="w-px h-4 bg-[rgb(var(--color-surface-4))] mx-0.5" />
          <button onClick={highlightAndNote} title="Highlight + new note" className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><StickyNote size={13} /></button>
          <button onClick={copyLinkToSelection} title="Copy link to selection" className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer"><Link2 size={13} /></button>
        </div>
      )}
    </div>
  )
}

// Renders the current find match as accent overlays on a page.
function FindOverlayLayer({ rects, pageEls, page }: {
  page: number; rects: Array<{ x: number; y: number; w: number; h: number }>; pageEls: React.MutableRefObject<Map<number, HTMLDivElement>>
}) {
  const el = pageEls.current.get(page)
  if (!el) return null
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight }}>
      {rects.map((r, i) => (
        <div key={i} className="absolute" style={{
          left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
          backgroundColor: 'rgba(255,165,0,0.55)', outline: '1px solid rgba(255,140,0,0.9)',
        }} />
      ))}
    </div>
  )
}

/**
 * Find the nth occurrence of `needle` inside a rendered text-layer element and
 * return its bounding rects normalised (0..1) to the page element.
 */
function rectsForOccurrence(textLayer: HTMLElement, pageEl: HTMLElement, needle: string, occurrence: number) {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let full = ''
  let n: Text | null
  const offsets: number[] = []
  while ((n = walker.nextNode() as Text)) {
    offsets.push(full.length)
    full += n.data
    nodes.push(n)
  }
  const hay = full.toLowerCase()
  // locate nth occurrence
  let from = -1
  for (let k = 0; k <= occurrence; k++) {
    from = hay.indexOf(needle, from + (k === 0 ? 0 : 1))
    if (from === -1) return []
  }
  const start = from, end = from + needle.length
  // map start/end to node + offset
  function locate(pos: number): { node: Text; offset: number } | null {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (offsets[i] <= pos) return { node: nodes[i], offset: pos - offsets[i] }
    }
    return null
  }
  const a = locate(start), b = locate(end)
  if (!a || !b) return []
  try {
    const range = document.createRange()
    range.setStart(a.node, Math.min(a.offset, a.node.length))
    range.setEnd(b.node, Math.min(b.offset, b.node.length))
    const pr = pageEl.getBoundingClientRect()
    return Array.from(range.getClientRects()).map((c) => ({
      x: (c.left - pr.left) / pr.width,
      y: (c.top - pr.top) / pr.height,
      w: c.width / pr.width,
      h: c.height / pr.height,
    }))
  } catch { return [] }
}
