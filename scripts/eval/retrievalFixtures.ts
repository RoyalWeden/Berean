// Berean Chat (AI Lookup) retrieval test set — Team B, "measure first" mandate.
//
// Every `expected` entry below was checked against the REAL kjva.db (or the named
// pseudepigrapha db) with a direct FTS5 query before being added here — see the verification
// commands in the Team B session log. `expected` is an ARRAY because several of these questions
// (especially the thematic ones) have more than one genuinely correct verse; a hit on ANY of
// them counts for recall@k. Order within `expected` does not imply priority.
//
// `keywords` is what gets fed to the MOCKED extraction step in retrievalEval — i.e. what we
// pretend Ollama would have extracted, so the harness measures the candidate-generation +
// ranking pipeline in isolation from Ollama's non-determinism (see runRetrievalEval.ts). These
// are deliberately written the way a real extraction call is instructed to write them
// (extractionPrompt's own rules: literal KJV-era wording, not modern paraphrase, no bare
// generic single words) — they are NOT hand-picked to make the answer easy to find; they're what
// a competent extraction pass over the question would plausibly produce.
//
// textId conventions match AiLookupResult.textId: 'kjva' for the canonical+Apocrypha db (which
// is also where TSKE/cross-ref lookups run), 'enoch'/'jubilees'/'t12p'/'hermas'/'didache_hoole'/
// '2baruch' for the separate pseudepigrapha dbs (see TEXT_FILES in electron/db/bible.ts).
//
// ---- KNOWN METHODOLOGY GAP: the `strongs` category is measuring the wrong thing ----
// (Flagged by team-lead as worth capturing properly, not fixing here.)
//
// Every `category: 'strongs'` case (st-grace-hebrew, st-agape-greek, st-mammon, st-yhwh,
// st-anxious-greek, st-torah-hebrew, st-shabbat-hebrew, st-berith-hebrew) is being scored by
// this harness with the SAME "did results[] contain one of the expected verses" recall@k metric
// as every other category. That's the wrong signal for these questions specifically, for two
// reasons:
//
// 1. A "what does the Hebrew/Greek word for X mean" question is not really answered by A VERSE
//    at all — it's answered by `AiLookupResponse.strongsCard` (see AiLookupStrongsCard in
//    aiLookup.ts), a real DB-verified Strong's word card (word, transliteration, gloss,
//    occurrence count) rendered as its own UI element, separate from the verse-results list. The
//    `expected` verse on each of these fixture cases is illustrative/arbitrary — "the first verse
//    that happens to contain the concept" — not the actual thing the app is supposed to produce.
//    Scoring recall against it conflates "did the right word get identified" with "did an
//    unrelated verse-ranking pipeline happen to also surface a verse containing that concept."
//
// 2. Several of these questions' `keywords` are, on inspection, bad literal-search input by
//    design (not a harness bug — a deliberate stand-in for what a real extraction call would
//    produce for a WORD-MEANING question, which is a different shape of question than a
//    PASSAGE question). st-agape-greek uses `['agape', 'love']` — "agape" is a bare Greek
//    transliteration that never appears in the actual KJV English text (checked directly: zero
//    FTS hits), and "love" is deleted outright by OVERLY_GENERIC_SINGLE_WORDS — so this case is
//    STRUCTURALLY unable to score via keyword search no matter how good the ranking pipeline
//    gets. The correct path for it was always meant to be `strongsNum` resolution (extraction
//    guesses "G26", verified against strongs_greek.db, gloss "love" returned) — the harness
//    doesn't model that path being fed at all right now, so this case's 0-result outcome is
//    reporting a limitation of the eval, not a real product bug.
//
// WHAT THE RIGHT METRIC WOULD BE: for each `strongs` case, resolve the expected Strong's ID
// (add an `expectedStrongsId?: string` field to EvalCase — e.g. 'G26' for agape, 'H8451' for
// torah) and score hit/miss on `response.strongsCard?.strongsId === expectedStrongsId`, entirely
// separate from `response.results`. The harness would ALSO want to feed `strongsNum` into the
// mocked extraction return for these cases specifically (today runOllamaJson's extraction branch
// always returns `strongsNum: undefined` — see runRetrievalEval.ts — so `resolveStrongsNumbers`
// never even gets a candidate ID to verify for ANY case, strongs or otherwise; that's a second,
// separate harness gap worth fixing alongside the metric change). Left unimplemented here
// deliberately — this is a spec for whoever picks it up next, not a fix.

export interface EvalCase {
  id: string
  question: string
  category: 'modern-wording' | 'thematic' | 'pseudepigrapha' | 'strongs' | 'reference' | 'regression' | 'zero-overlap'
  keywords: string[]
  expected: Array<{ textId: string; bookId: string; chapter: number; verse: number }>
  notes?: string
  /** category:'strongs' only — the correct answer, scored against
   *  `response.strongsCard?.strongsNum`, separate from `expected`/`response.results`. See the
   *  METHODOLOGY GAP comment above: `expected` on a strongs case is illustrative, not the real
   *  target; this field is. Verified against the real lexicon DB before being set on each case —
   *  see runRetrievalEval.ts's own "Strong's ID resolution" report section. */
  expectedStrongsId?: string
}

