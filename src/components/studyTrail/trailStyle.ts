// THE single source of truth for how the Study Trail map looks. Every bullet and every line in
// MapView / TrailConnectorOverlay resolves its shape, colour, weight and dash from here.
//
// Written in response to direct feedback: "you need to uniform all the styles of colors of lines
// and bullets and the style of the lines and bullets... they need to be less sparse and random and
// have a clear structure." Before this, each edge kind and each bullet picked its own colour/dash/
// size at its own call site — five different greys, clarity-tier colours leaking onto connecting
// lines, three different bullet sizes for the same concept — so nothing about the picture could be
// read as a rule. The rules are now:
//
//   SHAPE says WHAT a stop is.
//     square  = a chapter you actually sat in (a stop on the main spine)
//     circle  = a verse, or a jump to another chapter
//     diamond = a Strong's word
//     ring    = a side stop: a note, a video, a PDF, a search
//     hollow  = you had been here before (a revisit), whatever the shape
//
//   LINE STYLE says WHAT KIND OF MOVE it was, and there are only four.
//     forward — solid, arrowed. You moved on. This is the spine, and it is CONTINUOUS: every
//               consecutive pair of stops is joined, always.
//     deeper  — solid accent, arrowed. You went into something (a branch, a word, a note).
//     back    — dashed, arrowed, quiet. You returned to somewhere you had already been.
//     glance  — dotted, no arrow, quietest. You looked and left.
//
//   COLOUR is only three values, and never encodes confidence.
//     text-secondary = the path you took          accent = going deeper       text-muted = backward
//   Clarity tier used to colour the LINES, which meant the diagram's colour said two different
//   things at once. Tier is now a small dot on the row itself (TIER_DOT below) and nothing else.
//
// Anything that wants a new visual treatment belongs here first, not at a call site.

/** The three — and only three — line colours. */
export const LINE_COLOR = {
  forward: 'rgb(var(--color-text-secondary))',
  deeper: 'rgb(var(--color-accent))',
  back: 'rgb(var(--color-text-muted))',
} as const

export type EdgeRole = 'forward' | 'forward-quiet' | 'deeper' | 'back' | 'glance'

export interface EdgeStyle {
  color: string
  dashed?: boolean
  dotted?: boolean
  arrow?: boolean
  opacity: number
  strokeWidth: number
}

export const EDGE_STYLE: Record<EdgeRole, EdgeStyle> = {
  // The main spine. Solid, the heaviest line on the map, always arrowed — this is the thing the
  // whole diagram is about.
  forward: { color: LINE_COLOR.forward, arrow: true, opacity: 0.9, strokeWidth: 1.75 },
  // Retained for a caller that wants a de-emphasised forward segment, but the spine no longer uses
  // it: a faint copy running parallel to a branch path read as the spine starting and stopping.
  // A branch-explained stretch now has no spine segment at all — the branch is the connection.
  'forward-quiet': { color: LINE_COLOR.forward, arrow: false, opacity: 0.28, strokeWidth: 1 },
  deeper: { color: LINE_COLOR.deeper, arrow: true, opacity: 0.8, strokeWidth: 1.5 },
  back: { color: LINE_COLOR.back, dashed: true, arrow: true, opacity: 0.4, strokeWidth: 1 },
  glance: { color: LINE_COLOR.back, dotted: true, arrow: false, opacity: 0.32, strokeWidth: 1 },
}

/** Applies a role to an edge literal — call sites pass semantics, never raw pixels. */
export function styled<T extends object>(role: EdgeRole, edge: T): T & EdgeStyle & { role: EdgeRole } {
  return { ...edge, ...EDGE_STYLE[role], role }
}

// ── Type and icon scale ─────────────────────────────────────────────────────
// Per direct feedback: "i feel like all the text and icons and such are just so small in the map
// and hard to see." Every size on the map came from a different hand-picked number between 9 and
// 13.5px, which is both too small overall and inconsistent. One scale now, five steps, used
// everywhere — and because zoom is a real CSS transform, this is the size at 100%, not a cap.
export const FONT = {
  /** A chapter stop's own title — the most important text on the map. */
  stop: 15,
  /** A branch row, a tangent bullet's verse — the second level. */
  row: 13.5,
  /** Dwell time, subnotes, gap chips. */
  meta: 11.5,
  /** Pills and badges. */
  badge: 11,
  /** The step number in the margin. */
  step: 10.5,
} as const

export const ICON = { sm: 12, md: 14 } as const

// ── Bullets ─────────────────────────────────────────────────────────────────
export type BulletKind = 'chapter' | 'verse' | 'jump' | 'lexicon' | 'side'

export interface BulletStyle {
  size: number
  borderRadius: number | string
  rotate?: boolean
  /** Hollow (border only) — used for a revisit of somewhere already on the map. */
  hollow?: boolean
  color: string
}

const BULLET_COLOR = {
  chapter: 'rgb(var(--color-accent))',
  offspine: 'rgb(var(--color-text-secondary))',
} as const

export function bulletStyle(kind: BulletKind, opts: { revisit?: boolean } = {}): BulletStyle {
  const revisit = !!opts.revisit
  switch (kind) {
    // Two sizes total across the whole map: 11px for a main-spine chapter stop, 9px for
    // everything off-spine (both up from 9/7 — they were hard to see and hard to hit). A revisit
    // keeps its size and goes hollow instead of shrinking, so "same chapter as before" and "less
    // important" stop being conflated.
    case 'chapter': return { size: 11, borderRadius: 3, color: BULLET_COLOR.chapter, hollow: revisit }
    case 'verse': return { size: 9, borderRadius: 999, color: BULLET_COLOR.chapter, hollow: revisit }
    case 'jump': return { size: 9, borderRadius: 999, color: BULLET_COLOR.offspine, hollow: revisit }
    case 'lexicon': return { size: 9, borderRadius: 1, rotate: true, color: BULLET_COLOR.offspine, hollow: revisit }
    case 'side': return { size: 9, borderRadius: 999, color: BULLET_COLOR.offspine, hollow: true }
  }
}

/** Inline styles for a bullet — one helper so no call site hand-rolls a dot again. */
export function bulletCss(kind: BulletKind, opts: { revisit?: boolean; dim?: boolean } = {}): React.CSSProperties {
  const b = bulletStyle(kind, opts)
  return {
    width: b.size, height: b.size, flexShrink: 0,
    borderRadius: b.borderRadius,
    transform: b.rotate ? 'rotate(45deg)' : undefined,
    background: b.hollow ? 'transparent' : b.color,
    border: b.hollow ? `1.5px solid ${b.color}` : undefined,
    boxSizing: 'border-box',
    opacity: opts.dim ? 0.5 : 1,
  }
}

/** Which bullet a connection row gets, from what it points at. */
export function bulletKindForConnection(toKind: string): BulletKind {
  if (toKind === 'lexicon') return 'lexicon'
  if (toKind === 'note' || toKind === 'video' || toKind === 'pdf' || toKind === 'search') return 'side'
  return 'jump'
}

// ── Clarity tier ────────────────────────────────────────────────────────────
// Tier used to be the COLOUR of connecting lines, which is why the map read as randomly
// multicoloured. It is a property of how sure Berean is about a jump's cause — genuinely useful,
// but a footnote, not the diagram's primary colour axis. It is now a 4px dot on the row and
// nothing else, and only for tiers 2 and 3: tier 1 ("we know exactly why") is the normal case and
// deserves no mark at all.
export const TIER_DOT: Record<number, string | null> = {
  1: null,
  2: 'rgb(var(--color-text-muted))',
  3: '#e08468',
}
