import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { BookMarked, Search, X, ArrowLeft, Home, ChevronLeft, ChevronRight, ScanSearch, Info, Copy, Check as CheckIcon, Monitor } from 'lucide-react'
import { useAppStore } from '@/store'
import { HintTooltip } from '@/components/shell/HintTooltip'
import FindBar from '@/components/shell/FindBar'
import { applyFindHighlight } from '@/lib/highlight'
import { bookName } from '@/lib/parseRef'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { StrongsContextMenu, useStrongsContextMenu } from './StrongsContextMenu'
import ZoomControls from '@/components/shell/ZoomControls'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { tokenizeBdbNotes } from '@/lib/bdbAbbreviations'
import type { LexiconEntry } from '@/types'
import type { WordReplacerRule } from '@/store'

type OccurrenceRow = { book_id: string; chapter: number; verse_num: number; text: string; text_id?: string; matchWordIndices?: number[] }

/**
 * Strip BDB/scholarly bracket notation from lexicon text.
 * BDB entries contain patterns like `[ בָּשַׂר ] vb .` that look like Markdown links
 * and add visual noise when inserted into notes.
 */
export function stripBracketNotation(text: string): string {
  // Remove any [ ... ] group whose contents include a Hebrew (U+0590-U+05FF) or
  // Greek (U+0370-U+03FF) character - these BDB bracket annotations otherwise look
  // like Markdown links and get rendered as broken links inside notes.
  return text
    .replace(/\[[^\]]*[\u0590-\u05FF\u0370-\u03FF][^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Normalize a Strong's text field: bare numbers (1–5 digits) that appear in the
 * Strong's derivation / definition data without a H/G prefix get the prefix added.
 * All numbers in these fields are Strong's cross-references, not arbitrary numbers.
 */
export function normalizeStrongsNums(text: string, lang: 'H' | 'G'): string {
  // Add prefix to bare numbers; also strip leading zeros from already-prefixed ones
  // (Greek DB stores H07941; Hebrew DB stores H7941 — normalize to the shorter form)
  return text
    .replace(/\b([HG])0+(\d)/g, '$1$2')
    .replace(/(?<![HGa-zA-Z/])(\b\d{1,5}\b)(?!\s*[:.])/g, (_, n) => `${lang}${parseInt(n, 10)}`)
}

/** Build the plain-text string that the copy button places on the clipboard.
 *
 * Format (matches Strong's dictionary style) — NO leading indent in the raw copy:
 *   G5485 χάρις cháris, khar'-ece;
 *   from G5463; graciousness (as gratifying)...:—acceptable, benefit, favour, gift, grace...
 *
 * Line 2 is `{derivation} {definition}:—{occurrence words}` where the occurrence words
 * (how the term is actually rendered in scripture, e.g. the KJV translations) come from
 * the gloss/short_def, separated by the standard Strong's colon + em-dash.
 *
 * The notes renderer adds visual indentation on line 2 when it detects this as a
 * lexicon block — the copy text itself stays plain so it pastes cleanly anywhere.
 */
export function buildLexiconCopyText(
  entry: Pick<LexiconEntry, 'strongsNum' | 'lemma' | 'transliteration' | 'pronunciation' | 'definition' | 'gloss' | 'derivation'> & { extendedDef?: string }
): string {
  const lang: 'H' | 'G' = entry.strongsNum.startsWith('H') ? 'H' : 'G'

  // ── Line 1: number lemma transliteration, pronunciation; ─────────────────────
  const line1Parts: string[] = [entry.strongsNum]
  if (entry.lemma?.trim()) line1Parts.push(entry.lemma.trim())
  const trans = entry.transliteration?.trim() ?? ''
  const pron  = entry.pronunciation?.trim() ?? ''
  if (trans && pron) line1Parts.push(`${trans}, ${pron}`)
  else if (trans)    line1Parts.push(trans)
  else if (pron)     line1Parts.push(pron)
  // Line 1 always ends with semicolon so the notes lexicon-block detector matches
  const line1 = line1Parts.join(' ') + ';'

  // ── Line 2: derivation + definition :— occurrence words ──────────────────────
  // Body = the meaning: prefer `definition` (clean full_def) over `extendedDef`
  // (BDB scholarly notes full of Hebrew bracket notation / "vb.", "Pi.", "Hithp.").
  const derivation = normalizeStrongsNums(entry.derivation?.trim() ?? '', lang)
  const def        = (entry.definition ?? '').trim() || stripBracketNotation((entry.extendedDef ?? '').trim())
  const bodyDef    = normalizeStrongsNums(def, lang)
  // Occurrence words — how the term is rendered in scripture (KJV translations).
  const occurrences = (entry.gloss ?? '').trim()

  // Assemble derivation + definition into the body.
  let body = ''
  if (derivation && bodyDef) {
    const sep = derivation.endsWith(';') ? '' : ';'
    body = `${derivation}${sep} ${bodyDef}`
  } else {
    body = derivation || bodyDef
  }

  // Append the occurrence words after a colon + em-dash (standard Strong's notation).
  let line2 = body
  if (occurrences) {
    const trimmedBody = body.replace(/[;,\s]+$/, '')
    line2 = trimmedBody ? `${trimmedBody}:—${occurrences}` : occurrences
  }

  return line2 ? `${line1}\n${line2}` : line1
}

/** Render verse text with matched words (by index) bolded/highlighted */
function VerseWithMatchedWords({ text, matchWordIndices }: { text: string; matchWordIndices?: number[] }) {
  if (!text) return null
  if (!matchWordIndices?.length) return <span>{text}</span>
  const indexSet = new Set(matchWordIndices)
  // Split on word boundaries while keeping punctuation attached to words
  const tokens = text.split(/(\s+)/)
  let wordIdx = 0
  return (
    <span>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>
        const isMatch = indexSet.has(wordIdx)
        wordIdx++
        return isMatch
          ? (
            <mark
              key={i}
              className="berean-find-mark bg-yellow-400/40 text-[rgb(var(--color-text-primary))] rounded-sm not-italic font-medium"
            >
              {token}
            </mark>
          )
          : <span key={i}>{token}</span>
      })}
    </span>
  )
}

