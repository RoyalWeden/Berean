import { SectionLabel } from '@/components/ui'
import { collectionInfo, collectionOf, COLLECTIONS, type CollectionId } from '@/lib/research/collections'
import type { AiLookupResult, AiLookupResultSource } from '@/types/electron'

/**
 * Compact summary of a Deep Search reply that reached more than one Scripture collection (spec
 * §6.1 #10). Fixed labels and real counts only — no generated prose — so it is safe with
 * Commentary off. How each group was found is stated plainly from the result's own `source`.
 * (How many passages were checked is not recorded on a reply, so it is not claimed here.)
 */

const SOURCE_LABEL: Partial<Record<AiLookupResultSource, string>> = {
  keyword: 'Found by keyword match',
  semantic: 'Found by meaning match',
  strongs: "Found by Strong's tag",
  'quote-source': 'Found as a quoted source',
  'ai-guess': 'Suggested by the model, checked against the text',
}

export interface FindingsGroup { id: CollectionId; badge: string; count: number; how: string[] }

/** Primary (non-cross-reference) results grouped by collection, in the collections' own order. */
export function findingsGroups(results: readonly AiLookupResult[]): FindingsGroup[] {
  const by = new Map<CollectionId, { count: number; how: Set<string> }>()
  for (const r of results) {
    if (r.source === 'cross-ref') continue
    const id = collectionOf(r.textId, r.bookId)
    const g = by.get(id) ?? { count: 0, how: new Set<string>() }
    g.count++
    const label = SOURCE_LABEL[r.source]
    if (label) g.how.add(label)
    by.set(id, g)
  }
  return COLLECTIONS.filter((c) => by.has(c.id)).map((c) => ({ id: c.id, badge: collectionInfo(c.id).badge, count: by.get(c.id)!.count, how: [...by.get(c.id)!.how] }))
}

export function ResearchFindings({ results, terms }: { results: readonly AiLookupResult[]; terms: readonly string[] }) {
  const groups = findingsGroups(results)
  if (groups.length < 2) return null
  return (
    <section className="chat-findings" aria-label="Research findings">
      <SectionLabel className="chat-ai-section-label">Research findings</SectionLabel>
      {terms.length > 0 && <p className="text-caption2 text-text-muted">Search terms: {terms.join(', ')}</p>}
      <ul className="chat-findings-list">
        {groups.map((g) => (
          <li key={g.id} className="text-caption2" aria-label={`${g.badge}: ${g.count} passage${g.count === 1 ? '' : 's'}`}>
            <span className="chat-findings-name">{g.badge}</span>
            <span className="chat-findings-n">{g.count}</span>
            {g.how.length > 0 && <span className="text-text-muted">{g.how.join(' · ')}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
