// Scripture collections and search scope (spec §4.3, decision 9). Which installed texts a
// research request searches is a user/profile setting; a scope stated in the question always
// wins; every non-canonical result is labelled with its collection. No book is excluded by a
// hardcoded rule — Esther is ordinary canon.

export type CollectionId = 'canon' | 'apocrypha' | 'pseudepigrapha' | 'early-christian' | 'lxx'

export interface CollectionInfo {
  id: CollectionId
  label: string
  /** Short label for result badges. */
  badge: string
}

export const COLLECTIONS: ReadonlyArray<CollectionInfo> = [
  { id: 'canon', label: 'Old and New Testament (66 books)', badge: 'Bible' },
  { id: 'apocrypha', label: 'Apocrypha / Deuterocanon (KJV 1611)', badge: 'Apocrypha' },
  { id: 'pseudepigrapha', label: 'Pseudepigrapha (Enoch, Jubilees, Testaments…)', badge: 'Pseudepigrapha' },
  { id: 'early-christian', label: 'Early Christian writings (Hermas, Clement, Didache…)', badge: 'Early Christian' },
  { id: 'lxx', label: 'Septuagint (Brenton English)', badge: 'LXX' },
]

/** The KJV's Apocrypha books (kjva.db `books.testament = 'Apocrypha'`, verified 2026-10-28). */
export const KJVA_APOCRYPHA_BOOKS: ReadonlySet<string> = new Set(['1ES', '2ES', 'TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', 'PRA', 'SUS', 'BEL', 'PRM', '1MA', '2MA'])

const TEXT_COLLECTION: Record<string, CollectionId> = {
  kjva: 'canon', kjv: 'canon', lxx: 'lxx',
  enoch: 'pseudepigrapha', jubilees: 'pseudepigrapha', apoc_elijah: 'pseudepigrapha', asc_isaiah: 'pseudepigrapha',
  t12p: 'pseudepigrapha', gad: 'pseudepigrapha', t_job: 'pseudepigrapha', apoc_abraham: 'pseudepigrapha',
  t_jacob: 'pseudepigrapha', '2baruch': 'pseudepigrapha',
  hermas: 'early-christian', hermas_taylor: 'early-christian', '1clement': 'early-christian',
  didache_hoole: 'early-christian', ep_barnabas: 'early-christian', recog_clement: 'early-christian',
}

/** Default scope: every installed collection except the Septuagint, which is searched when asked
 *  for (its English is a second translation of the same Old Testament). Matches the behaviour
 *  before collections were configurable. */
export const DEFAULT_COLLECTIONS: ReadonlyArray<CollectionId> = ['canon', 'apocrypha', 'pseudepigrapha', 'early-christian']

export function collectionOf(textId: string, bookId: string): CollectionId {
  const c = TEXT_COLLECTION[textId] ?? 'pseudepigrapha'
  if (c === 'canon' && KJVA_APOCRYPHA_BOOKS.has(bookId)) return 'apocrypha'
  return c
}

export function collectionInfo(id: CollectionId): CollectionInfo {
  return COLLECTIONS.find((c) => c.id === id)!
}

/** Text ids that belong to the given collections (canon and apocrypha share kjva). */
export function textIdsFor(collections: ReadonlyArray<CollectionId>): string[] {
  const set = new Set(collections)
  const ids = Object.entries(TEXT_COLLECTION).filter(([id, c]) => set.has(c) && id !== 'kjv').map(([id]) => id)
  if (set.has('apocrypha') && !ids.includes('kjva')) ids.unshift('kjva')
  return ids
}

export interface QuestionScope {
  /** The question restricts itself to these collections. */
  only?: CollectionId[]
  /** The question removes these. */
  exclude?: CollectionId[]
}

const NAMES: Array<[CollectionId, RegExp]> = [
  ['apocrypha', /\b(apocrypha|apocryphal|deuterocanon(?:ical|s)?)\b/i],
  ['pseudepigrapha', /\bpseudepigrapha(?:l)?\b/i],
  ['early-christian', /\b(early christian writings|apostolic fathers)\b/i],
  ['lxx', /\b(septuagint|lxx)\b/i],
  ['canon', /\b(66 books|protestant canon|the canon|canonical books|canonical scriptures?|the bible only|only the bible|just the bible)\b/i],
]

/** Reads an explicit scope from the question ("only the Apocrypha", "without the pseudepigrapha",
 *  "just the 66 books"). Returns {} when the question states none. */
export function detectQuestionScope(question: string): QuestionScope {
  const q = question
  const named = NAMES.filter(([, re]) => re.test(q)).map(([id]) => id)
  if (named.length === 0) return {}
  if (/\b(without|exclude|excluding|except|not (?:the|including|from)|remove|no)\b/i.test(q)) {
    // "remove the Apocrypha" / "without the pseudepigrapha"
    return { exclude: named.filter((id) => id !== 'canon') }
  }
  if (/\b(only|just|solely|exclusively|in the|from the|within)\b/i.test(q) || /\bcanonical\b/i.test(q)) return { only: named }
  return {}
}

/** The collections a request searches: question scope first, then the setting. */
export function activeCollections(setting: ReadonlyArray<CollectionId> | undefined, scope: QuestionScope): CollectionId[] {
  const base = scope.only?.length ? scope.only : [...(setting?.length ? setting : DEFAULT_COLLECTIONS)]
  const excluded = new Set(scope.exclude ?? [])
  const out = base.filter((c) => !excluded.has(c))
  return out.length > 0 ? out : ['canon']
}
