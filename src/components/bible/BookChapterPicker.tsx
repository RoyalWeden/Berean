import { useState, useEffect, useLayoutEffect, useRef, useMemo, cloneElement, isValidElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, FileUp } from 'lucide-react'
import type { Book } from '@/types'
import { normalizeBookQuery } from '@/lib/verseUtils'
import { displayChapter, storedChapter, hasCustomChapterNumbering, chapterNumberingNote } from '@/lib/chapterNumbering'
import { isHermasBook, getHermasSections, getHermasSection, hermasVariantForTextId, type HermasBookId } from '@/lib/hermasMap'
import { hasPrologueChapter } from '@/lib/prologueBooks'
import { editionForTextId, type Edition } from '@/lib/bibleTexts'
import { bookName } from '@/lib/parseRef'
import { Button, Chip, IconButton, ListRow, RefChip, SearchField, SectionLabel, cx } from '@/components/ui'

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
  /** PDF library button, appended as the last icon in the Edition row (only rendered
   *  when both this and `editions` are provided) — receives the trigger's own
   *  bounding rect so the caller can position its PDF picker popover the same way
   *  the old standalone toolbar button did. */
  onOpenPdfLibrary?: (rect: DOMRect) => void
  /** Renders the default (non-custom-triggerLabel) trigger without its own border/
   *  background/rounded corners, so it can sit flush as the middle segment of an
   *  outer segmented-pill container (shared border, divider lines) instead of
   *  looking like its own separate pill next to the prev/next chapter arrows. */
  segmented?: boolean
  /** Optional contextual header strip shown above the search bar in the dropdown
   *  (e.g. "Compare Genesis 1 with…") — used by the "add comparison panel" picker
   *  to make clear what selecting a book/chapter here will do, since that popup is
   *  otherwise identical to the main chapter picker's. */
  popoverHeader?: string
  /** Window CustomEvent name that opens (and focuses the search field of) this picker — e.g.
   *  the main toolbar picker passes 'berean:focusRefBar' so ⌘L opens/focuses it. Omit on any
   *  secondary picker instance (add-compare-panel, etc.) so only one reacts. */
  focusEvent?: string
}

