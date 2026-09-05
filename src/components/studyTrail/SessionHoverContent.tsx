import { useEffect, useState } from 'react'
import type { TrailSession, TrailSessionDetail, TrailTag } from '@/types/studyTrail'

// Per feedback ("show some hover thing when the user hovers over the sessions... like some
// details" — and "for most things, i dont want a plain browser tooltip"): the day-view timeline
// bars only had a native `title=` tooltip (slow to appear, no styling, can't show a tag chip or
// multi-line recap). This is the rich equivalent, meant to be used as TrailHoverCard's `content`
// — same hover-card component the map already uses for node/connection details, so this gets the
// same show-delay/stay-open-while-hovering-the-card behavior for free.
//
// Times/tags are already loaded (passed in directly); node count and recap text aren't on the
// lightweight TrailSession row at all, so those are fetched lazily via getSession() only once
// this specific session is actually hovered — never eagerly for the whole day's sessions.
export default function SessionHoverContent({ session, tags }: { session: TrailSession; tags: TrailTag[] }) {
  const [detail, setDetail] = useState<TrailSessionDetail | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    setDetail('loading')
    window.studyTrail.getSession(session.id).then((d) => { if (!cancelled) setDetail(d) }).catch(() => { if (!cancelled) setDetail(null) })
    return () => { cancelled = true }
  }, [session.id])

  const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, minWidth: 170, maxWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 12, marginBottom: 2 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: session.status === 'live' ? '#4fc3ae' : session.status === 'paused' ? '#e08468' : 'rgb(var(--color-text-muted))',
        }} />
        {session.name}
      </div>
      <div style={{ color: 'rgb(var(--color-text-muted))' }}>
        {fmtClock(session.createdAt)} – {fmtClock(session.updatedAt)}
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
          {tags.map((t) => (
            <span
              key={t.id}
              style={{
                fontSize: 9.5, padding: '0 6px', borderRadius: 999, lineHeight: '15px',
                background: t.color ? `${t.color}22` : 'rgb(var(--color-surface-3))',
                color: t.color ?? 'rgb(var(--color-text-muted))',
              }}
            >{t.name}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 5, color: 'rgb(var(--color-text-secondary))' }}>
        {detail === 'loading' ? '…' : detail
          ? `${detail.nodes.length} chapter stop${detail.nodes.length === 1 ? '' : 's'} · ${detail.connections.length} connection${detail.connections.length === 1 ? '' : 's'}`
          : null}
      </div>
      {detail && detail !== 'loading' && detail.session.recapText && (
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid rgb(var(--color-surface-4))', fontStyle: 'italic', color: 'rgb(var(--color-text-secondary))' }}>
          {detail.session.recapText}
        </div>
      )}
    </div>
  )
}
