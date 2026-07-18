const BOOK_MAP: Array<{ id: string; name: string; patterns: string[] }> = [
  { id: 'GEN', name: 'Genesis',        patterns: ['gen', 'ge', 'gn', 'genesis'] },
  { id: 'EXO', name: 'Exodus',         patterns: ['exo', 'ex', 'exod', 'exodus'] },
  { id: 'LEV', name: 'Leviticus',      patterns: ['lev', 'le', 'lv', 'leviticus'] },
  { id: 'NUM', name: 'Numbers',        patterns: ['num', 'nu', 'nm', 'nb', 'numbers'] },
  { id: 'DEU', name: 'Deuteronomy',    patterns: ['deu', 'dt', 'deut', 'deuteronomy'] },
  { id: 'JOS', name: 'Joshua',         patterns: ['jos', 'josh', 'joshua'] },
  { id: 'JDG', name: 'Judges',         patterns: ['jdg', 'jg', 'judg', 'judges'] },
  { id: 'RUT', name: 'Ruth',           patterns: ['rut', 'ru', 'ruth'] },
  { id: '1SA', name: '1 Samuel',       patterns: ['1sa', '1sam', '1samuel', '1 sa', '1 sam', '1 samuel'] },
  { id: '2SA', name: '2 Samuel',       patterns: ['2sa', '2sam', '2samuel', '2 sa', '2 sam', '2 samuel'] },
  { id: '1KI', name: '1 Kings',        patterns: ['1ki', '1king', '1kings', '1 ki', '1 king', '1 kings'] },
  { id: '2KI', name: '2 Kings',        patterns: ['2ki', '2king', '2kings', '2 ki', '2 king', '2 kings'] },
  { id: '1CH', name: '1 Chronicles',   patterns: ['1ch', '1chr', '1chron', '1chronicles', '1 ch', '1 chr', '1 chron', '1 chronicles'] },
  { id: '2CH', name: '2 Chronicles',   patterns: ['2ch', '2chr', '2chron', '2chronicles', '2 ch', '2 chr', '2 chron', '2 chronicles'] },
  { id: 'EZR', name: 'Ezra',           patterns: ['ezr', 'ezra'] },
  { id: 'NEH', name: 'Nehemiah',       patterns: ['neh', 'ne', 'nehemiah'] },
  { id: 'JOB', name: 'Job',            patterns: ['job', 'jb'] },
  { id: 'PSA', name: 'Psalms',         patterns: ['psa', 'ps', 'pss', 'psalms', 'psalm'] },
  { id: 'PRO', name: 'Proverbs',       patterns: ['pro', 'pr', 'prv', 'prov', 'proverbs'] },
  { id: 'ECC', name: 'Ecclesiastes',   patterns: ['ecc', 'ec', 'qoh', 'eccl', 'ecclesiastes'] },
  { id: 'SNG', name: 'Song of Songs',  patterns: ['sng', 'ss', 'song', 'sol', 'songs', 'song of songs', 'song of solomon'] },
  { id: 'ISA', name: 'Isaiah',         patterns: ['isa', 'is', 'isaiah'] },
  { id: 'JER', name: 'Jeremiah',       patterns: ['jer', 'je', 'jr', 'jeremiah'] },
  { id: 'LAM', name: 'Lamentations',   patterns: ['lam', 'la', 'lamentations'] },
  { id: 'EZK', name: 'Ezekiel',        patterns: ['ezk', 'eze', 'ezek', 'ezekiel'] },
  { id: 'DAN', name: 'Daniel',         patterns: ['dan', 'da', 'dn', 'daniel'] },
  { id: 'HOS', name: 'Hosea',          patterns: ['hos', 'ho', 'hosea'] },
  { id: 'JOL', name: 'Joel',           patterns: ['jol', 'joe', 'jl', 'joel'] },
  { id: 'AMO', name: 'Amos',           patterns: ['amo', 'am', 'amos'] },
  { id: 'OBA', name: 'Obadiah',        patterns: ['oba', 'ob', 'obad', 'obadiah'] },
  { id: 'JON', name: 'Jonah',          patterns: ['jon', 'jnh', 'jonah'] },
  { id: 'MIC', name: 'Micah',          patterns: ['mic', 'mi', 'micah'] },
  { id: 'NAM', name: 'Nahum',          patterns: ['nam', 'na', 'nah', 'nahum'] },
  { id: 'HAB', name: 'Habakkuk',       patterns: ['hab', 'hb', 'habakkuk'] },
  { id: 'ZEP', name: 'Zephaniah',      patterns: ['zep', 'zph', 'zeph', 'zephaniah'] },
  { id: 'HAG', name: 'Haggai',         patterns: ['hag', 'hg', 'haggai'] },
  { id: 'ZEC', name: 'Zechariah',      patterns: ['zec', 'zch', 'zech', 'zechariah'] },
  { id: 'MAL', name: 'Malachi',        patterns: ['mal', 'ml', 'malachi'] },
  { id: 'MAT', name: 'Matthew',        patterns: ['mat', 'mt', 'matt', 'matthew'] },
  { id: 'MRK', name: 'Mark',           patterns: ['mrk', 'mk', 'mr', 'mark'] },
  { id: 'LUK', name: 'Luke',           patterns: ['luk', 'lk', 'luke'] },
  { id: 'JHN', name: 'John',           patterns: ['jhn', 'jn', 'john'] },
  { id: 'ACT', name: 'Acts',           patterns: ['act', 'ac', 'acts'] },
  { id: 'ROM', name: 'Romans',         patterns: ['rom', 'ro', 'rm', 'romans'] },
  { id: '1CO', name: '1 Corinthians',  patterns: ['1co', '1cor', '1corinthians', '1 co', '1 cor', '1 corinthians'] },
  { id: '2CO', name: '2 Corinthians',  patterns: ['2co', '2cor', '2corinthians', '2 co', '2 cor', '2 corinthians'] },
  { id: 'GAL', name: 'Galatians',      patterns: ['gal', 'ga', 'galatians'] },
  { id: 'EPH', name: 'Ephesians',      patterns: ['eph', 'ephesians'] },
  { id: 'PHP', name: 'Philippians',    patterns: ['php', 'phi', 'phil', 'philippians'] },
  { id: 'COL', name: 'Colossians',     patterns: ['col', 'colossians'] },
  { id: '1TH', name: '1 Thessalonians', patterns: ['1th', '1thes', '1thess', '1thessalonians', '1 th', '1 thes', '1 thess', '1 thessalonians'] },
  { id: '2TH', name: '2 Thessalonians', patterns: ['2th', '2thes', '2thess', '2thessalonians', '2 th', '2 thes', '2 thess', '2 thessalonians'] },
  { id: '1TI', name: '1 Timothy',      patterns: ['1ti', '1tim', '1timothy', '1 ti', '1 tim', '1 timothy'] },
  { id: '2TI', name: '2 Timothy',      patterns: ['2ti', '2tim', '2timothy', '2 ti', '2 tim', '2 timothy'] },
  { id: 'TIT', name: 'Titus',          patterns: ['tit', 'ti', 'titus'] },
  { id: 'PHM', name: 'Philemon',       patterns: ['phm', 'phlm', 'pm', 'philemon'] },
  { id: 'HEB', name: 'Hebrews',        patterns: ['heb', 'hebrews'] },
  { id: 'JAS', name: 'James',          patterns: ['jas', 'jm', 'jam', 'james'] },
  { id: '1PE', name: '1 Peter',        patterns: ['1pe', '1pet', '1peter', '1 pe', '1 pet', '1 peter'] },
  { id: '2PE', name: '2 Peter',        patterns: ['2pe', '2pet', '2peter', '2 pe', '2 pet', '2 peter'] },
  { id: '1JN', name: '1 John',         patterns: ['1jn', '1jo', '1john', '1 jn', '1 jo', '1 john'] },
  { id: '2JN', name: '2 John',         patterns: ['2jn', '2jo', '2john', '2 jn', '2 jo', '2 john'] },
  { id: '3JN', name: '3 John',         patterns: ['3jn', '3jo', '3john', '3 jn', '3 jo', '3 john'] },
  { id: 'JUD', name: 'Jude',           patterns: ['jud', 'jude'] },
  { id: 'REV', name: 'Revelation',     patterns: ['rev', 're', 'rv', 'revelation', 'revelations'] },
  { id: 'TOB', name: 'Tobit',          patterns: ['tob', 'tobit'] },
  { id: 'JDT', name: 'Judith',         patterns: ['jdt', 'jth', 'judith'] },
  { id: 'WIS', name: 'Wisdom of Solomon', patterns: ['wis', 'wisdom', 'wisdom of solomon'] },
  { id: 'SIR', name: 'Sirach',         patterns: ['sir', 'sirach', 'ecclus', 'ecclesiasticus'] },
  { id: 'BAR', name: 'Baruch',         patterns: ['bar', 'baruch'] },
  { id: '1MA', name: '1 Maccabees',    patterns: ['1ma', '1mac', '1macc', '1maccabees', '1 ma', '1 mac', '1 macc', '1 maccabees'] },
  { id: '2MA', name: '2 Maccabees',    patterns: ['2ma', '2mac', '2macc', '2maccabees', '2 ma', '2 mac', '2 macc', '2 maccabees'] },
  { id: '3MA', name: '3 Maccabees',    patterns: ['3ma', '3mac', '3macc', '3maccabees', '3 ma', '3 mac', '3 macc', '3 maccabees'] },
  { id: '4MA', name: '4 Maccabees',    patterns: ['4ma', '4mac', '4macc', '4maccabees', '4 ma', '4 mac', '4 macc', '4 maccabees'] },
  { id: 'ESG', name: 'Esther (Greek)', patterns: ['esg', 'esth gr', 'esther greek', 'esther gr', 'greek esther'] },
  { id: 'SUS', name: 'Susanna',        patterns: ['sus', 'susanna'] },
  { id: 'BEL', name: 'Bel and the Dragon', patterns: ['bel', 'bel and the dragon', 'bel dragon'] },
  { id: 'PRA', name: 'Prayer of Azariah', patterns: ['pra', 'prayer of azariah', 'pr azariah', 'song of three', 'azariah'] },
  { id: 'PRM', name: 'Prayer of Manasseh', patterns: ['prm', 'prayer of manasseh', 'pr manasseh', 'man', 'manasseh'] },
  { id: 'LJE', name: 'Letter of Jeremiah', patterns: ['lje', 'letter of jeremiah', 'ep jer', 'epistle of jeremiah'] },
  { id: 'PSS', name: 'Psalms of Solomon', patterns: ['pss', 'psalms of solomon', 'ps solomon', 'psal solomon'] },
  { id: '1ES', name: '1 Esdras',       patterns: ['1es', '1esd', '1 esd', '1esdras', '1 esdras'] },
  { id: '2ES', name: '2 Esdras',       patterns: ['2es', '2esd', '2 es', '2 esd', '2esdras', '2 esdras', '4ezra', '4 ezra'] },
  { id: 'ENO', name: '1 Enoch',        patterns: ['eno', '1en', '1enoch', 'enoch', '1 enoch'] },
  { id: 'JUB', name: 'Jubilees',       patterns: ['jub', 'jubilees'] },
  // Pseudepigrapha — additional texts
  { id: 'AEL', name: 'Apocalypse of Elijah', patterns: ['ael', 'apoc elijah', 'apocalypse of elijah', 'apoc. elijah', 'revelation of elijah', 'rev elijah'] },
  { id: 'ABR', name: 'Apocalypse of Abraham', patterns: ['abr', 'apoc abraham', 'apocalypse of abraham', 'apoc. abraham', 'apoc abr'] },
  // Recognitions of Clement — 10 books; 'rcl' / 'recognitions' defaults to Book I.
  // The bare 'rcl'/'recognitions of clement' patterns are merged into THIS entry
  // (rather than a second `{ id: 'RCL1', ... }` object further down) — two BOOK_MAP
  // entries sharing the same id built ID_TO_NAME via `.set(id, name)` in array
  // order, so the LATER entry's `name` silently won (Map last-write-wins) and
  // `bookName('RCL1')` returned the generic "Recognitions of Clement" instead of
  // this entry's more specific "Recognitions - Book 1" everywhere, even when
  // displaying book 1 specifically. Same bug, same fix, for Hermas below.
  { id: 'RCL1',  name: 'Recognitions - Book 1',  patterns: ['rcl1', 'rcl i', 'rec clem 1', 'recognitions book 1', 'recognitions book i', 'rcl', 'recognitions of clement', 'recog clement', 'rec clem'] },
  { id: 'RCL2',  name: 'Recognitions - Book 2',  patterns: ['rcl2', 'rcl ii', 'rec clem 2', 'recognitions book 2', 'recognitions book ii'] },
  { id: 'RCL3',  name: 'Recognitions - Book 3',  patterns: ['rcl3', 'rcl iii', 'rec clem 3', 'recognitions book 3', 'recognitions book iii'] },
  { id: 'RCL4',  name: 'Recognitions - Book 4',  patterns: ['rcl4', 'rcl iv', 'rec clem 4', 'recognitions book 4', 'recognitions book iv'] },
  { id: 'RCL5',  name: 'Recognitions - Book 5',  patterns: ['rcl5', 'rcl v', 'rec clem 5', 'recognitions book 5', 'recognitions book v'] },
  { id: 'RCL6',  name: 'Recognitions - Book 6',  patterns: ['rcl6', 'rcl vi', 'rec clem 6', 'recognitions book 6', 'recognitions book vi'] },
  { id: 'RCL7',  name: 'Recognitions - Book 7',  patterns: ['rcl7', 'rcl vii', 'rec clem 7', 'recognitions book 7', 'recognitions book vii'] },
  { id: 'RCL8',  name: 'Recognitions - Book 8',  patterns: ['rcl8', 'rcl viii', 'rec clem 8', 'recognitions book 8', 'recognitions book viii'] },
  { id: 'RCL9',  name: 'Recognitions - Book 9',  patterns: ['rcl9', 'rcl ix', 'rec clem 9', 'recognitions book 9', 'recognitions book ix'] },
  { id: 'RCL10', name: 'Recognitions - Book 10', patterns: ['rcl10', 'rcl x', 'rec clem 10', 'recognitions book 10', 'recognitions book x'] },
  // Shepherd of Hermas — 3 sections; bare 'her'/'hermas' defaults to Visions, merged
  // into the HER_VIS entry's own patterns (see the RCL1 comment above for why —
  // same duplicate-id/Map-overwrite bug, same fix).
  { id: 'HER_VIS', name: 'Hermas - Visions',     patterns: ['her vis', 'hermas visions', 'visions of hermas', 'shepherd visions', 'her', 'hermas', 'shepherd of hermas', 'shep hermas'] },
  { id: 'HER_MAN', name: 'Hermas - Mandates',    patterns: ['her man', 'hermas mandates', 'mandates of hermas', 'shepherd mandates', 'hermas commands'] },
  { id: 'HER_SIM', name: 'Hermas - Similitudes', patterns: ['her sim', 'hermas similitudes', 'similitudes of hermas', 'shepherd similitudes', 'hermas parables'] },
  { id: 'AIS', name: 'Ascension of Isaiah', patterns: ['ais', 'asc isaiah', 'ascension of isaiah', 'asc. isaiah', 'ascension isaiah'] },
  { id: 'EPB', name: 'Epistle of Barnabas', patterns: ['epb', 'barnabas', 'epistle of barnabas', 'ep barnabas', 'barn'] },
  // Testaments of the Twelve Patriarchs (each testament is a separate book in the same DB)
  { id: 'TREU', name: 'Testament of Reuben',    patterns: ['treu', 't reuben', 'testament of reuben', 'test reuben'] },
  { id: 'TSIM', name: 'Testament of Simeon',    patterns: ['tsim', 't simeon', 'testament of simeon', 'test simeon'] },
  { id: 'TLEV', name: 'Testament of Levi',      patterns: ['tlev', 't levi', 'testament of levi', 'test levi'] },
  { id: 'TJUD', name: 'Testament of Judah',     patterns: ['tjud', 't judah', 'testament of judah', 'test judah'] },
  { id: 'TISS', name: 'Testament of Issachar',  patterns: ['tiss', 't issachar', 'testament of issachar', 'test issachar'] },
  { id: 'TZEB', name: 'Testament of Zebulun',   patterns: ['tzeb', 't zebulun', 'testament of zebulun', 'test zebulun'] },
  { id: 'TDAN', name: 'Testament of Dan',       patterns: ['tdan', 't dan', 'testament of dan', 'test dan'] },
  { id: 'TNAP', name: 'Testament of Naphtali',  patterns: ['tnap', 't naphtali', 'testament of naphtali', 'test naphtali'] },
  { id: 'TGAD', name: 'Testament of Gad',       patterns: ['tgad', 't gad', 'testament of gad', 'test gad'] },
  { id: 'TASH', name: 'Testament of Asher',     patterns: ['tash', 't asher', 'testament of asher', 'test asher'] },
  { id: 'TJOS', name: 'Testament of Joseph',    patterns: ['tjos', 't joseph', 'testament of joseph', 'test joseph'] },
  { id: 'TBEN', name: 'Testament of Benjamin',  patterns: ['tben', 't benjamin', 'testament of benjamin', 'test benjamin'] },
  // Gad the Seer (distinct from T12P's Testament of Gad which uses 'tgad')
  { id: 'GAD', name: 'Gad the Seer', patterns: ['gad', 'gad the seer', 'words of gad', 'gad seer', 'word gad'] },
  // Testament of Job (distinct from canonical Job which uses 'job'/'jb')
  { id: 'TJOB', name: 'Testament of Job', patterns: ['tjob', 't job', 't. job', 'testament job', 'testament of job', 'test of job'] },
  // 1 Clement
  { id: '1CL', name: '1 Clement', patterns: ['1cl', '1clem', '1clement', '1 clement', 'first clement', '1st clement', 'clement i'] },
]

