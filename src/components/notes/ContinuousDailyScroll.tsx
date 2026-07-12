import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { PenLine, Plus } from 'lucide-react'
import { renderMarkdownToHTML } from './pm/staticRender'
import type { Note } from '@/types'

// Shared helpers (mirrored from NotesPanel to avoid circular imports)
function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function dailyNoteTitle(date: Date): string {
  return `Daily — ${toDateKey(date)}`
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
function formatDateHeader(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

const INITIAL_PAST  = 14   // days shown behind today on first render
const INITIAL_AHEAD = 2    // days shown ahead of today
const LOAD_CHUNK    = 7    // days loaded at each edge when scrolling

interface ContinuousDailyScrollProps {
  targetDate: Date
  notes: Note[]
  onDateChange: (date: Date) => void
  onDayOpen: (date: Date) => void   // open a day's note for editing
}

export default function ContinuousDailyScroll({ targetDate, notes, onDateChange, onDayOpen }: ContinuousDailyScrollProps) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // dayOffset: relative to targetDate. negative = past, positive = future.
  const [firstOffset, setFirstOffset] = useState(-INITIAL_PAST)
  const [lastOffset,  setLastOffset]  = useState(INITIAL_AHEAD)
  const [activeDateKey, setActiveDateKey] = useState(toDateKey(targetDate))

  const scrollRef  = useRef<HTMLDivElement>(null)
  const headingRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const programmaticScrollRef   = useRef(false)
  const programmaticTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialScrollDoneRef    = useRef(false)

  // Build lookup: date-key → note
  const notesByKey = useMemo(() => {
    const m = new Map<string, Note>()
    for (const n of notes) {
      if (n.type === 'daily' && n.title?.startsWith('Daily — ')) {
        const key = n.title.slice('Daily — '.length)
        m.set(key, n)
      }
    }
    return m
  }, [notes])

  // Reset when targetDate changes from outside (calendar navigation)
  useEffect(() => {
    setFirstOffset(-INITIAL_PAST)
    setLastOffset(INITIAL_AHEAD)
    setActiveDateKey(toDateKey(targetDate))
    initialScrollDoneRef.current = false
  }, [targetDate])

  // Scroll to today's section on first render
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    const key = toDateKey(targetDate)
    const el = headingRefs.current.get(key)
    if (!el) return
    initialScrollDoneRef.current = true
    programmaticScrollRef.current = true
    el.scrollIntoView({ block: 'start' })
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current)
    programmaticTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 600)
  })

  // IntersectionObserver: track which date heading is most in-view
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const observed = new Map<string, IntersectionObserverEntry>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.dateKey
          if (key) observed.set(key, e)
        }
        if (programmaticScrollRef.current) return

        let best: string | null = null
        let bestRatio = -1
        let bestTop = Infinity
        observed.forEach((e, key) => {
          if (e.isIntersecting) {
            const r = e.intersectionRatio
            const top = e.boundingClientRect.top
            if (r > bestRatio || (r === bestRatio && top < bestTop)) {
              best = key; bestRatio = r; bestTop = top
            }
          }
        })
        if (best === null) {
          let closestDist = Infinity
          observed.forEach((e, key) => {
            const top = e.boundingClientRect.top
            const dist = Math.abs(top)
            if (top <= 60 && dist < closestDist) { closestDist = dist; best = key }
          })
        }
        if (best !== null && best !== activeDateKey) {
          setActiveDateKey(best)
          const [y, m, d] = (best as string).split('-').map(Number)
          onDateChange(new Date(y, m - 1, d))
        }
      },
      { root: container, threshold: [0, 0.1, 0.5, 1.0], rootMargin: '0px 0px -80% 0px' },
    )
    headingRefs.current.forEach((el) => { if (el) io.observe(el) })
    return () => io.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstOffset, lastOffset, onDateChange])

  // Load more days when near top/bottom
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const { scrollTop, scrollHeight, clientHeight } = el
    // Near bottom → load more past days
    if (scrollHeight - scrollTop - clientHeight < clientHeight * 0.4) {
      setFirstOffset((prev) => prev - LOAD_CHUNK)
    }
    // Near top → load more future days (but only up to today + INITIAL_AHEAD)
    if (scrollTop < clientHeight * 0.25) {
      setLastOffset((prev) => prev + LOAD_CHUNK)
    }
  }, [])

  // Build date list newest → oldest
  const dates = useMemo(() => {
    const arr: Date[] = []
    for (let offset = lastOffset; offset >= firstOffset; offset--) {
      arr.push(addDays(targetDate, offset))
    }
    return arr
  }, [targetDate, firstOffset, lastOffset])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
      {dates.map((date) => {
        const key = toDateKey(date)
        const note = notesByKey.get(key)
        const isToday = key === toDateKey(today)
        const isFuture = date > today

        return (
          <div key={key}>
            {/* Date heading divider */}
            <div
              ref={(el) => {
                if (el) headingRefs.current.set(key, el)
                else headingRefs.current.delete(key)
              }}
              data-date-key={key}
              className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))]"
            >
              <span className={`text-xs font-semibold uppercase tracking-wider select-none ${isToday ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
                {isToday ? 'Today — ' : ''}{formatDateHeader(date)}
              </span>
              <button
                onClick={() => onDayOpen(date)}
                title={note ? "Edit this day's note" : 'Create note for this day'}
                className="ml-auto p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                {note ? <PenLine size={12} /> : <Plus size={12} />}
              </button>
            </div>

            {/* Day content */}
            <div
              className="px-4 pb-6 pt-3 min-h-[80px] cursor-pointer group"
              onClick={() => onDayOpen(date)}
            >
              {note ? (
                <div
                  className="prose-note text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed group-hover:text-[rgb(var(--color-text-primary))] transition-colors"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHTML(note.content || '') }}
                />
              ) : isFuture ? (
                <p className="text-xs text-[rgb(var(--color-text-muted))] italic select-none">
                  No entry yet
                </p>
              ) : (
                <p className="text-xs text-[rgb(var(--color-text-muted))] italic select-none group-hover:text-[rgb(var(--color-text-secondary))] transition-colors">
                  No entry for this day — click to start writing
                </p>
              )}
            </div>

            <div className="border-b border-[rgb(var(--color-surface-3))]" />
          </div>
        )
      })}

      {/* Bottom sentinel */}
      <div className="h-16" />
    </div>
  )
}
