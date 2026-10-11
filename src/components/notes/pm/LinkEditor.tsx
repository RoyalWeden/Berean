import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { FileText, Globe, Maximize2, Minimize2, Check, Unlink } from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { formatDottedVerseRef } from '@/lib/parseRef'
import { Button, IconButton, SegmentedControl, TextField, SearchField, cx } from '@/components/ui'
import {
  readLinkAt, blockTextRange, applyLinkEdit, removeLinkIn, checkUrl, searchNotesForLink,
  wikilinkMatchesNote, linkTargetKey, type LinkTarget, type LinkDestination, type ExistingLink,
} from './linkModel'

/**
 * The one link editor (TEST 2026-10-10 "unified link creator"): link selected text — or a whole
 * block — to another Berean note or to a web address, edit the text the link shows, change where
 * an existing link goes, or remove it. Opened by the formatting toolbar's Link button, the selection
 * bubble's Link button and a block's "Link…" action; all three share this component and
 * linkModel.ts, so there is one behaviour.
 *
 * Adaptive: a compact popover by the text for the common case; the expand button (or ⌘↵ / the
 * "Show preview" affordance) grows it in place into a larger panel with a taller note list and a
 * preview of the highlighted note — the same list + preview the `[[` note autocomplete shows.
 */

export interface LinkEditorRequest {
  target: LinkTarget
  /** Screen rect the popover hangs from (the selection, the block's handle, or the button). */
  anchor: { left: number; top: number; bottom: number }
}

type Mode = 'note' | 'url'
const MODE_KEY = 'berean.linkEditorMode'

function lastMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'url' ? 'url' : 'note' } catch { return 'note' }
}

function previewText(note: Note): string {
  return (note.content || '')
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
    .slice(0, 600)
}

function folderLabel(note: Note, folders: NoteFolder[]): string {
  if (note.folderId) {
    const byId = new Map(folders.map((f) => [f.id, f]))
    const path: string[] = []
    let cur = byId.get(note.folderId)
    let guard = 0
    while (cur && guard++ < 50) { path.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined }
    if (path.length) return path.join(' › ')
  }
  if (note.verseRef) return formatDottedVerseRef(note.verseRef)
  if (note.type === 'daily' || note.type === 'journal') return 'Daily Notes'
  return 'Notes'
}

function editedLabel(note: Note): string {
  const t = typeof note.updatedAt === 'number' ? note.updatedAt : Date.parse(String(note.updatedAt ?? ''))
  if (!t) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(t)
}

