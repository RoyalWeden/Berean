// Strip markdown/HTML syntax down to plain readable text for short truncated previews (notes
// list rows, search snippets, board/Kanban cards) — a preview isn't a rendered note, so leftover
// `**`/`#`/`==`/`[!TYPE]`/`<mark>` markup reads as raw formatting noise rather than the words the
// note actually contains. Shared by every "one-line preview of a note's content" surface so they
// all strip the same way instead of each surface inventing (and under-covering) its own regexes.
export function stripMarkdownFormatting(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')                   // HTML comments (e.g. highlight-preview markers)
    .replace(/```[\s\S]*?```/g, ' ')                     // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')                         // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')             // images -> alt text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')        // [[target|alias]] -> alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                   // [[wikilink]] -> target
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')              // [text](url) -> text
    .replace(/^>\s*\[![A-Za-z]+\]\s*/gm, '')              // callout type tag (> [!WARNING] ...)
    .replace(/^#{1,6}\s+/gm, '')                          // headings
    .replace(/^>\s?/gm, '')                               // blockquotes
    .replace(/^\s*\|?[\s:-]+\|[\s|:-]+$/gm, ' ')          // table separator rows (| --- | --- |)
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, '')         // bullet/task list markers
    .replace(/^\s*\d+\.\s+/gm, '')                        // numbered list markers
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')                   // horizontal rules
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')                 // bold+italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')                     // bold
    .replace(/__([^_]+)__/g, '$1')                         // bold (underscore)
    .replace(/==([^=]+)==/g, '$1')                         // highlight (==text==)
    .replace(/\*([^*]+)\*/g, '$1')                         // italic
    .replace(/_([^_]+)_/g, '$1')                           // italic (underscore)
    .replace(/~~([^~]+)~~/g, '$1')                         // strikethrough
    .replace(/\|/g, ' ')                                   // table pipes
    // Any remaining literal inline HTML (<mark class="hlcyan">…</mark>, <u>…</u>, and anything
    // else that might slip through) — broader than a fixed tag allowlist so new tag types don't
    // silently leak through as raw markup again.
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
}