const PATTERN_LOOKUP = new Map<string, string>()
const ID_TO_NAME = new Map<string, string>()
const BOOK_ORDER_MAP = new Map<string, number>()
BOOK_MAP.forEach(({ id, name, patterns }, i) => {
  if (!BOOK_ORDER_MAP.has(id)) BOOK_ORDER_MAP.set(id, i) // first occurrence wins for duplicate IDs
  ID_TO_NAME.set(id, name)
  for (const p of patterns) PATTERN_LOOKUP.set(p, id)
})

/** Canonical sort position for a bookId (lower = earlier in canon). Returns 9999 for unknown IDs. */
export function bookOrder(bookId: string): number {
  return BOOK_ORDER_MAP.get(bookId) ?? 9999
}

/** All books with a canonical display name (deduped by id, first occurrence wins). */
export const ALL_BOOKS: ReadonlyArray<{ id: string; name: string; patterns: readonly string[] }> = (() => {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; patterns: readonly string[] }> = []
  for (const b of BOOK_MAP) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    out.push({ id: b.id, name: b.name, patterns: b.patterns })
  }
  return out
})()

/** Plain Levenshtein edit distance — small hand-rolled implementation rather than pulling in
 *  a dependency, since it's only used for the misspelling fallback below (short strings,
 *  called rarely — once per unmatched book token, not in a hot loop). */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Resolve a book token to a book id.
 * 1. Exact pattern match ("gen", "jhn", "1jo")
 * 2. Name prefix match in canonical order ("joh" → John, "rev" → Revelation)
 * 3. Pattern prefix match in canonical order (fallback, e.g. "jdg" partials)
 * 4. Fuzzy match by edit distance against every book's full NAME and PATTERNS — catches
 *    misspellings that aren't simple truncations (a dropped/swapped/doubled letter
 *    mid-word, e.g. "Genesys", "Corinthans", "Deuteronmy", "Philipians", "Revelaton"),
 *    which prefix matching alone can't, since the mismatch isn't at the end of the string.
 *    Deliberately conservative to avoid two failure modes an earlier, looser version hit:
 *    (a) only matches against full book NAMES, never the short `patterns` abbreviations —
 *        a 3-4 letter abbreviation has too many single-edit English-word neighbors ("Room"
 *        is one edit from "Rom", the Romans abbreviation, but is obviously not a book ref);
 *    (b) requires |input length − candidate length| ≤ 1, not just a small edit distance —
 *        edit distance alone doesn't distinguish "a letter got mistyped" from "a whole
 *        extra word got prepended" (e.g. "vsdeuteronomy" is only 2 edits from
 *        "deuteronomy", well inside a naive distance budget, but that's `resolveBookToken`
 *        wrongly swallowing "vs " rather than a real misspelling — callers like
 *        NoteEditor.tsx's leading-word-recovery logic depend on this case failing so they
 *        can retry with just "deuteronomy"). Only kicks in for tokens ≥4 characters —
 *        below that there are too many plausible fuzzy neighbors regardless.
 * Prefix matching needs ≥2 chars to avoid wild single-letter ambiguity.
 */

