import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Search, ChevronRight, ChevronLeft, Check, CornerDownLeft } from 'lucide-react'
import type { Book } from '@/types'
import { useSheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { displayBookName } from '@/lib/parseRef'
import { displayChapter, chapterNumberingNote } from '@/lib/chapterNumbering'
import { isHermasBook, getHermasValidChaptersFor, getHermasShortLabel, hermasVariantForTextId } from '@/lib/hermasMap'
import { textChapterCount } from '@/lib/textCoverage'
import {
  PASSAGE_COLLECTIONS, collectionForText, singleBookOf, bookLabelInCollection, resolvePassageQuery,
  type PassageCollection, type PassageDestination, type CollectionGroup,
} from '@/lib/passageDestinations'
import './picker.css'

/** Where a Scripture destination picker sends the user. */
export interface PassagePick { textId: string; bookId: string; chapter: number; verse?: number; endVerse?: number }
export interface PassagePickerProps {
  /** The text / book / chapter the picker is opened from (marked as current, and the start view). */
  textId: string
  bookId: string
  chapter: number
  /** A final destination (a verse, or a search result): the caller navigates AND closes the picker. */
  onPick: (dest: PassagePick) => void
  /** A chapter was chosen (SEP25 PICKER-FLOW): the caller navigates its Scripture tab to it but
   *  must NOT close the picker — the picker moves on to that chapter's verse grid, and choosing a
   *  verse then arrives through `onPick`. Without it (legacy callers) a chapter still opens the
   *  verse grid, with a "Whole chapter" row that picks the chapter itself. */
  onChapter?: (dest: PassagePick) => void
}

// ── shared state + navigation ────────────────────────────────────────────────────────────────

type Current = { textId: string; bookId: string; chapter: number }
interface Shared {
  /** The passage the picker marks as current — follows chapters chosen while it is open. */
  store: { get: () => Current; subscribe: (fn: () => void) => () => void; set: (c: Current) => void }
  pick: (d: PassagePick) => void
  /** Chapters navigate live (the caller passed `onChapter`). */
  live: boolean
  /** Tell the caller (live) and mark it current — the view then pushes the verse grid. */
  chooseChapter: (d: PassagePick) => void
}
const SharedCtx = createContext<Shared | null>(null)
interface PickerView { key: string; title: string; node: React.ReactNode }
interface LocalNav { push: (v: PickerView) => void; pop: () => void; depth: number; back?: string }
const LocalNavCtx = createContext<LocalNav | null>(null)

function useShared(): Shared {
  const s = useContext(SharedCtx)
  if (!s) throw new Error('PassagePicker view outside <PassagePicker>')
  return s
}
function useCurrent(): Current {
  const { store } = useShared()
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Push a view: inside a sheet it becomes an in-sheet sub-view (automatic back control, same
 *  detent — never `expand`); outside one (tests, a plain page) a local stack. */
function usePush(): (v: PickerView) => void {
  const api = useSheetApi()
  const local = useContext(LocalNavCtx)
  const shared = useShared()
  return (v) => {
    if (local) { local.push(v); return }
    if (api) api.push({ key: v.key, title: v.title, render: () => <SharedCtx.Provider value={shared}>{v.node}</SharedCtx.Provider> })
  }
}

/** Choosing a chapter (tap or a bare-chapter search): Scripture follows at once (live callers),
 *  the picker stays open and moves to that chapter's verse grid. */
function useChooseChapter(): (d: PassagePick, title: string) => void {
  const { chooseChapter } = useShared()
  const push = usePush()
  return (d, title) => {
    chooseChapter(d)
    push({ key: `v:${d.textId}:${d.bookId}:${d.chapter}`, title, node: <VersesView textId={d.textId} bookId={d.bookId} chapter={d.chapter} title={title} /> })
  }
}

// ── data ────────────────────────────────────────────────────────────────────────────────────

const booksCache = new Map<string, Promise<Book[]>>()
/** Books already loaded — a view re-shown by Back renders at once instead of flashing "Loading…". */
const booksLoaded = new Map<string, Book[]>()
/** A text's books (cached per session), names normalised through the shared displayBookName. */
function loadBooks(textId: string): Promise<Book[]> {
  let p = booksCache.get(textId)
  if (!p) {
    p = Promise.resolve()
      .then(() => window.bible.getBooks(textId))
      .then((rows) => (rows ?? []).map((b) => ({ ...b, name: displayBookName(b.name, b.id) })))
      .then((books) => { booksLoaded.set(textId, books); return books })
    p.catch(() => booksCache.delete(textId))
    booksCache.set(textId, p)
  }
  return p
}
function useBooks(textId: string): Book[] | null {
  const [books, setBooks] = useState<Book[] | null>(() => booksLoaded.get(textId) ?? null)
  useEffect(() => {
    let alive = true
    setBooks(booksLoaded.get(textId) ?? null)
    loadBooks(textId).then((b) => { if (alive) setBooks(b) }, () => { if (alive) setBooks([]) })
    return () => { alive = false }
  }, [textId])
  return books
}

/** Stored chapters of a book in a text, with their display labels (RCL3 gap, Hermas sections). */
function chapterList(textId: string, book: { id: string; chapters_count?: number }): Array<{ stored: number; label: string; aria: string }> {
  if (isHermasBook(book.id)) {
    const variant = hermasVariantForTextId(textId)
    return getHermasValidChaptersFor(book.id, variant).map((c) => {
      const label = getHermasShortLabel(book.id as 'HER_VIS', c, variant)
      return { stored: c, label, aria: label.replace('Vis.', 'Vision').replace('Man.', 'Mandate').replace('Sim.', 'Similitude') }
    })
  }
  const count = book.chapters_count || textChapterCount(textId, book.id) || 1
  return Array.from({ length: count }, (_, i) => {
    const d = String(displayChapter(book.id, i + 1))
    return { stored: i + 1, label: d, aria: `Chapter ${d}` }
  })
}

const TESTAMENT_TITLE: Record<string, string> = { OT: 'Old Testament', NT: 'New Testament', Apocrypha: 'Apocrypha', Pseudepigrapha: 'Books' }
const groupTitle = (t: string) => TESTAMENT_TITLE[t] ?? t ?? 'Books'

/** A library's testament groups in book order (KJV: OT · Apocrypha · NT; LXX: OT · Apocrypha). */
export function libraryGroups(books: Array<{ testament: string }>): string[] {
  const out: string[] = []
  for (const b of books) if (!out.includes(b.testament)) out.push(b.testament)
  return out
}

/** The levels a library opens with, by its shape (SEP25): one book → its chapters; several
 *  testament groups → the groups; otherwise → its books. Never assumes a fixed depth. */
export function libraryShape(books: Array<{ testament: string }>): 'chapters' | 'groups' | 'books' {
  if (books.length === 1) return 'chapters'
  return libraryGroups(books).length > 1 ? 'groups' : 'books'
}

// ── views ───────────────────────────────────────────────────────────────────────────────────

function Row({ title, subtitle, current, onClick, label }: { title: string; subtitle?: string; current?: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" className={`m-pp-row${current ? ' is-current' : ''}`} onClick={onClick}
      aria-current={current ? 'true' : undefined} aria-label={label ?? (subtitle ? `${title}, ${subtitle}` : title) + (current ? ', current' : '')}
      data-current={current ? '' : undefined}>
      <span className="m-pp-row-text">
        <span className="m-pp-row-title">{title}</span>
        {subtitle && <span className="m-pp-row-sub">{subtitle}</span>}
      </span>
      {current && <Check className="m-pp-row-check" size={18} aria-hidden />}
      <ChevronRight className="m-pp-row-chevron" size={18} aria-hidden />
    </button>
  )
}

/** The view a collection opens — library-aware (SEP25): a single-book library opens at its
 *  chapters, a library with testament groups (KJV, LXX) at those groups, others at their books. */
function collectionView(c: { textId: string; group?: CollectionGroup; short: string }): PickerView {
  const single = !c.group ? singleBookOf(c.textId) : null
  if (single) return { key: `ch:${c.textId}:${single}`, title: c.short, node: <ChaptersView textId={c.textId} bookId={single} /> }
  if (c.group) return { key: `books:${c.textId}:${c.group}`, title: c.short, node: <BooksView textId={c.textId} group={c.group} /> }
  return { key: `lib:${c.textId}`, title: c.short, node: <LibraryView textId={c.textId} /> }
}
function groupView(textId: string, group: string): PickerView {
  return { key: `books:${textId}:${group}`, title: groupTitle(group), node: <BooksView textId={textId} group={group} /> }
}

function LibraryView({ textId }: { textId: string }) {
  const books = useBooks(textId)
  if (!books) return <div className="m-pp" aria-busy="true"><div className="mobile-empty">Loading…</div></div>
  const shape = libraryShape(books)
  if (shape === 'chapters') return <ChaptersView textId={textId} bookId={books[0].id} />
  if (shape === 'books') return <BooksView textId={textId} />
  return <GroupsView textId={textId} books={books} />
}

function GroupsView({ textId, books }: { textId: string; books: Book[] }) {
  const current = useCurrent()
  const push = usePush()
  const curGroup = textId === current.textId ? books.find((b) => b.id === current.bookId)?.testament : undefined
  return (
    <div className="m-pp">
      <PickerSearch textId={textId} placeholder="Book or passage — Matthew 10, 10:5 LXX…">
        <div className="m-pp-list">
          {libraryGroups(books).map((g) => {
            const n = books.filter((b) => b.testament === g).length
            return (
              <Row key={g} title={groupTitle(g)} subtitle={`${n} book${n === 1 ? '' : 's'}`} current={g === curGroup}
                onClick={() => { void haptic.selection(); push(groupView(textId, g)) }} />
            )
          })}
        </div>
      </PickerSearch>
    </div>
  )
}

function BooksView({ textId, group }: { textId: string; group?: string }) {
  const current = useCurrent()
  const push = usePush()
  const books = useBooks(textId)
  const listRef = useRef<HTMLDivElement>(null)
  // Bring the current book into view on open.
  useEffect(() => {
    if (!books) return
    const el = listRef.current?.querySelector<HTMLElement>('[data-current]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
  }, [books])
  if (!books) return <div className="m-pp" aria-busy="true"><div className="mobile-empty">Loading…</div></div>
  const shown = group ? books.filter((b) => b.testament === group) : books
  if (!shown.length) return <div className="m-pp"><div className="mobile-empty">No books.</div></div>
  if (shown.length === 1 && !group) return <ChaptersView textId={textId} bookId={shown[0].id} />
  const sections: Array<[string, Book[]]> = []
  for (const b of shown) {
    const t = groupTitle(b.testament)
    const s = sections.find(([k]) => k === t)
    if (s) s[1].push(b); else sections.push([t, [b]])
  }
  const headed = sections.length > 1
  return (
    <div className="m-pp" ref={listRef}>
      <PickerSearch textId={textId} placeholder="Book or passage — Matthew 10, 10:5 LXX…">
      {sections.map(([title, list]) => (
        <section key={title} className="m-pp-section" aria-label={headed ? title : undefined}>
          {headed && <h3 className="m-pp-section-title">{title}</h3>}
          <div className="m-pp-list">
            {list.map((b) => {
              const name = bookLabelInCollection(b.name, b.id)
              return (
                <Row key={b.id} title={name} current={textId === current.textId && b.id === current.bookId}
                  onClick={() => push({ key: `ch:${textId}:${b.id}`, title: name, node: <ChaptersView textId={textId} bookId={b.id} /> })} />
              )
            })}
          </div>
        </section>
      ))}
      </PickerSearch>
    </div>
  )
}

function ChaptersView({ textId, bookId }: { textId: string; bookId: string }) {
  const current = useCurrent()
  const choose = useChooseChapter()
  const books = useBooks(textId)
  if (!books) return <div className="m-pp" aria-busy="true"><div className="mobile-empty">Loading…</div></div>
  const book = books.find((b) => b.id === bookId) ?? { id: bookId, name: displayBookName('', bookId), chapters_count: 0 }
  const name = bookLabelInCollection(book.name, book.id)
  const chapters = chapterList(textId, book)
  const wide = isHermasBook(bookId)
  const note = chapterNumberingNote(bookId)
  const isCurrentBook = textId === current.textId && bookId === current.bookId
  return (
    <div className="m-pp">
      <PickerSearch textId={textId} bookId={bookId} placeholder={`${name} — 10, 10:5, or another passage`}>
      {note && <p className="m-pp-hint">{note}</p>}
      <div className={`m-pp-grid${wide ? ' is-wide' : ''}`} role="group" aria-label={`${name} chapters`}>
        {chapters.map((c) => {
          const cur = isCurrentBook && c.stored === current.chapter
          return (
            <button key={c.stored} type="button" className={`m-pp-cell${cur ? ' is-current' : ''}`} aria-current={cur ? 'true' : undefined}
              aria-label={`${name} ${c.aria}${cur ? ', current' : ''}`}
              onClick={() => choose({ textId, bookId, chapter: c.stored }, `${name} ${c.label}`)}>{c.label}</button>
          )
        })}
      </div>
      </PickerSearch>
    </div>
  )
}

function VersesView({ textId, bookId, chapter, title }: { textId: string; bookId: string; chapter: number; title: string }) {
  const { pick, live } = useShared()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => window.bible.queryChapter(bookId, chapter, textId))
      .then((vs) => { if (alive) setCount(vs?.length ? Math.max(...vs.map((v) => v.verse_num)) : 0) }, () => { if (alive) setCount(0) })
    return () => { alive = false }
  }, [textId, bookId, chapter])
  if (count == null) return <div className="m-pp" aria-busy="true"><div className="mobile-empty">Loading…</div></div>
  const n = count || 176 // unknown: an upper bound — the reader clamps to the real chapter
  return (
    <div className="m-pp">
      {/* Live callers already show this chapter; legacy ones get it as an explicit choice. */}
      {!live && <button type="button" className="m-pp-whole" onClick={() => pick({ textId, bookId, chapter })}>Whole chapter</button>}
      <div className="m-pp-grid" role="group" aria-label={`${title} verses`}>
        {Array.from({ length: n }, (_, i) => i + 1).map((v) => (
          <button key={v} type="button" className="m-pp-cell" aria-label={`${title}, verse ${v}`}
            onClick={() => pick({ textId, bookId, chapter, verse: v })}>{v}</button>
        ))}
      </div>
    </div>
  )
}

