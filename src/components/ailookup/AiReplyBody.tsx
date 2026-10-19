import { createContext, Fragment, memo, useContext, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, BookMarked, Link2, NotepadText, BookOpenText, Quote, Youtube } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button, SectionLabel } from '@/components/ui'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { AiLookupNoteResult, AiLookupResult, AiLookupStrongsCard, AiLookupVideoResult } from '@/types/electron'
import type { ChatMsg } from './chatModel'
import { ChatMarkdown } from './ChatMarkdown'
import { useChatNavigate } from './chatNav'

/**
 * The body of a Berean (AI) reply — prose (markdown), a passage list (reference, the verse in a
 * scripture style, then the commentary in Berean's own voice), Strong's word, notes, videos,
 * related passages. AI text is only presented, never rewritten. Every chat surface (Mac panel,
 * chat window, iPhone) renders answers through this; "Show more" / cross-ref disclosure state is
 * local to each reply, so expanding one never re-renders the rest of the transcript.
 */

/** Opens the shared verse copy menu (one per chat surface) for a result card. */
export type VerseMenuOpener = (e: React.MouseEvent, target: { bookId: string; chapter: number; verse: number; endVerse?: number; text: string; lxx: boolean }) => void
export const VerseMenuContext = createContext<VerseMenuOpener | null>(null)

/** Wraps any of `keywords` found inside `text` in a highlight, so a result shows WHY it matched. */
function HighlightedText({ text, keywords }: { text: string; keywords: string[] }) {
  const words = [...new Set(keywords.flatMap((k) => k.split(/\s+/)).filter((w) => w.length >= 3))]
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        words.some((w) => w.toLowerCase() === part.toLowerCase())
          ? <mark key={i} className="bg-[rgb(var(--highlight-yellow)/0.4)] text-inherit rounded-[2px]">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  )
}

/** A real, DB-verified Strong's word — opens the full lexicon entry. */
function StrongsCard({ card }: { card: AiLookupStrongsCard }) {
  const nav = useChatNavigate()
  return (
    <button type="button" className="chat-ai-row chat-strongs" title={`Open Strong's ${card.strongsNum}`}
      onClick={() => nav({ kind: 'lexicon', strongsNum: card.strongsNum })}>
      <BookOpenText size={13} className="flex-shrink-0 mt-[3px] text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
          {card.lemma && <span className="chat-strongs-lemma text-text-primary">{card.lemma}</span>}
          {card.transliteration && <span className="text-caption italic text-text-secondary">{card.transliteration}</span>}
          <span className="text-caption2 font-semibold text-accent">{card.strongsNum}</span>
        </div>
        {card.gloss && <p className="text-caption text-text-primary leading-snug mt-0.5">{card.gloss}</p>}
        {card.derivation && <p className="text-caption2 text-text-muted leading-snug mt-0.5 line-clamp-2">{card.derivation}</p>}
        <p className="text-caption2 text-text-muted mt-1">
          {card.occurrenceCount} occurrence{card.occurrenceCount === 1 ? '' : 's'} in Scripture · Open in Lexicon
        </p>
      </div>
      <ChevronRight size={13} className="flex-shrink-0 self-center text-text-muted" />
    </button>
  )
}

function NoteCard({ note }: { note: AiLookupNoteResult }) {
  const nav = useChatNavigate()
  return (
    <button type="button" className="chat-ai-row" onClick={() => nav({ kind: 'note', noteId: note.id })}>
      <NotepadText size={13} className="flex-shrink-0 mt-[2px] text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-caption font-semibold text-text-primary truncate">{note.title}</span>
          {note.isIdiom && (
            <span className="flex-shrink-0 text-micro px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
              idiom{note.idiomTerm ? `: ${note.idiomTerm}` : ''}
            </span>
          )}
        </div>
        {note.snippet && <p className="text-caption2 text-text-secondary leading-snug truncate mt-0.5">{note.snippet}</p>}
      </div>
    </button>
  )
}