/**
 * True only for tokens that resolve via resolveBookToken's tier-1 exact
 * match (a literal pattern, or the book's full canonical name) — never for
 * tier-2 prefix matches or tier-3 fuzzy matches. Used to auto-flag any
 * low-confidence resolution as ambiguous (see AMBIGUOUS_PATTERNS below)
 * without having to hand-list every short word that happens to prefix-match
 * some book's abbreviation (e.g. "to" -> "tob"/"tobit").
 */
export function isExactBookToken(raw: string): boolean {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (PATTERN_LOOKUP.has(key)) return true
  const noSpace = key.replace(/\s+/g, '')
  return BOOK_MAP.some(({ name }) => name.toLowerCase().replace(/\s+/g, '') === noSpace)
}

export function resolveBookToken(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const exact = PATTERN_LOOKUP.get(key)
  if (exact) return exact
  const noSpace = key.replace(/\s+/g, '')
  if (noSpace.length < 2) return null
  // Name prefix (canonical order)
  for (const { id, name } of BOOK_MAP) {
    if (name.toLowerCase().replace(/\s+/g, '').startsWith(noSpace)) return id
  }
  // Pattern prefix (canonical order)
  for (const { id, patterns } of BOOK_MAP) {
    if (patterns.some((p) => p.replace(/\s+/g, '').startsWith(noSpace))) return id
  }
  // Fuzzy fallback (misspellings) — see the function comment for why this is scoped so
  // narrowly (full names only, length-diff ≤ 1, distance capped at 2).
  if (noSpace.length >= 4) {
    let best: { id: string; dist: number } | null = null
    for (const { id, name } of BOOK_MAP) {
      const candidate = name.toLowerCase().replace(/\s+/g, '')
      if (candidate.length < 5) continue
      const lenDiff = Math.abs(candidate.length - noSpace.length)
      if (lenDiff > 1) continue
      const maxDist = candidate.length <= 6 ? 1 : 2
      const dist = editDistance(noSpace, candidate)
      if (dist <= maxDist && (!best || dist < best.dist)) best = { id, dist }
    }
    if (best) return best.id
  }
  return null
}

