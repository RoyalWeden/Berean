import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { originDisplayText } from './trailNav'
import { useWordReplace } from './useWordReplace'
import { IconButton, cx } from '@/components/ui'
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

const rowClassName = 'text-caption leading-relaxed text-text-secondary'
const dividerClassName = 'h-px bg-separator my-1.5'
const TIER_COLOR: Record<number, string> = { 1: 'rgb(var(--trail-cool))', 2: 'rgb(var(--color-accent))', 3: 'rgb(var(--trail-warm))' }
const TIER_LABEL: Record<number, string> = { 1: 'clear', 2: 'soft', 3: 'ambiguous' }

// A small note/pencil button shared by every hover card (node, connection, tangent bullet) —
// per direct feedback ("there should be a note button in the hover popup so that i can add a
// note"). Opens the SAME ReasonPromptPopover editor the row-level pencil icon already does (one
// unified note concept everywhere, not a separate quick-note system) — this is just another
// place to reach it, right where you're already looking at the fact card.
function EditNoteBtn({ onClick }: { onClick: () => void }) {
  return <IconButton icon={Pencil} label="Add/edit a note for this" size={20} variant="ghost" onClick={onClick} />
}

function ClarityBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const color = TIER_COLOR[tier]
  return (
    <span
      className="text-micro font-bold rounded-control px-1.5 py-px uppercase tracking-wide"
      style={{
        color, background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >{TIER_LABEL[tier]}</span>
  )
}

// The "how did I get here" line — every node's hover card leads with this when an origin
// connection is known, since that was the exact gap Michael flagged: landing on a chapter via
// a Strong's occurrence (or any other tangent) showed nothing at all about where it came from.
function OriginLine({ conn }: { conn: TrailConnection }) {
  const replace = useWordReplace()
  return (
    <div className={cx(rowClassName, 'flex items-center gap-1.5 flex-wrap')}>
      <span>via {replace(originDisplayText(conn))}</span>
      <ClarityBadge tier={conn.clarityTier} />
    </div>
  )
}

export function TrailNodeHoverContent({ node, originConn, onEditNote }: { node: TrailNode; originConn?: TrailConnection; onEditNote?: () => void }) {
  const replace = useWordReplace()
  // A dedicated-translation book (Enoch, Jubilees, etc.) only ever lives in ITS OWN db, never
  // 'kjva' (the default queryVerse falls back to when no textId is passed) — that mismatch was
  // silently resolving null with no indication why, so a non-canon chapter's hover card showed
  // no preview at all. getTranslationForBook is authoritative for those books regardless of
  // node.translation; for a canon book, fall back to what was actually recorded at arrival
  // (node.translation, v32) — the user's own KJV-vs-LXX choice, not derivable from bookId alone.
  const effectiveTranslation = getTranslationForBook(node.bookId) ?? node.translation
  // No verse-1 preview here anymore — per direct feedback ("dont show the preview of the
  // chapter when it is the main bullet because those are entire chapters, only show the
  // preview of the verses for the bullets that are specific verses or verse ranges"), a whole-
  // chapter node's hover shouldn't imply "verse 1 represents this chapter." Verse-specific
  // previews still show on connection rows/branch bullets — see TrailConnectionHoverContent.

  const duration = (node.anchorEndedAt ?? Date.now()) - node.anchorStartedAt

  return (
    <div>
      <div className="flex justify-between items-center gap-2.5 text-footnote font-semibold text-text-primary">
        <span>{bookName(node.bookId)} {node.chapter}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-medium text-text-muted text-caption2">{fmtClock(node.anchorStartedAt)}</span>
          {onEditNote && <EditNoteBtn onClick={onEditNote} />}
        </span>
      </div>
      <div className={cx(rowClassName, 'mt-0.5 flex items-center gap-1.5')}>
        <span>{fmtDuration(duration)} on this chapter</span>
        {/* No indication anywhere of which text (KJV vs LXX, or a dedicated translation) a
            chapter was actually read in — per direct feedback ("i dont see any indication in
            the hover thing if the user checked the lxx"). Suppressed for plain kjva since
            that's the silent default everyone assumes; anything else is worth calling out. */}
        {effectiveTranslation && effectiveTranslation !== 'kjva' && (
          <span className="text-micro font-bold text-accent bg-accent-muted rounded-control px-1.5 py-px uppercase tracking-wide">
            {effectiveTranslation}
          </span>
        )}
      </div>
      {originConn && <div className={dividerClassName} />}
      {originConn && <OriginLine conn={originConn} />}
      {node.cachedSubnote && <div className={dividerClassName} />}
      {node.cachedSubnote && <div className={rowClassName}>{replace(node.cachedSubnote)}</div>}
    </div>
  )
}

// The ORIGIN half of a tangent bullet pair (see MapView.tsx's TangentBullet) — the verse a
// cross-ref/lexicon/AI-lookup click was made FROM, not its destination. Fixes a real bug: both
// bullets used to share the same TrailConnectionHoverContent (which only ever describes the
// connection's own destination), so hovering the origin bullet showed the SAME preview as the
// destination bullet right below it. This fetches and previews the origin verse itself instead.
export function TrailVersePreview({ bookId, chapter, verse, onEditNote }: { bookId: string; chapter: number; verse: number; onEditNote?: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const replace = useWordReplace()
  useEffect(() => {
    let cancelled = false
    window.bible.queryVerse(bookId, chapter, verse, getTranslationForBook(bookId) ?? undefined)
      .then((v) => { if (!cancelled) setPreview(v?.text ?? null) }).catch(() => {})
    return () => { cancelled = true }
  }, [bookId, chapter, verse])
  return (
    <div>
      <div className="flex justify-between items-center gap-2.5">
        <div className="text-footnote font-semibold text-text-primary">{bookName(bookId)} {chapter}:{verse}</div>
        {onEditNote && <EditNoteBtn onClick={onEditNote} />}
      </div>
      {preview && (
        <>
          <div className={dividerClassName} />
          <div className={cx(rowClassName, 'italic line-clamp-2')}>
            “{replace(preview)}”
          </div>
        </>
      )}
    </div>
  )
}

export function TrailConnectionHoverContent({ conn, onEditNote }: { conn: TrailConnection; onEditNote?: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const replace = useWordReplace()
  useEffect(() => {
    let cancelled = false
    if (conn.toKind === 'lexicon' && conn.toStrongsNum) {
      window.lexicon.getEntry(conn.toStrongsNum).then((e) => {
        if (cancelled || !e) return
        setPreview(`${e.lemma} (${e.transliteration}) — ${e.gloss}`)
      }).catch(() => {})
    } else if (conn.toKind === 'chapter' && conn.toBookId && conn.toChapter != null && conn.toVerse != null) {
      // Only when this row actually targets a SPECIFIC verse (or range) — per direct feedback,
      // a bare chapter destination has no one verse that represents it, so no preview is shown
      // at all for those (see TrailNodeHoverContent, which dropped its own verse-1 preview for
      // the same reason). Same non-canon-book gap as there — a dedicated-translation
      // destination silently returned no preview with queryVerse defaulting to 'kjva'.
      window.bible.queryVerse(conn.toBookId, conn.toChapter, conn.toVerse, getTranslationForBook(conn.toBookId) ?? undefined)
        .then((v) => { if (!cancelled) setPreview(v?.text ?? null) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [conn.toKind, conn.toStrongsNum, conn.toBookId, conn.toChapter, conn.toVerse, conn.versePinFrom])

  const label = conn.toKind === 'lexicon' ? `Strong's ${conn.toStrongsNum}`
    : conn.toKind === 'compare' ? `compare · ${bookName(conn.toBookId ?? '')} ${conn.toChapter}`
    : conn.toKind === 'note' ? 'note' : conn.toKind === 'video' ? 'video'
    : `${bookName(conn.toBookId ?? '')} ${conn.toChapter}${conn.toVerse ? `:${conn.toVerse}` : ''}`

  return (
    <div>
      <div className="flex justify-between items-center gap-2.5">
        <div className="text-footnote font-semibold text-text-primary">{label}</div>
        {onEditNote && <EditNoteBtn onClick={onEditNote} />}
      </div>
      <div className={cx(rowClassName, 'mt-0.5 flex items-center gap-1.5 flex-wrap')}>
        <ClarityBadge tier={conn.clarityTier} />
        <span>{fmtClock(conn.createdAt)}{conn.weight === 'glance' ? ' · glance' : ''}</span>
      </div>
      {preview && (
        <>
          <div className={dividerClassName} />
          <div className={cx(rowClassName, 'italic line-clamp-2')}>
            {conn.toKind === 'lexicon' ? replace(preview) : `“${replace(preview)}”`}
          </div>
        </>
      )}
      {/* The raw reasonTags list ("tags: cross-ref, notes") was removed per direct feedback —
          it's internal bookkeeping (what KIND of thing this connection is, already implied by
          the label/icon above it), not something worth restating as visible text. The actual
          user-authored reasonText (a real note about WHY) still shows. */}
      {conn.reasonText && (
        <>
          <div className={dividerClassName} />
          <div className={rowClassName}>{replace(conn.reasonText)}</div>
        </>
      )}
    </div>
  )
}
