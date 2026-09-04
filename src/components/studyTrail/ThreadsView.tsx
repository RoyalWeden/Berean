import { useEffect, useState } from 'react'
import { Tag, Waypoints, Hash, ChevronDown, BookOpen } from 'lucide-react'
import type { TrailThread } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { navigateTrailRef } from './trailNav'
import { CARET_COLLAPSED_ROTATE } from './trailStyle'

// THREADS — the Study Trail window's second tab, replacing Review.
//
// REWRITTEN per direct feedback: "the threads tab should be by topics and not by books or
// whatever." The first version grouped by book and by Strong's number, which was really just a
// second table of contents — it said where you had been, not what you were pursuing.
//
// A topic is now one of two things, both grounded in what the user actually did:
//   • TAGGED — a verse tag or a session tag. Topics named by Michael himself, so they lead.
//   • TRACED — a cluster of chapters and words that his own cross-references, verse ties and
//     lookups linked together, named from the words he wrote about them. Plain sequential reading
//     is excluded from that graph on purpose, or everything would join into one super-topic.
// See studyTrail:listThreads for how each is built.

function fmtDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtSpan(firstAt: number, lastAt: number): string {
  if (!firstAt || !lastAt) return ''
  const days = Math.round((lastAt - firstAt) / 86_400_000)
  if (days <= 0) return 'one sitting'
  if (days === 1) return 'across 2 days'
  if (days < 60) return `across ${days} days`
  return `across ${Math.round(days / 30)} months`
}

/** "ISA 11" (how the backend keys a chapter) → the app's own display label. */
function chapterLabel(key: string): { label: string; bookId: string; chapter: number } | null {
  const m = /^(.+) (\d+)$/.exec(key)
  if (!m) return null
  const bookId = m[1]
  const chapter = Number(m[2])
  return { label: bookChapterVerseLabel(bookId, chapter), bookId, chapter }
}

// Every list field defaulted. The reported crash ("Cannot read properties of undefined (reading
// 'length')") came from the renderer hot-reloading to this file while the Electron MAIN process
// still served the previous listThreads shape — `npm run dev` reloads the renderer but not main,
// so the two can disagree until the app is restarted. A tab shouldn't take the whole window down
// over a field it didn't get, whatever the reason.
function normalize(t: TrailThread): TrailThread {
  return {
    ...t,
    label: t.label ?? '',
    source: t.source ?? '',
    chapters: Array.isArray(t.chapters) ? t.chapters : [],
    strongs: Array.isArray(t.strongs) ? t.strongs : [],
    words: Array.isArray(t.words) ? t.words : [],
    terms: Array.isArray(t.terms) ? t.terms : [],
    sessions: Array.isArray(t.sessions) ? t.sessions : [],
    stops: t.stops ?? 0,
    firstAt: t.firstAt ?? 0,
    lastAt: t.lastAt ?? 0,
  }
}