export function bookName(bookId: string): string {
  return ID_TO_NAME.get(bookId) ?? bookId
}

const BOOK_TRANSLATION: Record<string, string> = {
  ENO:     'enoch',
  JUB:     'jubilees',
  AEL:     'apoc_elijah',
  ABR:     'apoc_abraham',
  // Recognitions of Clement — all 10 books in same DB
  RCL1:    'recog_clement',
  RCL2:    'recog_clement',
  RCL3:    'recog_clement',
  RCL4:    'recog_clement',
  RCL5:    'recog_clement',
  RCL6:    'recog_clement',
  RCL7:    'recog_clement',
  RCL8:    'recog_clement',
  RCL9:    'recog_clement',
  RCL10:   'recog_clement',
  // Shepherd of Hermas — all 3 sections in same DB
  HER_VIS: 'hermas',
  HER_MAN: 'hermas',
  HER_SIM: 'hermas',
  AIS:     'asc_isaiah',
  EPB:     'ep_barnabas',
  TREU:    't12p',
  TSIM:    't12p',
  TLEV:    't12p',
  TJUD:    't12p',
  TISS:    't12p',
  TZEB:    't12p',
  TDAN:    't12p',
  TNAP:    't12p',
  TGAD:    't12p',
  TASH:    't12p',
  TJOS:    't12p',
  TBEN:    't12p',
  GAD:     'gad',
  TJOB:    't_job',
  '1CL':   '1clement',
}

