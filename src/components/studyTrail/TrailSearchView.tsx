import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Hash, NotepadText, GitBranch, Layers } from 'lucide-react'
import type { TrailSearchHit } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { navigateTrailRef, type TrailRef } from './trailNav'

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgb(var(--color-surface-4))' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every stop, jump, note and session…"
          style={{
            width: '100%', fontSize: 13, padding: '7px 11px', background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 8, color: 'rgb(var(--color-text-primary))',
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => toggleKind(k.id)}
              style={{
                fontSize: 12.5, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                background: kinds.has(k.id) ? 'rgb(var(--color-accent) / 0.16)' : 'transparent',
                border: '1px solid rgb(var(--color-surface-4))',
                color: kinds.has(k.id) ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
              }}
            >{k.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            style={{
              fontSize: 11, padding: '3px 6px', borderRadius: 7, background: 'rgb(var(--color-surface-2))',
              border: '1px solid rgb(var(--color-surface-4))', color: 'rgb(var(--color-text-secondary))',
            }}
          >
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 14px 24px' }}>
        {!query.trim() ? (
          <div style={{ fontSize: 13, color: 'rgb(var(--color-text-muted))' }}>
            Type to search. Cmd-click a result to open it in the main window; click its session to show it on the map.
          </div>
        ) : hits == null ? (
          <div style={{ fontSize: 13, color: 'rgb(var(--color-text-muted))' }}>Searching…</div>
        ) : hits.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgb(var(--color-text-muted))' }}>No matches.</div>
        ) : KINDS.filter((k) => grouped.has(k.id)).map((k) => (
          <div key={k.id} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
              color: 'rgb(var(--color-text-muted))', marginBottom: 6,
            }}>{k.label} · {grouped.get(k.id)!.length}</div>
            {grouped.get(k.id)!.map((h) => {
              const ref = refFor(h)
              const title = h.kind === 'stop' && h.bookId && h.chapter != null
                ? bookChapterVerseLabel(h.bookId, h.chapter)
                : h.title
              return (
                <div
                  key={`${h.kind}:${h.id}`}
                  className="trail-row-hover"
                  style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px',
                    borderRadius: 7, marginBottom: 2,
                  }}
                >
                  {iconFor(h.kind)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Cmd-click navigates, plain click does nothing — the same rule as the map,
                          so muscle memory carries between the two tabs. */}
                      <span
                        onClick={ref ? (e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef(ref, e.shiftKey) } : undefined}
                        title={ref ? 'Cmd-click to open in the main window' : undefined}
                        style={{
                          fontSize: 13.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))',
                          cursor: ref ? 'pointer' : 'default', whiteSpace: 'nowrap',
                        }}
                      >{title}</span>
                      {h.strongsNum && <Hash size={10} style={{ opacity: 0.5 }} />}
                      <button
                        className="trail-chip"
                        onClick={() => onOpenSession(h.sessionId)}
                        style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                          background: 'rgb(var(--color-surface-3))', border: 'none',
                          color: 'rgb(var(--color-text-muted))', whiteSpace: 'nowrap',
                        }}
                      >{h.sessionName}</button>
                    </div>
                    {h.snippet && (
                      <div style={{ fontSize: 12.5, color: 'rgb(var(--color-text-muted))', marginTop: 2, lineHeight: 1.5 }}>
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
