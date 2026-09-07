import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, X, Merge, Trash2, ArrowRight, ArrowLeft, ArrowLeftRight, Minus, ChevronLeft } from 'lucide-react'
import { TAG_SLOT_COUNT, tagSlotVar, resolveTagColor } from '@/lib/tagPalette'
import { useAppStore } from '@/store'
import { getTranslationForBook, bookChapterVerseLabel } from '@/lib/parseRef'
import { recordNavigation } from '@/lib/verseNavigation'
import TaggedVerseList, { type TaggedVerseGroup } from '@/components/bible/TaggedVerseList'
import type { TagEdge, VerseTag, VerseTagMember } from '@/types'

/** Jump the active Scripture tab to a verse (creating one if none is open) — mirrors
 *  VerseCopyMenu's "Open verse". */
function openVerseInCurrentTab(bookId: string, chapter: number, verse: number) {
  const store = useAppStore.getState()
  const tr = getTranslationForBook(bookId)
  let tabId = store.activeTabId['scripture']
  if (!tabId) {
    store.createTab('bible')
    tabId = useAppStore.getState().activeTabId['scripture']!
  }
  store.updateTabState('scripture', tabId, {
    bookId, chapter, targetVerse: verse, scrollPosition: 0,
    ...(tr ? { translation: tr } : {}),
  })
  store.setActiveSpace('scripture')
  recordNavigation({}, { bookId, chapter, verse }, { kind: 'other', label: 'tag-graph-inspector' })
}

interface Props {
  tags: VerseTag[]
  edges: TagEdge[]
  selectedTagId: string | null
  search: string
  onSearch: (q: string) => void
  onSelectTag: (id: string | null) => void
  onCreateTag: (name: string) => void
  onRenameTag: (id: string, name: string) => void
  onSetSlot: (id: string, slot: number) => void
  onMergeTag: (fromId: string, intoId: string) => void
  onDeleteTag: (id: string) => void
}

const ARROW_GLYPH = { none: Minus, forward: ArrowRight, backward: ArrowLeft, both: ArrowLeftRight }

const ROW =
  'w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left rounded-shell ' +
  'hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer text-[rgb(var(--color-text-primary))]'
const INPUT =
  'w-full px-2 py-1.5 text-[13px] rounded-shell bg-[rgb(var(--color-surface-1))/60] border border-[rgb(var(--color-surface-4))/60] ' +
  'outline-none focus:border-[rgb(var(--color-accent))] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]'