export default function BookChapterPicker({ books, currentBookId, currentChapter, onNavigate, compact, triggerLabel, triggerTitle, triggerClassName, wrapperClassName, editions, currentTextId, onSelectTranslation, onOpenPdfLibrary, segmented, popoverHeader, focusEvent }: BookChapterPickerProps) {
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
  // Scrolled into view whenever the popover opens (or the active book changes) — see the
  // useLayoutEffect below. Neither the book list nor the chapter grid did this at all before:
  // opening the picker on, say, Revelation always showed the book list scrolled to the top
  // (Genesis), and picking a book always showed the chapter grid scrolled to chapter 1, with no
  // indication of where the CURRENT book/chapter actually was without manually scrolling to find it.
  const activeBookRowRef = useRef<HTMLButtonElement>(null)
  const currentChapterBtnRef = useRef<HTMLButtonElement>(null)

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

  // useLayoutEffect (not useEffect) so `pos` is corrected before the browser paints — with a
  // plain useEffect, the first frame rendered with the initial {left:0, top:0} (top-left
  // corner), then a visible jump to the real position once the effect ran post-paint. Mirrors
  // the fix already used by MenuPositioner (usePositionedMenu.ts) for this exact class of bug.
  useLayoutEffect(() => {
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

  // Scroll the active book row and the current chapter cell into view — on open (activeBookId
  // was just set to currentBookId by the effect above, in the same before-paint cycle) and again
  // whenever the user picks a different book in the left column (a fresh chapter grid, which
  // should show its own current-chapter highlight if there is one, not start scrolled to the
  // top). useLayoutEffect + 'auto' (instant, no animation) — this is a popover that just
  // appeared/just switched books, not a navigation the user should watch glide.
  useLayoutEffect(() => {
    if (!open) return
    activeBookRowRef.current?.scrollIntoView({ block: 'center' })
    currentChapterBtnRef.current?.scrollIntoView({ block: 'center' })
  }, [open, activeBookId])

  // Keep activeBookId synced when currentBookId changes externally
  useEffect(() => {
    setActiveBookId(currentBookId)
  }, [currentBookId])

  // ⌘L (Focus scripture reference bar) — opens this picker; the open-effect above already
  // focuses the search field, so opening here reproduces the old "focus the ref bar" behavior.
  useEffect(() => {
    if (!focusEvent) return
    function onFocusEvent() { setOpen(true) }
    window.addEventListener(focusEvent, onFocusEvent)
    return () => window.removeEventListener(focusEvent, onFocusEvent)
  }, [focusEvent])

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

  // Clamp a typed chapter number to the book's valid range. Books with a chapter-0
  // Prologue (see prologueBooks.ts) allow 0 as their floor; everyone else floors at 1.
  // searchChapter is `number | null` and 0 is a legitimate value, so callers must not
  // use a plain truthy check here (0 is falsy in JS but a valid typed chapter).
  function clampSearchChapter(n: number, book: Book): number {
    const floor = hasPrologueChapter(book.id) ? 0 : 1
    // Typed number is the DISPLAYED chapter (RCL3 uses ANF 1, 12..75 — chapterNumbering.ts);
    // a skipped display number (RCL3 2–11) falls to the next real chapter.
    if (hasCustomChapterNumbering(book.id)) {
      let stored: number | null = null
      for (let d = n; stored == null && d <= displayChapter(book.id, book.chapters_count); d++) stored = storedChapter(book.id, d)
      n = stored ?? book.chapters_count
    }
    return Math.max(floor, Math.min(n, book.chapters_count))
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'Enter' && activeBook) {
      // If user typed a chapter number (e.g. "Genesis 3"), navigate to that chapter.
      const ch = searchChapter !== null ? clampSearchChapter(searchChapter, activeBook) : 1
      selectChapter(ch)
    }
  }

  const BookRow = ({ book }: { book: Book }) => (
    <ListRow
      key={book.id}
      buttonProps={{ ref: book.id === activeBookId ? activeBookRowRef : undefined }}
      onClick={() => setActiveBookId(book.id)}
      selected={book.id === activeBookId}
      title={book.name}
    />
  )

  const GroupLabel = ({ label }: { label: string }) => (
    <SectionLabel className="px-3 pt-2 pb-1">{label}</SectionLabel>
  )

  return (
    <div className={wrapperClassName ?? 'relative'} ref={containerRef}>
      {/* Trigger — custom (e.g. an "add panel" icon, typically an <IconButton>) or the default
          book + chapter label. When `triggerLabel` is a primitive that already renders its own
          <button> (IconButton), it's cloned in place with the ref/handler wired on rather than
          wrapped in a second <button> — avoids nested interactive elements. */}
      {triggerLabel ? (
        isValidElement(triggerLabel) ? (
          cloneElement(triggerLabel as React.ReactElement<Record<string, unknown>>, {
            ref: triggerRef,
            onClick: () => setOpen((o) => !o),
            active: open,
          })
        ) : (
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            selected={open}
            onClick={() => setOpen((o) => !o)}
            tooltip={triggerTitle}
            className={triggerClassName}
          >
            {triggerLabel}
          </Button>
        )
      ) : (
      <Button
        ref={triggerRef}
        variant={segmented ? 'ghost' : 'secondary'}
        size={compact ? 'sm' : 'md'}
        selected={open}
        onClick={() => setOpen((o) => !o)}
        className={segmented ? 'rounded-none' : undefined}
      >
        {/* Segmented (main toolbar) trigger reads as a title, not a plain button label —
            text-subhead font-semibold text-text-primary, matching TitleControl's own trigger
            typography so the two read as the same kind of control. */}
        <span className={cx('whitespace-nowrap', segmented ? 'text-subhead font-semibold text-text-primary' : 'font-medium')}>
          {currentBook?.name ?? bookName(currentBookId)}
        </span>
        {currentBook && isHermasBook(currentBook.id) ? (
          <span className="text-meta whitespace-nowrap">
            {(() => {
              const hid = currentBook.id as HermasBookId
              const sec = getHermasSection(hid, currentChapter, hermasVariantForTextId(currentTextId))
              if (!sec) return currentChapter
              if (sec.chapters.length === 1) return sec.sectionName.replace('Vision', 'Vis.').replace('Mandate', 'Man.').replace('Similitude', 'Sim.')
              const sub = sec.chapters.indexOf(currentChapter) + 1
              return `${sec.sectionName.replace('Vision', 'Vis.').replace('Mandate', 'Man.').replace('Similitude', 'Sim.')}.${sub}`
            })()}
          </span>
        ) : currentBook && hasPrologueChapter(currentBook.id) && currentChapter === 0 ? (
          <span className="text-meta whitespace-nowrap">Prologue</span>
        ) : (
          <span className="text-meta">{displayChapter(currentBookId, currentChapter)}</span>
        )}
        {/* Translation — a small static chip, not plain muted text, so it reads as a
            distinct piece of metadata rather than part of the title run. */}
        {currentEdition && currentEdition.translations.length > 1 && currentTransLabel && (
          <Chip static size="sm" className="flex-shrink-0">{currentTransLabel}</Chip>
        )}
        {/* LXX chip — the picker otherwise gives no visual cue at a glance that you're
            reading the Septuagint rather than KJVA, only distinguishable by actually reading
            the verse text or opening the picker itself. */}
        {currentTextId === 'lxx' && (
          <RefChip variant="lxx" size="xs" className="flex-shrink-0">LXX</RefChip>
        )}
        <ChevronDown size={12} strokeWidth={2} className="text-text-muted -mr-0.5 flex-shrink-0" />
      </Button>
      )}

      {/* Dropdown panel — portaled to body + fixed so it's never clipped by overflow parents */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="
            fixed z-menu flex flex-col
            material-popover rounded-menu overflow-hidden
          "
          style={{ left: pos.left, top: pos.top, width: PANEL_W, maxHeight: PANEL_H }}
        >
          {popoverHeader && (
            <div className="px-3 py-2 text-footnote font-semibold text-accent bg-accent-muted border-b border-separator flex-shrink-0">
              {popoverHeader}
            </div>
          )}
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-separator flex-shrink-0">
            <SearchField
              ref={searchRef}
              bare
              wrapperClassName="flex-1"
              value={search}
              onValueChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={'Search books… or type “Genesis 3” and press Enter'}
            />
            {searchChapter !== null && activeBook && (
              <RefChip size="xs" className="flex-shrink-0">
                → ch {clampSearchChapter(searchChapter, activeBook)}
              </RefChip>
            )}
          </div>

          {/* Edition switcher — collapsed by default; expand with the round triangle toggle,
              or it auto-reveals when the search matches an edition name. */}
          {editions && editions.length > 1 && onSelectTranslation && (
            <div className="px-3 py-2 border-b border-separator flex-shrink-0">
              <Button
                variant="ghost" size="sm"
                icon={editionsShown ? ChevronDown : ChevronRight}
                className="h-auto px-1 py-0.5 gap-1.5"
                onClick={() => setEditionsExpanded((v) => !v)}
              >
                <SectionLabel className="inline">Edition</SectionLabel>
                <span className="text-footnote text-text-primary font-medium">{currentEditionLabel}</span>
              </Button>
              {editionsShown && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {filteredEditions.map((e) => (
                    <Chip
                      key={e.id}
                      selected={e.id === currentEdition?.id}
                      onClick={() => onSelectTranslation(e.translations[0].id)}
                    >
                      {e.label}
                    </Chip>
                  ))}
                  {filteredEditions.length === 0 && (
                    <span className="text-caption text-text-muted">No editions match</span>
                  )}
                  {onOpenPdfLibrary && (
                    <IconButton
                      icon={FileUp}
                      label="PDF library — import or open a PDF"
                      size={24}
                      onClick={(e) => onOpenPdfLibrary((e.currentTarget as HTMLElement).getBoundingClientRect())}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Translation sub-picker — only when the current edition has multiple translations
              (e.g. Shepherd of Hermas: Roberts-Donaldson / Charles Taylor). */}
          {currentEdition && currentEdition.translations.length > 1 && onSelectTranslation && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-separator flex-shrink-0 flex-wrap">
              <SectionLabel className="mr-0.5">Translation</SectionLabel>
              {currentEdition.translations.map((t) => (
                <Chip
                  key={t.id}
                  selected={t.id === currentTextId}
                  onClick={() => onSelectTranslation(t.id)}
                >
                  {t.label}
                </Chip>
              ))}
            </div>
          )}

          {/* Two-column body */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Book list */}
            <div className="w-[55%] overflow-y-auto py-1 border-r border-separator">
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
                <div className="px-3 py-4 text-subhead text-center text-text-muted">
                  No books found
                </div>
              )}
            </div>

            {/* Chapter grid / Hermas section picker */}
            <div className="w-[45%] overflow-y-auto p-3">
              {activeBook && isHermasBook(activeBook.id) ? (
                // Hermas: show Vision / Mandate / Similitude sections
                <div className="flex flex-col gap-1">
                  {getHermasSections(activeBook.id as HermasBookId, hermasVariantForTextId(currentTextId)).map((section) => (
                    <div key={section.sectionName}>
                      <SectionLabel className="px-2 pt-1.5 pb-0.5">
                        {section.sectionName}
                      </SectionLabel>
                      <div className="grid grid-cols-4 gap-0.5 pl-1">
                        {section.chapters.map((ch, subIdx) => (
                          <button
                            key={ch}
                            ref={activeBook.id === currentBookId && ch === currentChapter ? currentChapterBtnRef : undefined}
                            onClick={() => selectChapter(ch)}
                            className={`
                              focus-ring flex items-center justify-center h-7 w-full text-caption rounded-row cursor-pointer transition-colors
                              ${activeBook.id === currentBookId && ch === currentChapter
                                ? 'bg-accent text-white font-semibold'
                                : 'text-text-primary hover:bg-surface-hover'
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
                // Normal books: flat chapter grid, with an optional "Prologue" row
                // (chapter 0 — unnumbered front matter, e.g. Sirach's translator's
                // prologue) spanning the full width above the numbered chapters.
                <div className="flex flex-col gap-1">
                  {hasPrologueChapter(activeBook.id) && (
                    <button
                      onClick={() => selectChapter(0)}
                      className={`
                        focus-ring flex items-center justify-center h-7 w-full text-caption font-medium rounded-row cursor-pointer transition-colors
                        ${activeBook.id === currentBookId && currentChapter === 0
                          ? 'bg-accent text-white'
                          : 'text-text-muted border border-dashed border-border hover:bg-surface-hover hover:text-text-primary'
                        }
                      `}
                    >
                      Prologue
                    </button>
                  )}
                  {chapterNumberingNote(activeBook.id) && (
                    <p className="text-caption text-text-muted px-1 pb-1">{chapterNumberingNote(activeBook.id)}</p>
                  )}
                  <div className="grid grid-cols-5 gap-1">
                    {Array.from({ length: activeBook.chapters_count }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        ref={activeBook.id === currentBookId && n === currentChapter ? currentChapterBtnRef : undefined}
                        onClick={() => selectChapter(n)}
                        className={`
                          focus-ring flex items-center justify-center h-7 w-full text-caption rounded-row cursor-pointer transition-colors
                          ${activeBook.id === currentBookId && n === currentChapter
                            ? 'bg-accent text-white font-semibold'
                            : 'text-text-primary hover:bg-surface-hover'
                          }
                        `}
                      >
                        {displayChapter(activeBook.id, n)}
                      </button>
                    ))}
                  </div>
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