// The Shepherd of Hermas ships in two translations sharing the same HER_* book ids:
// 'hermas' (Roberts-Donaldson, default) and 'hermas_taylor' (Charles Taylor). The
// user picks one in Settings; we hold it in a module-level variable set from the
// store so every getTranslationForBook call site resolves Hermas books to the
// chosen text without threading the preference through each signature.
let hermasTextId = 'hermas'

/** Set the active Hermas translation textId ('hermas' | 'hermas_taylor'). */
export function setHermasTextId(textId: string): void {
  hermasTextId = textId === 'hermas_taylor' ? 'hermas_taylor' : 'hermas'
}

/** The currently selected Hermas translation textId. */
export function getHermasTextId(): string {
  return hermasTextId
}

/** Returns the translation ID to switch to when navigating to this book, or null for canonical books. */
export function getTranslationForBook(bookId: string): string | null {
  const base = BOOK_TRANSLATION[bookId]
  if (base === 'hermas') return hermasTextId
  return base ?? null
}

/** Label for a specific book+chapter. The book of Psalms is plural, but an individual
 *  chapter is a single "Psalm", so show "Psalm 23" rather than "Psalms 23". */
export function bookChapterLabel(bookId: string, chapter: number): string {
  if (bookId === 'PSA') return `Psalm ${chapter}`
  return `${bookName(bookId)} ${chapter}`
}

const _DEDICATED_TRANSLATION_IDS = new Set([...Object.values(BOOK_TRANSLATION), 'hermas_taylor'])
/** Returns true when textId is a non-canonical dedicated translation (e.g. 'asc_isaiah', 'enoch').
 *  Use to detect when navigating to a canonical book requires a translation switch. */