/**
 * The picker's search field — on EVERY level (SEP24-007): at the library it resolves collections,
 * books and passages; inside a collection it prefers that text; inside a book a bare "10" / "10:5"
 * is that book's chapter / verse. "… LXX" / "… KJV" anywhere selects that text's database.
 * While a query is typed the level's own list is replaced by the destinations.
 */
function PickerSearch({ textId, bookId, placeholder, children }: { textId: string; bookId?: string; placeholder: string; children: React.ReactNode }) {
  const { pick, live } = useShared()
  const push = usePush()
  const choose = useChooseChapter()
  const [query, setQuery] = useState('')
  const books = useBooks(textId)
  const results = useMemo(() => resolvePassageQuery(query, { textId, bookId, books: books ?? [] }), [query, textId, bookId, books])
  const open = (d: PassageDestination) => {
    void haptic.selection()
    if (d.kind === 'passage') {
      // A bare chapter ("Matthew 10") behaves like tapping that chapter; a verse is final.
      if (live && d.verse == null) { choose({ textId: d.textId, bookId: d.bookId, chapter: d.chapter }, d.label); return }
      pick({ textId: d.textId, bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse }); return
    }
    if (d.kind === 'book') { push({ key: `ch:${d.textId}:${d.bookId}`, title: d.label, node: <ChaptersView textId={d.textId} bookId={d.bookId} /> }); return }
    const c = PASSAGE_COLLECTIONS.find((x) => x.textId === d.textId && x.group === d.group)
    push(collectionView(c ?? { textId: d.textId, group: d.group, short: d.label }))
  }
  return (
    <>
      <form className="m-pp-search" role="search" onSubmit={(e) => { e.preventDefault(); if (results[0]) open(results[0]) }}>
        <Search size={17} aria-hidden />
        <input type="search" inputMode="text" autoCorrect="off" enterKeyHint="go" spellCheck={false}
          placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)}
          aria-label="Go to a collection, book or passage" data-no-sheet-drag />
      </form>
      {query.trim() ? (
        results.length ? (
          <div className="m-pp-list" role="list" aria-label="Destinations">
            {results.map((d, i) => (
              <button key={d.key} type="button" role="listitem" className={`m-pp-row${i === 0 ? ' is-first' : ''}`} onClick={() => open(d)}
                aria-label={`${d.kind === 'passage' ? 'Go to' : 'Open'} ${d.label}${d.subtitle ? `, ${d.subtitle}` : ''}`}>
                <span className="m-pp-row-text">
                  <span className="m-pp-row-title">{d.label}</span>
                  <span className="m-pp-row-sub">{d.kind === 'collection' ? 'Collection' : d.kind === 'book' ? `Book · ${d.subtitle ?? ''}` : `Passage · ${d.subtitle ?? ''}`}</span>
                </span>
                {d.kind === 'passage' ? <CornerDownLeft className="m-pp-row-chevron" size={18} aria-hidden /> : <ChevronRight className="m-pp-row-chevron" size={18} aria-hidden />}
              </button>
            ))}
          </div>
        ) : <div className="mobile-empty">Nothing matches “{query.trim()}”.</div>
      ) : children}
    </>
  )
}

