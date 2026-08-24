import { useEffect, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection, TrailNode } from '@/types/studyTrail'

// Rich hover-card body — timestamp/duration plus a live-fetched verse or Strong's-gloss
// preview, per the design spec's §3. Fetches lazily on mount (only happens once the card is
// actually shown, see TrailHoverCard.tsx) rather than upfront for every row in the trail —
// hovering is the ask signal, not rendering.

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function fmtDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const rowStyle: React.CSSProperties = { fontSize: 11, color: 'rgb(var(--color-text-secondary))', lineHeight: 1.5 }
const dividerStyle: React.CSSProperties = { height: 1, background: 'rgb(var(--color-surface-4))', margin: '6px 0' }

export function TrailNodeHoverContent({ node }: { node: TrailNode }) {
  const [verseText, setVerseText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.bible.queryVerse(node.bookId, node.chapter, 1).then((v) => { if (!cancelled) setVerseText(v?.text ?? null) }).catch(() => {})
    return () => { cancelled = true }
  }, [node.bookId, node.chapter])

  const duration = (node.anchorEndedAt ?? Date.now()) - node.anchorStartedAt

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>
        <span>{bookName(node.bookId)} {node.chapter}</span>
        <span style={{ fontWeight: 500, color: 'rgb(var(--color-text-muted))', fontSize: 10.5 }}>{fmtClock(node.anchorStartedAt)}</span>
      </div>
      <div style={{ ...rowStyle, marginTop: 2 }}>{fmtDuration(duration)} on this chapter</div>
      {(verseText || node.cachedSubnote) && <div style={dividerStyle} />}
      {verseText && (
        <div style={{ ...rowStyle, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          &ldquo;{verseText}&rdquo;
        </div>
      )}
      {node.cachedSubnote && <div style={{ ...rowStyle, marginTop: verseText ? 3 : 0 }}>{node.cachedSubnote}</div>}
    </div>
  )
}

export function TrailConnectionHoverContent({ conn }: { conn: TrailConnection }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (conn.toKind === 'lexicon' && conn.toStrongsNum) {
      window.lexicon.getEntry(conn.toStrongsNum).then((e) => {
        if (cancelled || !e) return
        setPreview(`${e.lemma} (${e.transliteration}) — ${e.gloss}`)
      }).catch(() => {})
    } else if (conn.toKind === 'chapter' && conn.toBookId && conn.toChapter != null) {
      window.bible.queryVerse(conn.toBookId, conn.toChapter, conn.toVerse ?? conn.versePinFrom ?? 1)
        .then((v) => { if (!cancelled) setPreview(v?.text ?? null) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [conn.toKind, conn.toStrongsNum, conn.toBookId, conn.toChapter, conn.toVerse, conn.versePinFrom])

  const clarityLabel = conn.clarityTier === 1 ? 'clear' : conn.clarityTier === 2 ? 'soft' : 'ambiguous'
  const label = conn.toKind === 'lexicon' ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare' ? `compare · ${bookName(conn.toBookId ?? '')} ${conn.toChapter}`
    : conn.toKind === 'note' ? 'note' : conn.toKind === 'video' ? 'video'
    : `${bookName(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`

  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>{label}</div>
      <div style={{ ...rowStyle, marginTop: 2 }}>
        {clarityLabel} · {fmtClock(conn.createdAt)}{conn.weight === 'glance' ? ' · glance' : ''}
      </div>
      {preview && (
        <>
          <div style={dividerStyle} />
          <div style={{ ...rowStyle, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {conn.toKind === 'lexicon' ? preview : `“${preview}”`}
          </div>
        </>
      )}
      {(conn.reasonText || conn.reasonTags.length > 0) && (
        <>
          <div style={dividerStyle} />
          {conn.reasonText && <div style={rowStyle}>{conn.reasonText}</div>}
          {conn.reasonTags.length > 0 && <div style={{ ...rowStyle, color: 'rgb(var(--color-text-muted))' }}>tags: {conn.reasonTags.join(', ')}</div>}
        </>
      )}
    </div>
  )
}