function LangBadge({ num }: { num: string }) {
  const isHebrew = num.startsWith('H')
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
      isHebrew ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-500/20 text-indigo-400'
    }`}>
      {isHebrew ? 'Hebrew' : 'Greek'}
    </span>
  )
}

/** Render BDB notes with grammatical abbreviations expanded + tagged (e.g. "vb." → "verb"),
 *  and bare numbers (occurrence counts / citations — not Strong's) shown muted. */
function BdbNotesText({ text }: { text: string }) {
  const tokens = tokenizeBdbNotes(text)
  return (
    <span>
      {tokens.map((t, i) => {
        if (t.kind === 'abbr') {
          return (
            <span
              key={i}
              title={t.raw}
              className="italic text-[rgb(var(--color-accent))] opacity-80"
            >{t.text}</span>
          )
        }
        if (t.kind === 'num') {
          return (
            <span
              key={i}
              dir="ltr"
              title={`${t.text} occurrences in the Hebrew Bible`}
              className="text-[rgb(var(--color-text-muted))] opacity-70"
            >
              {t.text}<span className="text-[0.72em] opacity-60">&nbsp;occ.</span>
            </span>
          )
        }
        return <span key={i}>{t.text}</span>
      })}
    </span>
  )
}

function DerivationText({ text, lang, onNav, onContextMenu }: {
  text: string
  lang: 'H' | 'G'
  onNav: (num: string, newTab: boolean) => void
  onContextMenu?: (e: React.MouseEvent, num: string) => void
}) {
  // Split on H/G-prefixed numbers OR bare numbers (1–5 digits) so that
  // derivations stored without the prefix (e.g. "from 2165") still link.
  const parts = text.split(/(\b[HG]\d{1,5}\b|\b\d{1,5}\b)/g)
  return (
    <span>
      {parts.map((part, i) => {
        let prefixed: string | null = null
        if (/^[HG]\d{1,5}$/.test(part)) {
          // Strip leading zeros: H07941 → H7941 (Greek DB pads, Hebrew DB does not)
          prefixed = part[0] + String(parseInt(part.slice(1), 10))
        } else if (/^\d{1,5}$/.test(part)) {
          prefixed = `${lang}${parseInt(part, 10)}`
        }
        if (prefixed) {
          return (
            <button
              key={i}
              onClick={(e) => onNav(prefixed!, e.metaKey || e.ctrlKey)}
              onContextMenu={(e) => onContextMenu?.(e, prefixed!)}
              className="font-mono text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
            >
              {prefixed}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

const LEXICON_GUIDE = [
  {
    section: 'Strong\'s number',
    example: 'H7225 · G3056',
    desc: 'Unique numeric ID for every original-language word. H = Hebrew/Aramaic, G = Greek. The same number always refers to the same root word across the whole Bible.',
  },
  {
    section: 'Original word',
    example: 'בְּרֵאשִׁית · λόγος',
    desc: 'The word exactly as it appears in the Hebrew (OT) or Greek (NT) manuscript. Hebrew reads right-to-left.',
  },
  {
    section: 'Transliteration',
    example: 'bĕrêʼshîyth · lógos',
    desc: 'The original word spelled out in Latin letters so you can hear how it sounds, even without knowing Hebrew or Greek.',
  },
  {
    section: 'Gloss',
    example: '"in the beginning, chief"',
    desc: 'A short one-phrase English summary of the word\'s core meaning. This is what most concordances show.',
  },
  {
    section: 'Definition',
    example: 'Full Brown-Driver-Briggs / Thayer entry',
    desc: 'The complete lexical definition covering all shades of meaning, how the word is used in different contexts, and related forms.',
  },
  {
    section: 'Derivation',
    example: 'from H7218 (rôʼsh, "head")',
    desc: 'How the word is built — its root word(s) and linguistic history. Clickable Strong\'s numbers in blue jump to that root.',
  },
  {
    section: 'BDB Notes / Extended',
    example: 'verb · noun, fem. · Hiphil',
    desc: 'Scholarly notes from the Hebrew (BDB) lexicon. Grammatical markers (vb., n.f., Hiph.…) are expanded and shown in blue italics. Numbers show as "1101 occ." — that\'s how many times the word appears in the Hebrew Bible, not a Strong\'s number.',
  },
  {
    section: 'Derived terms',
    example: 'H7218 → H7221, H7222…',
    desc: 'Other Strong\'s words that share the same root. Useful for exploring a word family across the whole Bible.',
  },
  {
    section: 'Occurrences',
    example: 'Gen 1:1 · Prov 8:22…',
    desc: 'Every verse in the Bible where this exact word appears. Click any reference to jump there in the scripture reader.',
  },
]

function LexiconInfoPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 z-50 w-80 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-xl shadow-2xl overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-[rgb(var(--color-surface-4))] flex items-center justify-between">
        <span className="text-xs font-semibold text-[rgb(var(--color-text-primary))]">How to read a lexicon entry</span>
        <button onClick={onClose} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"><X size={13} /></button>
      </div>
      <div className="overflow-y-auto max-h-80">
        {LEXICON_GUIDE.map((g) => (
          <div key={g.section} className="px-4 py-2.5 border-b border-[rgb(var(--color-surface-4))] last:border-0">
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))]">{g.section}</span>
              <code className="text-[9px] text-[rgb(var(--color-text-muted))] font-mono truncate">{g.example}</code>
            </div>
            <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed">{g.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function EntryView({
  entry,
  backLabel,
  onBack,
  onHome,
  hasHistory,
  onNav,
  noteBack,
  onNoteBack,
  findQuery,
  onFindOpen,
  onNavigateToVerse,
  scrollRef,
  onScroll,
  floating = false,
  wordReplacerRules = [],
  viewerWindowOpen = false,
  onPresentLexicon,
}: {
  entry: LexiconEntry
  backLabel: string
  onBack: () => void
  onHome: () => void
  hasHistory: boolean
  onNav: (num: string, newTab: boolean) => void
  noteBack?: { noteId: string; title: string } | null
  onNoteBack?: () => void
  findQuery?: string
  onFindOpen?: () => void
  onNavigateToVerse?: (bookId: string, chapter: number, verse: number) => void
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  floating?: boolean
  wordReplacerRules?: WordReplacerRule[]
  viewerWindowOpen?: boolean
  onPresentLexicon?: () => void
}) {
  // Helper: apply word replacer if rules are present
  const wr = (t: string) => wordReplacerRules.length ? applyWordReplacer(t, wordReplacerRules) : t
  const lexiconZoom = useAppStore((s) => s.panelZoom.lexicon)
  const [infoOpen, setInfoOpen] = useState(false)
  const [related, setRelated] = useState<{ strongsNum: string; lemma: string; transliteration: string; gloss: string }[]>([])
  const [adjacent, setAdjacent] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null })
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>([])
  const [occurrencesLoading, setOccurrencesLoading] = useState(false)
  const [showAllOccurrences, setShowAllOccurrences] = useState(false)
  const verseCopy = useVerseCopyMenu()
  const strongsCtx = useStrongsContextMenu()

  useEffect(() => {
    try {
      window.lexicon.getRelated(entry.strongsNum).then(setRelated).catch(() => setRelated([]))
    } catch {
      setRelated([])
    }
  }, [entry.strongsNum])

  useEffect(() => {
    setOccurrences([])
    setShowAllOccurrences(false)
    setOccurrencesLoading(true)
    window.lexicon.getOccurrences(entry.strongsNum)
      .then((rows) => { setOccurrences(rows); setOccurrencesLoading(false) })
      .catch(() => { setOccurrencesLoading(false) })
  }, [entry.strongsNum])

  useEffect(() => {
    const num = entry.strongsNum
    const isHebrew = num.startsWith('H')
    const n = parseInt(num.slice(1), 10)
    if (isNaN(n)) { setAdjacent({ prev: null, next: null }); return }
    const prevNum = n > 1 ? `${isHebrew ? 'H' : 'G'}${n - 1}` : null
    setAdjacent({ prev: prevNum, next: `${isHebrew ? 'H' : 'G'}${n + 1}` })
  }, [entry.strongsNum])

  const hasExtended = (entry.extendedDef?.trim().length ?? 0) > 0
  const hasDerivation = (entry.derivation?.trim().length ?? 0) > 0
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(buildLexiconCopyText(entry)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full">
      <VerseCopyMenu target={verseCopy.target} onClose={verseCopy.close} />
      <StrongsContextMenu
        target={strongsCtx.target}
        onClose={strongsCtx.close}
        onOpen={(num) => onNav(num, false)}
        onOpenNewTab={(num) => onNav(num, true)}
      />
      {/* Header */}
      <div className={`flex items-center gap-2 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 min-h-[40px] ${floating ? 'pl-[76px] pr-4 app-drag-region' : 'px-4 app-drag-region'}`}>
        {noteBack && onNoteBack && (
          <button
            onClick={onNoteBack}
            title={`Back to "${noteBack.title}"`}
            className="flex items-center gap-1 text-xs text-[rgb(var(--color-accent))] hover:underline cursor-pointer flex-shrink-0 max-w-[120px] truncate"
          >
            <ArrowLeft size={11} className="flex-shrink-0" />
            <span className="truncate">{noteBack.title}</span>
          </button>
        )}
        {hasHistory && (
          <button
            onClick={onHome}
            className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
            title="Back to lexicon search"
          >
            <Home size={14} />
          </button>
        )}
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] rounded px-1.5 py-0.5 cursor-pointer transition-colors"
        >
          <ArrowLeft size={14} />
          <span>{backLabel}</span>
        </button>
        <span className="text-sm font-semibold text-[rgb(var(--color-text-primary))] font-mono">{entry.strongsNum}</span>
        <LangBadge num={entry.strongsNum} />
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          title="Copy Strong's number and definition"
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          {copied ? <CheckIcon size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
        {onFindOpen && (
          <button
            onClick={onFindOpen}
            title="Find in entry (⌘F)"
            className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            <ScanSearch size={14} />
          </button>
        )}
        <ZoomControls context="lexicon" compact />
        {onPresentLexicon && (
          <HintTooltip label={viewerWindowOpen ? 'Send to presenter view' : 'Open presenter view'} shortcut="⌘⇧B">
          <button
            onClick={onPresentLexicon}
            className={`p-1 rounded transition-colors cursor-pointer ${
              viewerWindowOpen
                ? 'text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))]'
                : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
            }`}
          >
            <Monitor size={14} />
          </button>
          </HintTooltip>
        )}
        <div className="relative">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setInfoOpen((v) => !v)}
            title="How to read a lexicon entry"
            className={`p-1 rounded transition-colors cursor-pointer ${infoOpen ? 'text-[rgb(var(--color-text-primary))] bg-[rgb(var(--color-surface-4))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'}`}
          >
            <Info size={14} />
          </button>
          {infoOpen && <LexiconInfoPopover onClose={() => setInfoOpen(false)} />}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ zoom: lexiconZoom }}>
        {/* Word + transliteration */}
        <div className="space-y-1">
          {entry.lemma && (
            <div className="text-2xl font-medium text-[rgb(var(--color-text-primary))]" style={{ fontFamily: 'serif' }}>
              <span dir="rtl">{findQuery ? applyFindHighlight(entry.lemma, findQuery) : entry.lemma}</span>
            </div>
          )}
          <div className="flex items-baseline gap-2 flex-wrap">
            {entry.transliteration && (
              <span className="text-base text-[rgb(var(--color-text-secondary))] italic">
                {findQuery ? applyFindHighlight(entry.transliteration, findQuery) : entry.transliteration}
              </span>
            )}
            {entry.pronunciation && (
              <span className="text-xs text-[rgb(var(--color-text-muted))]">({entry.pronunciation})</span>
            )}
          </div>
        </div>

        {entry.gloss && (
          <div className="text-sm text-[rgb(var(--color-text-primary))] font-medium bg-[rgb(var(--color-surface-4))] px-3 py-2 rounded-lg">
            {(() => {
              const isUnrepresented = entry.gloss.toLowerCase().includes('unrepresented in english')
              const rawGloss = isUnrepresented
                ? `Untranslated particle (${entry.strongsNum}) — marks the definite direct object in Hebrew; has no English equivalent and is not rendered in translation`
                : entry.gloss
              const displayGloss = wr(rawGloss)
              return findQuery ? applyFindHighlight(displayGloss, findQuery) : displayGloss
            })()}
          </div>
        )}

        {entry.definition && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">Definition</p>
            <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">
              {(() => { const t = wr(entry.definition); return findQuery ? applyFindHighlight(t, findQuery) : t })()}
            </p>
          </div>
        )}

        {hasDerivation && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">Derivation</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed italic">
              <DerivationText text={wr(entry.derivation)} lang={entry.strongsNum.startsWith('H') ? 'H' : 'G'} onNav={onNav} onContextMenu={(e, num) => strongsCtx.open(e, num)} />
            </p>
          </div>
        )}

        {hasExtended && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">
              {entry.strongsNum.startsWith('H') ? 'BDB Notes' : 'Extended'}
            </p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
              <BdbNotesText text={wr(entry.extendedDef)} />
            </p>
          </div>
        )}

        {related.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Derived terms</p>
            <div className="space-y-1">
              {related.map((r) => (
                <button
                  key={r.strongsNum}
                  onClick={(e) => onNav(r.strongsNum, e.metaKey || e.ctrlKey)}
                  onContextMenu={(e) => strongsCtx.open(e, r.strongsNum)}
                  className="w-full flex items-baseline gap-2 px-2 py-1.5 rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-left transition-colors"
                >
                  <span className="font-mono text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0 w-10">{r.strongsNum}</span>
                  {r.lemma && (
                    <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]" style={{ fontFamily: 'serif' }}><span dir="rtl">{r.lemma}</span></span>
                  )}
                  <span className="text-xs text-[rgb(var(--color-text-muted))] italic flex-shrink-0">{r.transliteration}</span>
                  <span className="text-xs text-[rgb(var(--color-text-secondary))] truncate">{r.gloss}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Verse Occurrences */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
              Occurrences{occurrences.length > 0 ? ` (${occurrences.length}${occurrences.length >= 1000 ? '+' : ''})` : ''}
            </p>
            <div className="flex items-center gap-3">
              {occurrences.length > 0 && (
                <button
                  onClick={() => useAppStore.getState().openScriptureSearchTab(entry.strongsNum)}
                  title={`Open all ${entry.strongsNum} occurrences in a search tab, with the words highlighted`}
                  className="flex items-center gap-1 text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                >
                  <ScanSearch size={11} />
                  Open all in a tab
                </button>
              )}
              {occurrences.length > 10 && (
                <button
                  onClick={() => setShowAllOccurrences((v) => !v)}
                  className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                >
                  {showAllOccurrences ? 'Show fewer' : `Show all ${occurrences.length}`}
                </button>
              )}
            </div>
          </div>
          {occurrencesLoading && (
            <p className="text-xs text-[rgb(var(--color-text-muted))] text-center py-2">Loading…</p>
          )}
          {!occurrencesLoading && occurrences.length === 0 && (
            <p className="text-xs text-[rgb(var(--color-text-muted))]">No occurrence data available.</p>
          )}
          {!occurrencesLoading && occurrences.length > 0 && (
            <div className="space-y-0.5">
              {(showAllOccurrences ? occurrences : occurrences.slice(0, 10)).map((occ, i) => {
                const bk = (() => { try { return bookName(occ.book_id) } catch { return occ.book_id } })()
                const refLabel = `${bk} ${occ.chapter}:${occ.verse_num}`
                const multipleMatches = (occ.matchWordIndices?.length ?? 0) > 1
                return (
                  <button
                    key={i}
                    onClick={() => onNavigateToVerse?.(occ.book_id, occ.chapter, occ.verse_num)}
                    onContextMenu={(e) => verseCopy.open(e, { bookId: occ.book_id, chapter: occ.chapter, verse: occ.verse_num, text: occ.text ?? '' })}
                    className="w-full text-left px-2 py-2 rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors group"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-[rgb(var(--color-accent))] flex-shrink-0 group-hover:underline">
                        {refLabel}
                      </span>
                      {occ.text_id === 'lxx' && (
                        <span className="text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] px-1 rounded">
                          LXX
                        </span>
                      )}
                      {multipleMatches && (
                        <span className="text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] px-1 rounded">
                          ×{occ.matchWordIndices?.length}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-relaxed mt-0.5">
                      {occ.text
                        ? <VerseWithMatchedWords text={wr(occ.text)} matchWordIndices={occ.matchWordIndices} />
                        : <span className="italic text-[rgb(var(--color-text-muted))]">—</span>
                      }
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Prev / Next navigation */}
      <div className="flex items-center border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
        <button
          onClick={() => adjacent.prev && onNav(adjacent.prev, false)}
          disabled={!adjacent.prev}
          className="flex-1 flex items-center gap-1 px-4 py-2.5 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <ChevronLeft size={14} />
          {adjacent.prev}
        </button>
        <div className="w-px h-5 bg-[rgb(var(--color-surface-4))]" />
        <button
          onClick={() => adjacent.next && onNav(adjacent.next, false)}
          disabled={!adjacent.next}
          className="flex-1 flex items-center justify-end gap-1 px-4 py-2.5 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          {adjacent.next}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

function SearchView({
  onSelect,
  onOpenNewTab,
  onSearchStateChange,
  initialQuery = '',
  initialLang = 'all' as 'H' | 'G' | 'all',
  findQuery,
  onFindOpen,
  floating = false,
  wordReplacerRules = [],
  viewerWindowOpen = false,
  onPresentLexicon,
}: {
  onSelect: (entry: LexiconEntry) => void
  onOpenNewTab?: (entry: LexiconEntry) => void
  onSearchStateChange?: (state: { query: string; lang: 'H' | 'G' | 'all' }) => void
  initialQuery?: string
  initialLang?: 'H' | 'G' | 'all'
  findQuery?: string
  onFindOpen?: () => void
  floating?: boolean
  wordReplacerRules?: WordReplacerRule[]
  viewerWindowOpen?: boolean
  onPresentLexicon?: () => void
}) {
  const wr = (t: string) => wordReplacerRules.length ? applyWordReplacer(t, wordReplacerRules) : t
  const [query, setQuery] = useState(initialQuery)
  const [lang, setLang] = useState<'H' | 'G' | 'all'>(initialLang)
  const [infoOpen, setInfoOpen] = useState(false)
  const [results, setResults] = useState<LexiconEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchCtx = useStrongsContextMenu()
  const [ctxEntry, setCtxEntry] = useState<LexiconEntry | null>(null)

  // If we were restored from history with a pre-existing query, run it immediately
  useEffect(() => {
    inputRef.current?.focus()
    if (initialQuery.trim().length >= 2) {
      setLoading(true)
      const q = initialQuery.trim()
      if (/^[HhGg]\d+$/i.test(q)) {
        window.lexicon.getEntry(q)
          .then((e) => { setResults(e ? [e] : []); setLoading(false) })
          .catch(() => { setResults([]); setLoading(false) })
      } else {
        window.lexicon.search(q, initialLang)
          .then((r) => { setResults(r); setLoading(false) })
          .catch(() => { setResults([]); setLoading(false) })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount only — intentional

  useEffect(() => { setSelectedIdx(0) }, [results])

  // Report state changes up so the parent can save them into history
  useEffect(() => {
    onSearchStateChange?.({ query, lang })
  }, [query, lang, onSearchStateChange])

  function handleInput(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setResults([]); return }

    if (/^[HhGg]\d+$/i.test(val.trim())) {
      setLoading(true)
      window.lexicon.getEntry(val.trim())
        .then((e) => { setResults(e ? [e] : []); setLoading(false) })
        .catch(() => { setResults([]); setLoading(false) })
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await window.lexicon.search(val.trim(), lang)) }
      catch { setResults([]) }
      setLoading(false)
    }, 300)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const en = results[selectedIdx]; if (en) onSelect(en) }
  }

  return (
    <div className="flex flex-col h-full">
      <StrongsContextMenu
        target={searchCtx.target}
        onClose={searchCtx.close}
        onOpen={() => { if (ctxEntry) { onSelect(ctxEntry); searchCtx.close() } }}
        onOpenNewTab={() => { if (ctxEntry) { onOpenNewTab?.(ctxEntry); searchCtx.close() } }}
      />
      <div className={`flex items-center gap-2 py-2 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 min-h-[40px] relative ${floating ? 'pl-[76px] pr-4 app-drag-region' : 'px-4'}`}>
        <BookMarked size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Lexicon</span>
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'H', 'G'] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                lang === l ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
              }`}>
              {l === 'all' ? 'All' : l === 'H' ? 'Heb' : 'Grk'}
            </button>
          ))}
          <div className="relative ml-1">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setInfoOpen((v) => !v)}
              title="How to read a lexicon entry"
              className={`p-1 rounded transition-colors cursor-pointer ${infoOpen ? 'text-[rgb(var(--color-text-primary))] bg-[rgb(var(--color-surface-4))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              <Info size={13} />
            </button>
            {infoOpen && <LexiconInfoPopover onClose={() => setInfoOpen(false)} />}
          </div>
          {/* Send to presenter view — only shown when a presenter callback is provided */}
          {onPresentLexicon && (
            <HintTooltip label={viewerWindowOpen ? 'Send to presenter view' : 'Open presenter view'} shortcut="⌘⇧B">
            <button
              onClick={onPresentLexicon}
              className={`p-1 rounded transition-colors cursor-pointer ${
                viewerWindowOpen
                  ? 'text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))]'
                  : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
              }`}
            >
              <Monitor size={13} />
            </button>
            </HintTooltip>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
        <Search size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input ref={inputRef} type="text" value={query}
          onChange={(e) => handleInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="H7225 · G3056 · beginning..."
          className="flex-1 bg-transparent text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none" />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]) }}
            className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="px-4 py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">Searching…</div>}
        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="px-4 py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">No results for "{query}"</div>
        )}
        {!loading && results.length === 0 && query.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <BookMarked size={28} className="text-[rgb(var(--color-text-muted))] mb-3 opacity-40" />
            <p className="text-sm text-[rgb(var(--color-text-secondary))]">Search Strong's lexicon</p>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mt-1">Enter a Strong's number (H7225) or keyword</p>
          </div>
        )}
        {!loading && results.length > 0 && (
          <div className="divide-y divide-[rgb(var(--color-surface-4))]">
            {results.map((entry, i) => (
              <button key={entry.strongsNum} onClick={() => onSelect(entry)}
                onContextMenu={(e) => { setCtxEntry(entry); searchCtx.open(e, entry.strongsNum) }}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                  i === selectedIdx ? 'bg-[rgb(var(--color-surface-4))]' : 'hover:bg-[rgb(var(--color-surface-4))]'
                }`}>
                <span className="font-mono text-xs text-[rgb(var(--color-text-muted))] flex-shrink-0 mt-0.5 w-12">{entry.strongsNum}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    {entry.lemma && (
                      <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]" style={{ fontFamily: 'serif' }}><span dir="rtl">{entry.lemma}</span></span>
                    )}
                    {entry.transliteration && (
                      <span className="text-xs text-[rgb(var(--color-text-muted))] italic">
                        {findQuery ? applyFindHighlight(entry.transliteration, findQuery) : entry.transliteration}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[rgb(var(--color-text-secondary))] truncate">
                    {(() => { const t = wr(entry.gloss); return findQuery ? applyFindHighlight(t, findQuery) : t })()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type LexHistoryItem =
  | { kind: 'entry'; entry: LexiconEntry }
  | { kind: 'search'; query: string; lang: 'H' | 'G' | 'all' }

export default function LexiconPanel({ floating = false }: { floating?: boolean }) {
  const pendingLexiconEntry = useAppStore((s) => s.pendingLexiconEntry)
  const clearLexiconEntry = useAppStore((s) => s.clearLexiconEntry)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const renameTab = useAppStore((s) => s.renameTab)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const createTab = useAppStore((s) => s.createTab)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const lexiconNoteBack = useAppStore((s) => s.lexiconNoteBack)
  const setLexiconNoteBack = useAppStore((s) => s.setLexiconNoteBack)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const activeWordReplacerRules = wordReplacerEnabled && wordReplacerRules.length > 0 ? wordReplacerRules : []

  // Tracks the current SearchView's query/lang so we can push it into history
  const searchStateRef = useRef<{ query: string; lang: 'H' | 'G' | 'all' }>({ query: '', lang: 'all' })
  // Restored search state passed as initialQuery/initialLang to a freshly-mounted SearchView
  const [savedSearch, setSavedSearch] = useState<{ query: string; lang: 'H' | 'G' | 'all' } | null>(null)

  // ── Find bar — local state, per-panel routing ─────────────────────────────
  // App.tsx dispatches 'berean:openLexiconFindBar' when Cmd+F is pressed while
  // this panel was the last-focused panel (activePanelId === 'lexicon').
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  const lexiconContentRef = useRef<HTMLDivElement>(null)
  const [localFindOpen, setLocalFindOpen] = useState(false)
  const [localFindQuery, setLocalFindQuery] = useState('')
  const [findMatchCount, setFindMatchCount] = useState(0)
  const [findMatchIdx, setFindMatchIdx] = useState(0)

  const findBarVisible = localFindOpen
  const activeFindQuery = findBarVisible && localFindQuery.trim() ? localFindQuery : ''

  function openLocalFind() {
    if (localFindOpen) {
      closeLocalFind()
    } else {
      setLocalFindOpen(true)
      setLocalFindQuery('')
      setFindMatchIdx(0)
    }
  }

  function closeLocalFind() {
    setLocalFindOpen(false)
    setLocalFindQuery('')
    setFindMatchIdx(0)
    setFindMatchCount(0)
  }

  // Listen for App.tsx's routed find-bar open event (also handles type-anywhere seed char)
  useEffect(() => {
    function onOpenLexiconFindBar(e: Event) {
      const seedChar = (e as CustomEvent).detail?.seedChar ?? ''
      if (localFindOpen) {
        // Already open — re-focus + select instead of closing.
        window.dispatchEvent(new CustomEvent('berean:findBarSelectAll'))
        return
      }
      setLocalFindOpen(true)
      setLocalFindQuery(seedChar)
      setFindMatchIdx(0)
    }
    window.addEventListener('berean:openLexiconFindBar', onOpenLexiconFindBar)
    return () => window.removeEventListener('berean:openLexiconFindBar', onOpenLexiconFindBar)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFindOpen])

  // Declare activeEntry here so find effects can reference it in their dependency arrays
  const [activeEntry, setActiveEntry] = useState<LexiconEntry | null>(null)
  // True while we're still trying to restore the previously-open entry for this tab
  // (async IPC lookup). Prevents the tab-title effect below from briefly renaming
  // the tab to the generic "Lexicon" fallback before the real Strong's number has
  // loaded — visible every time you switched to an existing Lexicon tab, since
  // this panel remounts fresh (key={tab.id}) on every tab switch.
  const [entryRestorePending, setEntryRestorePending] = useState(() => {
    const tab = useAppStore.getState().tabs['lexicon'].find((t) => t.id === useAppStore.getState().activeTabId['lexicon'])
    const state = tab?.state as { strongsNum?: string | null } | undefined
    return !!state?.strongsNum
  })
  const [history, setHistory] = useState<LexHistoryItem[]>([])

  // After each render: collect inline <mark> elements, manage active-mark class
  useLayoutEffect(() => {
    const container = lexiconContentRef.current
    document.querySelectorAll('.berean-find-mark-active').forEach((el) => el.classList.remove('berean-find-mark-active'))
    if (!findBarVisible || !localFindQuery.trim() || !container) {
      setFindMatchCount(0)
      setFindMatchIdx(0)
      return
    }
    const marks = container.querySelectorAll<HTMLElement>('.berean-find-mark')
    setFindMatchCount(marks.length)
    setFindMatchIdx(0)
    if (marks[0]) {
      marks[0].classList.add('berean-find-mark-active')
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFindQuery, findBarVisible, activeEntry?.strongsNum])

  // Update active-mark when navigation index changes
  useLayoutEffect(() => {
    const container = lexiconContentRef.current
    if (!container) return
    const marks = container.querySelectorAll<HTMLElement>('.berean-find-mark')
    document.querySelectorAll('.berean-find-mark-active').forEach((el) => el.classList.remove('berean-find-mark-active'))
    if (marks[findMatchIdx]) {
      marks[findMatchIdx].classList.add('berean-find-mark-active')
      marks[findMatchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [findMatchIdx, findMatchCount])

  function findPrev() {
    if (!findMatchCount) return
    setFindMatchIdx((prev) => (prev - 1 + findMatchCount) % findMatchCount)
  }

  function findNext() {
    if (!findMatchCount) return
    setFindMatchIdx((prev) => (prev + 1) % findMatchCount)
  }

  const lexiconTabId = activeTabId['lexicon']
  const entryScrollRef = useRef<HTMLDivElement>(null)
  const lexScrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore the entry and history that was open when this tab was last active (also runs after duplication)
  useEffect(() => {
    if (!lexiconTabId) return
    const tab = tabs['lexicon'].find((t) => t.id === lexiconTabId)
    const state = tab?.state as {
      strongsNum?: string | null
      scrollTop?: number
      lexHistory?: Array<{ kind: 'entry'; strongsNum: string } | { kind: 'search'; query: string; lang: 'H' | 'G' | 'all' }>
    } | undefined
    const savedNum = state?.strongsNum ?? null
    const savedScroll = state?.scrollTop ?? 0
    const savedHistory = state?.lexHistory ?? []

    // Restore history first
    if (savedHistory.length > 0) {
      Promise.all(savedHistory.map(async (h) => {
        if (h.kind === 'entry') {
          const e = await window.lexicon.getEntry(h.strongsNum).catch(() => null)
          return e ? ({ kind: 'entry' as const, entry: e }) : null
        }
        return { kind: 'search' as const, query: h.query, lang: h.lang }
      })).then((items) => {
        setHistory(items.filter(Boolean) as LexHistoryItem[])
      })
    }

    if (!savedNum) { setEntryRestorePending(false); return }
    window.lexicon.getEntry(savedNum)
      .then((entry) => {
        if (entry) {
          setActiveEntry(entry)
          setTimeout(() => {
            if (entryScrollRef.current) entryScrollRef.current.scrollTop = savedScroll
          }, 80)
        }
      })
      .catch(() => {})
      .finally(() => setEntryRestorePending(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount only

  // Persist open entry + history to tab state (used when duplicating the tab)
  useEffect(() => {
    if (!lexiconTabId) return
    updateTabState('lexicon', lexiconTabId, {
      strongsNum: activeEntry?.strongsNum ?? null,
      lexHistory: history.map((h) =>
        h.kind === 'entry'
          ? { kind: 'entry' as const, strongsNum: h.entry.strongsNum }
          : { kind: 'search' as const, query: h.query, lang: h.lang }
      ),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntry?.strongsNum, history, lexiconTabId, updateTabState])

  // Pick up entries opened from FloatingSearch or VerseRow
  useEffect(() => {
    if (!pendingLexiconEntry) return
    clearLexiconEntry()
    window.lexicon.getEntry(pendingLexiconEntry)
      .then((entry) => {
        if (!entry) return
        if (activeEntry) {
          setHistory((h) => [...h, { kind: 'entry', entry: activeEntry }])
        }
        setActiveEntry(entry)
      })
      .catch(() => {})
  }, [pendingLexiconEntry, clearLexiconEntry])

  // Keep tab title in sync
  useEffect(() => {
    if (!lexiconTabId) return
    if (entryRestorePending) return // avoid a flash of "Lexicon" while the saved entry is still loading
    renameTab('lexicon', lexiconTabId, activeEntry ? activeEntry.strongsNum : 'Lexicon')
  }, [activeEntry?.strongsNum, lexiconTabId, entryRestorePending, renameTab])

  function navToEntry(strongsNum: string, newTab: boolean) {
    if (newTab) {
      createTab('lexicon')
      openLexiconEntry(strongsNum)
      setActiveSpace('lexicon')
      return
    }
    window.lexicon.getEntry(strongsNum)
      .then((entry) => {
        if (!entry) return
        if (activeEntry) setHistory((h) => [...h, { kind: 'entry', entry: activeEntry }])
        setActiveEntry(entry)
        addHistoryEntry({ type: 'lexicon', title: strongsNum, strongsNum })
      })
      .catch(() => {})
  }

  const navToVerse = useCallback((bookId: string, chapter: number, verse: number) => {
    const store = useAppStore.getState()
    store.ensureTab('bible')
    const fresh = useAppStore.getState()
    const scriptureTabId = fresh.activeTabId['scripture']
    if (!scriptureTabId) return
    fresh.updateTabState('scripture', scriptureTabId, {
      bookId,
      chapter,
      targetVerse: verse,
      scrollPosition: 0,
    })
    store.setActiveSpace('scripture')
  }, [])

  function goBack() {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      if (prev.kind === 'entry') {
        setActiveEntry(prev.entry)
      } else {
        // Restore the search view with the saved query
        setSavedSearch({ query: prev.query, lang: prev.lang })
        setActiveEntry(null)
      }
    } else {
      setActiveEntry(null)
    }
  }

  function goHome() {
    setActiveEntry(null)
    setHistory([])
    setSavedSearch(null)
  }

  const lastHistoryItem = history.length > 0 ? history[history.length - 1] : null
  const backLabel = lastHistoryItem
    ? lastHistoryItem.kind === 'search'
      ? `"${lastHistoryItem.query}"`
      : lastHistoryItem.entry.strongsNum
    : 'Lexicon'

  return (
    <div
      ref={lexiconContentRef}
      className="flex flex-col h-full"
      onMouseDown={() => setActivePanelId('lexicon')}
    >
      <FindBar
        visible={findBarVisible}
        query={localFindQuery}
        onQueryChange={(q) => { setLocalFindQuery(q); setFindMatchIdx(0) }}
        onClose={closeLocalFind}
        matchCount={findMatchCount}
        currentMatch={findMatchIdx}
        onPrev={findPrev}
        onNext={findNext}
        autoOpen={false}
      />
      {activeEntry ? (
        <EntryView
          entry={activeEntry}
          backLabel={backLabel}
          onBack={goBack}
          onHome={goHome}
          hasHistory={history.length > 0}
          onNav={navToEntry}
          noteBack={lexiconNoteBack}
          onNoteBack={() => {
            if (!lexiconNoteBack) return
            requestOpenNote(lexiconNoteBack.noteId)
            ensureTab('note')
            setLexiconNoteBack(null)
          }}
          findQuery={activeFindQuery}
          onFindOpen={openLocalFind}
          onNavigateToVerse={navToVerse}
          scrollRef={entryScrollRef}
          floating={floating}
          wordReplacerRules={activeWordReplacerRules}
          viewerWindowOpen={viewerWindowOpen}
          onPresentLexicon={async () => {
            if (!activeEntry) return
            if (!viewerWindowOpen) {
              await window.app.openViewerWindow?.()
              useAppStore.getState().setViewerWindowOpen(true)
            }
            window.app.pushViewerContent?.({ kind: 'lexicon', strongsId: activeEntry.strongsNum })
          }}
          onScroll={(e) => {
            const el = e.currentTarget
            if (lexScrollSaveTimer.current) clearTimeout(lexScrollSaveTimer.current)
            lexScrollSaveTimer.current = setTimeout(() => {
              if (lexiconTabId) updateTabState('lexicon', lexiconTabId, { scrollTop: el.scrollTop })
            }, 150)
          }}
        />
      ) : (
        <SearchView
          onSelect={(entry) => {
            // Push current search state to history so Back returns here
            const { query, lang } = searchStateRef.current
            if (query.trim().length >= 2) {
              setHistory((h) => [...h, { kind: 'search', query, lang }])
            }
            setActiveEntry(entry)
            addHistoryEntry({ type: 'lexicon', title: entry.strongsNum, strongsNum: entry.strongsNum })
          }}
          onOpenNewTab={(entry) => navToEntry(entry.strongsNum, true)}
          onSearchStateChange={(s) => { searchStateRef.current = s }}
          initialQuery={savedSearch?.query ?? ''}
          initialLang={savedSearch?.lang ?? 'all'}
          findQuery={activeFindQuery}
          floating={floating}
          wordReplacerRules={activeWordReplacerRules}
        />
      )}
    </div>
  )
}