function ThreadCard({ thread, onOpenSession }: { thread: TrailThread; onOpenSession: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  // A card gave no feedback at all on hover, so it didn't read as clickable — "the threads doesnt
  // highlight or whatever when hovered".
  const [hovered, setHovered] = useState(false)
  const tagged = thread.kind === 'tag'
  const accent = thread.color ?? (tagged ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))')
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered || open ? 'rgb(var(--color-accent) / 0.45)' : 'rgb(var(--color-surface-4))'}`,
        borderRadius: 10, marginBottom: 8, overflow: 'hidden',
        background: hovered ? 'rgb(var(--color-surface-3))' : 'rgb(var(--color-surface-2))',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
          padding: '11px 13px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
        }}
      >
        {/* Same caret direction as everywhere else on the map — see CARET_COLLAPSED_ROTATE. */}
        <ChevronDown size={16} style={{ flexShrink: 0, opacity: hovered ? 0.85 : 0.5, transform: open ? undefined : CARET_COLLAPSED_ROTATE, transition: 'transform 120ms, opacity 120ms' }} />
        {tagged ? <Tag size={15} style={{ flexShrink: 0, color: accent }} /> : <Waypoints size={15} style={{ flexShrink: 0, opacity: 0.7 }} />}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {thread.label}
          </span>
          {/* Says WHERE the topic came from, so a traced cluster is never mistaken for something
              Berean decided on its own authority. */}
          <span style={{ display: 'block', fontSize: 11, letterSpacing: '.03em', textTransform: 'uppercase', color: 'rgb(var(--color-text-muted))' }}>
            {thread.source}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))', whiteSpace: 'nowrap' }}>
          {thread.chapters.length > 0 && `${thread.chapters.length} ch · `}
          {thread.sessions.length} {thread.sessions.length === 1 ? 'session' : 'sessions'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 10px 36px' }}>
          <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))', marginBottom: 9 }}>
            {fmtDate(thread.firstAt)} – {fmtDate(thread.lastAt)}
            {fmtSpan(thread.firstAt, thread.lastAt) && ` · ${fmtSpan(thread.firstAt, thread.lastAt)}`}
          </div>

          {thread.terms.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgb(var(--color-text-muted))', marginBottom: 4 }}>Your words</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {thread.terms.map((t) => (
                  <span key={t} style={{
                    fontSize: 12, padding: '2px 9px', borderRadius: 999,
                    background: 'rgb(var(--color-accent) / 0.12)', color: 'rgb(var(--color-accent))',
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {thread.chapters.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgb(var(--color-text-muted))', marginBottom: 4 }}>Passages</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {thread.chapters.map((key) => {
                  const c = chapterLabel(key)
                  if (!c) return null
                  return (
                    <button
                      key={key}
                      // Same rule as the map: a plain click never moves the main window.
                      onClick={(e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef({ kind: 'chapter', bookId: c.bookId, chapter: c.chapter }, e.shiftKey) }}
                      title="Cmd-click to open in the main window"
                      className="trail-chip"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 12, padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                        background: 'rgb(var(--color-surface-3))', border: 'none', color: 'rgb(var(--color-text-secondary))',
                      }}
                    ><BookOpen size={11} style={{ opacity: 0.6 }} />{c.label}</button>
                  )
                })}
              </div>
            </div>
          )}

          {thread.strongs.length > 0 && (
            <div style={{ marginBottom: 9 }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgb(var(--color-text-muted))', marginBottom: 4 }}>Words looked up</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {thread.strongs.map((sn) => {
                  // Show the actual word where we have it — a row of bare "H7307"s is a list of
                  // database keys, not a description of what was being studied.
                  const w = thread.words.find((x) => x.strongsNum === sn)
                  return (
                    <button
                      key={sn}
                      onClick={(e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef({ kind: 'lexicon', strongsNum: sn }, e.shiftKey) }}
                      title={`${sn}${w?.gloss ? ` — ${w.gloss}` : ''} · Cmd-click to open in the main window`}
                      className="trail-chip"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 12, padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                        background: 'rgb(var(--color-surface-3))', border: 'none', color: 'rgb(var(--color-text-secondary))',
                      }}
                    >
                      <Hash size={11} style={{ opacity: 0.6 }} />
                      {w?.translit || sn}
                      {w?.gloss && <span style={{ opacity: 0.6 }}>{w.gloss}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgb(var(--color-text-muted))', marginBottom: 4 }}>Sessions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {thread.sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id)}
                title="Show this session on the map"
                className="trail-chip"
                style={{
                  fontSize: 12.5, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  background: 'rgb(var(--color-surface-3))', border: '1px solid rgb(var(--color-surface-4))',
                  color: 'rgb(var(--color-text-secondary))',
                }}
              >{s.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ThreadsView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [threads, setThreads] = useState<TrailThread[] | null>(null)
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'tag' | 'traced'>('all')

  useEffect(() => {
    let cancelled = false
    const load = () => {
      window.studyTrail.listThreads()
        .then((t) => { if (!cancelled) setThreads((Array.isArray(t) ? t : []).map(normalize)) })
        .catch(() => { if (!cancelled) setThreads([]) })
    }
    load()
    // Push-only: a thread list is derived from every session at once, so re-deriving it on a poll
    // would be a needless full scan.
    const off = window.studyTrail.onDataChanged(load)
    return () => { cancelled = true; off() }
  }, [])

  const q = filter.trim().toLowerCase()
  const shown = (threads ?? []).filter((t) => {
    if (kind !== 'all' && t.kind !== kind) return false
    if (!q) return true
    return [t.label, ...t.terms, ...t.chapters, ...t.strongs].some((x) => x.toLowerCase().includes(q))
  })

  return (
    <div style={{ padding: '10px 14px 24px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter topics…"
          style={{
            flex: 1, maxWidth: 260, fontSize: 12, padding: '5px 9px', background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
          }}
        />
        {(['all', 'tag', 'traced'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
              background: kind === k ? 'rgb(var(--color-accent) / 0.16)' : 'transparent',
              border: '1px solid rgb(var(--color-surface-4))',
              color: kind === k ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
            }}
          >{k === 'all' ? 'All' : k === 'tag' ? 'Tagged' : 'Traced'}</button>
        ))}
      </div>
      {threads == null ? (
        <div style={{ fontSize: 13, color: 'rgb(var(--color-text-muted))' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))', lineHeight: 1.6 }}>
          {q || kind !== 'all'
            ? 'Nothing matches that.'
            : 'No topics yet. Topics come from your verse and session tags, and from chapters your own cross-references, verse ties and word lookups link together — plain reading through a book on its own doesn’t make one.'}
        </div>
      ) : shown.map((t) => <ThreadCard key={t.id} thread={t} onOpenSession={onOpenSession} />)}
    </div>
  )
}
