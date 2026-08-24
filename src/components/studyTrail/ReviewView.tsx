import { useEffect, useRef, useState } from 'react'
import type { TrailSession, TrailSessionDetail, TrailConnectionWithSession } from '@/types/studyTrail'
import { buildRecap } from './recapText'

// The Review tab: search across every session's connections, plus each session collapsed into
// an editable prose recap paragraph. Search is currently substring-only server-side
// (electron/ipc/studyTrail.ts's studyTrail:search — real semantic/embedding search is a
// separate, not-yet-built piece, see the plan's Phase 0 embeddings section) — this UI doesn't
// pretend otherwise, it just calls whatever the IPC handler currently does.

function SessionCard({ session }: { session: TrailSession }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  const [recap, setRecap] = useState('')
  const [backlink, setBacklink] = useState<string | null>(null)
  const savedRecapRef = useRef('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.studyTrail.getSession(session.id).then((d) => {
      if (cancelled || !d) return
      setDetail(d)
      const text = d.session.recapUserEdited && d.session.recapText ? d.session.recapText : buildRecap(d)
      setRecap(text)
      savedRecapRef.current = text
      const last = d.nodes[d.nodes.length - 1]
      if (last) {
        window.studyTrail.getBacklinks(last.bookId, last.chapter, session.id).then((rows) => {
          if (cancelled) return
          const others = new Set(rows.map((r) => r.sessionName))
          setBacklink(others.size > 0 ? `Also visited ${last.bookId} ${last.chapter} in: ${[...others].join(', ')}` : null)
        }).catch(() => {})
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open, session.id])

  function commitRecap() {
    if (recap === savedRecapRef.current) return
    savedRecapRef.current = recap
    window.studyTrail.updateRecap(session.id, recap).catch(() => {})
  }

  const unresolvedCount = detail
    ? detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length
    : 0

  return (
    <div style={{ border: '1px solid #2a2730', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
          background: '#1c1a21', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: session.status === 'live' ? '#4fc3ae' : session.status === 'paused' ? '#e08468' : '#7d7869',
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#ece6d8', flex: 1 }}>{session.name}</span>
        {unresolvedCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#e08468', background: 'rgba(224,132,104,0.14)', borderRadius: 999, padding: '1px 7px' }}>
            {unresolvedCount} needs input
          </span>
        )}
        <span style={{ fontSize: 11, color: '#7d7869' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 12px 12px' }}>
          {!detail ? (
            <div style={{ fontSize: 11.5, color: '#7d7869' }}>Loading…</div>
          ) : (
            <>
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => { setRecap(e.currentTarget.textContent ?? ''); commitRecap() }}
                style={{ fontSize: 12.5, lineHeight: 1.6, color: '#d8d2c4', outline: 'none', padding: '4px 0' }}
              >
                {recap}
              </div>
              {backlink && (
                <div style={{ fontSize: 10.5, color: '#7d7869', marginTop: 6, fontStyle: 'italic' }}>{backlink}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SearchResultRow({ r }: { r: TrailConnectionWithSession }) {
  const label = r.toKind === 'lexicon'
    ? `Strong's ${r.toStrongsNum}`
    : `${r.toBookId ?? ''} ${r.toChapter ?? ''}${r.toVerse ? `:${r.toVerse}` : ''}`
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid #2a2730' }}>
      <div style={{ fontSize: 11.5, color: '#ece6d8' }}>
        {label} <span style={{ color: '#7d7869' }}>· {r.sessionName}</span>
      </div>
      {r.reasonText && <div style={{ fontSize: 11, color: '#b7b0a0', fontStyle: 'italic', marginTop: 1 }}>{r.reasonText}</div>}
    </div>
  )
}

export default function ReviewView({ sessions }: { sessions: TrailSession[] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TrailConnectionWithSession[] | null>(null)
  const [searching, setSearching] = useState(false)

  async function runSearch() {
    const q = query.trim()
    if (!q) { setResults(null); return }
    setSearching(true)
    try {
      const rows = await window.studyTrail.search(q)
      setResults(rows)
    } finally {
      setSearching(false)
    }
  }

  const grouped = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
          placeholder="Search across every session…"
          style={{ flex: 1, background: '#17151a', border: '1px solid #423d49', borderRadius: 7, padding: '7px 10px', color: '#ece6d8', fontSize: 12.5 }}
        />
        <button
          onClick={runSearch}
          style={{ background: '#d7ab52', border: 'none', borderRadius: 7, padding: '0 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#17151a' }}
        >{searching ? '…' : 'Search'}</button>
      </div>

      {results && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7d7869', marginBottom: 6 }}>
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          {results.length === 0 ? (
            <div style={{ fontSize: 11.5, color: '#7d7869' }}>No matches — search is substring-only for now (real semantic search across word meanings isn't wired up yet).</div>
          ) : (
            results.map((r) => <SearchResultRow key={r.id} r={r} />)
          )}
        </div>
      )}

      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7d7869', marginBottom: 6 }}>
        Sessions
      </div>
      {grouped.map((s) => <SessionCard key={s.id} session={s} />)}
      {grouped.length === 0 && <div style={{ fontSize: 11.5, color: '#7d7869' }}>No sessions yet.</div>}
    </div>
  )
}
