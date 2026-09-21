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
  Link2, NotepadText, FileText, Trash2, BookOpen,
  ChevronDown as ChevronDownIcon, BookmarkPlus, Bookmark as BookmarkIcon, PanelRight as PanelRightIcon,
} from 'lucide-react'
import { loadPdfFromBytes, type PDFDocumentProxy } from '@/lib/pdfjs'
import { useAppStore } from '@/store'
import PdfPage, { hlColor } from './PdfPage'
import PdfPicker from './PdfPicker'
import { IconButton, Button, ControlGroup, SearchField, SegmentedControl, SectionLabel, Divider, ListRow, ColorSwatchRow, OverflowGroup, OverflowSection } from '@/components/ui'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import { useIsActivePanel } from '@/components/shell/ActivePanelContext'
import type { PdfTabState, PdfHighlight, PdfBookmark } from '@/types'

const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'] as const
// "r g b" triples matching hlColor()'s rgba() map (PdfPage.tsx) — ColorSwatchRow wants a plain
// triple it can compose its own opacity around, not the pre-alpha'd rgba() string.
const HL_SWATCH_RGB: Record<(typeof HL_COLORS)[number], string> = {
  yellow: '250 204 21',
  green: '74 222 128',
  blue: '96 165 250',
  pink: '244 114 182',
  orange: '251 146 60',
  purple: '192 132 252',
}

interface SelToolbar {
  page: number
  rects: Array<{ x: number; y: number; w: number; h: number }>   // normalised to page
  text: string
  x: number; y: number   // screen coords for the toolbar
}

interface FindMatch { page: number; index: number }

interface TocItem { title: string; page: number | null; depth: number }
type Bookmark = PdfBookmark
// Shape of a raw pdf.js outline node (typed loosely; pdf.js types are permissive)
interface RawOutlineNode { title: string; dest: string | unknown[] | null; items?: RawOutlineNode[] }

