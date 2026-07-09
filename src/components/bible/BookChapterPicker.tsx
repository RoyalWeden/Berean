import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { Book } from '@/types'
import { normalizeBookQuery } from '@/lib/verseUtils'
import { isHermasBook, getHermasSections, getHermasSection, type HermasBookId } from '@/lib/hermasMap'
import { editionForTextId, type Edition } from '@/lib/bibleTexts'
import { bookName } from '@/lib/parseRef'

interface BookChapterPickerProps {
  books: Book[]
  currentBookId: string
  currentChapter: number
  onNavigate: (bookId: string, chapter: number) => void
  compact?: boolean
  /** Custom trigger content (e.g. an "add panel" icon) instead of the current book + chapter. */
  triggerLabel?: ReactNode
  /** Tooltip for the trigger when a custom triggerLabel is used. */
  triggerTitle?: string
  /** Override className for the custom-triggerLabel button (defaults to an icon-sized p-1 button). */
  triggerClassName?: string
  /** Override className on the outer wrapper div (default: "relative"). */
  wrapperClassName?: string
  /** Optional edition switcher shown in the dropdown, turning this into a unified
   *  book + chapter + edition/translation picker. When omitted, no edition UI. */
  editions?: Edition[]
  currentTextId?: string
  /** Switch to a translation textId (edition or, within a multi-translation edition, a
   *  specific translation). The popover stays open so the user can keep picking. */
  onSelectTranslation?: (id: string) => void
}

