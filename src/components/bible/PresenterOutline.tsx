/**
 * Presenter visible-region outline (§62) — the dashed band in the main Scripture reader showing
 * which part of the chapter the presenter window shows. Geometry (top/height) comes from
 * presenterBand.ts; this is only the style + horizontal placement layer, shared by the paged
 * reader (BiblePanel) and continuous scroll so the two can never drift apart.
 *
 * Horizontal placement: the outer box IS a `.berean-reading-column` (same class, same font size,
 * so the same padding, `ch` measure and side-panel-aware cap as ChapterView's text column), and the
 * dashed box fills its content area. The outline therefore sits exactly over the text at every
 * pane width and margin setting — it used to be a bare `left: 0; max-width: 86ch` box that started
 * a full margin left of the text and kept the wrong width once the pane was narrower or wider
 * than the measure (TEST 2026-10-07).
 */
export function PresenterOutline({ top, height, paused, fontSize }: {
  top: number
  height: number
  paused: boolean
  fontSize: number
}) {
  return (
    <div
      aria-hidden="true"
      className="berean-reading-column berean-scripture-text absolute left-0 right-0 pointer-events-none z-raised"
      style={{ top, height, fontSize, paddingBlock: 0, transition: 'height var(--motion-fast) var(--motion-ease-out)' }}
    >
      <div
        className="h-full rounded-card animate-fade-in"
        style={{
          // A small outset so the dashes never touch the first/last glyph of a line.
          marginInline: 'calc(-1 * min(10px, var(--reading-margin) / 2))',
          border: `1.5px dashed ${paused ? 'rgb(var(--color-warning) / 0.6)' : 'rgb(var(--color-accent) / 0.55)'}`,
          background: paused ? 'rgb(var(--color-warning) / 0.035)' : 'rgb(var(--color-accent) / 0.035)',
          transition: 'border-color var(--motion-base), background-color var(--motion-base)',
        }}
      />
    </div>
  )
}
