import { useEffect, useRef, useState } from 'react'

/**
 * A sticky row of "jump to" chips at the top of a Settings section. Auto-discovers targets
 * by scanning the scroll container for `[data-anchor]` elements (their `data-anchor` value is
 * the chip label). Clicking a chip smooth-scrolls that group into view; an IntersectionObserver
 * keeps the chip for the group nearest the top highlighted. Renders nothing when the active
 * section has no `[data-anchor]` groups.
 */
export default function SectionAnchorChips({
  scrollRef, sectionKey,
}: {
  scrollRef: React.RefObject<HTMLElement>
  /** Re-scan whenever this changes (i.e. the visible section changed). */
  sectionKey: string
}) {
  const [anchors, setAnchors] = useState<Array<{ id: string; label: string }>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Discover anchors after the section renders.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) { setAnchors([]); return }
    const raf = requestAnimationFrame(() => {
      // Explicit [data-anchor] markers, plus the small uppercase sub-section headers several
      // sections already use (`p.font-semibold.uppercase.tracking-wider`).
      const explicit = Array.from(root.querySelectorAll<HTMLElement>('[data-anchor]'))
      const auto = explicit.length > 0 ? [] : Array.from(
        root.querySelectorAll<HTMLElement>('p.font-semibold.uppercase.tracking-wider'),
      )
      const els = [...explicit, ...auto]
      els.forEach((el, i) => { if (!el.id) el.id = `sanchor-${i}` })
      setAnchors(els.map((el) => ({
        id: el.id,
        label: el.getAttribute('data-anchor') || (el.textContent || '').trim(),
      })))
      setActiveId(els[0]?.id ?? null)
    })
    return () => cancelAnimationFrame(raf)
  }, [scrollRef, sectionKey])

  // Highlight the group nearest the top of the scroll viewport.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || anchors.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId((visible[0].target as HTMLElement).id)
      },
      { root, rootMargin: '-8px 0px -70% 0px', threshold: 0 },
    )
    anchors.forEach((a) => { const el = document.getElementById(a.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [scrollRef, anchors])

  if (anchors.length < 2) return null

  return (
    <div
      ref={rowRef}
      // Pull up into the scroll container's top padding so it sits flush at the very top
      // (no empty gap above), and stay pinned there while scrolling.
      className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-2.5 pb-2 mb-3 flex flex-wrap gap-1.5 bg-[rgb(var(--color-surface-1))/97] backdrop-blur-sm border-b border-[rgb(var(--color-surface-4))/60]"
    >
      {anchors.map((a) => (
        <button
          key={a.id}
          onClick={() => document.getElementById(a.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
            activeId === a.id
              ? 'bg-[rgb(var(--color-accent))]/14 border-[rgb(var(--color-accent))]/40 text-[rgb(var(--color-accent))] font-semibold'
              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))]'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