/** mm:ss (or h:mm:ss) for a transcript-match deep-link label. */
function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "Find me a video about X" — from the local, allowlisted-channel library only (CLAUDE.md §12). */
function VideoCard({ video }: { video: AiLookupVideoResult }) {
  const nav = useChatNavigate()
  const startSeconds = video.startMs != null ? Math.floor(video.startMs / 1000) : 0
  return (
    <button type="button" className="chat-ai-row items-center" onClick={() => nav({ kind: 'video', videoId: video.videoId, startSeconds })}>
      {video.thumbnailUrl
        ? <img src={video.thumbnailUrl} alt="" className="w-14 h-9 rounded object-cover flex-shrink-0" />
        : <Youtube size={18} className="flex-shrink-0 text-text-muted" />}
      <div className="min-w-0 flex-1">
        <p className="text-caption font-semibold text-text-primary leading-snug line-clamp-2">{video.title}</p>
        <p className="text-caption2 text-text-muted truncate">
          {video.channelName}{video.startMs != null ? ` — at ${formatTimestamp(startSeconds)}` : ''}
        </p>
        {video.snippet && <p className="text-caption2 text-text-secondary leading-snug truncate mt-0.5">"{video.snippet}"</p>}
      </div>
    </button>
  )
}

/** A deterministic (non-AI-prose) summary line, shown as a quiet label rather than a sentence. */
function SourceBadge({ text }: { text: string }) {
  return (
    <div className="chat-source-badge flex items-start gap-1.5 max-w-full text-caption2 text-text-muted">
      <Quote size={10} className="flex-shrink-0 mt-[2px] opacity-60" />
      <span>{text}</span>
    </div>
  )
}

const refLabel = (r: AiLookupResult) => `${r.bookName} ${r.chapter}:${r.verse}${r.endVerse ? `-${r.endVerse}` : ''}`

function useActiveWordReplacerRules() {
  const enabled = useAppStore((s) => s.wordReplacerEnabled)
  const rules = useAppStore((s) => s.wordReplacerRules)
  // Enabled, non-Strong's rules only — Strong's-number rules apply to tagged-word rendering.
  return useMemo(() => (enabled ? rules.filter((r) => r.enabled && !r.strongsNum) : []), [enabled, rules])
}

