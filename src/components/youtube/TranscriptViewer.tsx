import { useRef, useEffect, useMemo, useState } from 'react'
import { Captions, Search, X } from 'lucide-react'
import { decodeEntities } from '@/lib/youtubeSearch'

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
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-[rgb(var(--color-text-muted))]">
        <Captions size={22} className="opacity-30" />
        <p className="text-[11px] opacity-60">No transcript downloaded for this video</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Header + search */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-shrink-0">
        <Captions size={12} className="text-[rgb(var(--color-text-muted))]" />
        <p className="text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider flex-1">
          Transcript <span className="opacity-50 normal-case">({segments.length} lines)</span>
        </p>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
          <Search size={10} className="text-[rgb(var(--color-text-muted))]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find…"
            className="w-24 text-[10px] bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
              <X size={9} />
            </button>
          )}
        </div>
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
              className={`w-full text-left flex gap-2 rounded px-2 py-1 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-[rgb(var(--color-accent))/20] ring-1 ring-inset ring-[rgb(var(--color-accent))/40]'
                  : 'hover:bg-[rgb(var(--color-surface-3))]'
              } ${dimmed ? 'opacity-30' : ''}`}
            >
              <span className={`text-[10px] font-mono flex-shrink-0 tabular-nums pt-0.5 ${isActive ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
                {formatTs(seg.startMs)}
              </span>
              <span className={`text-[12px] leading-snug ${isActive ? 'text-[rgb(var(--color-text-primary))] font-medium' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                {decodeEntities(seg.text)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