export function isDedicatedTranslation(textId: string): boolean {
  return _DEDICATED_TRANSLATION_IDS.has(textId.toLowerCase())
}

// Maximum chapter count per book. Used to reject out-of-range references that
// would otherwise match common English words (e.g. "is 99" → Isaiah 99 doesn't exist).
const MAX_CHAPTERS: Partial<Record<string, number>> = {
  // OT
  GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34,
  JOS: 24, JDG: 21, RUT: 4,
  '1SA': 31, '2SA': 24, '1KI': 22, '2KI': 25,
  '1CH': 29, '2CH': 36,
  EZR: 10, NEH: 13,
  JOB: 42, PSA: 150, PRO: 31, ECC: 12, SNG: 8,
  ISA: 66, JER: 52, LAM: 5, EZK: 48, DAN: 12,
  HOS: 14, JOL: 3, AMO: 9, OBA: 1, JON: 4,
  MIC: 7, NAM: 3, HAB: 3, ZEP: 3, HAG: 2, ZEC: 14, MAL: 4,
  // NT
  MAT: 28, MRK: 16, LUK: 24, JHN: 21, ACT: 28,
  ROM: 16, '1CO': 16, '2CO': 13, GAL: 6, EPH: 6,
  PHP: 4, COL: 4, '1TH': 5, '2TH': 3, '1TI': 6, '2TI': 4,
  TIT: 3, PHM: 1, HEB: 13, JAS: 5,
  '1PE': 5, '2PE': 3, '1JN': 5, '2JN': 1, '3JN': 1, JUD: 1, REV: 22,
  // Apocrypha
  TOB: 14, JDT: 16, WIS: 19, SIR: 51, BAR: 6,
  '1MA': 16, '2MA': 15, '3MA': 7, '4MA': 18,
  '1ES': 9, '2ES': 16,
  ESG: 10, SUS: 1, BEL: 1, PRA: 1, PRM: 1, LJE: 1, PSS: 18,
  // Pseudepigrapha
  // These caps were previously wrong for several books — verified here against
  // each book's actual data/*.db (books.chapters_count / MAX(verses.chapter)),
  // not just guessed. The Hermas values were the most dramatically off (4/12/10
  // vs the DB's real 25/24/65 flat db-chapters — the traditional 4-visions/
  // 12-mandates/10-similitudes numbering is a LITERARY structure the app maps
  // separately via src/lib/hermasMap.ts, not the raw chapter count a typed
  // reference like "Hermas Vis 15" is checked against here), which meant any
  // reference past chapter 4/12/10 was silently rejected as out of range even
  // though the text exists. RCL1–10 (Recognitions of Clement) weren't in this
  // table at all, so those got no range validation whatsoever.
  ENO: 108, JUB: 50,
  AEL: 5, ABR: 32,
  HER_VIS: 25, HER_MAN: 24, HER_SIM: 65,
  AIS: 11, EPB: 21,
  TREU: 7, TSIM: 9, TLEV: 19, TJUD: 26, TISS: 7, TZEB: 10,
  TDAN: 7, TNAP: 9, TGAD: 8, TASH: 8, TJOS: 20, TBEN: 12,
  GAD: 14, TJOB: 12, '1CL': 66,
  RCL1: 74, RCL2: 72, RCL3: 65, RCL4: 37, RCL5: 36,
  RCL6: 15, RCL7: 38, RCL8: 62, RCL9: 36, RCL10: 72,
}

/**
 * Patterns that are also common English words, abbreviations, or symbols and
 * therefore need extra signal to be trusted as Bible book references in prose.
 *
 * When a plain-text match resolves via one of these patterns (case-insensitive),
 * the caller should additionally require:
 *   - The book token is capitalised in the source text (e.g. "Is 5" not "is 5"), OR
 *   - The reference includes a chapter:verse colon (e.g. "is 5:1")
 *
 * [[Wikilinks]] and full-word book names (Isaiah, Amos…) are never affected.
 */
