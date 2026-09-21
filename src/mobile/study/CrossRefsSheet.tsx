import React, { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import type { TSKeGroup } from '@/types/electron'
import type { SheetApi } from '../primitives/Sheet'
import { Segmented } from '../settings/SettingsPage'

interface Ref { bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; votes?: number }

/**
 * Cross references for a verse (R075): the same three sources as the desktop right panel —
 * TSKe (grouped, with headings), classic (votes), and notes (references found in the user's
 * notes are shown through the notes sheet). Tap a reference → navigate; the sheet closes.
 */
export function CrossRefsSheet({ bookId, chapter, verse, textId, label, api }: { bookId: string; chapter: number; verse: number; textId: string; label: string; api: SheetApi }) {
  const source = useAppStore((s) => s.crossRefSource)
  const setSource = useAppStore((s) => s.setCrossRefSource)
  const [classic, setClassic] = useState<Ref[] | null>(null)
  const [tske, setTske] = useState<TSKeGroup[] | null>(null)
  const mode: 'tske' | 'classic' = source === 'classic' ? 'classic' : 'tske'
  useEffect(() => {
    let alive = true
    window.crossrefs.getForVerse(bookId, chapter, verse, textId).then((r) => { if (alive) setClassic(r.refs) }).catch(() => { if (alive) setClassic([]) })
    window.crossrefs.getTSKeForVerse(bookId, chapter, verse, textId).then((r) => { if (alive) setTske(r.groups) }).catch(() => { if (alive) setTske([]) })
    return () => { alive = false }
  }, [bookId, chapter, verse, textId])
  const go = (r: Ref) => {
    api.close()
    navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, origin: { kind: 'cross-ref', source: mode, fromVerse: verse } })
  }
  const refLabel = (r: Ref) => `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${r.endVerse && r.endVerse !== r.verse ? `-${r.endVerse}` : ''}`
  return (
    <div className="mobile-crossrefs">
      <div className="mobile-crossrefs-head">
        <div className="mobile-verse-actions-ref">Cross references · {label}</div>
        <Segmented value={mode} options={[['tske', 'TSKe'], ['classic', 'Classic']]} onChange={(v) => setSource(v as 'tske' | 'classic')} />
      </div>
      {mode === 'tske' ? (
        tske === null ? <div className="mobile-empty">Loading…</div> : tske.length === 0 ? <div className="mobile-empty">No TSKe references.</div> : tske.map((g, i) => (
          <section key={i} className="mobile-crossrefs-group">
            {g.heading && <h3>{g.heading}{g.isReciprocal ? ' (reciprocal)' : ''}</h3>}
            <ul className="mobile-occurrence-list">
              {g.refs.map((r, j) => (
                <li key={j}><button type="button" onClick={() => go(r)}><span className="mobile-occurrence-ref">{refLabel(r)}</span><span className="mobile-occurrence-text">{r.text}</span></button></li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        classic === null ? <div className="mobile-empty">Loading…</div> : classic.length === 0 ? <div className="mobile-empty">No references.</div> : (
          <ul className="mobile-occurrence-list">
            {classic.map((r, j) => (
              <li key={j}><button type="button" onClick={() => go(r)}><span className="mobile-occurrence-ref">{refLabel(r)}{r.votes ? <span className="mobile-muted"> · {r.votes}</span> : null}</span><span className="mobile-occurrence-text">{r.text}</span></button></li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
