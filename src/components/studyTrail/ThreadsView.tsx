import { useEffect, useState } from 'react'
import { Tag, Waypoints, Hash, ChevronDown, BookOpen } from 'lucide-react'
import type { TrailThread } from '@/types/studyTrail'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { navigateTrailRef } from './trailNav'
import { CARET_COLLAPSED_ROTATE } from './trailStyle'
import { ListRow, Chip, SectionLabel, SearchField, SegmentedControl, cx } from '@/components/ui'

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
  const tagged = thread.kind === 'tag'
  const accent = thread.color ?? (tagged ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))')
  return (
    <div className={cx('rounded-card border mb-2 overflow-hidden transition-colors duration-fast', open ? 'border-accent/45' : 'border-separator')}>
      <ListRow
        onClick={() => setOpen((v) => !v)}
        flush
        dense={false}
        leading={
          <span className="flex items-center gap-2">
            {/* Same caret direction as everywhere else on the map — see CARET_COLLAPSED_ROTATE. */}
            <ChevronDown size={16} className="flex-shrink-0 opacity-50" style={{ transform: open ? undefined : CARET_COLLAPSED_ROTATE, transition: 'transform 120ms' }} />
            {tagged ? <Tag size={15} className="flex-shrink-0" style={{ color: accent }} /> : <Waypoints size={15} className="flex-shrink-0 opacity-70" />}
          </span>
        }
        title={thread.label}
        // Says WHERE the topic came from, so a traced cluster is never mistaken for something
        // Berean decided on its own authority.
        subtitle={<span className="uppercase tracking-wide">{thread.source}</span>}
        meta={<span className="whitespace-nowrap">
          {thread.chapters.length > 0 && `${thread.chapters.length} ch · `}
          {thread.sessions.length} {thread.sessions.length === 1 ? 'session' : 'sessions'}
        </span>}
      />
      {open && (
        <div className="px-3 pb-2.5 pl-9">
          <div className="text-footnote text-text-muted mb-2">
            {fmtDate(thread.firstAt)} – {fmtDate(thread.lastAt)}
            {fmtSpan(thread.firstAt, thread.lastAt) && ` · ${fmtSpan(thread.firstAt, thread.lastAt)}`}
          </div>

          {thread.terms.length > 0 && (
            <div className="mb-2">
              <SectionLabel className="mb-1">Your words</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {thread.terms.map((t) => (
                  <Chip key={t} static className="bg-accent-muted text-accent">{t}</Chip>
                ))}
              </div>
            </div>
          )}

          {thread.chapters.length > 0 && (
            <div className="mb-2">
              <SectionLabel className="mb-1">Passages</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {thread.chapters.map((key) => {
                  const c = chapterLabel(key)
                  if (!c) return null
                  return (
                    <Chip
                      key={key}
                      icon={BookOpen}
                      // Same rule as the map: a plain click never moves the main window.
                      onClick={(e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef({ kind: 'chapter', bookId: c.bookId, chapter: c.chapter }, e.shiftKey) }}
                      title="Cmd-click to open in the main window"
                    >{c.label}</Chip>
                  )
                })}
              </div>
            </div>
          )}

          {thread.strongs.length > 0 && (
            <div className="mb-2">
              <SectionLabel className="mb-1">Words looked up</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {thread.strongs.map((sn) => {
                  // Show the actual word where we have it — a row of bare "H7307"s is a list of
                  // database keys, not a description of what was being studied.
                  const w = thread.words.find((x) => x.strongsNum === sn)
                  return (
                    <Chip
                      key={sn}
                      icon={Hash}
                      onClick={(e) => { if (e.metaKey || e.ctrlKey) navigateTrailRef({ kind: 'lexicon', strongsNum: sn }, e.shiftKey) }}
                      title={`${sn}${w?.gloss ? ` — ${w.gloss}` : ''} · Cmd-click to open in the main window`}
                    >
                      {w?.translit || sn}
                      {w?.gloss && <span className="text-text-tertiary"> {w.gloss}</span>}
                    </Chip>
                  )
                })}
              </div>
            </div>
          )}

          <SectionLabel className="mb-1">Sessions</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {thread.sessions.map((s) => (
              <Chip key={s.id} size="md" onClick={() => onOpenSession(s.id)} title="Show this session on the map">{s.name}</Chip>
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
    <div className="px-3.5 pt-2.5 pb-6 h-full overflow-auto">
      <div className="flex gap-2 mb-3 items-center">
        <SearchField value={filter} onValueChange={setFilter} placeholder="Filter topics…" wrapperClassName="flex-1 max-w-[260px]" />
        <SegmentedControl
          aria-label="Topic kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'tag', label: 'Tagged' },
            { value: 'traced', label: 'Traced' },
          ]}
        />
      </div>
      {threads == null ? (
        <div className="text-body text-text-muted">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-footnote text-text-muted leading-relaxed">
          {q || kind !== 'all'
            ? 'Nothing matches that.'
            : 'No topics yet. Topics come from your verse and session tags, and from chapters your own cross-references, verse ties and word lookups link together — plain reading through a book on its own doesn’t make one.'}
        </div>
      ) : shown.map((t) => <ThreadCard key={t.id} thread={t} onOpenSession={onOpenSession} />)}
    </div>
  )
}
