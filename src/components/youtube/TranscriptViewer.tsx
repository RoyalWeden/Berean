import { useRef, useEffect, useMemo, useState } from 'react'
import { Captions } from 'lucide-react'
import { decodeEntities } from '@/lib/youtubeSearch'
import { EmptyState, SearchField, SectionLabel } from '@/components/ui'

export interface TranscriptSegment {
  startMs: number
  durMs: number
  text: string
}

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Synced transcript panel. Highlights the segment matching the current playback
 * time, auto-scrolls to keep it in view, and seeks the video when a line is clicked.
 */
export default function TranscriptViewer({
  segments,
  currentTimeMs,
  onSeek,
  autoScroll = true,
}: {
  segments: TranscriptSegment[]
  currentTimeMs: number
  onSeek: (seconds: number) => void
  autoScroll?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [userScrolling, setUserScrolling] = useState(false)
  const userScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Index of the active segment: the last segment whose start is <= current time.
  const activeIdx = useMemo(() => {
    if (segments.length === 0) return -1
    // Binary search for the rightmost startMs <= currentTimeMs
    let lo = 0, hi = segments.length - 1, ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segments[mid].startMs <= currentTimeMs) { ans = mid; lo = mid + 1 }
      else hi = mid - 1
    }
    return ans
  }, [segments, currentTimeMs])

  // Auto-scroll the active line into view (unless the user is manually scrolling or searching).
  useEffect(() => {
    if (!autoScroll || userScrolling || query) return
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx, autoScroll, userScrolling, query])

  // Detect manual scroll → pause auto-scroll for 4s so the user can read freely.
  function handleScroll() {
    setUserScrolling(true)
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
    userScrollTimer.current = setTimeout(() => setUserScrolling(false), 4000)
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.trim().toLowerCase()
    return new Set(segments.map((s, i) => (s.text.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0))
  }, [query, segments])

  if (segments.length === 0) {
    return <EmptyState icon={Captions} title="No transcript downloaded for this video" compact />
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Header + search */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-shrink-0">
        <Captions size={12} className="text-text-muted flex-shrink-0" />
        <SectionLabel className="flex-1 px-0">
          Transcript <span className="opacity-50 normal-case">({segments.length} lines)</span>
        </SectionLabel>
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder="Find…"
          size="sm"
          wrapperClassName="w-28 flex-shrink-0"
        />
      </div>

      {/* Segment list */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
        {segments.map((seg, i) => {
          const isActive = i === activeIdx
          const dimmed = filtered ? !filtered.has(i) : false
          return (
            <button
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(seg.startMs / 1000)}
              title={`Jump to ${formatTs(seg.startMs)}`}
              className={`group w-full text-left flex gap-2 items-start rounded-row px-2 py-1 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-accent-muted ring-1 ring-inset ring-accent/40'
                  : 'hover:bg-accent/10'
              } ${dimmed ? 'opacity-30' : ''}`}
            >
              {/* Timestamp — turns accent-colored on hover */}
              <span className={`flex-shrink-0 pt-0.5 text-caption2 font-mono tabular-nums transition-colors min-w-[36px] text-right ${
                isActive
                  ? 'text-accent'
                  : 'text-text-muted group-hover:text-accent'
              }`}>
                {formatTs(seg.startMs)}
              </span>
              <span className={`flex-1 text-footnote leading-snug transition-colors ${
                isActive
                  ? 'text-text-primary font-medium'
                  : 'text-text-secondary group-hover:text-text-primary'
              }`}>
                {decodeEntities(seg.text)}
              </span>
              {/* Play triangle — visible only on hover for non-active lines */}
              {!isActive && (
                <span className="ml-auto flex-shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg width="8" height="9" viewBox="0 0 8 9" fill="currentColor" className="text-accent">
                    <path d="M0 0L8 4.5L0 9V0Z"/>
                  </svg>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
