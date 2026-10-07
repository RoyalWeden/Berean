import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

/**
 * A note whose body already opens with `# <its title>` (the Obsidian / vault convention) has its
 * title on the page — that H1 IS the document title, so the large title is not added above it.
 */
export function contentStartsWithTitle(content: string | undefined, title: string | undefined): boolean {
  if (!content || !title?.trim()) return false
  const body = content.replace(/^\uFEFF?---\n[\s\S]*?\n---\s*\n/, '')
  const m = /^\s*#[ \t]+(.+?)[ \t#]*$/m.exec(body.split('\n').find((l) => l.trim() !== '') ?? '')
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  return !!m && norm(m[1]) === norm(title)
}

/**
 * The note's title as the first line of the document (TEST 2026-10-04: "make the individual note
 * title noticeably larger… document-like"), like Notes / Pages: large, semibold, scrolls with the
 * text, edited in place. Enter moves into the body. `onVisibleChange` reports whether it is on
 * screen, so the toolbar can show the small title only once this one has scrolled away.
 */
export interface NoteDocTitleHandle { focus: () => void; reveal: () => void }

export const NoteDocTitle = forwardRef<NoteDocTitleHandle, {
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  onVisibleChange?: (visible: boolean) => void
  readOnly?: boolean
}>(function NoteDocTitle({ value, onChange, onEnter, onVisibleChange, readOnly }, ref) {
  const el = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({
    // preventScroll + scrolling only the editor's own scroller: focus()/scrollIntoView() also
    // scroll overflow-hidden ANCESTORS (the panel, the window body), which shifted the whole
    // layout when the toolbar title was clicked (TEST 2026-10-04).
    focus: () => { el.current?.focus({ preventScroll: true }); const n = el.current?.value.length ?? 0; el.current?.setSelectionRange(n, n) },
    reveal: () => el.current?.closest('.berean-pm-editor')?.scrollTo({ top: 0, behavior: 'smooth' }),
  }), [])

  useEffect(() => {
    const node = el.current
    if (!node || !onVisibleChange || typeof IntersectionObserver === 'undefined') return
    const root = node.closest('.berean-pm-editor')
    // The floating formatting toolbar covers the top ~52px of the scroller — a title tucked under
    // it counts as scrolled away.
    const io = new IntersectionObserver(([e]) => onVisibleChange(e.isIntersecting), { root, rootMargin: '-52px 0px 0px 0px', threshold: 0.4 })
    io.observe(node)
    return () => { io.disconnect(); onVisibleChange(true) }
  }, [onVisibleChange])

  return (
    <textarea
      ref={el}
      rows={1}
      value={value}
      readOnly={readOnly}
      placeholder="Untitled"
      aria-label="Note title"
      spellCheck
      className="note-doc-title"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter() }
      }}
    />
  )
})
