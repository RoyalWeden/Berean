import { useRef, useEffect, useMemo, useState } from 'react'
import { Captions, Play } from 'lucide-react'
import { decodeEntities } from '@/lib/youtubeSearch'
import { EmptyState, SearchField, SectionLabel, ListRow, cx } from '@/components/ui'

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
  const activeRef = useRef<HTMLDivElement>(null)
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
            <ListRow
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(seg.startMs / 1000)}
              title={decodeEntities(seg.text)}
              titleClassName={isActive ? 'font-medium' : undefined}
              current={isActive}
              className={cx(isActive && 'ring-1 ring-inset ring-accent/40', dimmed && 'opacity-30')}
              buttonProps={{ title: `Jump to ${formatTs(seg.startMs)}` }}
              leading={
                <span className={cx('text-caption2 font-mono tabular-nums min-w-[36px] text-right', isActive ? 'text-accent' : 'text-text-muted')}>
                  {formatTs(seg.startMs)}
                </span>
              }
              trailing={!isActive && <Play size={8} className="text-accent fill-accent" />}
            />
          )
        })}
      </div>
    </div>
  )
}