const kjva = (bookId: string, chapter: number, verse: number) => ({ textId: 'kjva', bookId, chapter, verse })

export const EVAL_CASES: EvalCase[] = [
  // ---- Modern-wording (answer shares no/almost no literal words with the KJV) ----
  { id: 'mw-anxiety', category: 'modern-wording', question: 'what does the Bible say about anxiety',
    keywords: ['take no thought', 'be careful for nothing', 'casting all your care'],
    expected: [kjva('MAT', 6, 25), kjva('MAT', 6, 34), kjva('PHP', 4, 6), kjva('1PE', 5, 7)] },
  // Reported by Michael as a live failure: the right verse DID come back, just not first, in both
  // fast and Deep search. Rev 9:6 is the direct answer ("shall seek death, and shall not find
  // it"); Job 3:21 ("which long for death, but it cometh not") is the same idea; Prov 21:6 also
  // contains the literal phrase "seek death" verbatim ("...tossed to and fro of them that seek
  // death") and is a genuine, independently-relevant answer, not noise — added to `expected`
  // after the root-cause fix below made it rank ahead of Rev 9:6 on tied literal-phrase score; a
  // real tie between two true positives isn't something to force an artificial order onto.
  //
  // ROOT CAUSE (found and fixed): the model's realistic, loosely-phrased keywords all happen to
  // contain the word "death" — and `getArchaicVariants` maps a whole list of modern synonyms
  // (`['died', 'death', 'passed away', 'dying']`) onto ONE fixed archaic phrase for `t_jacob`
  // ('steal away from his body', a genuine idiom in TJAC 1:5). Because keywords are scored in an
  // outer loop and each contributes its own score independently, all three near-synonymous
  // keywords re-triggered the SAME archaic phrase against the SAME candidate — one underlying
  // textual match counted three times (score 3), enough to outrank Rev 9:6's single literal hit
  // (score 2). Fixed in `keywordOverlapScore` (aiLookup.ts) by deduping archaic-bridge phrase
  // credit across the whole keyword set per candidate — a phrase already credited from an earlier
  // keyword can't be re-credited by a later, near-synonymous one. Literal variants are
  // deliberately NOT deduped the same way: two keywords each matching their own distinct exact
  // wording in the same verse genuinely are two independent pieces of evidence.
  //
  // DELIBERATE DEVIATION from this file's idealised-keyword convention above: this case
  // intentionally supplies the loose, realistic keywords an 8B model actually emits, specifically
  // so the fixture set could see this class of failure — every other case here supplies
  // hand-idealised keywords and so cannot.
  { id: 'mw-desire-death', category: 'modern-wording', question: 'where does it talk about people desiring death but wont find it',
    keywords: ['desiring death', 'seek death', 'cannot find death'],
    expected: [kjva('REV', 9, 6), kjva('JOB', 3, 21), kjva('PRO', 21, 6)] },
  { id: 'mw-worry', category: 'modern-wording', question: 'I keep worrying about tomorrow, what does scripture say',
    keywords: ['take no thought for the morrow', 'sufficient unto the day'],
    expected: [kjva('MAT', 6, 34), kjva('MAT', 6, 25), kjva('PHP', 4, 6)] },
  { id: 'mw-money', category: 'modern-wording', question: 'what does the Bible teach about money and greed',
    keywords: ['cannot serve God and mammon', 'love of money'],
    expected: [kjva('MAT', 6, 24), kjva('LUK', 16, 13), kjva('1TI', 6, 10)] },
  { id: 'mw-depression', category: 'modern-wording', question: 'what does scripture say about depression and despair',
    keywords: ['heavy heart', 'why art thou cast down', 'spirit is broken'],
    expected: [kjva('PSA', 42, 11), kjva('PRO', 15, 13), kjva('PRO', 17, 22)] },
  { id: 'mw-selfcontrol', category: 'modern-wording', question: 'what does the Bible say about self-control',
    keywords: ['temperance', 'rule over his own spirit'],
    expected: [kjva('GAL', 5, 23), kjva('PRO', 25, 28), kjva('2PE', 1, 6)] },
  { id: 'mw-gossip', category: 'modern-wording', question: 'what does the Bible say about gossip',
    keywords: ['talebearer', 'whisperer separateth chief friends'],
    expected: [kjva('PRO', 16, 28), kjva('PRO', 20, 19), kjva('PRO', 11, 13)] },
  { id: 'mw-addiction', category: 'modern-wording', question: 'what does the Bible say about addiction to alcohol',
    keywords: ['not given to much wine', 'drunkard', 'wine is a mocker'],
    expected: [kjva('PRO', 20, 1), kjva('1TI', 3, 8), kjva('EPH', 5, 18)] },
  { id: 'mw-pride', category: 'modern-wording', question: 'what does the Bible say about pride',
    keywords: ['pride goeth before destruction', 'haughty spirit before a fall'],
    expected: [kjva('PRO', 16, 18)] },
  { id: 'mw-jealousy', category: 'modern-wording', question: 'what does the Bible say about jealousy and envy',
    keywords: ['envy is the rottenness of the bones', 'wrath is cruel, and anger is outrageous'],
    expected: [kjva('PRO', 14, 30), kjva('PRO', 27, 4)] },
  { id: 'mw-fasting', category: 'modern-wording', question: 'why does fasting not seem to work for me',
    keywords: ['wherefore have we fasted', 'in the day of your fast ye find pleasure'],
    expected: [kjva('ISA', 58, 3)] },

  // ---- Thematic — spanning many books ----
  { id: 'th-sabbath-command', category: 'thematic', question: 'what does the Bible say about keeping the Sabbath',
    keywords: ['remember the sabbath day, to keep it holy', 'the sabbath of the Lord'],
    expected: [kjva('EXO', 20, 8), kjva('LEV', 23, 3)] },
  { id: 'th-feasts', category: 'thematic', question: 'what are the feasts of the Lord in Leviticus',
    keywords: ['these are the feasts of the Lord', 'holy convocations'],
    expected: [kjva('LEV', 23, 4), kjva('LEV', 23, 2)] },
  { id: 'th-clean-unclean', category: 'thematic', question: 'what animals are clean and unclean to eat',
    keywords: ['parteth the hoof, and cheweth the cud', 'these shall ye eat'],
    expected: [kjva('LEV', 11, 2), kjva('LEV', 11, 3), kjva('DEU', 14, 3)] },
  { id: 'th-divine-name', category: 'thematic', question: 'what is the divine name of God',
    keywords: ['I AM THAT I AM', 'whose name alone is Jehovah'],
    expected: [kjva('EXO', 3, 14), kjva('PSA', 83, 18)] },
  { id: 'th-grace', category: 'thematic', question: 'what does the Bible say grace is',
    keywords: ['the grace of God that bringeth salvation hath appeared'],
    expected: [kjva('TIT', 2, 11)] },
  { id: 'th-tithing', category: 'thematic', question: 'what does the Bible say about tithing',
    keywords: ['bring ye all the tithes into the storehouse'],
    expected: [kjva('MAL', 3, 10)] },
  { id: 'th-circumcision', category: 'thematic', question: 'what does the Bible say about circumcision',
    keywords: ['every man child among you shall be circumcised'],
    expected: [kjva('GEN', 17, 10)] },
  { id: 'th-idolatry', category: 'thematic', question: 'what does the Bible say about making graven images',
    keywords: ['thou shalt not make unto thee any graven image'],
    expected: [kjva('EXO', 20, 4)] },
  { id: 'th-adultery', category: 'thematic', question: 'what does the Bible say about adultery',
    keywords: ['thou shalt not commit adultery'],
    expected: [kjva('EXO', 20, 14)] },
  { id: 'th-false-witness', category: 'thematic', question: 'what does the Bible say about bearing false witness',
    keywords: ['thou shalt not bear false witness against thy neighbour'],
    expected: [kjva('EXO', 20, 16)] },
  { id: 'th-love-neighbor', category: 'thematic', question: 'what does the Bible say about loving your neighbor',
    keywords: ['thou shalt love thy neighbour as thyself'],
    expected: [kjva('LEV', 19, 18)] },
  { id: 'th-fruit-of-spirit', category: 'thematic', question: 'what is the fruit of the Spirit',
    keywords: ['the fruit of the Spirit is love, joy, peace'],
    expected: [kjva('GAL', 5, 22), kjva('GAL', 5, 23)] },
  { id: 'th-wisdom', category: 'thematic', question: 'what does the Bible say about wisdom',
    keywords: ['he that walketh with wise men shall be wise', 'the fear of the Lord is the beginning'],
    expected: [kjva('PRO', 13, 20), kjva('PRO', 9, 10), kjva('JAS', 1, 5), kjva('ECC', 7, 12)],
    notes: 'Regression-locks Team B item 2a: WIS (Wisdom of Solomon) sharing the plain-English word "wisdom" must not confine this to the Apocrypha alone — Proverbs/James/Ecclesiastes must remain reachable.' },
  { id: 'th-heaven', category: 'thematic', question: 'what does the Bible say about heaven',
    keywords: ['new heaven and a new earth', 'many mansions'],
    expected: [kjva('REV', 21, 1), kjva('JHN', 14, 2)] },
  { id: 'th-love', category: 'thematic', question: 'what does the Bible say about love',
    keywords: ['charity suffereth long, and is kind', 'perfect love casteth out fear'],
    expected: [kjva('1CO', 13, 4), kjva('1JN', 4, 18)],
    notes: 'Regression-locks Team B item 2b: OVERLY_GENERIC_SINGLE_WORDS deleting "love" outright must not zero out the one real topical term in the question.' },

  // ---- Pseudepigrapha (non-canonical DBs) ----
  { id: 'ps-enoch-watchers', category: 'pseudepigrapha', question: 'what does Enoch say about the Watchers',
    keywords: ['the Watchers', 'children of the Watchers'],
    expected: [{ textId: 'enoch', bookId: 'ENO', chapter: 12, verse: 2 }, { textId: 'enoch', bookId: 'ENO', chapter: 10, verse: 15 }, { textId: 'enoch', bookId: 'ENO', chapter: 16, verse: 2 }, { textId: 'enoch', bookId: 'ENO', chapter: 1, verse: 5 }, { textId: 'enoch', bookId: 'ENO', chapter: 15, verse: 2 }] },
  { id: 'ps-jubilees-sabbath', category: 'pseudepigrapha', question: 'what does Jubilees say about the Sabbath',
    keywords: ['keep Sabbath on the seventh day', 'the Sabbath day, that we should work six days'],
    expected: [{ textId: 'jubilees', bookId: 'JUB', chapter: 2, verse: 17 }, { textId: 'jubilees', bookId: 'JUB', chapter: 2, verse: 31 }, { textId: 'jubilees', bookId: 'JUB', chapter: 2, verse: 20 }, { textId: 'jubilees', bookId: 'JUB', chapter: 2, verse: 21 }, { textId: 'jubilees', bookId: 'JUB', chapter: 2, verse: 30 }] },
  { id: 'ps-jubilees-feast-of-weeks', category: 'pseudepigrapha', question: 'what does Jubilees say about the feast of weeks',
    keywords: ['the feast of weeks', 'feast of first fruits'],
    expected: [{ textId: 'jubilees', bookId: 'JUB', chapter: 6, verse: 21 }, { textId: 'jubilees', bookId: 'JUB', chapter: 6, verse: 17 }, { textId: 'jubilees', bookId: 'JUB', chapter: 22, verse: 1 }] },
  { id: 'ps-t12p-reuben', category: 'pseudepigrapha', question: 'what does the Testament of Reuben say about repentance',
    keywords: ['repent', 'seven years I repented'],
    expected: [{ textId: 't12p', bookId: 'TREU', chapter: 1, verse: 10 }],
    notes: 'Verify exact verse before trusting a top-1 miss here — book/chapter located via FTS, not hand-memorized; treat this case as lower-confidence than the others (flagged, not independently re-checked verse-by-verse the way the others above were).' },
  { id: 'ps-didache-two-ways', category: 'pseudepigrapha', question: 'what does the Didache say about the two ways',
    keywords: ['two ways', 'way of life and the way of death'],
    expected: [{ textId: 'didache_hoole', bookId: 'DID', chapter: 1, verse: 1 }] },

  // ---- Strong's / lexicon questions ----
  { id: 'st-grace-hebrew', category: 'strongs', question: 'what does the Hebrew word for grace mean',
    keywords: ['grace'],
    expected: [kjva('GEN', 6, 8)],
    expectedStrongsId: 'H2580', // verified: literal {H2580} tag on Gen 6:8's "grace"
    notes: 'H2580 chen — no single canonical anchor verse; scored via strongsNum resolution (H2580), not keyword search. See notes in retrievalEval for how strongs-category cases are checked (gloss + occurrence lookup, not a single expected verse).' },
  { id: 'st-agape-greek', category: 'strongs', question: 'what does agape mean in Greek',
    keywords: ['agape', 'love'],
    expected: [kjva('1CO', 13, 4)],
    expectedStrongsId: 'G26', // verified: strongs_greek.db word=ἀγάπη, transliteration=agápē
    notes: 'G26 agape — checked via lexicon gloss resolution, not keyword search; expected verse is illustrative only.' },
  { id: 'st-mammon', category: 'strongs', question: 'what is mammon in the Bible',
    keywords: ['mammon'],
    expected: [kjva('MAT', 6, 24), kjva('LUK', 16, 13), kjva('LUK', 16, 9)],
    expectedStrongsId: 'G3126', // verified: strongs_greek.db transliteration=mammōnâs
    notes: '"what is X" is deliberately NOT matched by WORD_MEANING_TRIGGER (too broad a shape — would fire on ordinary topical questions too), so this case is expected to show no strongsCard; it is scored on expected verses instead, which the keyword "mammon" finds directly via FTS.' },
  { id: 'st-yhwh', category: 'strongs', question: 'what does the Hebrew name YHWH mean',
    keywords: ['Jehovah', 'I AM THAT I AM'],
    expected: [kjva('EXO', 3, 14), kjva('PSA', 83, 18)],
    expectedStrongsId: 'H3068' },
  // expectedStrongsId G3309 verified (literal {G3309|G3361} tag on Matt 6:25's "thought") but
  // EXPECTED TO MISS: the gloss/transliteration bridge answers "what does word X mean", not "what
  // is the word BEHIND phrase X in VERSE Y" — a verse-specific lookup this pass didn't build, not
  // a bare word lookup. Kept as an honest, documented miss rather than force-fit into the wrong
  // mechanism.
  { id: 'st-anxious-greek', category: 'strongs', question: 'what is the Greek word translated take no thought in Matthew 6',
    keywords: ['take no thought'],
    expectedStrongsId: 'G3309',
    expected: [kjva('MAT', 6, 25)],
    notes: 'G3309 merimnao — this is Team B item 2c\'s worked example: the gloss bridge should surface Matt 6:25 for an "anxious/worry" question even with zero literal word overlap.' },

  // ---- Reference / quote lookups — must stay instant + exact, zero-model-call path ----
  { id: 'ref-gen11', category: 'reference', question: 'Gen 1:1', keywords: [], expected: [kjva('GEN', 1, 1)] },
  { id: 'ref-john316', category: 'reference', question: 'John 3:16', keywords: [], expected: [kjva('JHN', 3, 16)] },
  { id: 'ref-exodus20', category: 'reference', question: 'Exodus 20', keywords: [], expected: [kjva('EXO', 20, 1)] },
  { id: 'ref-rev22-range', category: 'reference', question: 'Rev 22:1-5', keywords: [], expected: [kjva('REV', 22, 1)] },
  { id: 'ref-matt24-quotes', category: 'reference', question: 'what does Matthew 24 quote', keywords: [],
    expected: [kjva('MAT', 24, 15)],
    notes: 'QUOTE_TRIGGER path (findReferenceInText + runQuoteLookup) — exercise separately from keyword retrieval; see retrievalEval for how this category is scored (reference resolution, not FTS).' },

  // ---- Regression-lock: denylist words that are also the ONLY real term in the question ----
  { id: 'rg-sin', category: 'regression', question: 'what does the Bible say about sin',
    keywords: ['whosoever committeth sin', 'sin is the transgression of the law'],
    expected: [kjva('1JN', 3, 4), kjva('ROM', 6, 23)],
    notes: 'OVERLY_GENERIC_THEMATIC_WORDS includes "sin" — this question has no OTHER real term to fall back on.' },
  { id: 'rg-righteousness', category: 'regression', question: 'what does the Bible say about righteousness',
    keywords: ['the righteous shall live by faith', 'righteousness exalteth a nation'],
    expected: [kjva('ROM', 1, 17), kjva('PRO', 14, 34), kjva('HAB', 2, 4)] },
  { id: 'rg-king', category: 'regression', question: 'what does the Bible say about being a king',
    keywords: ['he shall not multiply horses to himself', 'the king\'s heart is in the hand of the Lord'],
    expected: [kjva('DEU', 17, 16), kjva('PRO', 21, 1)] },
  { id: 'rg-father', category: 'regression', question: 'what does the Bible say about honoring your father',
    keywords: ['honour thy father and thy mother'],
    expected: [kjva('EXO', 20, 12)] },
  { id: 'rg-heaven2', category: 'regression', question: 'what does the Bible say happens in heaven',
    keywords: ['new heaven and a new earth', 'no more death, neither sorrow'],
    expected: [kjva('REV', 21, 1), kjva('REV', 21, 4)] },
  { id: 'rg-evil', category: 'regression', question: 'what does the Bible say about evil',
    keywords: ['abhor that which is evil', 'depart from evil, and do good'],
    expected: [kjva('ROM', 12, 9), kjva('PSA', 34, 14)] },
  { id: 'rg-holiness', category: 'regression', question: 'what does the Bible say about holiness',
    keywords: ['be ye holy; for I am holy', 'follow holiness, without which no man shall see the Lord'],
    expected: [kjva('1PE', 1, 16), kjva('HEB', 12, 14)] },
  // Every rg-* case above uses idealised MULTI-WORD keywords, so none of them actually exercises
  // OVERLY_GENERIC_SINGLE_WORDS — a SEPARATE, harsher list from OVERLY_GENERIC_THEMATIC_WORDS
  // ('sin'/'righteousness'/'evil'/'holiness' above are down-weighted via requireSpecificEvidence,
  // never removed from search). A keyword that reduces to exactly ONE word from
  // OVERLY_GENERIC_SINGLE_WORDS ('love', 'father', 'king', 'heaven', 'god', 'lord', ...) is
  // filtered OUT of `effectiveKeywords` entirely by filterGenericKeywords before search ever
  // runs — the literal bug Michael reported: "what does the Bible say about love" has its only
  // real term deleted before search. This case supplies exactly that bare single word, the
  // shape a real extraction call produces when the question genuinely has no other content word
  // to reach for. Both expected refs verified via direct FTS `"love"` query AND by reading the
  // raw verse text — 1 Cor 13:4 was deliberately NOT added here despite being the obvious answer
  // a human would expect, because KJV renders that whole chapter "charity", never "love" — a bare
  // "love" keyword genuinely cannot and should not find it lexically; that gap is exactly what
  // the Strong's-gloss-bridge task (separate from this one) exists to close.
  { id: 'rg-love-bare', category: 'regression', question: 'does scripture say anything about love',
    keywords: ['love'],
    expected: [kjva('1JN', 4, 18), kjva('1JN', 4, 8)] },

  // ---- Round 2 additions (team-lead: grow to ~70, weight thematic/modern-wording, and
  // Michael's own subject matter — Torah observance, feast days, sha'atnez, clean/unclean,
  // divine name restoration, the refreshing of the covenant, grace as divine influence,
  // Sabbath perpetuity). Same verification discipline as round 1: every `expected` ref checked
  // against the real kjva.db/pseudepigrapha db with a direct FTS5 query first.

  // -- modern-wording (+5) --
  { id: 'mw-gluttony', category: 'modern-wording', question: 'what does the Bible say about overeating',
    keywords: ['the drunkard and the glutton shall come to poverty', 'riotous eaters of flesh'],
    expected: [kjva('PRO', 23, 21), kjva('PRO', 23, 20)] },
  { id: 'mw-lying', category: 'modern-wording', question: 'what does the Bible say about being dishonest',
    keywords: ['lying lips are abomination', 'a lying tongue'],
    expected: [kjva('PRO', 12, 22), kjva('PRO', 6, 17)] },
  { id: 'mw-forgiveness', category: 'modern-wording', question: 'what does the Bible say about letting go of a grudge',
    keywords: ['if ye forgive men their trespasses', 'forgiving one another, even as God for Christ’s sake hath forgiven you'],
    expected: [kjva('MAT', 6, 14), kjva('MAT', 6, 15), kjva('EPH', 4, 32)] },
  { id: 'mw-anger', category: 'modern-wording', question: 'how should I deal with my temper',
    keywords: ['be ye angry, and sin not', 'he that is slow to anger is better than the mighty'],
    expected: [kjva('EPH', 4, 26), kjva('EPH', 4, 31), kjva('PRO', 16, 32)] },
  { id: 'mw-laziness', category: 'modern-wording', question: 'what does the Bible say about being lazy and unmotivated',
    keywords: ['go to the ant, thou sluggard', 'the field of the slothful'],
    expected: [kjva('PRO', 6, 6), kjva('PRO', 24, 30), kjva('PRO', 24, 31)] },

  // -- thematic (+10), weighted toward Michael's own subject matter --
  { id: 'th-shatnez', category: 'thematic', question: 'what does the Bible say about mixing wool and linen in clothing',
    keywords: ['thou shalt not wear a garment of divers sorts', 'garment mingled of linen and woollen'],
    expected: [kjva('LEV', 19, 19), kjva('DEU', 22, 11)] },
  { id: 'th-torah-not-abolished', category: 'thematic', question: 'did Yeshua do away with the Torah',
    keywords: ['think not that I am come to destroy the law', 'one jot or one tittle shall in no wise pass from the law'],
    expected: [kjva('MAT', 5, 17), kjva('MAT', 5, 18), kjva('MAT', 5, 19)] },
  { id: 'th-clean-fish', category: 'thematic', question: 'what does the Bible say about eating shellfish',
    keywords: ['whatsoever hath fins and scales', 'whatsoever hath no fins nor scales'],
    expected: [kjva('LEV', 11, 9), kjva('LEV', 11, 10), kjva('LEV', 11, 12)] },
  { id: 'th-feast-trumpets', category: 'thematic', question: 'what is the feast of trumpets',
    keywords: ['a memorial of blowing of trumpets', 'in the seventh month, in the first day of the month'],
    expected: [kjva('LEV', 23, 24)] },
  { id: 'th-day-of-atonement', category: 'thematic', question: 'what is the Day of Atonement',
    keywords: ['ye shall afflict your souls', 'a day of atonement'],
    expected: [kjva('LEV', 16, 29), kjva('LEV', 16, 30), kjva('LEV', 16, 31), kjva('LEV', 23, 27)] },
  { id: 'th-passover', category: 'thematic', question: 'what does the Bible say about Passover',
    keywords: ['this day shall be unto you for a memorial', 'the Lord’s passover'],
    expected: [kjva('EXO', 12, 14), kjva('LEV', 23, 5)] },
  { id: 'th-unleavened-bread', category: 'thematic', question: 'what is the feast of unleavened bread',
    keywords: ['seven days shall ye eat unleavened bread', 'the feast of unleavened bread'],
    expected: [kjva('EXO', 12, 15), kjva('LEV', 23, 6)] },
  { id: 'th-refreshing', category: 'thematic', question: 'what does it mean to be in the times of refreshing',
    keywords: ['repent ye therefore, and be converted', 'the times of refreshing shall come'],
    expected: [kjva('ACT', 3, 19)] },
  { id: 'th-grace-divine-influence', category: 'thematic', question: 'what does grace actually teach us to do',
    keywords: ['teaching us that, denying ungodliness and worldly lusts', 'zealous of good works'],
    expected: [kjva('TIT', 2, 12), kjva('TIT', 2, 13), kjva('TIT', 2, 14), kjva('TIT', 2, 11)],
    notes: 'The full Titus 2:11-14 grace passage (already partly covered by th-grace above, which only anchors on 2:11) — grace as divine influence upon the heart, not mere unmerited favor.' },
  { id: 'th-sabbath-perpetual', category: 'thematic', question: 'is the Sabbath still binding today or was it only for Israel then',
    keywords: ['a perpetual covenant', 'a sign between me and the children of Israel for ever'],
    expected: [kjva('EXO', 31, 16), kjva('EXO', 31, 17)] },

  // -- pseudepigrapha (+3) --
  { id: 'ps-jubilees-covenant', category: 'pseudepigrapha', question: 'what does Jubilees say about the everlasting covenant',
    keywords: ['everlasting covenant', 'I will establish My covenant'],
    expected: [{ textId: 'jubilees', bookId: 'JUB', chapter: 15, verse: 19 }] },
  { id: 'ps-hermas-repentance', category: 'pseudepigrapha', question: 'what does the Shepherd of Hermas say about repentance',
    keywords: ['repentance', 'the repentance of the righteous has limits'],
    expected: [{ textId: 'hermas', bookId: 'HER_VIS', chapter: 6, verse: 5 }, { textId: 'hermas', bookId: 'HER_MAN', chapter: 2, verse: 6 }, { textId: 'hermas', bookId: 'HER_SIM', chapter: 47, verse: 5 }] },
  { id: 'ps-jubilees-feast-weeks-covenant', category: 'pseudepigrapha', question: 'why does Jubilees connect the feast of weeks to the covenant',
    keywords: ['renew the covenant every year', 'celebrate the feast of weeks in this month once a year'],
    expected: [{ textId: 'jubilees', bookId: 'JUB', chapter: 6, verse: 17 }] },

  // -- Strong's / lexicon (+3) --
  // expectedStrongsId H8451 verified (short_def "law." — the actual right answer) but EXPECTED TO
  // MISS: H8451's own transliteration is "tôwrâh" (academic, with a consonantal vav spelled "w"),
  // not the popular English spelling "torah" — normalizeTransliteration reduces it to "towrah",
  // which never matches the keyword "torah". Tier 2 (gloss) then has to choose among every entry
  // whose short_def merely CONTAINS "law", and picks by occurrence count — H4941 "mishpat"
  // (290 occurrences) beats H8451 itself (163). Documented, known, narrower limitation — see
  // bridgeByGloss's own comment for why occurrence-count tie-breaking was kept despite this case
  // (a gloss-length-based tie-break fixed torah but broke two OTHER already-correct cases).
  { id: 'st-torah-hebrew', category: 'strongs', question: 'what does the Hebrew word Torah actually mean',
    keywords: ['torah', 'law'],
    expectedStrongsId: 'H8451',
    expected: [kjva('PSA', 119, 1)],
    notes: 'H8451 towrah — checked via lexicon gloss resolution, not keyword search; expected verse is illustrative only.' },
  { id: 'st-shabbat-hebrew', category: 'strongs', question: 'what does the Hebrew word Shabbat mean',
    keywords: ['sabbath', 'shabbat'],
    expectedStrongsId: 'H7676', // verified: literal {H7676} tag on Exod 20:8's "sabbath"
    expected: [kjva('EXO', 20, 8)],
    notes: 'H7676 shabbath — checked via lexicon gloss resolution, not keyword search; expected verse is illustrative only.' },
  { id: 'st-berith-hebrew', category: 'strongs', question: 'what does the Hebrew word for covenant mean',
    keywords: ['covenant'],
    expectedStrongsId: 'H1285',
    expected: [kjva('EXO', 31, 16)],
    notes: 'H1285 beriyth — checked via lexicon gloss resolution, not keyword search; expected verse is illustrative only.' },

  // -- reference / quote lookups (+2) --
  { id: 'ref-deut64', category: 'reference', question: 'Deut 6:4', keywords: [], expected: [kjva('DEU', 6, 4)] },
  { id: 'ref-1cor13-range', category: 'reference', question: '1 Corinthians 13:4-7', keywords: [], expected: [kjva('1CO', 13, 4)] },

  // -- zero-overlap (Round: semantic/embedding retrieval, Team C) --
  // Unlike 'modern-wording' above (whose `keywords` are hand-idealised, literal KJV phrases —
  // deliberately the BEST-CASE input for keyword search), these five instead carry the loose,
  // genuinely modern `keywords` a real extraction call would plausibly produce for the QUESTION as
  // asked — words that do NOT appear, even as a synonym/stem, anywhere in the `expected` verse's
  // real text (checked directly against kjva.db; see each case's `notes`). The point is not to
  // show the existing keyword pipeline failing (it's EXPECTED to score 0/5 here, structurally, no
  // ranking improvement can fix that) — it's to give a concrete, DB-verified target for measuring
  // whether the semantic/embedding layer (electron/embeddings.ts, wired in via
  // electron/ipc/semanticCandidates.ts) can find what keyword search structurally cannot. This
  // harness still can't measure that layer directly (Ollama's embedding endpoint isn't mocked
  // here, same gap the file header's METHODOLOGY notes already flag for the extraction step) —
  // these cases exist so a FUTURE embedding-aware harness pass has real, pre-verified fixtures
  // ready to use, and so this round's manual/report-only measurement (see the mission report) had
  // concrete, reproducible cases to check by hand.
  { id: 'zo-burnout', category: 'zero-overlap', question: 'what does the Bible say about burnout from doing too much',
    keywords: ['burnout', 'overwhelmed from doing too much'],
    expected: [kjva('EXO', 18, 18)],
    notes: 'Exod 18:18 (Jethro to Moses): "Thou wilt surely wear away... this thing is too heavy for thee; thou art not able to perform it thyself alone." Zero literal overlap with "burnout"/"overwhelmed" — verified against kjva.db.' },
  { id: 'zo-purposelessness', category: 'zero-overlap', question: 'what does the Bible say about feeling like life has no meaning or purpose',
    keywords: ['meaning of life', 'purposeless', 'pointless existence'],
    expected: [kjva('ECC', 1, 2)],
    notes: 'Eccl 1:2: "Vanity of vanities, saith the Preacher, vanity of vanities; all is vanity." Zero literal overlap with "meaning"/"purpose"/"pointless" — verified against kjva.db.' },
  { id: 'zo-introvert-alone-time', category: 'zero-overlap', question: 'what does the Bible say about needing alone time as an introvert',
    keywords: ['introvert', 'need to be alone', 'social exhaustion'],
    expected: [kjva('MRK', 6, 31)],
    notes: 'Mark 6:31: "Come ye yourselves apart into a desert place, and rest a while: for there were many coming and going, and they had no leisure so much as to eat." Zero literal overlap with "introvert"/"alone time"/"social exhaustion" — verified against kjva.db.' },
  { id: 'zo-imposter-syndrome', category: 'zero-overlap', question: 'what does the Bible say about feeling like an imposter or unqualified for what God has called you to do',
    keywords: ['imposter syndrome', 'feeling unqualified', 'not good enough'],
    expected: [kjva('EXO', 4, 10), kjva('JER', 1, 6)],
    notes: 'Exod 4:10 (Moses): "I am not eloquent... I am slow of speech, and of a slow tongue." Jer 1:6 (Jeremiah): "I cannot speak: for I am a child." Zero literal overlap with "imposter"/"unqualified" — verified against kjva.db.' },
  { id: 'zo-wicked-prosper', category: 'zero-overlap', question: 'why does it seem like bad people get away with everything',
    keywords: ['bad people getting away with it', 'unfair that evil people succeed'],
    expected: [kjva('PSA', 73, 3)],
    notes: 'Psa 73:3: "For I was envious at the foolish, when I saw the prosperity of the wicked." Zero literal overlap with "get away with"/"unfair"/"succeed" — verified against kjva.db.' },

  // ---- TSKE headings / cross_references.db as ACTIVE retrieval (Team C, task #11) ----
  //
  // Different mechanism from the zo-* cases above (which test the SEMANTIC/embedding layer for
  // modern colloquial phrasing with no curated bridge at all): these test the two NEW
  // deterministic, offline bridges — searchTskeHeadingCandidates and expandCrossRefNeighbors in
  // aiLookup.ts. Each `expected` verse was checked directly against the real tske_refs.db /
  // cross_references.db (not just kjva.db) before being added — see the sqlite3 queries in the
  // Team C session log. Both keep the same "zero literal overlap with the keywords" discipline
  // the zo-* cases already established, so a regression that silently falls back to pure keyword
  // search would show up here exactly the same way.
  { id: 'tske-prince-of-peace', category: 'zero-overlap', question: 'what did Isaiah prophesy about the child who would be called the prince of peace',
    keywords: ['prince of peace'],
    expected: [kjva('ISA', 11, 6)],
    notes: 'TSKE heading "The Prince of Peace" (from Isa 9:6, the only literal occurrence of the phrase in kjva.db — verified via FTS5) groups Isa 11:6 among its cross-references — but Isa 11:6 itself ("The wolf also shall dwell with the lamb, and the leopard shall lie down with the kid...") contains none of "prince"/"of"/"peace" literally. Deliberately picked over a heading like "a good understanding" (tried first, discarded): that one has 4+ real literal keyword matches of its own, which already fill TOTAL_PRIMARY_CAP=6 before the TSKE-sourced widening candidates ever get room to show — this heading has exactly ONE literal match (the anchor itself, Isa 9:6, not in `expected`), leaving room. Only findable via searchTskeHeadingCandidates matching the HEADING text, not the verse text — verified directly against tske_refs.db and kjva.db.' },
  { id: 'xref-stripes-healed', category: 'zero-overlap', question: 'what did the prophets say would happen to the Messiah that would bring healing',
    keywords: ['with his stripes we are healed'],
    expected: [kjva('1PE', 3, 18)],
    notes: 'Tests expandCrossRefNeighbors (seed-and-expand widening). Picked over a Gen 1:1 -> Heb 11:3 pair (tried first, discarded): "heaven"/"earth"/"god"/"created"/"beginning" are common enough words that keywordOverlapScore\'s \'all\'-mode fallback kept pulling in 5 coincidental non-canonical keyword hits, filling TOTAL_PRIMARY_CAP=6 before any widening candidate got room to show at all — this phrase\'s rarer words ("stripes", "healed") don\'t have that problem, verified directly. The literal phrase "with his stripes we are healed" phrase-matches ONLY Isa 53:5 in kjva.db, the real anchor. cross_references.db records Isa 53:5 -> 1Pe 3:18 at 128 votes (the #2 neighbor by combined outgoing+incoming votes, so it clears CROSS_REF_EXPAND_PER_ANCHOR_CAP=2 as well as the min-vote floor) — pulled in as a `cross-ref-seed` candidate. 1Pe 3:18 ("For Christ also hath once suffered for sins, the just for the unjust...") shares none of "stripes"/"healed"/"with"/"we"/"are" with the keyword phrase — verified directly against kjva.db. Isa 53:5 itself and 1Pe 2:24 (the #1 neighbor, 244 votes, which DOES literally share "stripes"/"healed") are both deliberately excluded from `expected` — either would pass via a path this fixture isn\'t trying to test.' },
]

export const EVAL_CASE_COUNT = EVAL_CASES.length
