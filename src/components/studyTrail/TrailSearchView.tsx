import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Hash, NotepadText, GitBranch, Layers } from 'lucide-react'
import type { TrailSearchHit } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { navigateTrailRef, type TrailRef } from './trailNav'
import { SearchField, Select, Chip, SectionLabel, Toolbar, cx } from '@/components/ui'

// SEARCH — the Study Trail window's third tab. Per direct feedback, alongside the Threads tab
// "there still should be a way to search all study trail notes and such by having an additional
// tab ... for searching through all study trail things easily."
//
// The old Review tab's search box only ever grepped connection reason text and tags. This one hits
// session names and recaps, chapter stops and their subnotes, connection reasons/notes/ties/
// Strong's numbers, and the sticky notes and section headers on the map — everything the trail
// actually holds. Filtering by kind and by date happens in SQL (see studyTrail:search).

const KINDS: Array<{ id: TrailSearchHit['kind']; label: string }> = [
  { id: 'stop', label: 'Stops' },
  { id: 'connection', label: 'Jumps' },
  { id: 'note', label: 'Notes' },
  { id: 'session', label: 'Sessions' },
]

const RANGES: Array<{ id: string; label: string; days: number | null }> = [
  { id: 'all', label: 'Any time', days: null },
  { id: 'week', label: 'Past week', days: 7 },
  { id: 'month', label: 'Past month', days: 30 },
  { id: 'year', label: 'Past year', days: 365 },
]

function iconFor(kind: TrailSearchHit['kind']) {
  if (kind === 'stop') return <BookOpen size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
  if (kind === 'connection') return <GitBranch size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
  if (kind === 'note') return <NotepadText size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
  return <Layers size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
}

function refFor(hit: TrailSearchHit): TrailRef | null {
  if (hit.strongsNum) return { kind: 'lexicon', strongsNum: hit.strongsNum }
  if (hit.bookId && hit.chapter != null) return { kind: 'chapter', bookId: hit.bookId, chapter: hit.chapter }
  return null
}

/** Wraps the matched substring so a long snippet says WHY it matched without being read in full. */
function highlight(text: string, query: string) {
  const q = query.trim()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  // A window around the hit rather than the whole body — a sticky note can be paragraphs long.
  const start = Math.max(0, i - 40)
  const end = Math.min(text.length, i + q.length + 80)
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark style={{ background: 'rgb(var(--color-accent) / 0.28)', color: 'inherit', borderRadius: 2 }}>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length, end)}
      {end < text.length && '…'}
    </>
  )
}

export default function TrailSearchView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<TrailSearchHit['kind']>>(() => new Set(KINDS.map((k) => k.id)))
  const [range, setRange] = useState('all')
  const [hits, setHits] = useState<TrailSearchHit[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const since = useMemo(() => {
    const r = RANGES.find((x) => x.id === range)
    return r?.days == null ? undefined : Date.now() - r.days * 86_400_000
  }, [range])

  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits(null); return }
    // Debounced — every keystroke otherwise runs seven LIKE scans across the whole trail.
    let cancelled = false
    const t = setTimeout(() => {
      window.studyTrail.search(q, { kinds: [...kinds], since })
        .then((r) => { if (!cancelled) setHits(r) })
        .catch(() => { if (!cancelled) setHits([]) })
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, kinds, since])

  const grouped = useMemo(() => {
    const m = new Map<TrailSearchHit['kind'], TrailSearchHit[]>()
    for (const h of hits ?? []) {
      const list = m.get(h.kind)
      if (list) list.push(h)
      else m.set(h.kind, [h])
    }
    return m
  }, [hits])

  function toggleKind(k: TrailSearchHit['kind']) {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      // Never leave every filter off — that reads as "no results" when it really means
      // "you excluded everything".
      return next.size === 0 ? new Set(KINDS.map((x) => x.id)) : next
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="pt-2.5 px-3.5 pb-2">
        <SearchField
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="Search every stop, jump, note and session…"
          wrapperClassName="w-full"
        />
      </div>
      <Toolbar size="sm" material="none" className="px-3.5">
        {KINDS.map((k) => (
          <Chip key={k.id} selected={kinds.has(k.id)} onClick={() => toggleKind(k.id)}>{k.label}</Chip>
        ))}
        <div className="flex-1" />
        <Select
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
          aria-label="Date range"
        />
      </Toolbar>

      <div className="flex-1 min-h-0 overflow-auto px-3.5 pt-2.5 pb-6">
        {!query.trim() ? (
          <div className="text-body text-text-muted">
            Type to search. Cmd-click a result to open it in the main window; click its session to show it on the map.
          </div>
        ) : hits == null ? (
          <div className="text-body text-text-muted">Searching…</div>
        ) : hits.length === 0 ? (
          <div className="text-body text-text-muted">No matches.</div>
        ) : KINDS.filter((k) => grouped.has(k.id)).map((k) => (
          <div key={k.id} className="mb-4">
            <SectionLabel className="mb-1.5">{k.label} · {grouped.get(k.id)!.length}</SectionLabel>
            {grouped.get(k.id)!.map((h) => {
              const ref = refFor(h)
              const title = h.kind === 'stop' && h.bookId && h.chapter != null
                ? bookChapterVerseLabel(h.bookId, h.chapter)
                : h.title
              return (
                <div
                  key={`${h.kind}:${h.id}`}
                  className="flex gap-2 items-start px-2 py-1.5 rounded-row mb-0.5 hover:bg-surface-hover"
                >
                  {iconFor(h.kind)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {/* Cmd-click navigates, plain click does nothing — the same rule as the map,
                          so muscle memory carries between the two tabs. */}
                      <span
                        onClick={ref ? (e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef(ref, e.shiftKey) } : undefined}
                        title={ref ? 'Cmd-click to open in the main window' : undefined}
                        className={cx('text-subhead font-semibold text-text-primary whitespace-nowrap', ref ? 'cursor-pointer' : 'cursor-default')}
                      >{title}</span>
                      {h.strongsNum && <Hash size={10} style={{ opacity: 0.5 }} />}
                      <Chip onClick={() => onOpenSession(h.sessionId)} className="whitespace-nowrap">{h.sessionName}</Chip>
                    </div>
                    {h.snippet && (
                      <div className="text-footnote text-text-muted mt-0.5 leading-relaxed">
                        {highlight(h.snippet, query)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
