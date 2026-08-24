import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { BookMarked, Search, X, ArrowLeft, ChevronLeft, ChevronRight, ScanSearch, Info, Copy, Check as CheckIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import HeaderSegmentedToggle from '@/components/shell/HeaderSegmentedToggle'
import FindBar from '@/components/shell/FindBar'
import { applyFindHighlight } from '@/lib/highlight'
import { bookName } from '@/lib/parseRef'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { StrongsContextMenu, useStrongsContextMenu } from './StrongsContextMenu'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { navigateToVerse } from '@/lib/verseNavigation'
import { tokenizeBdbNotes } from '@/lib/bdbAbbreviations'
import { rememberLexiconTitle } from '@/lib/lexiconTitle'
import type { LexiconEntry, LexiconTabState } from '@/types'
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
  // The lookahead alone (excluding a number FOLLOWED by ":") only guards the chapter half
  // of a "32:38" verse reference — "38" (preceded by ":") was still getting converted to a
  // clickable "H38", rendering "(Deuteronomy 32:38)" as "(Deuteronomy 32:H38)". Added a matching
  // lookbehind excluding a number immediately preceded by ":" too.
  // NOTE: the trailing lookahead used to also exclude "." — meant to catch a "32:38." shaped
  // reference, but the colon-lookahead/lookbehind pair above already fully covers that case (the
  // period sits AFTER "38", which the lookbehind already excludes via its preceding ":"). All
  // that extra "." exclusion actually did was block the extremely common "Compare 3050, 3069."/
  // "See 7495." shape — a bare cross-reference number simply ending a sentence — from linking at
  // all, reported as "Compare H3050, 3069." (H3050 linked, 3069 silently not).
  return text
    .replace(/\b([HG])0+(\d)/g, '$1$2')
    .replace(/(?<![HGa-zA-Z/:])(\b\d{1,5}\b)(?!\s*:)/g, (_, n) => `${lang}${parseInt(n, 10)}`)
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

export function DerivationText({ text, lang, onNav, onContextMenu, findQuery }: {
  text: string
  lang: 'H' | 'G'
  onNav: (num: string, newTab: boolean) => void
  onContextMenu?: (e: React.MouseEvent, num: string) => void
  findQuery?: string
}) {
  // Split on H/G-prefixed numbers OR bare numbers (1–5 digits) so that
  // derivations stored without the prefix (e.g. "from 2165") still link.
  // Also used for the "Definition" field, which stores cross-refs the same
  // way (e.g. Hebrew H5703's definition ends "See 7495." with no H) — bare
  // numbers there are inferred from the entry's own lang the same way.
  // The bare-number branch excludes one immediately preceded/followed by ":" — without this, a
  // plain chapter:verse reference like "(Deuteronomy 32:38)" got BOTH halves linkified as bare
  // Strong's cross-refs, rendering as "(Deuteronomy H32:H38)". Mirrors normalizeStrongsNums'
  // identical guard (used for the copy-text path) above — including that function's own fix for
  // why "." must NOT be part of this exclusion: it isn't needed (the colon guard alone already
  // covers "32:38"-shaped refs) and excluding it silently broke the far more common "Compare
  // 3050, 3069." / "See 7495." shape, where a bare cross-reference number just ends a sentence.
  const parts = text.split(/(\b[HG]\d{1,5}\b|(?<![:.\d])\b\d{1,5}\b(?!\s*:))/g)
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
        return <span key={i}>{findQuery ? applyFindHighlight(part, findQuery) : part}</span>
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
  onNav,
  noteBack,
  onNoteBack,
  findQuery,
  onNavigateToVerse,
  scrollRef,
  onScroll,
  floating = false,
  wordReplacerRules = [],
}: {
  entry: LexiconEntry
  onNav: (num: string, newTab: boolean) => void
  noteBack?: { noteId: string; title: string } | null
  onNoteBack?: () => void
  findQuery?: string
  onNavigateToVerse?: (bookId: string, chapter: number, verse: number, textId?: string) => void
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  floating?: boolean
  wordReplacerRules?: WordReplacerRule[]
}) {
  // Helper: apply word replacer if rules are present
  const wr = (t: string) => wordReplacerRules.length ? applyWordReplacer(t, wordReplacerRules) : t
  const lexiconZoom = useAppStore((s) => s.appZoom)
  const [infoOpen, setInfoOpen] = useState(false)
  const [related, setRelated] = useState<{ strongsNum: string; lemma: string; transliteration: string; gloss: string }[]>([])
  const [adjacent, setAdjacent] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null })
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>([])
  const [occurrencesLoading, setOccurrencesLoading] = useState(false)
  const [showAllOccurrences, setShowAllOccurrences] = useState(false)
  // How many occurrence rows are rendered — starts capped at 10 and grows as the user
  // scrolls near the bottom of the entry panel (see the scroll listener below), instead of
  // requiring an explicit "Show all" click to see anything past the first page.
  const [visibleOccCount, setVisibleOccCount] = useState(10)
  const [occSort, setOccSort] = useState<'canon' | 'matches'>('canon')
  const [occBookFilter, setOccBookFilter] = useState<string | 'all'>('all')
  // Full entry (definition, derivation, related terms, occurrences) shows by
  // default — an earlier collapsed-by-default pass hid these behind "Show
  // full entry" and the user explicitly asked for them back. "Show less"
  // still lets the user collapse a given entry, but a NEW entry always
  // starts expanded again rather than inheriting the previous collapse.
  const [expanded, setExpanded] = useState(true)
  useEffect(() => { setExpanded(true) }, [entry.strongsNum])
  const verseCopy = useVerseCopyMenu()
  const strongsCtx = useStrongsContextMenu()

  // Related words and occurrences used to be two independent fetches, each committing the
  // moment its own IPC call resolved — "Related words" has no loading indicator at all, so it
  // would silently pop in and shift the layout a beat after the rest of the entry (definition,
  // occurrences) had already settled, reported as the lexicon entry "loading weird." Combined
  // into one effect so both land in a single commit instead of staggering — occurrences keeps
  // its own explicit loading state (still a real, announced load for what can be a large
  // dataset), just gated on BOTH fetches now instead of only its own.
  // Two-phase occurrence load. getLexiconOccurrences scans EVERY verse's text_tagged with a
  // synchronous LIKE '%...%' full-table scan, then runs an extra per-row query + regex parse
  // for each match — genuinely slow for a common word (hundreds of matches), and since
  // better-sqlite3 is synchronous, it blocks the WHOLE main process (every window's IPC) for
  // as long as it takes. Reported: "occurrence stuff should show immediately and [the rest]
  // after a second" — phase 1 asks for a small quickLimit so the panel renders almost
  // instantly (LIMIT lets the scan short-circuit far sooner for common words; rare words have
  // few total rows anyway so they're already fast); phase 2 fires right behind it for the
  // COMPLETE set (no visible loading state — it just quietly replaces the quick batch once
  // ready, which is what "Show all"/infinite-scroll need data for beyond the first ~20).
  useEffect(() => {
    setOccurrences([])
    setShowAllOccurrences(false)
    setVisibleOccCount(10)
    setOccSort('canon')
    setOccBookFilter('all')
    setOccurrencesLoading(true)
    let cancelled = false
    Promise.all([
      window.lexicon.getRelated(entry.strongsNum).catch(() => []),
      window.lexicon.getOccurrences(entry.strongsNum, 20).catch(() => []),
    ]).then(([relatedRows, quickRows]) => {
      if (cancelled) return
      setRelated(relatedRows)
      setOccurrences(quickRows)
      setOccurrencesLoading(false)
      // Phase 2: the full set, in the background — replaces the quick batch once it lands.
      window.lexicon.getOccurrences(entry.strongsNum).then((fullRows) => {
        if (cancelled) return
        setOccurrences(fullRows)
      }).catch(() => {})
    })
    return () => { cancelled = true }
  }, [entry.strongsNum])

  // Load more occurrence rows as the user scrolls near the bottom of the entry panel
  // (scrollRef, owned by the parent LexiconPanel), instead of only revealing more via the
  // explicit "Show all" click.
  useEffect(() => {
    const el = (scrollRef as React.RefObject<HTMLDivElement> | undefined)?.current
    if (!el || occurrences.length === 0) return
    function onScroll() {
      if (!el) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
        setVisibleOccCount((c) => Math.min(c + 20, occurrences.length))
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [occurrences.length, scrollRef])

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
      {/* Header — portaled into the shared top bar, not a second local header.
           Back/home navigation is gone: the top bar's own back button now
           reaches the search view (idx -1) directly via the global nav stack. */}
      <TabHeaderPortal floating={floating}>
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
      </TabHeaderPortal>

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
              // Was plain text (via applyFindHighlight alone, no linking) — the gloss field is
              // where Strong's "Compare 3050, 3069." cross-references actually live (e.g.
              // H3068's own gloss), and those bare numbers were never clickable at all, unlike
              // the Definition/Derivation fields just below which already go through
              // DerivationText for exactly this. Routed through the same component so gloss text
              // gets the same bare-number-inferred-from-this-entry's-own-language linking.
              return (
                <DerivationText
                  text={displayGloss}
                  lang={entry.strongsNum.startsWith('H') ? 'H' : 'G'}
                  onNav={onNav}
                  onContextMenu={(e, num) => strongsCtx.open(e, num)}
                  findQuery={findQuery}
                />
              )
            })()}
          </div>
        )}

        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full text-center text-xs text-[rgb(var(--color-accent))] hover:underline cursor-pointer py-1"
          >
            Show full entry
          </button>
        )}
        {expanded && (<>
        {entry.definition && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">Definition</p>
            <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">
              <DerivationText text={wr(entry.definition)} lang={entry.strongsNum.startsWith('H') ? 'H' : 'G'} onNav={onNav} onContextMenu={(e, num) => strongsCtx.open(e, num)} findQuery={findQuery} />
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
                  onClick={() => { setShowAllOccurrences((v) => !v); setVisibleOccCount(10) }}
                  className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                >
                  {showAllOccurrences ? 'Show fewer' : `Show all ${occurrences.length}`}
                </button>
              )}
            </div>
          </div>

          {/* Sort + book filter — occurrences previously had no way to narrow a long list down
              to one book, or to bring the most-repeated verses to the top. Editions filter only
              appears when the data actually mixes KJVA/LXX rows (most entries are one or the
              other). */}
          {!occurrencesLoading && occurrences.length > 5 && (() => {
            const bookCounts = new Map<string, number>()
            for (const o of occurrences) bookCounts.set(o.book_id, (bookCounts.get(o.book_id) ?? 0) + 1)
            const bookOptions = Array.from(bookCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([id, count]) => ({ id, count, name: (() => { try { return bookName(id) } catch { return id } })() }))
            const hasMultipleBooks = bookOptions.length > 1
            return (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <div className="flex items-center gap-0.5 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-md p-0.5">
                  {([['canon', 'Canon order'], ['matches', 'Most matches']] as [typeof occSort, string][]).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => setOccSort(m)}
                      className={`text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${occSort === m ? 'bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))] font-semibold' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {hasMultipleBooks && (
                  <select
                    value={occBookFilter}
                    onChange={(e) => setOccBookFilter(e.target.value)}
                    className="text-[9.5px] px-1.5 py-1 rounded-md border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-secondary))] cursor-pointer outline-none"
                  >
                    <option value="all">All books ({occurrences.length})</option>
                    {bookOptions.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.count})</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })()}

          {occurrencesLoading && (
            <p className="text-xs text-[rgb(var(--color-text-muted))] text-center py-2">Loading…</p>
          )}
          {!occurrencesLoading && occurrences.length === 0 && (
            <p className="text-xs text-[rgb(var(--color-text-muted))]">No occurrence data available.</p>
          )}
          {!occurrencesLoading && occurrences.length > 0 && (() => {
            let visible = occBookFilter === 'all' ? occurrences : occurrences.filter((o) => o.book_id === occBookFilter)
            if (occSort === 'matches') {
              visible = [...visible].sort((a, b) => (b.matchWordIndices?.length ?? 0) - (a.matchWordIndices?.length ?? 0))
            }
            return (
            <div className="space-y-1">
              {(showAllOccurrences ? visible : visible.slice(0, visibleOccCount)).map((occ, i) => {
                const bk = (() => { try { return bookName(occ.book_id) } catch { return occ.book_id } })()
                const refLabel = `${bk} ${occ.chapter}:${occ.verse_num}`
                const multipleMatches = (occ.matchWordIndices?.length ?? 0) > 1
                return (
                  <button
                    key={i}
                    onClick={() => onNavigateToVerse?.(occ.book_id, occ.chapter, occ.verse_num, occ.text_id)}
                    onContextMenu={(e) => verseCopy.open(e, { bookId: occ.book_id, chapter: occ.chapter, verse: occ.verse_num, text: occ.text ?? '' })}
                    className="w-full text-left px-2.5 py-2 rounded-lg border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors group"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1.5 py-0.5 flex-shrink-0 group-hover:bg-[rgb(var(--color-accent))]/18">
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
                    <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-relaxed mt-1">
                      {occ.text
                        ? <VerseWithMatchedWords text={wr(occ.text)} matchWordIndices={occ.matchWordIndices} />
                        : <span className="italic text-[rgb(var(--color-text-muted))]">—</span>
                      }
                    </p>
                  </button>
                )
              })}
            </div>
            )
          })()}
        </div>
        {/* Hidden once every occurrence is already visible (≤10 total, or the "Show all N"
            toggle above has been used) — redundant with that toggle at that point, since
            there's nothing left this button would be collapsing away from. */}
        {!(occurrences.length <= 10 || showAllOccurrences) && (
          <button
            onClick={() => setExpanded(false)}
            className="w-full text-center text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:underline cursor-pointer py-1"
          >
            Show less
          </button>
        )}
        </>)}
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
  initialScrollTop = 0,
  onScrollChange,
  findQuery,
  onFindOpen,
  floating = false,
  wordReplacerRules = [],
}: {
  onSelect: (entry: LexiconEntry) => void
  onOpenNewTab?: (entry: LexiconEntry) => void
  onSearchStateChange?: (state: { query: string; lang: 'H' | 'G' | 'all' }) => void
  initialQuery?: string
  initialLang?: 'H' | 'G' | 'all'
  initialScrollTop?: number
  onScrollChange?: (top: number) => void
  findQuery?: string
  onFindOpen?: () => void
  floating?: boolean
  wordReplacerRules?: WordReplacerRule[]
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
  const resultsScrollRef = useRef<HTMLDivElement>(null)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Restore the results-list scroll position once the initial (restored) results have loaded.
  useEffect(() => {
    if (!initialScrollTop || loading) return
    const t = setTimeout(() => {
      if (resultsScrollRef.current) resultsScrollRef.current.scrollTop = initialScrollTop
    }, 80)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Flush the latest scroll position on unmount — onScroll below debounces its save by 150ms,
  // so a tab switch inside that window would otherwise abandon the timer and lose the last bit
  // of scroll. Mirrors the same fix in ScriptureSearchView.tsx / SearchTab.tsx.
  const onScrollChangeRef = useRef(onScrollChange)
  useEffect(() => { onScrollChangeRef.current = onScrollChange })
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      if (resultsScrollRef.current) onScrollChangeRef.current?.(resultsScrollRef.current.scrollTop)
    }
  }, [])

  // Report state changes up so the parent can save them into history. Read through a ref
  // kept fresh every render, NOT depended on directly — the parent (LexiconPanel) passes an
  // inline arrow function here that gets a new identity on every one of ITS renders; including
  // it directly in this effect's deps re-fired the effect on every parent render regardless of
  // whether query/lang actually changed, and since the effect's own call updates store state
  // the parent reads, that re-triggered a parent render too — an infinite loop (confirmed via
  // a live "Maximum update depth exceeded" crash tracing directly to this effect).
  const onSearchStateChangeRef = useRef(onSearchStateChange)
  useEffect(() => { onSearchStateChangeRef.current = onSearchStateChange })
  useEffect(() => {
    onSearchStateChangeRef.current?.({ query, lang })
  }, [query, lang])

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
      <TabHeaderPortal floating={floating} className="relative">
        <BookMarked size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Lexicon</span>
        <div className="ml-auto flex items-center gap-1">
          <HeaderSegmentedToggle
            value={lang}
            onChange={setLang}
            options={[
              { value: 'all', label: 'All' },
              { value: 'H',   label: 'Heb' },
              { value: 'G',   label: 'Grk' },
            ]}
          />
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
        </div>
      </TabHeaderPortal>

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

      <div
        ref={resultsScrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const top = (e.currentTarget as HTMLDivElement).scrollTop
          if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = setTimeout(() => onScrollChange?.(top), 150)
        }}
      >
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
  const pendingLexiconSearchTab = useAppStore((s) => s.pendingLexiconSearchTab)
  const clearLexiconSearchTab = useAppStore((s) => s.clearLexiconSearchTab)
  const activeTabId = useAppStore((s) => s.activeTabId.lexicon)
  // Narrowed to this panel's own space — see BiblePanel.tsx's identical comment for why.
  const tabs = useAppStore((s) => s.tabs.lexicon)
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
  const pushTabNav = useAppStore((s) => s.pushTabNav)
  const lexiconHomeToken = useAppStore((s) => s.lexiconHomeToken)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const activeWordReplacerRules = wordReplacerEnabled && wordReplacerRules.length > 0 ? wordReplacerRules : []

  // Tracks the current SearchView's query/lang so we can push it into history
  const searchStateRef = useRef<{ query: string; lang: 'H' | 'G' | 'all' }>({ query: '', lang: 'all' })
  // Restored search state passed as initialQuery/initialLang to a freshly-mounted SearchView.
  // Lazy initializer reads this tab's persisted query/lang directly — ActivePanel fully remounts
  // LexiconPanel on every tab switch, so this is a genuinely fresh mount each time, matching the
  // pattern used for NotesPanel's continuousDailyDate.
  const [savedSearch, setSavedSearch] = useState<{ query: string; lang: 'H' | 'G' | 'all' } | null>(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    const state = tab?.state as LexiconTabState | undefined
    return state?.searchQuery ? { query: state.searchQuery, lang: state.searchLang ?? 'all' } : null
  })
  // Restored results-list scroll offset, passed to SearchView as initialScrollTop.
  const [searchInitialScrollTop] = useState(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return ((tab?.state as LexiconTabState | undefined)?.searchScrollTop) ?? 0
  })
  // Bumped whenever a query is pushed in from the floating search bar, so SearchView
  // remounts and re-runs the search even when it was already the visible view.
  const [searchRemountToken, setSearchRemountToken] = useState(0)

  // ── Find bar — local state, per-panel routing ─────────────────────────────
  // App.tsx dispatches 'berean:openLexiconFindBar' when Cmd+F is pressed while
  // this panel was the last-focused panel (activePanelId === 'lexicon').
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)
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
      // Only one overlay open at a time — opening this find bar closes any
      // open "More" menu/other overlay via the shared broadcast.
      window.dispatchEvent(new CustomEvent('berean:closeMenus'))
      setLocalFindOpen(true)
      setLocalFindQuery(seedChar)
      setFindMatchIdx(0)
    }
    window.addEventListener('berean:openLexiconFindBar', onOpenLexiconFindBar)
    return () => window.removeEventListener('berean:openLexiconFindBar', onOpenLexiconFindBar)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFindOpen])

  // ...and the reverse: an open "More" menu / Settings closes this find bar.
  useEffect(() => {
    function onCloseMenus() { setLocalFindOpen(false) }
    window.addEventListener('berean:closeMenus', onCloseMenus)
    return () => window.removeEventListener('berean:closeMenus', onCloseMenus)
  }, [])

  // Declare activeEntry here so find effects can reference it in their dependency arrays
  const [activeEntry, setActiveEntry] = useState<LexiconEntry | null>(null)

  // Rail's Presenter button (Ribbon.tsx) dispatches this after ensuring the
  // viewer window is open — mirrors the find-bar routing above, since
  // pushing content depends on activeEntry, which only this panel has.
  useEffect(() => {
    function onPresenterPush() {
      if (activeEntry) window.app.pushViewerContent?.({ kind: 'lexicon', strongsId: activeEntry.strongsNum })
    }
    window.addEventListener('berean:presenterPushLexicon', onPresenterPush)
    return () => window.removeEventListener('berean:presenterPushLexicon', onPresenterPush)
  }, [activeEntry])
  // True while we're still trying to restore the previously-open entry for this tab
  // (async IPC lookup). Prevents the tab-title effect below from briefly renaming
  // the tab to the generic "Lexicon" fallback before the real Strong's number has
  // loaded — visible every time you switched to an existing Lexicon tab. LexiconPanel
  // is actually a single shared instance reused across every Lexicon tab (not one
  // keyed per tab, despite what an earlier version of this comment claimed) — the
  // restore effect below now re-arms this to true at the start of every tab switch,
  // not just once via this initializer, so the guard actually covers repeat switches.
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

  const lexiconTabId = activeTabId
  const entryScrollRef = useRef<HTMLDivElement>(null)
  const lexScrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // LexiconPanel is a single shared instance reused across every Lexicon tab (PanelLayout.tsx
  // renders one, not one per tab) — same architecture and same class of bug as NotesPanel's
  // skipNextPersistRef (see its comment there). An earlier version of the restore effect below
  // ran once on mount only, so switching Lexicon tabs left activeEntry showing whichever entry
  // was last explicitly opened in ANY tab, and the persist effect then wrote that stale entry
  // into the tab you switched to, corrupting its stored state too.
  const skipNextLexPersistRef = useRef(false)
  // Same-tick guard for the title-sync effect further down. Re-arming entryRestorePending
  // (a STATE update) inside the restore effect doesn't take effect until the NEXT render, but
  // the title-sync effect also depends on lexiconTabId, so it fires in the very SAME commit as
  // the restore effect, still reading the OLD entryRestorePending/activeEntry — see
  // NotesPanel.tsx's tabSwitchInFlightRef comment for the full explanation of this race.
  const tabSwitchInFlightRef = useRef(false)
  // "Latest request wins" guard for the restore effect below — mirrors NotesPanel.tsx's
  // openSeqRef exactly, but here it also has to cover the double-rAF scroll-restore, not just
  // setActiveEntry. React 18 StrictMode (dev only) double-invokes this effect on every genuine
  // mount of LexiconPanel (which ActivePanel.tsx does on every switch INTO the Lexicon space),
  // kicking off two separate window.lexicon.getEntry() calls that each schedule their OWN
  // double-rAF `entryScrollRef.current.scrollTop = savedScroll` assignment. Without a guard,
  // whichever of the two resolves LAST wins — and since a real user can start scrolling before
  // that second, stale restore's rAF pair has fired, its scrollTop reset silently clobbers the
  // user's live scroll back to the (stale) savedScroll value moments later, reading as "the
  // scroll position isn't saving" (the save itself was fine; a stale restore overwrote it
  // before the debounced save's 150ms timer ever read it back).
  const entryOpenSeqRef = useRef(0)
  // Belt-and-suspenders alongside entryOpenSeqRef: even a SINGLE restore (no StrictMode
  // duplicate involved) schedules its double-rAF scroll-set for "2 animation frames after the
  // entry fetch resolves" — an arbitrary amount of real wall-clock time later, not truly
  // "next frame," since the fetch itself is an async IPC round trip. A real user reading a
  // freshly-opened entry can easily start scrolling within that window; without this flag the
  // restore's rAF still fires afterward and silently resets scrollTop back to the stale
  // savedScroll it captured at effect-start, clobbering the user's own scroll milliseconds
  // before the debounced save (150ms) would have read and persisted it — reading as "the
  // scroll position isn't saving." Set true by the onScroll handler, reset false at the start
  // of every restore; the double-rAF below skips its own assignment once this is true.
  const userScrolledSinceRestoreRef = useRef(false)
  // Set during RENDER, not inside an effect, so the guard is already true before ANY of this
  // component's effects run in the commit that switches lexiconTabId — see NotesPanel.tsx's
  // prevNotesTabIdForGuardRef comment for the full explanation (effect declaration order isn't
  // a safe way to guarantee this ref is armed before a sibling effect reads it).
  const prevLexiconTabIdForGuardRef = useRef<string | null>(null)
  if (prevLexiconTabIdForGuardRef.current !== lexiconTabId) {
    prevLexiconTabIdForGuardRef.current = lexiconTabId
    tabSwitchInFlightRef.current = true
  }

  // Restore the entry and history that was open when this tab was last active (also runs after
  // duplication, and now on every tab switch — see skipNextLexPersistRef's comment above).
  useEffect(() => {
    if (!lexiconTabId) return
    const seq = ++entryOpenSeqRef.current
    userScrolledSinceRestoreRef.current = false
    skipNextLexPersistRef.current = true
    tabSwitchInFlightRef.current = true
    setEntryRestorePending(true)
    // Deferred (not synchronous) clear of tabSwitchInFlightRef. The synchronous branches below
    // call setEntryRestorePending(true) then immediately setEntryRestorePending(false) in the same
    // effect pass — React batches same-tick state updates, so if the state was already false
    // beforehand this nets to NO change at all, meaning an effect keyed on entryRestorePending
    // transitioning to false would never re-fire and the ref would stay stuck true forever after
    // the first switch to a tab hitting a synchronous branch, permanently blocking the title-sync
    // effect below. setTimeout(0) runs unconditionally after this render's effects have flushed,
    // regardless of whether state actually changed, so the ref reliably clears one pass later either way.
    function deferClear() { setTimeout(() => { tabSwitchInFlightRef.current = false }, 0) }
    const tab = tabs.find((t) => t.id === lexiconTabId)
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
    } else {
      setHistory([])
    }

    if (!savedNum) { setActiveEntry(null); setEntryRestorePending(false); deferClear(); return }
    window.lexicon.getEntry(savedNum)
      .then((entry) => {
        // A newer restore request (another tab switch, or StrictMode's dev-only double-invoke
        // of this same effect on a fresh mount) has started since — don't let this stale one's
        // scroll-restore clobber whatever the user's done since. See entryOpenSeqRef's comment.
        if (entry && entryOpenSeqRef.current === seq) {
          setActiveEntry(entry)
          // A fixed setTimeout(80) here raced the actual render: the entry committed and
          // painted at scrollTop 0 well before 80ms was up, then visibly jumped to savedScroll
          // once the timer fired — reading as "shows for a second without scroll then it
          // jumps." Matches NoteEditorPM.tsx's own scroll-restore double-rAF: the first
          // rAF runs before the browser has painted this render's DOM changes, the second
          // (nested) rAF then fires after that paint's layout is actually settled, so the
          // scrollTop assignment lands before the user ever sees the unscrolled frame.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (entryScrollRef.current && entryOpenSeqRef.current === seq && !userScrolledSinceRestoreRef.current) {
              entryScrollRef.current.scrollTop = savedScroll
            }
          }))
        }
      })
      .catch(() => {})
      .finally(() => {
        setEntryRestorePending(false)
        tabSwitchInFlightRef.current = false
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lexiconTabId])

  // Flush the entry-view's latest scroll position on unmount (tab switch away from this
  // lexicon tab) — the onScroll handler debounces its save by 150ms, so scrolling that happens
  // in the last stretch before a switch would otherwise be lost with the abandoned timer.
  // Mirrors the same fix in ScriptureSearchView.tsx / SearchTab.tsx.
  useEffect(() => {
    return () => {
      if (lexScrollSaveTimer.current) clearTimeout(lexScrollSaveTimer.current)
      if (lexiconTabId && entryScrollRef.current) {
        updateTabState('lexicon', lexiconTabId, { scrollTop: entryScrollRef.current.scrollTop })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist open entry + history to tab state (used when duplicating the tab). Skips exactly
  // one run right after a tab switch — see skipNextLexPersistRef's comment.
  useEffect(() => {
    if (!lexiconTabId) return
    if (skipNextLexPersistRef.current) { skipNextLexPersistRef.current = false; return }
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

  // Pick up a query pushed in from the floating search bar's "Lexicon" button —
  // show the search view (clear any open entry) and seed its input with the term.
  useEffect(() => {
    if (!pendingLexiconSearchTab) return
    const term = pendingLexiconSearchTab
    clearLexiconSearchTab()
    setActiveEntry(null)
    setSavedSearch({ query: term, lang: 'all' })
    setSearchRemountToken((t) => t + 1)
  }, [pendingLexiconSearchTab, clearLexiconSearchTab])

  // Keep tab title in sync
  useEffect(() => {
    if (!lexiconTabId) return
    if (entryRestorePending) return // avoid a flash of "Lexicon" while the saved entry is still loading
    if (tabSwitchInFlightRef.current) return // same-tick race guard — see its comment above
    renameTab('lexicon', lexiconTabId, activeEntry ? rememberLexiconTitle(activeEntry) : 'Lexicon')
  }, [activeEntry, lexiconTabId, entryRestorePending, renameTab])

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
        setActiveEntry(entry)
        const title = rememberLexiconTitle(entry)
        addHistoryEntry({ type: 'lexicon', title, strongsNum })
        if (lexiconTabId) pushTabNav(lexiconTabId, { type: 'lexicon', strongsNum, title })
      })
      .catch(() => {})
  }

  const navToVerse = useCallback((bookId: string, chapter: number, verse: number, textId?: string) => {
    // The occurrence being clicked already tells us which text it actually came from
    // (getLexiconOccurrences in electron/ipc/lexicon.ts only ever returns 'kjva' or 'lxx') — a
    // Greek Strong's occurrence in the LXX list (the "LXX" badge next to it, ~line 695 above)
    // must land the tab on the LXX translation, not whatever translation the tab happened to be
    // showing before. Left undefined (not defaulted to KJVA) for any other/unknown text_id so
    // this never overrides an already-correct translation on a guess.
    const translation = textId === 'lxx' ? 'LXX' : textId === 'kjva' ? 'KJVA' : undefined
    navigateToVerse({
      bookId, chapter, verse, translationOverride: translation,
      origin: { kind: 'lexicon-occurrence', strongsNum: activeEntry?.strongsNum ?? '' },
    })
  }, [activeEntry])

  // Global top bar's back button reached the list/search position for this tab.
  //
  // Tracks the last SEEN token, not a "have I run before" boolean — see NotesPanel.tsx's
  // identical fix (lastSeenNotesHomeTokenRef) for why a boolean-ref "skip the first call"
  // guard is unsafe under React 18 StrictMode's dev-only double-invoke of a genuine mount's
  // effects: the boolean survives the replay unchanged, so the second invocation sees it
  // already consumed and fires anyway, spuriously clearing the just-restored entry on every
  // fresh mount of this panel even though lexiconHomeToken never actually changed.
  const lastSeenLexiconHomeTokenRef = useRef(lexiconHomeToken)
  useEffect(() => {
    if (lexiconHomeToken === lastSeenLexiconHomeTokenRef.current) return
    lastSeenLexiconHomeTokenRef.current = lexiconHomeToken
    setActiveEntry(null)
    setSavedSearch(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lexiconHomeToken])

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
          onNav={navToEntry}
          noteBack={lexiconNoteBack}
          onNoteBack={() => {
            if (!lexiconNoteBack) return
            requestOpenNote(lexiconNoteBack.noteId)
            ensureTab('note')
            setLexiconNoteBack(null)
          }}
          findQuery={activeFindQuery}
          onNavigateToVerse={navToVerse}
          scrollRef={entryScrollRef}
          floating={floating}
          wordReplacerRules={activeWordReplacerRules}
          onScroll={(e) => {
            const el = e.currentTarget
            userScrolledSinceRestoreRef.current = true
            if (lexScrollSaveTimer.current) clearTimeout(lexScrollSaveTimer.current)
            lexScrollSaveTimer.current = setTimeout(() => {
              if (lexiconTabId) updateTabState('lexicon', lexiconTabId, { scrollTop: el.scrollTop })
            }, 150)
          }}
        />
      ) : (
        <SearchView
          key={searchRemountToken}
          onSelect={(entry) => {
            setActiveEntry(entry)
            const title = rememberLexiconTitle(entry)
            addHistoryEntry({ type: 'lexicon', title, strongsNum: entry.strongsNum })
            if (lexiconTabId) pushTabNav(lexiconTabId, { type: 'lexicon', strongsNum: entry.strongsNum, title })
          }}
          onOpenNewTab={(entry) => navToEntry(entry.strongsNum, true)}
          onSearchStateChange={(s) => {
            searchStateRef.current = s
            if (lexiconTabId) updateTabState('lexicon', lexiconTabId, { searchQuery: s.query, searchLang: s.lang })
          }}
          initialQuery={savedSearch?.query ?? ''}
          initialLang={savedSearch?.lang ?? 'all'}
          initialScrollTop={searchInitialScrollTop}
          onScrollChange={(top) => { if (lexiconTabId) updateTabState('lexicon', lexiconTabId, { searchScrollTop: top }) }}
          findQuery={activeFindQuery}
          floating={floating}
          wordReplacerRules={activeWordReplacerRules}
        />
      )}
    </div>
  )
}
