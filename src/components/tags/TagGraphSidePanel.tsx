import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Merge, Trash2, ArrowRight, ArrowLeft, ArrowLeftRight, Minus, ChevronLeft } from 'lucide-react'
import { TAG_SLOT_COUNT, resolveTagColor } from '@/lib/tagPalette'
import { useAppStore } from '@/store'
import { getTranslationForBook, bookChapterVerseLabel } from '@/lib/parseRef'
import { recordNavigation } from '@/lib/verseNavigation'
import TaggedVerseList, { type TaggedVerseGroup } from '@/components/bible/TaggedVerseList'
import { SearchField, TextField, IconButton, Button, ListRow, ColorSwatchRow, SectionLabel, EmptyState, type Swatch } from '@/components/ui'
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

const SLOT_SWATCHES: Swatch[] = Array.from({ length: TAG_SLOT_COUNT }, (_, i) => ({
  id: String(i), rgb: `var(--tag-slot-${i})`, label: `Colour ${i + 1}`,
}))

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
    <div className="h-full w-[300px] flex-shrink-0 border-r border-separator material-sidebar flex flex-col">
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
          <div className="p-3 flex flex-col gap-2 border-b border-separator">
            <SearchField size="sm" value={search} onValueChange={onSearch} placeholder="Search tags…" />
            <form
              onSubmit={(e) => { e.preventDefault(); const n = newName.trim(); if (n) { onCreateTag(n); setNewName('') } }}
              className="flex items-center gap-1.5"
            >
              <TextField size="sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New tag…" wrapperClassName="flex-1" />
              <IconButton type="submit" icon={Plus} label="Create tag" variant="glass" size={28} tooltip={false} />
            </form>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {filtered.map((t) => (
              <ListRow
                key={t.id}
                dense
                flush
                selected={t.id === selectedTagId}
                leading={<span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: resolveTagColor(t) }} />}
                title={t.name}
                meta={
                  <span className="inline-flex items-center gap-1.5">
                    <span>{t.verseCount}{t.chapterCount ? `+${t.chapterCount}ch` : ''}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <ArrowLeftRight size={10} />
                      {edgeCount.get(t.id) ?? 0}
                    </span>
                  </span>
                }
                onClick={() => onSelectTag(t.id)}
              />
            ))}
            {filtered.length === 0 && <EmptyState compact title="No tags." />}
          </div>
        </>
      )}
    </div>
  )
}

function SlotSwatches({ value, hasOverride, onPick }: { value: number | null; hasOverride: boolean; onPick: (slot: number) => void }) {
  return (
    <ColorSwatchRow
      swatches={SLOT_SWATCHES}
      value={hasOverride || value == null ? null : String(value)}
      onChange={(id) => { if (id != null) onPick(Number(id)) }}
      size={16}
    />
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
      <div className="p-3 border-b border-separator flex flex-col gap-2.5">
        <Button variant="ghost" size="sm" icon={ChevronLeft} className="self-start -ml-1.5" onClick={onBack}>All tags</Button>
        <TextField
          size="md"
          bare
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { const n = name.trim(); if (n && n !== nameRef.current) { onRename(tag.id, n); nameRef.current = n } }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="text-title3 font-semibold px-0"
        />
        <SlotSwatches value={tag.colorSlot} hasOverride={!!tag.color} onPick={(i) => onSetSlot(tag.id, i)} />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={Merge} onClick={() => setMergeOpen((v) => !v)}>Merge</Button>
          <Button variant="destructive" size="sm" icon={Trash2} onClick={() => onDelete(tag.id)}>Delete</Button>
          <span className="ml-auto text-caption text-text-secondary">
            {tag.verseCount} verses{tag.chapterCount ? ` · ${tag.chapterCount} ch` : ''}
          </span>
        </div>
        {mergeOpen && (
          <div className="max-h-[140px] overflow-y-auto material-popover rounded-menu p-1 flex flex-col gap-0.5">
            {tags.filter((t) => t.id !== tag.id).map((t) => (
              <ListRow
                key={t.id}
                dense
                flush
                title={`Merge into "${t.name}"`}
                onClick={() => { onMerge(tag.id, t.id); setMergeOpen(false); onBack() }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {connected.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">Connected tags</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {connected.map(({ edge, other, outgoing }) => {
                const Glyph = ARROW_GLYPH[edge.arrows]
                return (
                  <ListRow
                    key={edge.id}
                    dense
                    leading={<Glyph size={13} className={outgoing ? '' : 'rotate-180'} />}
                    title={other!.name}
                    subtitle={edge.note || undefined}
                    onClick={() => onSelectTag(other!.id)}
                  />
                )
              })}
            </div>
          </div>
        )}

        <div>
          <SectionLabel className="mb-1.5 px-3">Verses</SectionLabel>
          {members == null ? (
            <div className="text-footnote text-text-muted px-3">Loading…</div>
          ) : members.length === 0 ? (
            <EmptyState compact title="No verses tagged yet." />
          ) : (
            <TaggedVerseList groups={verseGroups} onNavigate={openVerseInCurrentTab} outerMargin={false} />
          )}
        </div>
      </div>
    </div>
  )
}