export const AMBIGUOUS_PATTERNS = new Set([
  // ── Very common verbs / function words ──────────────────────────────────────
  'is',    // Isaiah    — "salvation is 99% complete", "is 5 times worse"
  'am',    // Amos      — "I am 3 years old", "there am 5"
  're',    // Revelation— "re: 5 action items", "RE 22 pending"
  'her',   // Hermas    — "her 5 children", "gave her 3 books"
  'da',    // Daniel    — "da 3 guys" (informal definite article in some dialects)
  'ho',    // Hosea     — "ho 3!" (interjection), "ho ho ho"
  'la',    // Lamentations — "la 3" (musical solfège), "LA 5" (Los Angeles)
  'ro',    // Romans    — "ro 5 engine", "RO 3" (reverse osmosis)
  'le',    // Leviticus — "le 3" (French/Spanish article)
  'na',    // Nahum     — "na 3" (informal negative / abbreviation)
  'ec',    // Ecclesiastes — "EC 3" (European Community, electric car)
  'ne',    // Nehemiah  — "NE 5" (northeast direction / street)
  'nu',    // Numbers   — "nu 4" (Greek letter ν, or informal "new")
  'mi',    // Micah     — "mi 3" (musical note, miles abbreviation)
  'ac',    // Acts      — "AC 12V" (alternating current / air conditioning)
  'ga',    // Galatians — "GA 3" (US state Georgia, genetic algorithm)
  'rm',    // Romans    — "rm 5" (Unix remove command, room abbrev)
  'ru',    // Ruth      — "ru 3" (less common abbrev)
  'ex',    // Exodus    — "my ex 3 years ago", "ex 5 partners"
  'pr',    // Proverbs  — "PR 5 campaign" (public relations, Puerto Rico)
  'ep',    // Ephesians — "ep 3" (episode 3)
  'ps',    // Psalms    — "PS3" (PlayStation), "ps 5" (postscript)
  // ── Chemical symbols / units that double as book abbreviations ─────────────
  'hg',    // Haggai    — Hg (mercury, atomic symbol)
  'ml',    // Malachi   — ml (milliliters)
  'ti',    // Titus     — Ti (titanium, Texas Instruments)
  'nm',    // Numbers   — nm (nanometers)
  'nb',    // Numbers   — NB: (nota bene), nb (niobium)
  // ── Short codes used in tech / versioning / grids ─────────────────────────
  'ss',    // Song of Songs — "SS 5" (steamship, social security)
  'mk',    // Mark      — "mk3" / "mk 3" (version mark / generation)
  'mt',    // Matthew   — "MT 5" (Montana, mountain)
  'lk',    // Luke      — "lk 3" (common abbreviation)
  'jn',    // John      — "Jn 3" (less ambiguous, but email abbrev)
  'mr',    // Mark      — "Mr. 3" (honorific)
  'jl',    // Joel      — "jl 3" (abbreviation)
  'ob',    // Obadiah   — "ob 3" (abbreviation)
  'mn',    // abbreviation
  // ── Common 3–5 letter words that match longer abbreviations ───────────────
  'col',   // Colossians— "col 3" (spreadsheet column, colonel)
  'sir',   // Sirach    — "Sir 3" (honorific title)
  'bar',   // Baruch    — "bar 5" (English word bar, unit of pressure)
  'wis',   // Wisdom    — "WIS 5" (wisdom stat in RPGs, Wisconsin)
  'lam',   // Lamentations — "LAM 3" (abbreviation for lambda)
  'mal',   // Malachi   — "mal 4" (prefix mal- meaning bad)
  'hag',   // Haggai    — "hag 2" (English: old hag)
  'gad',   // Gad       — "gad!" (exclamation), "gad 3"
  'sol',   // Song of Solomon — "sol 3" (musical solfège, Spanish for sun)
  'mic',   // Micah     — "mic 3" (microphone)
  'job',   // Job       — "job 10 applicants", "job 3 at the company"
  'jb',    // Job       — "jb 3" (abbreviation)
  'num',   // Numbers   — "num 5" (number abbreviation)
  'nah',   // Nahum     — "nah 3" (informal "no")
  'lev',   // Leviticus — "lev 5" (abbreviation)
  'hab',   // Habakkuk  — "hab 3" (abbreviation)
  'heb',   // Hebrews   — "HEB 5" (supermarket chain in Texas)
  'rev',   // Revelation— "rev 5" (revision 5, rev count in engines)
  'phi',   // Philippians — "phi 3" (Greek letter φ)
  'sng',   // Song of Songs — "sng 3" (abbreviation for "song")
  'qoh',   // Ecclesiastes — rare, but "Qoh" is unusual
  'amo',   // Amos      — "amo 3" (Latin "I love")
  'prv',   // Proverbs  — "PRV 5" (abbreviation)
  'pss',   // Psalms    — "pss" (abbreviation)
  'jam',   // James     — "jam 3" (strawberry jam 3 jars, traffic jam)
  'oba',   // Obadiah   — "oba 3" (abbreviation)
  'deut',  // Deuteronomy — "deut 34" (less common)
  'ecc',   // Ecclesiastes — "ECC 5" (abbreviation)
  'joe',   // Joel      — "joe 3" (common name "Joe", cup of joe)
  'zph',   // Zephaniah — "ZPH 3" (abbreviation)
  'hb',    // Habakkuk  — "hb 3" (hardback, abbreviation)
  'zch',   // Zechariah — "ZCH 3" (abbreviation)
  'jnh',   // Jonah     — "JNH 4" (abbreviation)
  'man',   // Prayer of Manasseh — "man 5" (the common English word "man")
])

export interface ParsedRef {
  bookId: string
  chapter: number
  verse?: number
  endVerse?: number
  endChapter?: number  // for chapter ranges like "Hosea 13-14"
  forcedTranslation?: string
}

export function parseRef(input: string): ParsedRef | null {
  const s = input.trim()
  if (!s) return null

  // Normalise: collapse interior whitespace
  const norm = s.replace(/\s+/g, ' ')

  // Regex handles:
  //   "Gen 1:1"  "Gen 1"  "Genesis 1:1-5"  "Gen1:1"  "Gen1"
  //   "Hosea 13-14"  (chapter range — no verse)
  // Group 1: book token (may include leading digit like "1 Samuel" or "1Sam")
  // Group 2: start chapter
  // Group 3: start verse (optional, present when colon/period separator used)
  // Group 4: end verse (optional, when verse range)
  // Group 5: end chapter (optional, when chapter range without verse)
  const m = norm.match(
    /^((?:\d\s*)?\w[\w\s]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?|\s*[-–]\s*(\d+))?$/i
  )
  if (!m) return null

  const bookRaw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
  const chapter   = parseInt(m[2])
  const verse     = m[3] ? parseInt(m[3]) : undefined
  const endVerse  = m[4] ? parseInt(m[4]) : undefined
  const endChapter = m[5] ? parseInt(m[5]) : undefined

  if (isNaN(chapter) || chapter < 1) return null

  const bookId = resolveBookToken(bookRaw)
  if (!bookId) return null

  // Reject chapters beyond the book's known maximum.
  const maxCh = MAX_CHAPTERS[bookId]
  if (maxCh !== undefined && chapter > maxCh) return null

  // Sanity-check verse number (Psalm 119 is the longest chapter at 176 verses).
  if (verse !== undefined && (isNaN(verse) || verse < 1 || verse > 200)) return null

  return { bookId, chapter, verse, endVerse, endChapter }
}

