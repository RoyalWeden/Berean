import { useEffect, useState } from 'react'
import { bookName } from '@/lib/parseRef'
import type { ChapterTSKeEntry, ChapterCrossRefEntry } from '@/types/electron'

interface Props {
  bookId: string
  chapter: number
  source: 'tske' | 'classic' | 'notes'
  activeVerse?: number
  fontScale: number
  muteColor: string
  textColor: string
  accentColor: string
  scrollRef?: React.RefObject<HTMLDivElement>
}

type FlatRef = { bookId: string; chapter: number; verse: number; endVerse: number | null; text?: string }
type RenderGroup = { heading: string | null; isReciprocal: boolean; refs: FlatRef[] }
type RenderVerse = { verseNum: number; groups: RenderGroup[] }

function refLabel(r: FlatRef): string {
  if (r.verse === 0) return `${bookName(r.bookId)} ${r.chapter}`
  if (r.endVerse) return `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
  return `${bookName(r.bookId)} ${r.chapter}:${r.verse}`
}

export default function ViewerCrossRefs({
  bookId, chapter, source, activeVerse, fontScale, muteColor, textColor, accentColor, scrollRef,
}: Props) {
  const [verses, setVerses] = useState<RenderVerse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    console.log('[ViewerCrossRefs] fetch', { bookId, chapter, source, activeVerse, hasApi: typeof window.crossrefs?.getTSKeForChapter })
    setLoading(true); setError(false)
    if (source === 'tske' && typeof window.crossrefs?.getTSKeForChapter === 'function') {
      window.crossrefs.getTSKeForChapter(bookId, chapter)
        .then((res: { verseRefs: ChapterTSKeEntry[]; error: boolean }) => {
          console.log('[ViewerCrossRefs] tske result', { error: res.error, verses: res.verseRefs?.length })
          if (res.error) { setError(true); setVerses([]); return }
          setVerses(res.verseRefs.map(v => ({
            verseNum: v.verseNum,
            groups: v.groups.map(g => ({ heading: g.heading, isReciprocal: g.isReciprocal, refs: g.refs })),
          })))
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    } else if (source === 'classic' && typeof window.crossrefs?.getForChapter === 'function') {
      window.crossrefs.getForChapter(bookId, chapter)
        .then((res: { verseRefs: ChapterCrossRefEntry[]; error: boolean }) => {
          if (res.error) { setError(true); setVerses([]); return }
          setVerses(res.verseRefs.map(v => ({
            verseNum: v.verseNum,
            groups: [{ heading: null, isReciprocal: false, refs: v.refs }],
          })))
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    } else {
      // 'notes' source is derived from the user's notes in the main window; not mirrored here.
      setVerses([])
      setLoading(false)
    }
  }, [bookId, chapter, source])

  const fs = Math.round(13 * fontScale)
  const headerFs = Math.round(11 * fontScale)
  const labelFs = Math.round(12 * fontScale)

  const visible = activeVerse ? verses.filter(v => v.verseNum === activeVerse) : verses

  if (loading) {
    return <div ref={scrollRef} className="h-full overflow-y-auto flex items-center justify-center" style={{ fontSize: fs, color: muteColor }}>Loading…</div>
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-5 pt-12">
      <div
        className="select-none mb-4"
        style={{ fontSize: headerFs, color: muteColor, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}
      >
        Cross-references — {bookName(bookId)} {chapter}{activeVerse ? `:${activeVerse}` : ''}
        <span style={{ marginLeft: 6, opacity: 0.6 }}>
          {source === 'tske' ? 'TSKe' : source === 'classic' ? 'Classic' : 'My Notes'}
        </span>
      </div>

      {error && (
        <p style={{ fontSize: fs, color: muteColor }}>Cross-reference data unavailable.</p>
      )}
      {!error && source === 'notes' && (
        <p style={{ fontSize: fs, color: muteColor }}>Note-based cross-references are shown in the main window.</p>
      )}
      {!error && source !== 'notes' && visible.length === 0 && (
        <p style={{ fontSize: fs, color: muteColor }}>No cross-references for this {activeVerse ? 'verse' : 'chapter'}.</p>
      )}

      {visible.map(v => (
        <div key={v.verseNum} className="mb-5">
          {!activeVerse && (
            <div style={{ fontSize: headerFs, color: accentColor, fontWeight: 700, marginBottom: 6 }}>
              v{v.verseNum}
            </div>
          )}
          {v.groups.map((g, gi) => (
            <div key={gi} className="mb-2">
              {g.heading && (
                <div
                  style={{
                    fontSize: headerFs, marginBottom: 4, fontWeight: 600,
                    color: muteColor, fontStyle: g.isReciprocal ? 'italic' : 'normal',
                  }}
                >
                  {g.heading}
                </div>
              )}
              {g.refs.map((r, ri) => (
                <div key={ri} style={{ marginBottom: 6, lineHeight: 1.5 }}>
                  <span style={{ fontSize: labelFs, color: accentColor, fontWeight: 600, fontFamily: 'monospace' }}>
                    {refLabel(r)}
                  </span>
                  {r.text && (
                    <span style={{ fontSize: fs, color: textColor }}> — {r.text}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