/** `question` = the ai-request this reply answers (threaded into Study Trail as the reason). */
export const AiReplyBody = memo(function AiReplyBody({ message: m, question }: { message: ChatMsg; question?: string }) {
  const nav = useChatNavigate()
  const openVerseMenu = useContext(VerseMenuContext)
  const rules = useActiveWordReplacerRules()
  const [shownOverride, setShownOverride] = useState<number | null>(null)
  const [crossRefsOpen, setCrossRefsOpen] = useState<Record<number, boolean>>({})
  const display = (t: string) => (rules.length > 0 ? applyWordReplacer(t, rules) : t)

  const keywords = m.keywords ?? []
  const displayKeywords = rules.length > 0 ? keywords.map((k) => applyWordReplacer(k, rules)) : keywords
  const primary = (m.results ?? []).filter((r) => r.source !== 'cross-ref')
  const crossRefsByParent = new Map<string, AiLookupResult[]>()
  for (const r of m.results ?? []) {
    if (r.source !== 'cross-ref' || !r.crossRefOf) continue
    const key = `${r.crossRefOf.bookId}|${r.crossRefOf.chapter}|${r.crossRefOf.verse}`
    if (!crossRefsByParent.has(key)) crossRefsByParent.set(key, [])
    crossRefsByParent.get(key)!.push(r)
  }
  const shown = shownOverride ?? m.visibleCount ?? primary.length
  const visiblePrimary = primary.slice(0, shown)
  const hasMore = shown < primary.length
  const openVerse = (r: AiLookupResult) => nav({ kind: 'verse', result: r, question })
  const menu = (e: React.MouseEvent, r: AiLookupResult) =>
    openVerseMenu?.(e, { bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, text: r.text, lxx: r.textId === 'lxx' })

  return (
    <div className="chat-ai text-footnote">
      {m.content && <ChatMarkdown text={m.content} streaming={!!m.pending} className="text-text-primary" />}
      {m.summary && (
        // Deterministic branches (quote-lookup, notes-only) return `keywords: []` — a quiet
        // label for those vs the model's narrated summary, which reads as prose.
        keywords.length === 0
          ? <SourceBadge text={m.summary} />
          : <ChatMarkdown text={m.summary} streaming={!!m.pending} className="chat-ai-summary text-text-primary" />
      )}
      {m.strongsCard && <StrongsCard card={m.strongsCard} />}
      {(m.notes ?? []).length > 0 && <div className="chat-ai-rows">{m.notes!.map((n) => <NoteCard key={n.id} note={n} />)}</div>}
      {(m.videos ?? []).length > 0 && <div className="chat-ai-rows">{m.videos!.map((v) => <VideoCard key={v.videoId} video={v} />)}</div>}

      {visiblePrimary.length > 0 && (
        <ul className="chat-passages" aria-label="Passages">
          {visiblePrimary.map((r, ri) => {
            const nested = crossRefsByParent.get(`${r.bookId}|${r.chapter}|${r.verse}`) ?? []
            const crOpen = crossRefsOpen[ri] ?? false
            return (
              <li key={ri} className="chat-passage-item">
                <div
                  role="button" tabIndex={0} className="chat-passage" title={`Open ${refLabel(r)}`}
                  onClick={() => openVerse(r)} onContextMenu={(e) => menu(e, r)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openVerse(r) } }}
                >
                  <div className="chat-passage-ref text-caption">
                    <span>{refLabel(r)}</span>
                    {r.noted && <BookMarked size={11} className="text-accent" aria-label="You have a note here" />}
                  </div>
                  <blockquote className="chat-scripture berean-scripture-text m-0">
                    <HighlightedText text={display(r.text)} keywords={displayKeywords} />
                  </blockquote>
                  {r.commentary && <ChatMarkdown text={r.commentary} streaming={!!m.pending} className="chat-commentary" />}
                </div>
                {nested.length > 0 && (
                  <div className="chat-crossrefs">
                    <button
                      type="button" className="chat-crossrefs-toggle text-caption2" aria-expanded={crOpen}
                      onClick={(e) => { e.stopPropagation(); setCrossRefsOpen((prev) => ({ ...prev, [ri]: !crOpen })) }}
                    >
                      {crOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      <Link2 size={10} /> {nested.length} related
                    </button>
                    {crOpen && (
                      <ul className="chat-crossref-list">
                        {nested.map((cr, ci) => (
                          <li key={ci}>
                            <button type="button" className="chat-crossref text-caption2" title={`Open ${refLabel(cr)}`}
                              onClick={() => openVerse(cr)} onContextMenu={(e) => menu(e, cr)}>
                              <span className="chat-crossref-ref">{cr.bookName} {cr.chapter}:{cr.verse}</span>
                              <span className="chat-crossref-text">{display(cr.text)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {hasMore && (
        <Button variant="ghost" size="sm" icon={ChevronDown} onClick={() => setShownOverride(primary.length)} className="self-start">
          Show {primary.length - shown} more
        </Button>
      )}

      {(m.related ?? []).length > 0 && (
        <section className="chat-related" aria-label="Related Passages">
          <SectionLabel className="chat-ai-section-label">Related Passages</SectionLabel>
          {m.relatedNote && <ChatMarkdown text={m.relatedNote} className="text-caption text-text-muted mb-1" />}
          <ul className="chat-passages">
            {m.related!.map((r, ri) => (
              <li key={ri}>
                <button type="button" className="chat-crossref text-caption" title={`Open ${refLabel(r)}`}
                  onClick={() => openVerse(r)} onContextMenu={(e) => menu(e, r)}>
                  <span className="chat-crossref-ref">{refLabel(r)}</span>
                  <span className="chat-crossref-text">{display(r.text)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
})
