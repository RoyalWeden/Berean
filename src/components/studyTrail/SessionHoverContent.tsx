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
    <div className="text-caption leading-relaxed" style={{ minWidth: 170, maxWidth: 260 }}>
      <div className="flex items-center gap-1.5 font-semibold text-footnote mb-0.5">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: session.status === 'live' ? 'rgb(var(--trail-cool))' : session.status === 'paused' ? 'rgb(var(--trail-warm))' : 'rgb(var(--color-text-muted))' }}
        />
        {session.name}
      </div>
      <div className="text-text-muted">
        {fmtClock(session.createdAt)} – {fmtClock(session.updatedAt)}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {tags.map((t) => (
            <span
              key={t.id}
              className="text-micro rounded-control px-1.5 leading-[15px]"
              style={{
                background: t.color ? `${t.color}22` : 'rgb(var(--color-surface-3))',
                color: t.color ?? 'rgb(var(--color-text-muted))',
              }}
            >{t.name}</span>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-text-secondary">
        {detail === 'loading' ? '…' : detail
          ? `${detail.nodes.length} chapter stop${detail.nodes.length === 1 ? '' : 's'} · ${detail.connections.length} connection${detail.connections.length === 1 ? '' : 's'}`
          : null}
      </div>
      {detail && detail !== 'loading' && detail.session.recapText && (
        <div className="mt-1.5 pt-1.5 border-t border-separator italic text-text-secondary">
          {detail.session.recapText}
        </div>
      )}
    </div>
  )
}