function CollectionsView() {
  const current = useCurrent()
  const push = usePush()
  const currentColl = collectionForText(current.textId)
  const sections: Array<[string, PassageCollection[]]> = []
  for (const c of PASSAGE_COLLECTIONS) {
    const s = sections.find(([k]) => k === c.section)
    if (s) s[1].push(c); else sections.push([c.section, [c]])
  }
  return (
    <div className="m-pp">
      <PickerSearch textId={current.textId} placeholder="LXX, Genesis 3, 1 Cor 13, Enoch…">
        {sections.map(([title, list]) => (
          <section key={title} className="m-pp-section" aria-label={title}>
            <h3 className="m-pp-section-title">{title}</h3>
            <div className="m-pp-list">
              {list.map((c) => (
                <Row key={c.key} title={c.label} subtitle={c.subtitle} current={!c.group && c.key === currentColl?.key}
                  onClick={() => { void haptic.selection(); push(collectionView(c)) }} />
              ))}
            </div>
          </section>
        ))}
      </PickerSearch>
    </div>
  )
}

// ── root ────────────────────────────────────────────────────────────────────────────────────

/** Sheets this picker already pre-navigated in (so popping back to the root stays there). */
const prenavigated = new WeakMap<Element, string>()

/** The views a picker opened at `textId` / `bookId` starts inside: the library, then — for a
 *  library with testament groups — the group holding the current book (its book list). */