export default function TagGraphSidePanel(props: Props) {
  const {
    tags, edges, selectedTagId, search, onSearch, onSelectTag, onCreateTag, onRenameTag,
    onSetSlot, onMergeTag, onDeleteTag,
  } = props

  const selected = tags.find((t) => t.id === selectedTagId) ?? null
  const [newName, setNewName] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags
  }, [tags, search])

  const edgeCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1)
      m.set(e.target, (m.get(e.target) ?? 0) + 1)
    }
    return m
  }, [edges])

  return (
    <div className="h-full w-[300px] flex-shrink-0 border-r border-[rgb(var(--color-surface-4))/50] glass-panel flex flex-col">
      {selected ? (
        <TagInspector
          tag={selected}
          tags={tags}
          edges={edges}
          onBack={() => onSelectTag(null)}
          onRename={onRenameTag}
          onSetSlot={onSetSlot}
          onMerge={onMergeTag}
          onDelete={onDeleteTag}
          onSelectTag={onSelectTag}
        />
      ) : (
        <>
          <div className="p-3 flex flex-col gap-2 border-b border-[rgb(var(--color-surface-4))/50]">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-muted))]" />
              <input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search tags…"
                className={`${INPUT} pl-8 pr-7`}
              />
              {search && (
                <button
                  onClick={() => onSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); const n = newName.trim(); if (n) { onCreateTag(n); setNewName('') } }}
              className="flex items-center gap-1.5"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New tag…"
                className={`${INPUT} flex-1`}
              />
              <button
                type="submit"
                title="Create tag"
                className="p-1.5 rounded-shell bg-[rgb(var(--color-accent))] text-white cursor-pointer hover:brightness-110 transition-[filter]"
              >
                <Plus size={14} />
              </button>
            </form>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
            {filtered.map((t) => (
              <button key={t.id} onClick={() => onSelectTag(t.id)} className={ROW}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: resolveTagColor(t) }} />
                <span className="truncate flex-1">{t.name}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--color-text-secondary))] flex-shrink-0">
                  <span>{t.verseCount}{t.chapterCount ? `+${t.chapterCount}ch` : ''}</span>
                  <span className="inline-flex items-center gap-0.5" title="relationships">
                    <ArrowLeftRight size={10} className="text-[rgb(var(--color-text-muted))]" />
                    {edgeCount.get(t.id) ?? 0}
                  </span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-5 text-xs text-center text-[rgb(var(--color-text-muted))]">No tags.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SlotSwatches({ value, hasOverride, onPick }: { value: number | null; hasOverride: boolean; onPick: (slot: number) => void }) {
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {Array.from({ length: TAG_SLOT_COUNT }, (_, i) => (
        <button
          key={i}
          title={`Colour ${i + 1}`}
          onClick={() => onPick(i)}
          className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 ${
            value === i && !hasOverride ? 'ring-2 ring-[rgb(var(--color-text-primary))] ring-offset-1 ring-offset-transparent' : ''
          }`}
          style={{ backgroundColor: tagSlotVar(i) }}
        />
      ))}
    </div>
  )
}

function TagInspector({
  tag, tags, edges, onBack, onRename, onSetSlot, onMerge, onDelete, onSelectTag,
}: {
  tag: VerseTag
  tags: VerseTag[]
  edges: TagEdge[]
  onBack: () => void
  onRename: (id: string, name: string) => void
  onSetSlot: (id: string, slot: number) => void
  onMerge: (fromId: string, intoId: string) => void
  onDelete: (id: string) => void
  onSelectTag: (id: string) => void
}) {
  const [name, setName] = useState(tag.name)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [members, setMembers] = useState<VerseTagMember[] | null>(null)
  const [verseText, setVerseText] = useState<Record<string, { text: string; title?: string }>>({})
  const nameRef = useRef(tag.name)

  useEffect(() => { setName(tag.name); nameRef.current = tag.name }, [tag.id, tag.name])

  useEffect(() => {
    let alive = true
    setMembers(null)
    window.verseTags.getMembers([tag.id]).then(async (ms) => {
      if (!alive) return
      setMembers(ms)
      const refs = ms.flatMap((m) => m.verses).slice(0, 400)
        .map((v) => ({ bookId: v.bookId, chapter: v.chapter, verse: v.verse }))
      // preview the first several verses of any whole-chapter member too
      for (const m of ms) {
        for (const w of m.wholeChapters) {
          for (let v = 1; v <= 8; v++) refs.push({ bookId: w.bookId, chapter: w.chapter, verse: v })
        }
      }
      if (refs.length) {
        try {
          const map = await window.bible.queryVerses(refs)
          if (alive) setVerseText(map)
        } catch { /* ignore */ }
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [tag.id])

  const verseGroups: TaggedVerseGroup[] = useMemo(() => {
    if (!members) return []
    const groups: TaggedVerseGroup[] = []
    for (const m of members) {
      if (m.verses.length) {
        groups.push({
          key: m.memberId,
          label: m.label,
          kind: 'verses',
          rows: m.verses.map((v) => ({
            bookId: v.bookId, chapter: v.chapter, verse: v.verse,
            text: verseText[`${v.bookId}.${v.chapter}.${v.verse}`]?.text ?? '',
          })),
        })
      }
      for (const w of m.wholeChapters) {
        const rows: TaggedVerseGroup['rows'] = []
        for (let v = 1; v <= 8; v++) {
          const t = verseText[`${w.bookId}.${w.chapter}.${v}`]
          if (t) rows.push({ bookId: w.bookId, chapter: w.chapter, verse: v, text: t.text })
        }
        groups.push({
          key: `${m.memberId}-${w.bookId}-${w.chapter}`,
          label: bookChapterVerseLabel(w.bookId, w.chapter),
          kind: 'chapter',
          rows,
          truncatedNote: true,
        })
      }
    }
    return groups
  }, [members, verseText])

  const connected = useMemo(() => {
    const byId = new Map(tags.map((t) => [t.id, t]))
    return edges
      .filter((e) => e.source === tag.id || e.target === tag.id)
      .map((e) => {
        const otherId = e.source === tag.id ? e.target : e.source
        const outgoing = e.source === tag.id
        return { edge: e, other: byId.get(otherId), outgoing }
      })
      .filter((x) => x.other)
  }, [edges, tags, tag.id])

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[rgb(var(--color-surface-4))/50] flex flex-col gap-2.5">
        <button
          onClick={onBack}
          className="flex items-center gap-1 self-start px-1.5 py-0.5 -ml-1.5 rounded text-[11px] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          <ChevronLeft size={13} /> All tags
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { const n = name.trim(); if (n && n !== nameRef.current) { onRename(tag.id, n); nameRef.current = n } }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className={`${INPUT} !text-sm font-semibold`}
        />
        <SlotSwatches value={tag.colorSlot} hasOverride={!!tag.color} onPick={(i) => onSetSlot(tag.id, i)} />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMergeOpen((v) => !v)}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            <Merge size={12} /> Merge
          </button>
          <button
            onClick={() => onDelete(tag.id)}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-[rgb(var(--highlight-red))] hover:bg-red-500/15 transition-colors cursor-pointer"
          >
            <Trash2 size={12} /> Delete
          </button>
          <span className="ml-auto text-[11px] text-[rgb(var(--color-text-secondary))]">
            {tag.verseCount} verses{tag.chapterCount ? ` · ${tag.chapterCount} ch` : ''}
          </span>
        </div>
        {mergeOpen && (
          <div className="max-h-[140px] overflow-y-auto rounded-shell border border-[rgb(var(--color-surface-4))/60]">
            {tags.filter((t) => t.id !== tag.id).map((t) => (
              <button
                key={t.id}
                onClick={() => { onMerge(tag.id, t.id); setMergeOpen(false); onBack() }}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer text-[rgb(var(--color-text-primary))]"
              >
                Merge into “{t.name}”
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {connected.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-secondary))] mb-1.5">Connected tags</div>
            <div className="flex flex-col gap-0.5">
              {connected.map(({ edge, other, outgoing }) => {
                const Glyph = ARROW_GLYPH[edge.arrows]
                return (
                  <button
                    key={edge.id}
                    onClick={() => onSelectTag(other!.id)}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-shell text-[13px] text-left hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
                  >
                    <Glyph size={13} className={`mt-0.5 flex-shrink-0 text-[rgb(var(--color-text-muted))] ${outgoing ? '' : 'rotate-180'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="text-[rgb(var(--color-text-primary))]">{other!.name}</span>
                      {edge.note && <span className="block text-[11px] text-[rgb(var(--color-text-secondary))] truncate">{edge.note}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-secondary))] mb-1.5 px-3">Verses</div>
          {members == null ? (
            <div className="text-xs text-[rgb(var(--color-text-muted))] px-3">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-xs text-[rgb(var(--color-text-muted))] px-3">No verses tagged yet.</div>
          ) : (
            <TaggedVerseList groups={verseGroups} onNavigate={openVerseInCurrentTab} outerMargin={false} />
          )}
        </div>
      </div>
    </div>
  )
}
