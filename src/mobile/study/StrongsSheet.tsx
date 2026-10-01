import React, { useEffect, useState } from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'
import type { LexiconEntry } from '@/types'
import { DerivationText, stripBracketNotation, buildLexiconCopyText } from '@/components/lexicon/LexiconPanel'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { openDestination } from '@/lib/navigation/destination'
import { useScriptureText } from '@/lib/scriptureText'
import type { SheetApi } from '../primitives/Sheet'

/**
 * Strong's bottom sheet (R074): the collapsed detent shows the word, transliteration and gloss;
 * dragging up reveals the full definition, derivation, related numbers and occurrences (tap
 * → navigate). Same data the desktop tooltip/side panel/lexicon tab read.
 */
export function StrongsSheet({ strongsNum, api, onNavigate }: { strongsNum: string; api: SheetApi; onNavigate?: () => void }) {
  const [entry, setEntry] = useState<LexiconEntry | null | undefined>(undefined)
  const [related, setRelated] = useState<Array<{ strongsNum: string; lemma: string; transliteration: string; gloss: string }>>([])
  const [occ, setOcc] = useState<Array<{ book_id: string; chapter: number; verse_num: number; text: string; text_tagged?: string | null; text_id?: string }>>([])
  const [num, setNum] = useState(strongsNum)
  const [copied, setCopied] = useState(false)
  const lang: 'H' | 'G' = num.startsWith('G') ? 'G' : 'H'
  const { displayVerseText } = useScriptureText()

  useEffect(() => {
    let alive = true
    setEntry(undefined); setRelated([]); setOcc([])
    window.lexicon.getEntry(num).then((e) => { if (alive) setEntry(e) }).catch(() => { if (alive) setEntry(null) })
    window.lexicon.getRelated(num).then((r) => { if (alive) setRelated(r) }).catch(() => {})
    window.lexicon.getOccurrences(num, 60).then((o) => { if (alive) setOcc(o) }).catch(() => {})
    return () => { alive = false }
  }, [num])

  // An occurrence / "Open in Lexicon" changes the tab the sheet was opened over (NAV-002) — a
  // Scripture tab navigates, any other tab becomes Scripture / the Lexicon in place (‹ returns).
  const go = (bookId: string, chapter: number, verse: number) => {
    api.close()
    openDestination({ kind: 'passage', bookId, chapter, verse }, 'current-tab', { origin: { kind: 'lexicon-occurrence', strongsNum: num } })
    onNavigate?.()
  }

  if (entry === undefined) return <div className="mobile-sheet-loading">Loading {num}…</div>
  if (!entry) return <div className="mobile-empty">No lexicon entry for {num}.</div>
  return (
    <div className="mobile-strongs">
      <div className="mobile-strongs-head">
        <div className="mobile-strongs-lemma" lang={lang === 'H' ? 'he' : 'el'}>{entry.lemma}</div>
        <div className="mobile-strongs-meta"><span className="mobile-strongs-num">{entry.strongsNum}</span> · {entry.transliteration}{entry.pronunciation ? ` · ${entry.pronunciation}` : ''}</div>
        <div className="mobile-strongs-gloss">{stripBracketNotation(entry.gloss)}</div>
        {/* Copy — the desktop lexicon's Copy semantics (buildLexiconCopyText: number, word,
            definition) — TEST-042. */}
        <div className="mobile-strongs-actions">
          <button type="button" className="mobile-chip" onClick={() => { navigator.clipboard.writeText(buildLexiconCopyText(entry)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {}) }}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="mobile-chip" onClick={() => { api.close(); openDestination({ kind: 'strongs', num }, 'current-tab') }}>
            <ExternalLink size={16} aria-hidden /> Open in Lexicon
          </button>
        </div>
      </div>
      {api.detent === 0 && (
        <button type="button" className="mobile-link-button" onClick={api.expand}>Full entry, related words and {entry.occurrences} occurrences ↑</button>
      )}
      <section className="mobile-strongs-section">
        <h3>Definition</h3>
        <p><DerivationText text={stripBracketNotation(entry.definition)} lang={lang} onNav={(n) => setNum(n)} /></p>
        {entry.derivation && (<><h3>Derivation</h3><p><DerivationText text={stripBracketNotation(entry.derivation)} lang={lang} onNav={(n) => setNum(n)} /></p></>)}
        {entry.extendedDef && (<><h3>Extended</h3><p className="mobile-strongs-extended"><DerivationText text={stripBracketNotation(entry.extendedDef)} lang={lang} onNav={(n) => setNum(n)} /></p></>)}
      </section>
      {related.length > 0 && (
        <section className="mobile-strongs-section">
          <h3>Related</h3>
          <div className="mobile-chip-row">
            {related.map((r) => (
              <button key={r.strongsNum} type="button" className="mobile-chip" onClick={() => setNum(r.strongsNum)}>
                <span className="mobile-strongs-num">{r.strongsNum}</span> {r.lemma}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="mobile-strongs-section">
        <h3>Occurrences <span className="mobile-muted">({entry.occurrences})</span></h3>
        <ul className="mobile-occurrence-list">
          {occ.map((o) => (
            <li key={`${o.book_id}-${o.chapter}-${o.verse_num}`}>
              <button type="button" onClick={() => go(o.book_id, o.chapter, o.verse_num)}>
                <span className="mobile-occurrence-ref">{bookChapterVerseLabel(o.book_id, o.chapter, o.verse_num)}</span>
                <span className="mobile-occurrence-text">{displayVerseText(o.text, o.text_tagged ?? null, o.text_id ?? 'kjva')}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="mobile-link-button" onClick={() => { api.close(); openDestination({ kind: 'strongs', num }, 'current-tab') }}>
          <ExternalLink size={14} aria-hidden /> Open in Lexicon
        </button>
      </section>
    </div>
  )
}