async function startChain(textId: string, bookId: string): Promise<PickerView[]> {
  const c = collectionForText(textId)
  if (!c) return []
  const first = collectionView(c)
  if (!first.key.startsWith('lib:')) return [first]
  const books = await loadBooks(c.textId).catch(() => [] as Book[])
  const group = libraryShape(books) === 'groups' ? books.find((b) => b.id === bookId)?.testament : undefined
  return group ? [first, groupView(c.textId, group)] : [first]
}

/**
 * Hierarchical, library-aware Scripture destination picker (NEW-11, SEP25):
 * Library → (testament group) → Book → Chapter → Verse, skipping levels a library does not have
 * (1 Enoch opens straight at its chapters). Renders inside ONE sheet with in-sheet navigation
 * (`useSheetApi().push`); opened from a reader it starts pre-navigated at the current book's list
 * (current book marked), and the back control climbs to the Library root. Every level has a search
 * field (`resolvePassageQuery`). Choosing a chapter calls `onChapter` (the reader follows at once)
 * and moves to that chapter's verse grid with the picker still open; choosing a verse calls
 * `onPick` (navigate + close). Nothing is remembered between presentations.
 * Outside a sheet (tests, a plain page) it keeps its own stack with a back button.
 */
export function PassagePicker({ textId, bookId, chapter, onPick, onChapter }: PassagePickerProps) {
  const api = useSheetApi()
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const onChapterRef = useRef(onChapter)
  onChapterRef.current = onChapter
  const live = !!onChapter
  const shared = useMemo<Shared>(() => {
    let cur: Current = { textId: textId.toLowerCase(), bookId, chapter }
    const subs = new Set<() => void>()
    const store: Shared['store'] = {
      get: () => cur,
      subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
      set: (c) => { cur = c; subs.forEach((fn) => fn()) },
    }
    return {
      store, live,
      pick: (d) => { void haptic.selection(); onPickRef.current(d) },
      chooseChapter: (d) => {
        void haptic.selection()
        if (!onChapterRef.current) return
        onChapterRef.current(d)
        store.set({ textId: d.textId.toLowerCase(), bookId: d.bookId, chapter: d.chapter })
      },
    }
  }, [textId, bookId, chapter, live])

  // Local stack (no sheet): starts pre-navigated.
  const [stack, setStack] = useState<PickerView[]>([])
  // Pre-navigate once per presentation. In a sheet the pushes are deferred a tick so they land
  // after the sheet's own mount-time reset of its view stack.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    if (!api) {
      void startChain(textId, bookId).then((chain) => { if (alive) setStack(chain) })
      return () => { alive = false }
    }
    if (api.depth > 0) return
    const sheetEl = rootRef.current?.closest('.mobile-sheet') ?? null
    const token = `${textId}|${bookId}|${chapter}`
    if (sheetEl) {
      if (prenavigated.get(sheetEl) === token) return
      prenavigated.set(sheetEl, token)
    }
    const t = setTimeout(() => {
      void startChain(textId, bookId).then((chain) => {
        if (!alive) return
        for (const v of chain) api.push({ key: v.key, title: v.title, render: () => <SharedCtx.Provider value={shared}>{v.node}</SharedCtx.Provider> })
      })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const local = useMemo<LocalNav | null>(() => api ? null : ({
    push: (v) => { void haptic.selection(); setStack((s) => [...s.filter((x) => x.key !== v.key), v]) },
    pop: () => setStack((s) => s.slice(0, -1)),
    depth: stack.length,
  }), [api, stack.length])

  const top = !api ? stack[stack.length - 1] : undefined
  return (
    <SharedCtx.Provider value={shared}>
      <LocalNavCtx.Provider value={local}>
        <div ref={rootRef} className="m-pp-root">
          {top ? (
            <>
              <button type="button" className="m-pp-back" onClick={() => local?.pop()} aria-label={`Back to ${stack.length > 1 ? stack[stack.length - 2].title : 'Library'}`}>
                <ChevronLeft size={20} aria-hidden /><span>{stack.length > 1 ? stack[stack.length - 2].title : 'Library'}</span>
              </button>
              <div className="m-pp-local-title" aria-live="polite">{top.title}</div>
              <React.Fragment key={top.key}>{top.node}</React.Fragment>
            </>
          ) : <CollectionsView />}
        </div>
      </LocalNavCtx.Provider>
    </SharedCtx.Provider>
  )
}
