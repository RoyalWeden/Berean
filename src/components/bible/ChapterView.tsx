import { useState, useEffect } from 'react'
import VerseRow from './VerseRow'
import type { Verse } from '@/types'

interface ChapterViewProps {
  bookId: string
  chapter: number
  showStrongs: boolean
}

export default function ChapterView({ bookId, chapter, showStrongs }: ChapterViewProps) {
  const [verses, setVerses] = useState<Verse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.bible
      .queryChapter(bookId, chapter)
      .then((data) => {
        setVerses(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [bookId, chapter])

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="w-6 h-4 bg-[rgb(var(--color-surface-4))] rounded flex-shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-[rgb(var(--color-surface-4))] rounded w-full" />
              {i % 2 === 0 && <div className="h-4 bg-[rgb(var(--color-surface-4))] rounded w-3/4" />}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (verses.length === 0) {
    return (
      <div className="px-8 py-12 text-center text-[rgb(var(--color-text-muted))]">
        No verses found for {bookId} {chapter}.
      </div>
    )
  }

  return (
    <div className="px-8 py-6 max-w-3xl">
      {verses.map((verse) => (
        <VerseRow
          key={verse.verse_num}
          verse={verse}
          showStrongs={showStrongs}
        />
      ))}
    </div>
  )
}