export default function BookChapterPicker({ books, currentBookId, currentChapter, onNavigate, compact, triggerLabel, triggerTitle, triggerClassName, wrapperClassName, editions, currentTextId, onSelectTranslation }: BookChapterPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editionsExpanded, setEditionsExpanded] = useState(false)
  const [activeBookId, setActiveBookId] = useState(currentBookId)

  // Edition / translation model (only when `editions` is provided).
  const currentEdition = currentTextId ? editionForTextId(currentTextId) : undefined
  const currentTransLabel = currentEdition?.translations.find((t) => t.id === currentTextId)?.label
  const currentEditionLabel = currentEdition?.label ?? currentTextId?.toUpperCase()
  // Typing filters editions too; matching editions auto-reveal even when collapsed.
  const filteredEditions = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = editions ?? []
    if (!q) return list
    return list.filter((e) => e.label.toLowerCase().includes(q) || e.translations.some((t) => t.label.toLowerCase().includes(q)))
  }, [editions, search])
  const editionQueryMatch = search.trim().length > 0 && filteredEditions.length > 0 && filteredEditions.length < (editions?.length ?? 0)
  const editionsShown = editionsExpanded || editionQueryMatch
  const [pos, setPos] = useState<{ left: number; top: number; openUp: boolean }>({ left: 0, top: 0, openUp: false })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const PANEL_W = 520
  const PANEL_H = 380

  // Position the (portaled) dropdown relative to the trigger, clamped to the viewport
  // so it's never clipped inside narrow/overflow-hidden containers (e.g. compare columns).
  function recomputePos() {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const pad = 8
    const left = Math.max(pad, Math.min(r.left, window.innerWidth - PANEL_W - pad))
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < PANEL_H + pad && r.top > spaceBelow
    const top = openUp ? Math.max(pad, r.top - PANEL_H - 4) : r.bottom + 4
    setPos({ left, top, openUp })
  }

  const currentBook = books.find((b) => b.id === currentBookId)

  useEffect(() => {
    if (open) {
      setActiveBookId(currentBookId)
      setSearch('')
      setEditionsExpanded(false)
      recomputePos()
      setTimeout(() => searchRef.current?.focus(), 30)
    }
  }, [open, currentBookId])

  // Keep the dropdown anchored while open (scroll/resize)
  useEffect(() => {
    if (!open) return
    const onMove = () => recomputePos()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  // Keep activeBookId synced when currentBookId changes externally
  useEffect(() => {
    setActiveBookId(currentBookId)
  }, [currentBookId])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      const inTrigger = containerRef.current?.contains(t)
      const inPanel = panelRef.current?.contains(t)
      if (!inTrigger && !inPanel) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Parse optional chapter number from the end of the search string.
  // Handles: "Genesis 3", "gen 3", "gen3", "genesis3", "1sam6", "1 sam 6", "2es4"
  function parseSearchChapter(raw: string): { bookQuery: string; chapter: number | null } {
    const trimmed = raw.trim()
    // With space: "Genesis 3", "1 Sam 6"
    let m = trimmed.match(/^(.*?)\s+(\d+)$/)
    if (m) return { bookQuery: m[1].trim(), chapter: parseInt(m[2], 10) }
    // No space, letter-only prefix: "gen6", "genesis6"
    m = trimmed.match(/^([a-zA-Z][a-zA-Z.]*)(\d+)$/)
    if (m) return { bookQuery: m[1].trim(), chapter: parseInt(m[2], 10) }
    // No space, numbered-book prefix: "1sam6", "2es4", "1clem3"
    m = trimmed.match(/^(\d+[a-zA-Z][a-zA-Z.]*)(\d+)$/)
    if (m) return { bookQuery: m[1].trim(), chapter: parseInt(m[2], 10) }
    return { bookQuery: trimmed, chapter: null }
  }

  const { bookQuery, chapter: searchChapter } = parseSearchChapter(search)

  const filtered = books.filter((b) => {
    const rawQuery = bookQuery || search
    if (!rawQuery) return true
    const q = normalizeBookQuery(rawQuery.toLowerCase())
    return b.name.toLowerCase().includes(q) || b.short_name.toLowerCase().includes(q)
  })

  const otBooks = filtered.filter((b) => b.testament === 'OT')
  const ntBooks = filtered.filter((b) => b.testament === 'NT')
  const apocBooks = filtered.filter((b) => b.testament === 'Apocrypha' || b.testament === 'Pseudepigrapha')

  const activeBook = books.find((b) => b.id === activeBookId)

  function handleSearchChange(val: string) {
    setSearch(val)
    const { bookQuery: bq } = parseSearchChapter(val)
    const rawQuery = bq || val
    // Auto-select first matching book
    const first = books.find((b) => {
      const q = normalizeBookQuery(rawQuery.toLowerCase())
      return b.name.toLowerCase().includes(q) || b.short_name.toLowerCase().includes(q)
    })
    if (first) setActiveBookId(first.id)
  }

  function selectChapter(chapter: number) {
    onNavigate(activeBookId, chapter)
    setOpen(false)
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'Enter' && activeBook) {
      // If user typed a chapter number (e.g. "Genesis 3"), navigate to that chapter.
      // Clamp to the book's chapter count.
      const ch = searchChapter
        ? Math.max(1, Math.min(searchChapter, activeBook.chapters_count))
        : 1
      selectChapter(ch)
    }
  }

  const BookRow = ({ book }: { book: Book }) => (
    <button
      key={book.id}
      onClick={() => setActiveBookId(book.id)}
      className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer transition-colors rounded-sm ${
        book.id === activeBookId
          ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] font-medium'
          : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))]'
      }`}
    >
      {book.name}
    </button>
  )

  const GroupLabel = ({ label }: { label: string }) => (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
      {label}
    </div>
  )

  return (
    <div className={wrapperClassName ?? 'relative'} ref={containerRef}>
      {/* Trigger — custom (e.g. an "add panel" icon) or the default book + chapter label */}
      {triggerLabel ? (
        <button
          ref={triggerRef}
          onClick={() => setOpen((o) => !o)}
          title={triggerTitle}
          className={triggerClassName ?? `p-1 rounded transition-colors cursor-pointer ${open ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'}`}
        >
          {triggerLabel}
        </button>
      ) : (
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className={`
          flex items-center gap-1 rounded-md cursor-pointer transition-colors border
          ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'}
          ${open
            ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))]'
            : 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))] hover:border-[rgb(var(--color-accent))/50]'
          }
        `}
      >
        <span className="font-medium whitespace-nowrap">{currentBook?.name ?? bookName(currentBookId)}</span>
        {currentBook && isHermasBook(currentBook.id) ? (
          <span className="text-[rgb(var(--color-text-muted))] text-[10px] whitespace-nowrap">
            {(() => {
              const hid = currentBook.id as HermasBookId
              const sec = getHermasSection(hid, currentChapter)
              if (!sec) return currentChapter
              if (sec.chapters.length === 1) return sec.sectionName.replace('Vision', 'Vis.').replace('Mandate', 'Man.').replace('Similitude', 'Sim.')
              const sub = sec.chapters.indexOf(currentChapter) + 1
              return `${sec.sectionName.replace('Vision', 'Vis.').replace('Mandate', 'Man.').replace('Similitude', 'Sim.')}.${sub}`
            })()}
          </span>
        ) : (
          <span className="text-[rgb(var(--color-text-muted))] text-[10px]">{currentChapter}</span>
        )}
        {currentEdition && currentEdition.translations.length > 1 && currentTransLabel && (
          <span className="text-[rgb(var(--color-text-muted))] text-[10px] whitespace-nowrap border-l border-[rgb(var(--color-surface-4))] pl-1.5 ml-0.5">
            {currentTransLabel}
          </span>
        )}
        <ChevronDown size={compact ? 10 : 12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
      </button>
      )}

      {/* Dropdown panel — portaled to body + fixed so it's never clipped by overflow parents */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="
            fixed z-[9999] flex flex-col
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden
          "
          style={{ left: pos.left, top: pos.top, width: PANEL_W, maxHeight: PANEL_H }}
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={'Search books… or type “Genesis 3” and press Enter'}
              className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] outline-none placeholder:text-[rgb(var(--color-text-muted))]"
            />
            {searchChapter && activeBook && (
              <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]">
                → ch {Math.max(1, Math.min(searchChapter, activeBook.chapters_count))}
              </span>
            )}
          </div>

          {/* Edition switcher — collapsed by default; expand with the round triangle toggle,
              or it auto-reveals when the search matches an edition name. */}
          {editions && editions.length > 1 && onSelectTranslation && (
            <div className="px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
              <button
                onClick={() => setEditionsExpanded((v) => !v)}
                className="flex items-center gap-1.5 cursor-pointer group"
              >
                <span className="flex items-center justify-center w-4 h-4 rounded-full border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] group-hover:border-[rgb(var(--color-text-muted))] group-hover:text-[rgb(var(--color-text-primary))] transition-colors">
                  {editionsShown ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Edition</span>
                <span className="text-xs text-[rgb(var(--color-text-primary))] font-medium">{currentEditionLabel}</span>
              </button>
              {editionsShown && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {filteredEditions.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onSelectTranslation(e.translations[0].id)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                        e.id === currentEdition?.id
                          ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                          : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                  {filteredEditions.length === 0 && (
                    <span className="text-[11px] text-[rgb(var(--color-text-muted))]">No editions match</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Translation sub-picker — only when the current edition has multiple translations
              (e.g. Shepherd of Hermas: Roberts-Donaldson / Charles Taylor). */}
          {currentEdition && currentEdition.translations.length > 1 && onSelectTranslation && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mr-0.5">Translation</span>
              {currentEdition.translations.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTranslation(t.id)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                    t.id === currentTextId
                      ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white'
                      : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Two-column body */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Book list */}
            <div className="w-[55%] overflow-y-auto py-1 border-r border-[rgb(var(--color-surface-4))]">
              {otBooks.length > 0 && (
                <>
                  <GroupLabel label="Old Testament" />
                  {otBooks.map((b) => <BookRow key={b.id} book={b} />)}
                </>
              )}
              {ntBooks.length > 0 && (
                <>
                  <GroupLabel label="New Testament" />
                  {ntBooks.map((b) => <BookRow key={b.id} book={b} />)}
                </>
              )}
              {apocBooks.length > 0 && (
                <>
                  <GroupLabel label="Apocrypha / Pseudepigrapha" />
                  {apocBooks.map((b) => <BookRow key={b.id} book={b} />)}
                </>
              )}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-sm text-center text-[rgb(var(--color-text-muted))]">
                  No books found
                </div>
              )}
            </div>

            {/* Chapter grid / Hermas section picker */}
            <div className="w-[45%] overflow-y-auto p-3">
              {activeBook && isHermasBook(activeBook.id) ? (
                // Hermas: show Vision / Mandate / Similitude sections
                <div className="flex flex-col gap-1">
                  {getHermasSections(activeBook.id as HermasBookId).map((section) => (
                    <div key={section.sectionName}>
                      <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
                        {section.sectionName}
                      </div>
                      <div className="grid grid-cols-4 gap-0.5 pl-1">
                        {section.chapters.map((ch, subIdx) => (
                          <button
                            key={ch}
                            onClick={() => selectChapter(ch)}
                            className={`
                              flex items-center justify-center h-7 w-full text-[11px] rounded cursor-pointer transition-colors
                              ${activeBook.id === currentBookId && ch === currentChapter
                                ? 'bg-[rgb(var(--color-accent))] text-white font-semibold'
                                : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                              }
                            `}
                            title={section.chapters.length === 1 ? section.sectionName : `${section.sectionName}.${subIdx + 1}`}
                          >
                            {subIdx + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeBook ? (
                // Normal books: flat chapter grid
                <div className="grid grid-cols-5 gap-1">
                  {Array.from({ length: activeBook.chapters_count }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => selectChapter(n)}
                      className={`
                        flex items-center justify-center h-8 w-full text-xs rounded cursor-pointer transition-colors
                        ${activeBook.id === currentBookId && n === currentChapter
                          ? 'bg-[rgb(var(--color-accent))] text-white font-semibold'
                          : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                        }
                      `}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