export default function PDFViewer({ floating = false }: { floating?: boolean }) {
  const isActivePdfPanel = useIsActivePanel('pdf')
  const isActivePanel = floating || isActivePdfPanel
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

  // Bookmarks live in the database since v46 (they sync with the PDF's highlights). The
  // pre-v46 localStorage list is imported the first time each PDF is opened and then left in
  // place, read-only, as a safety net for one release.
  const bookmarkKey = pdfId ? `berean:pdfBookmarks:${pdfId}` : ''
  async function loadBookmarks() {
    if (!pdfId) return
    try {
      let legacy: Array<{ page: number; label: string; createdAt?: number }> = []
      try { legacy = JSON.parse(localStorage.getItem(bookmarkKey) ?? '[]') } catch { legacy = [] }
      if (legacy.length) await window.pdf.bookmarksImport(pdfId, legacy)
      setBookmarks(await window.pdf.bookmarksList(pdfId))
    } catch { setBookmarks([]) }
  }
  async function addBookmark() {
    if (!pdfId) return
    const label = prompt('Bookmark label:', `Page ${currentPage}`)
    if (label === null) return
    try {
      await window.pdf.bookmarksAdd(pdfId, currentPage, label || `Page ${currentPage}`)
      setBookmarks(await window.pdf.bookmarksList(pdfId))
    } catch { /* keep the list as is */ }
    setPanelOpen(true)
  }
  async function removeBookmark(idx: number) {
    const b = bookmarks[idx]
    if (!b || !pdfId) return
    setBookmarks(bookmarks.filter((_, i) => i !== idx))
    try { await window.pdf.bookmarksRemove(b.id); setBookmarks(await window.pdf.bookmarksList(pdfId)) } catch { /* optimistic removal stands */ }
  }

  // ── Load document ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfId) return
    let cancelled = false
    setDoc(null); setLoadError(null); setNumPages(0)
    window.pdf.readBytes(pdfId)
      .then((bytes) => {
        if (!bytes) throw new Error('This PDF was imported on another device. Use Import PDF and choose the same file to read it here — your highlights and bookmarks are already waiting.')
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
    void loadBookmarks()
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
    return <div className="flex items-center justify-center h-full text-subhead text-text-muted">No PDF selected</div>
  }

  return (
    <div className="flex flex-col h-full bg-surface-1">
      {/* CONTEXT zone — title doubles as the PDF switcher / library button, plus the page
          indicator. Docked, this portals into ShellHeader's shared bar; floating, TabHeaderPortal
          renders the actual PanelHeader bar (see that component). */}
      <TabHeaderPortal floating={floating} active={isActivePanel} zone="context">
        <Button
          variant="ghost" size="sm"
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPdfSwitcher({ x: r.left, y: r.bottom + 4 }) }}
          tooltip="Switch PDF / library"
          className="min-w-0 justify-start px-1 -mx-1"
        >
          <FileText size={14} className="text-text-muted flex-shrink-0" />
          <span className="min-w-0 text-subhead font-semibold text-text-primary truncate transition-colors">{title}</span>
          <ChevronDownIcon size={12} className="flex-shrink-0 text-text-muted" />
        </Button>
        <span className="text-caption text-text-muted tabular-nums flex-shrink-0 px-1">
          {numPages ? `${currentPage} / ${numPages}` : '…'}
        </span>
      </TabHeaderPortal>

      {/* ACTIONS zone — tool buttons, grouped by what they act on, folding into ONE "…" via
          OverflowGroup as the bar narrows (§17). "Outline & highlights" stays OUTSIDE the
          OverflowGroup, after it: it's a panel-chrome toggle (opens the right-side panel), the
          same role as Scripture's inspector toggle, so it's never subject to folding rather than
          pinned inside the fold system — see BiblePanel.tsx's zone comment for why "never" +
          "inside" don't mix for a trailing control (OverflowGroup hoists `never` children to the
          FRONT of its own row). */}
      <TabHeaderPortal floating={floating} active={isActivePanel} zone="actions">
        <OverflowGroup label="More">
          <OverflowSection priority="last" items={[
            { key: 'zoom-out', label: 'Zoom out', icon: ZoomOut, onSelect: () => changeScale(scale - 0.15) },
            { key: 'zoom-in', label: 'Zoom in', icon: ZoomIn, onSelect: () => changeScale(scale + 0.15) },
          ]}>
            <ControlGroup>
              <IconButton icon={ZoomOut} label="Zoom out" size={28} onClick={() => changeScale(scale - 0.15)} />
              <IconButton icon={ZoomIn} label="Zoom in" size={28} onClick={() => changeScale(scale + 0.15)} />
            </ControlGroup>
          </OverflowSection>
          <OverflowSection items={[
            { key: 'find', label: 'Find', icon: Search, shortcut: '⌘F', checked: findOpen, onSelect: () => setFindOpen((v) => !v) },
          ]}>
            <IconButton icon={Search} label="Find" tooltip={{ shortcut: '⌘F' }} size={28} selected={findOpen} onClick={() => setFindOpen((v) => !v)} />
          </OverflowSection>
          <OverflowSection items={[
            { key: 'bookmark', label: 'Add bookmark at current page', icon: BookmarkPlus, onSelect: addBookmark },
          ]}>
            <IconButton icon={BookmarkPlus} label="Add bookmark at current page" size={28} onClick={addBookmark} />
          </OverflowSection>
          {!floating && (
            <OverflowSection items={[
              { key: 'new-scripture-tab', label: 'New Scripture tab', icon: BookOpen, onSelect: () => useAppStore.getState().createTab('bible') },
            ]}>
              <IconButton icon={BookOpen} label="New Scripture tab" size={28} onClick={() => useAppStore.getState().createTab('bible')} />
            </OverflowSection>
          )}
        </OverflowGroup>
        {!floating && (
          <IconButton icon={PanelRightIcon} label="Outline & highlights" size={28} active={panelOpen} onClick={() => setPanelOpen((v) => !v)} />
        )}
      </TabHeaderPortal>

      {/* Find bar */}
      {findOpen && (
        <div className="flex items-center gap-2 mx-2 my-1.5 px-2 py-1.5 material-popover rounded-menu flex-shrink-0">
          <SearchField
            autoFocus
            value={findQuery}
            onValueChange={(v) => { setFindQuery(v); runFind(v, findScope) }}
            onKeyDown={(e) => { if (e.key === 'Enter') navMatch(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setFindOpen(false) }}
            placeholder={findScope === 'page' ? 'Find on this page…' : 'Find in entire book…'}
            wrapperClassName="flex-1"
          />
          <SegmentedControl
            value={findScope}
            onChange={(s) => { setFindScope(s); runFind(findQuery, s) }}
            options={[{ value: 'page', label: 'Page' }, { value: 'book', label: 'Book' }]}
            aria-label="Find scope"
          />
          <span className="text-caption2 text-text-muted tabular-nums flex-shrink-0">{matches.length ? `${matchIdx + 1}/${matches.length}` : '0'}</span>
          <IconButton icon={ChevronUp} label="Previous match" size={24} tooltip={false} onClick={() => navMatch(-1)} />
          <IconButton icon={ChevronDown} label="Next match" size={24} tooltip={false} onClick={() => navMatch(1)} />
          <IconButton icon={X} label="Close find" size={24} tooltip={false} onClick={() => setFindOpen(false)} />
        </div>
      )}

      {/* Body: pages + optional side panel */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Pages scroll area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-w-0" onMouseUp={onMouseUp} style={{ contain: 'paint' }}>
          {loadError && <div className="p-6 text-center text-subhead text-destructive">{loadError.startsWith("This PDF was imported") ? loadError : `Failed to load PDF: ${loadError}`}</div>}
          {!doc && !loadError && <div className="p-6 text-center text-subhead text-text-muted">Loading PDF…</div>}
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
          <div className="material-panel w-64 flex-shrink-0 flex flex-col border-l border-separator overflow-hidden">
            <div className="p-1.5 border-b border-separator flex-shrink-0">
              <SegmentedControl
                value={panelTab}
                onChange={setPanelTab}
                options={[{ value: 'outline', label: 'Outline' }, { value: 'highlights', label: 'Highlights' }]}
                fill
                aria-label="Panel section"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {panelTab === 'outline' && (
                <div className="py-1">
                  {/* Bookmarks */}
                  <div className="flex items-center justify-between">
                    <SectionLabel className="px-2">Bookmarks</SectionLabel>
                    <IconButton icon={BookmarkPlus} label="Add bookmark" size={20} tooltip={false} onClick={addBookmark} />
                  </div>
                  {bookmarks.length === 0 && <div className="px-2 py-1 text-caption text-text-muted italic">No bookmarks</div>}
                  {bookmarks.map((b, i) => (
                    <ListRow key={b.id} dense
                      leading={<BookmarkIcon size={12} className="text-accent" />}
                      title={b.label}
                      meta={`p.${b.page}`}
                      onClick={() => scrollToPage(b.page)}
                      trailing={
                        <IconButton icon={X} label="Remove bookmark" size={20} tooltip={false}
                          onClick={(e) => { e.stopPropagation(); removeBookmark(i) }} />
                      }
                    />
                  ))}
                  {/* TOC */}
                  <SectionLabel className="px-2 pt-3">Contents</SectionLabel>
                  {toc.length === 0 && <div className="px-2 py-1 text-caption text-text-muted italic">No table of contents</div>}
                  {toc.map((item, i) => (
                    <ListRow key={i} dense
                      title={item.title}
                      disabled={!item.page}
                      indent={8 + item.depth * 12}
                      onClick={() => item.page && scrollToPage(item.page)}
                    />
                  ))}
                </div>
              )}
              {panelTab === 'highlights' && (
                <div className="py-1">
                  {highlights.length === 0 && <div className="px-2 py-3 text-caption text-text-muted italic">No highlights yet — select text to add one</div>}
                  {highlights.map((h) => (
                    <ListRow key={h.id}
                      leading={<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hlColor(h.color).replace('0.45', '0.9') }} />}
                      title={<span className="line-clamp-2 whitespace-normal">{h.text || '(no text)'}</span>}
                      meta={`p.${h.page}`}
                      onClick={() => scrollToPage(h.page)}
                      trailing={
                        <IconButton icon={Trash2} label="Remove highlight" size={20} tooltip={false} danger
                          onClick={(e) => { e.stopPropagation(); removeHighlight(h.id) }} />
                      }
                    />
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
          className="fixed z-popover flex items-center gap-1 px-1.5 py-1 material-popover rounded-menu"
          style={{ left: Math.min(selToolbar.x, window.innerWidth - 240), top: selToolbar.y + 6 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <ColorSwatchRow
            value={null}
            onChange={(c) => c && addHighlight(c)}
            swatches={HL_COLORS.map((c) => ({ id: c, rgb: HL_SWATCH_RGB[c], label: `Highlight ${c}` }))}
            size={20}
          />
          <Divider orientation="vertical" className="h-4 mx-0.5" />
          <IconButton icon={NotepadText} label="Highlight + new note" size={24} tooltip={false} onClick={highlightAndNote} />
          <IconButton icon={Link2} label="Copy link to selection" size={24} tooltip={false} onClick={copyLinkToSelection} />
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