export function isStrongsRef(input: string): boolean {
  return /^[HGhg]\d{1,5}$/.test(input.trim())
}

/** Sanitise a free-text query so it's safe to pass to SQLite FTS5 MATCH.
 *  Strips FTS5 special characters and appends '*' for prefix matching. */
export function safeFtsQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean)
  const clean = words
    .map((w) => w.replace(/[^a-zA-Z0-9']/g, ''))
    .filter((w) => w.length > 1)
  if (clean.length === 0) return ''
  return clean.map((w) => `${w}*`).join(' ')
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * STANDARDIZED FORMAT CONVERSIONS — M7 Task 4
 *
 * Canonical formats:
 * - Machine: "GEN.1.1" (all-caps, dots, used in DB/frontmatter ref field)
 * - Filename: "Genesis 1.1.md" (title-case, dot separator, human-readable)
 * - UI Display: "Genesis 1:1" (title-case, colon, display format)
 * - Wikilink: "[[Verse Notes/Genesis 1:1]]" (full path, colon, for markdown)
 * - Frontmatter related_verses: ["Genesis 1:1"] (title-case, colon)
 *
 * All conversions go through these functions to ensure consistency.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Parse any verse reference format and return canonical form (e.g. "GEN.1.1").
 *  Accepts: "Genesis 1:1", "Gen 1.1", "GEN.1.1", "gen.1.1", etc.
 */
export function toCanonical(input: string): string | null {
  // Parse the input using the same pattern matching as parseVerseRef
  const parsed = (() => {
    const norm = (input ?? '').trim()
    if (!norm) return null
    const m = norm.match(
      /^((?:\d\s*)?\w[\w\s]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?|\s*[-–]\s*(\d+))?$/i
    )
    if (!m) return null
    const bookRaw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
    const chapter = parseInt(m[2])
    const verse = m[3] ? parseInt(m[3]) : undefined
    if (isNaN(chapter) || chapter < 1) return null
    const bookId = resolveBookToken(bookRaw)
    if (!bookId) return null
    return { bookId, chapter, verse }
  })()
  if (!parsed) return null
  const { bookId, chapter, verse } = parsed
  return verse ? `${bookId}.${chapter}.${verse}` : `${bookId}.${chapter}.0`
}

/** Convert canonical form (e.g. "GEN.1.1") to filename format (e.g. "Genesis 1.1.md").
 *  Handles multi-word book names and numbered books.
 */
export function toFilename(canonical: string): string | null {
  const parts = canonical.split('.')
  if (parts.length < 2) return null
  const bookId = parts[0]
  const chapter = parts[1]
  const verse = parts[2]

  const name = bookName(bookId)
  if (!name || name === bookId) return null // Unknown book

  const versionStr = verse && verse !== '0' ? `${chapter}.${verse}` : chapter
  return `${name} ${versionStr}.md`
}

/** Convert canonical form to human-readable UI display format (e.g. "Genesis 1:1").
 */
export function toUIDisplay(canonical: string): string | null {
  const parts = canonical.split('.')
  if (parts.length < 2) return null
  const bookId = parts[0]
  const chapter = parts[1]
  const verse = parts[2]

  const name = bookName(bookId)
  if (!name || name === bookId) return null // Unknown book

  return verse && verse !== '0' ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`
}

/** Convert canonical form to wikilink format with folder prefix (e.g. "[[Verse Notes/Genesis 1:1]]").
 */
export function toWikilink(canonical: string): string | null {
  const display = toUIDisplay(canonical)
  if (!display) return null
  return `[[Verse Notes/${display}]]`
}

/** Convert canonical form to bare wikilink (no folder, for cross-reference).
 *  e.g. "GEN.1.1" → "Genesis 1:1" (used in frontmatter related_verses field)
 */
export function toRelatedVerse(canonical: string): string | null {
  return toUIDisplay(canonical)
}

/** Create a canonical reference from book ID, chapter, and optional verse. */
export function createCanonical(bookId: string, chapter: number, verse?: number): string {
  const v = verse ?? 0
  return `${bookId}.${chapter}.${v}`
}

/** Extract book ID, chapter, verse from canonical form. */
export function parseCanonical(canonical: string): { bookId: string; chapter: number; verse?: number } | null {
  const parts = canonical.split('.')
  if (parts.length < 2) return null
  const bookId = parts[0]
  const chapter = parseInt(parts[1])
  const verse = parts[2] ? parseInt(parts[2]) : undefined
  if (isNaN(chapter)) return null
  if (verse !== undefined && isNaN(verse)) return null
  return { bookId, chapter, verse: verse && verse !== 0 ? verse : undefined }
}
