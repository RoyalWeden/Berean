import { useEffect, useState } from 'react'
import { BookOpen, Hash, ChevronRight } from 'lucide-react'
import type { TrailThread } from '@/types/studyTrail'
import { bookName } from '@/lib/parseRef'
import { navigateTrailRef } from './trailNav'

// THREADS — the Study Trail window's second tab, replacing Review. Review was a per-session recap
// list; per direct feedback it "isnt helpful and i wouldnt use it... if there is another tab, it
// needs to be something completely different."
//
// A thread is a SUBJECT rather than a time span: every book you've actually studied and every
// Strong's number you've looked up, with how many stops it holds, when you first and last touched
// it, and which sessions it spans. Read the other way round from the Map — the Map answers "what
// did I do that afternoon", Threads answers "what have I been chasing, and where did I chase it".
//
// The grouping is done in SQL (studyTrail:listThreads), not here: the old Everything view loaded
// every session's full detail into the renderer and this tab would have had the same problem.

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtSpan(firstAt: number, lastAt: number): string {
  const days = Math.round((lastAt - firstAt) / 86_400_000)
  if (days <= 0) return 'one day'
  if (days === 1) return 'over 2 days'
  if (days < 60) return `over ${days} days`
  return `over ${Math.round(days / 30)} months`
}

function ThreadCard({ thread, onOpenSession }: { thread: TrailThread; onOpenSession: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const isBook = thread.kind === 'book'
  const label = isBook ? bookName(thread.label) || thread.label : `Strong's ${thread.label}`
  return (
    <div style={{
      border: '1px solid rgb(var(--color-surface-4))', borderRadius: 10, marginBottom: 8,
      background: 'rgb(var(--color-surface-2))', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
          padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
        }}
      >
        <ChevronRight size={13} style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }} />
        {isBook ? <BookOpen size={13} style={{ flexShrink: 0, opacity: 0.7 }} /> : <Hash size={13} style={{ flexShrink: 0, opacity: 0.7 }} />}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', whiteSpace: 'nowrap' }}>
          {thread.stops} {thread.stops === 1 ? 'stop' : 'stops'}
          {isBook && thread.chapters > 0 ? ` · ${thread.chapters} ch` : ''}
          {' · '}{thread.sessions.length} {thread.sessions.length === 1 ? 'session' : 'sessions'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 10px 34px' }}>
          <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>
            {fmtDate(thread.firstAt)} – {fmtDate(thread.lastAt)} · {fmtSpan(thread.firstAt, thread.lastAt)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {thread.sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id)}
                title="Show this session on the map"
                style={{
                  fontSize: 11, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                  background: 'rgb(var(--color-surface-3))', border: '1px solid rgb(var(--color-surface-4))',
                  color: 'rgb(var(--color-text-secondary))',
                }}
              >{s.name}</button>
            ))}
          </div>
          {/* Same rule as everywhere else in this window: navigating the main window is a
              deliberate act, never something a stray click does. */}
          <button
            onClick={() => navigateTrailRef(
              isBook ? { kind: 'chapter', bookId: thread.label, chapter: 1 } : { kind: 'lexicon', strongsNum: thread.label },
              true,
            )}
            style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
              background: 'none', border: '1px solid rgb(var(--color-surface-4))',
              color: 'rgb(var(--color-text-muted))',
            }}
          >Open {isBook ? label : `Strong's ${thread.label}`} in a new tab</button>
        </div>
      )}
    </div>
  )
}

export default function ThreadsView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [threads, setThreads] = useState<TrailThread[] | null>(null)
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'book' | 'strongs'>('all')

  useEffect(() => {
    let cancelled = false
    const load = () => { window.studyTrail.listThreads().then((t) => { if (!cancelled) setThreads(t) }).catch(() => {}) }
    load()
    // Push-only: a thread list is derived from every session at once, so re-deriving it on a poll
    // would be the same needless full scan the old Everything view did on a 2s timer.
    const off = window.studyTrail.onDataChanged(load)
    return () => { cancelled = true; off() }
  }, [])

  const q = filter.trim().toLowerCase()
  const shown = (threads ?? []).filter((t) => {
    if (kind !== 'all' && t.kind !== kind) return false
    if (!q) return true
    const label = t.kind === 'book' ? (bookName(t.label) || t.label) : t.label
    return label.toLowerCase().includes(q)
  })

  return (
    <div style={{ padding: '10px 14px 24px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter threads…"
          style={{
            flex: 1, maxWidth: 260, fontSize: 12, padding: '5px 9px', background: 'rgb(var(--color-surface-2))',
            border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, color: 'rgb(var(--color-text-primary))',
          }}
        />
        {(['all', 'book', 'strongs'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
              background: kind === k ? 'rgb(var(--color-accent) / 0.16)' : 'transparent',
              border: '1px solid rgb(var(--color-surface-4))',
              color: kind === k ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
            }}
          >{k === 'all' ? 'All' : k === 'book' ? 'Books' : "Strong's"}</button>
        ))}
      </div>
      {threads == null ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>
          {q || kind !== 'all' ? 'Nothing matches that.' : 'Nothing recorded yet — threads appear as you study.'}
        </div>
      ) : shown.map((t) => <ThreadCard key={t.id} thread={t} onOpenSession={onOpenSession} />)}
    </div>
  )
}