export default function LinkEditor({ view, request, notes, currentNoteId, onClose }: {
  view: EditorView
  request: LinkEditorRequest
  notes: Note[]
  currentNoteId?: string
  onClose: () => void
}) {
  // ── Read the link context ONCE, when the editor opens. Typing in this popover's own fields blurs
  //    the editor and can collapse its live selection, so everything works from this snapshot. ──
  const initial = useMemo(() => {
    const state = view.state
    let range: { from: number; to: number } | null
    let existing: ExistingLink | null = null
    if (request.target.kind === 'block') {
      range = blockTextRange(state.doc, request.target.pos)
      if (range) {
        const link = readLinkAt(state, range.from, range.to)
        // A block counts as "linked" only when one link covers all of its text.
        if (link && link.from <= range.from && link.to >= range.to) existing = link
      }
    } else {
      existing = readLinkAt(state, request.target.from, request.target.to)
      range = existing ? { from: existing.from, to: existing.to } : { from: request.target.from, to: request.target.to }
    }
    const text = existing?.text ?? (range ? state.doc.textBetween(range.from, range.to, ' ', ' ') : '')
    return { range, existing, text, block: request.target.kind === 'block' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const existingDest = initial.existing?.destination ?? null
  const existingNote = useMemo<Note | null>(() => {
    if (!existingDest) return null
    if (existingDest.kind === 'note') return notes.find((n) => n.id === existingDest.noteId) ?? null
    if (existingDest.kind === 'wikilink') return notes.find((n) => wikilinkMatchesNote(existingDest.title, n)) ?? null
    return null
  }, [existingDest, notes])

  const [mode, setMode] = useState<Mode>(() => {
    if (existingDest) return existingDest.kind === 'url' ? 'url' : 'note'
    // Selected text that is itself an address links to it.
    return checkUrl(initial.text).ok || /^www\./i.test(initial.text.trim()) ? 'url' : lastMode()
  })
  const [text, setText] = useState(initial.text)
  const [url, setUrl] = useState(() => (existingDest?.kind === 'url' ? existingDest.href : checkUrl(initial.text).ok ? initial.text.trim() : ''))
  const [urlTouched, setUrlTouched] = useState(false)
  // Fresh text that names a note (wholly or in part) starts the search with it; otherwise the
  // list opens on the most recently edited notes rather than on "no matches".
  const [query, setQuery] = useState(() => {
    const t = initial.text.trim().slice(0, 60)
    if (existingNote || !t) return ''
    return searchNotesForLink(notes, t, 1, currentNoteId).length ? t : ''
  })
  const [noteId, setNoteId] = useState<string | null>(existingNote?.id ?? null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [folders, setFolders] = useState<NoteFolder[]>([])

  useEffect(() => {
    window.notes?.getFolders?.().then(setFolders).catch(() => {})
  }, [])

  // Keep the words being linked visibly marked while focus is in this popover (linkModel.ts).
  useEffect(() => {
    if (initial.range && initial.range.to > initial.range.from) {
      view.dispatch(view.state.tr.setMeta(linkTargetKey, { ...initial.range }).setMeta('addToHistory', false))
    }
    return () => {
      if (!view.isDestroyed && linkTargetKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(linkTargetKey, null).setMeta('addToHistory', false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const results = useMemo(() => {
    const list = searchNotesForLink(notes, query, 50, currentNoteId)
    // A typed query that matches nothing still lets the current destination stay visible.
    if (noteId && !list.some((n) => n.id === noteId)) {
      const cur = notes.find((n) => n.id === noteId)
      if (cur && !query.trim()) list.unshift(cur)
    }
    return list
  }, [notes, query, currentNoteId, noteId])
  const selectedNote = noteId ? notes.find((n) => n.id === noteId) ?? null : null
  const activeNote = results[activeIdx] ?? selectedNote ?? null

  // Titles shared by more than one note get their folder shown so the right one can be told apart.
  const dupTitles = useMemo(() => {
    const seen = new Map<string, number>()
    for (const n of notes) { const k = (n.title || 'Untitled').trim().toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1) }
    return seen
  }, [notes])

  useEffect(() => { setActiveIdx(0) }, [query])

  const urlCheck = checkUrl(url)
  const textRequired = !initial.range || initial.range.from === initial.range.to
  const destination: LinkDestination | null = mode === 'url'
    ? (urlCheck.ok ? { kind: 'url', href: urlCheck.href } : null)
    : selectedNote
      // Editing a [[wikilink]] that still points at the same note keeps it a wikilink.
      ? (existingDest?.kind === 'wikilink' && wikilinkMatchesNote(existingDest.title, selectedNote)
        ? { kind: 'wikilink', title: existingDest.title }
        : { kind: 'note', noteId: selectedNote.id })
      : null
  const effectiveText = text.trim() ? text : (textRequired
    ? (mode === 'url' ? (urlCheck.ok ? urlCheck.href : '') : (selectedNote?.title || ''))
    : initial.text)
  const canApply = !!initial.range && !!destination && !!effectiveText
  const unchanged = !!existingDest && !!destination && text === initial.text && JSON.stringify(destination) === JSON.stringify(existingDest)

  function apply() {
    if (!canApply || !initial.range || !destination) return
    if (unchanged) { finish(); return }
    const size = view.state.doc.content.size
    const range = { from: Math.min(initial.range.from, size), to: Math.min(initial.range.to, size) }
    const tr = applyLinkEdit(view.state, range, effectiveText, destination)
    if (tr) view.dispatch(tr.scrollIntoView())
    try { localStorage.setItem(MODE_KEY, mode) } catch { /* per-viewer convenience only */ }
    finish()
  }

  function remove() {
    if (!initial.existing) return
    view.dispatch(removeLinkIn(view.state, initial.existing))
    finish()
  }

  function finish() {
    onClose()
    view.focus()
  }

  function chooseNote(n: Note) {
    setNoteId(n.id)
    // Linking fresh text: keep the user's wording; a caret link takes the note's title.
    if (textRequired && !text.trim()) setText(n.title || 'Untitled')
  }

  // ── Dismiss: Escape, a click outside, the app-wide close-menus events ──
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish() } }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('berean:closeMenus', onClose)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('berean:closeMenus', onClose)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Position: below the anchor, flipped above when there's no room; clamped to the window.
  //    Re-measured when the panel grows (expand) so it never runs off screen. ──
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = request.anchor.left - 12
    left = Math.max(pad, Math.min(left, vw - width - pad))
    let top = request.anchor.bottom + 8
    if (top + height + pad > vh) top = request.anchor.top - height - 8
    top = Math.max(pad, Math.min(top, vh - height - pad))
    setPos({ left, top })
  }, [expanded, mode, request.anchor.left, request.anchor.top, request.anchor.bottom])

  const firstFieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => firstFieldRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [mode])

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if ((e.metaKey || e.ctrlKey) && canApply) { apply(); return }
      const n = results[activeIdx]
      if (n && n.id !== noteId) chooseNote(n)
      else if (canApply) apply()
    }
  }

  const title = initial.existing ? 'Edit Link' : initial.block ? 'Link Block' : 'Add Link'

  const noteList = (
    <div
      role="listbox"
      aria-label="Notes"
      className={cx('overflow-y-auto rounded-control-sm border border-separator-subtle bg-surface-1/40 py-0.5', expanded ? 'flex-1 min-h-0' : 'max-h-[168px]')}
    >
      {results.length === 0 ? (
        <div className="px-3 py-3 text-caption text-text-tertiary">No notes match “{query.trim()}”.</div>
      ) : results.map((n, i) => {
        const chosen = n.id === noteId
        const dup = (dupTitles.get((n.title || 'Untitled').trim().toLowerCase()) ?? 0) > 1
        return (
          <button
            key={n.id}
            type="button"
            role="option"
            aria-selected={chosen}
            data-active={i === activeIdx ? '' : undefined}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => chooseNote(n)}
            className={cx(
              'w-full flex items-center gap-2 px-2 py-1 text-left rounded-[5px] cursor-pointer',
              i === activeIdx ? 'bg-lift-2' : 'hover:bg-lift-1',
            )}
          >
            <FileText size={13} strokeWidth={1.75} className="flex-shrink-0 text-text-tertiary" />
            <span className="flex-1 min-w-0">
              <span className={cx('block truncate text-footnote', chosen ? 'text-accent font-medium' : 'text-text-primary')}>{n.title || 'Untitled'}</span>
              <span className={cx('block truncate text-caption2', dup ? 'text-text-secondary' : 'text-text-tertiary')}>
                {folderLabel(n, folders)}{editedLabel(n) ? ` · ${editedLabel(n)}` : ''}
              </span>
            </span>
            {chosen && <Check size={13} strokeWidth={2.25} className="flex-shrink-0 text-accent" />}
          </button>
        )
      })}
    </div>
  )

  const panel = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      // `pm-toolbar-solid` — NoteEditorPM's outside-click dismissal of the selection bubble skips it.
      className={cx(
        'pm-toolbar-solid material-popover rounded-menu animate-menu-in flex flex-col gap-2 p-2.5 text-footnote',
        expanded ? 'w-[min(680px,calc(100vw-16px))] h-[min(460px,calc(100vh-16px))]' : 'w-[320px]',
      )}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 'var(--z-menu)' as unknown as number, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="text-footnote font-semibold text-text-primary flex-1 min-w-0 truncate">{title}</span>
        <SegmentedControl
          size="sm"
          aria-label="Link to"
          value={mode}
          onChange={(m) => setMode(m)}
          options={[{ value: 'note', label: 'Note', icon: FileText }, { value: 'url', label: 'Web', icon: Globe }]}
        />
        <IconButton
          icon={expanded ? Minimize2 : Maximize2}
          label={expanded ? 'Smaller' : 'Larger — more room to search, with a preview'}
          size={24}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <div className={cx('flex gap-3 min-h-0', expanded ? 'flex-1' : 'flex-col')}>
        <div className={cx('flex flex-col gap-2 min-h-0', expanded ? 'w-[300px] flex-shrink-0' : '')}>
          <label className="flex items-center gap-2">
            <span className="w-11 flex-shrink-0 text-right text-caption text-text-secondary">Text</span>
            <TextField
              size="sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } }}
              placeholder={textRequired ? 'Text to show' : initial.text}
              aria-label="Text to show"
              wrapperClassName="flex-1 min-w-0"
            />
          </label>

          {mode === 'url' ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <span className="w-11 flex-shrink-0 text-right text-caption text-text-secondary">Address</span>
                <TextField
                  ref={firstFieldRef}
                  size="sm"
                  type="url"
                  value={url}
                  invalid={urlTouched && !!url.trim() && !urlCheck.ok}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setUrlTouched(true); apply() } }}
                  placeholder="https://…"
                  aria-label="Web address"
                  wrapperClassName="flex-1 min-w-0"
                />
              </label>
              {url.trim() && !urlCheck.ok && (urlTouched || urlCheck.suggestion) && (
                <p className="pl-[52px] text-caption2 text-text-secondary">
                  {urlCheck.reason}
                  {urlCheck.suggestion && (
                    <button type="button" className="ml-1 text-accent hover:underline cursor-pointer" onClick={() => setUrl(urlCheck.suggestion!)}>
                      Use {urlCheck.suggestion}
                    </button>
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className={cx('flex flex-col gap-1.5 min-h-0', expanded && 'flex-1')}>
              <SearchField
                ref={firstFieldRef}
                value={query}
                onValueChange={setQuery}
                onKeyDown={onListKey}
                placeholder="Search notes"
                aria-label="Search notes"
              />
              {noteList}
            </div>
          )}
        </div>

        {expanded && (
          <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-control-sm bg-surface-2/60 border border-separator-subtle p-3 overflow-hidden">
            {mode === 'note' && activeNote ? (
              <>
                <p className="text-footnote font-semibold text-text-primary truncate">{activeNote.title || 'Untitled'}</p>
                <p className="text-caption2 text-text-tertiary mb-2 truncate">{folderLabel(activeNote, folders)}{editedLabel(activeNote) ? ` · Edited ${editedLabel(activeNote)}` : ''}</p>
                <p className="text-caption text-text-secondary leading-relaxed whitespace-pre-wrap break-words overflow-y-auto min-h-0">
                  {previewText(activeNote) || 'No content'}
                </p>
              </>
            ) : mode === 'url' ? (
              <div className="flex flex-col gap-1 text-caption text-text-secondary">
                <span className="text-footnote font-semibold text-text-primary">Web link</span>
                <span className="break-all">{urlCheck.ok ? urlCheck.href : 'Enter an address to link to.'}</span>
                <span className="text-text-tertiary">Opens in your browser. Berean links (berean://…) open inside the app.</span>
              </div>
            ) : (
              <span className="text-caption text-text-tertiary">Choose a note to see a preview.</span>
            )}
          </div>
        )}
      </div>

      {initial.block && (
        <p className="text-caption2 text-text-tertiary leading-snug">The link covers this block’s text; its content and formatting stay as they are unless you change the text above.</p>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        {initial.existing && (
          <Button variant="ghost" size="xs" icon={Unlink} onClick={remove}>Remove Link</Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={finish}>Cancel</Button>
        <Button variant="primary" size="xs" disabled={!canApply} onClick={apply}>{initial.existing ? 'Update' : 'Apply'}</Button>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
