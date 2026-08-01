export interface AnnotationKey {
  key: string
  symbol: string
  meaning: string
}

export const ANNOTATION_KEYS: Record<string, { canHide: boolean; description?: string; keys: AnnotationKey[] }> = {
  kjva: {
    canHide: true,
    keys: [
      { key: 'kjva_italics', symbol: 'italic', meaning: 'Words supplied by KJV translators — not present in the Hebrew or Greek source text. Shown in italics when visible.' },
    ],
  },
  lxx: {
    canHide: true,
    keys: [
      { key: 'lxx_supply', symbol: '[word]', meaning: 'Word supplied by the translator — not present in the Greek Septuagint text.' },
    ],
  },
  enoch: {
    canHide: true,
    keys: [
      { key: 'enoch_supply',    symbol: '(word)',  meaning: 'Word supplied or paraphrased for clarity by the translator.' },
      { key: 'enoch_uncertain', symbol: '[word]',  meaning: 'Textually uncertain or reconstructed passage.' },
      { key: 'enoch_restored',  symbol: '〈word〉', meaning: 'Text restored from Ethiopic manuscripts.' },
    ],
  },
  jubilees: {
    canHide: true,
    keys: [
      { key: 'jubilees_date',     symbol: '[1307 A.M.]', meaning: 'Anno Mundi — "Year of the World." Chronological dates from creation embedded in the text by R.H. Charles.' },
      { key: 'jubilees_bracket',  symbol: '[word]',      meaning: 'Translator insertion — text added by R.H. Charles for clarity or to supply repeated/parallel wording.' },
      { key: 'jubilees_supply',   symbol: '(word)',      meaning: 'Word or phrase supplied by the translator; not in the Ethiopic source but implied by context.' },
      { key: 'jubilees_stanza',   symbol: '(b) (c) …',  meaning: 'Stanza marker — single letter in parentheses dividing lines of embedded poetry (e.g. blessings, songs).' },
      { key: 'jubilees_restored', symbol: '<word>',      meaning: 'Text restored from other manuscript witnesses where the Ethiopic is defective or missing.' },
    ],
  },
  apoc_elijah: {
    canHide: false,
    description: 'Trans. O.S. Wintermute. 5 chapters with standard verse numbering. Verse 1 of each chapter begins immediately after the chapter heading.',
    keys: [],
  },
  asc_isaiah: {
    canHide: false,
    description: 'Trans. R.H. Charles (1900). 11 chapters with standard verse numbering.',
    keys: [
      { key: 'asc_isaiah_brackets', symbol: '[ ]', meaning: 'Text supplied or restored by the translator from other manuscript witnesses.' },
    ],
  },
  ep_barnabas: {
    canHide: false,
    description: "Trans. Samuel Sharpe (1880), from the Sinaitic Manuscript. Verse breaks follow the '/' separators in the Sharpe translation; verse counts differ from the Hoole/Lightfoot edition.",
    keys: [],
  },
  t12p: {
    canHide: false,
    description: 'Trans. R.H. Charles (1908). Each testament is a separate book (Reuben, Simeon, Levi…). Verse numbers follow the Charles chapter.verse scheme.',
    keys: [],
  },
  recog_clement: {
    canHide: false,
    description: 'Ante-Nicene Fathers edition. Organized by Book (I–X) and Chapter. Each "verse" shown here is a paragraph-sized passage — no traditional verse numbers exist in the source.',
    keys: [],
  },
  hermas: {
    canHide: false,
    description: 'Ante-Nicene Fathers edition (Roberts-Donaldson). Divided into Visions, Mandates, and Similitudes. Each "verse" shown here is a paragraph-sized passage — no traditional verse numbers exist in the source.',
    keys: [],
  },
  hermas_taylor: {
    canHide: false,
    description: 'Trans. Charles Taylor (1903–1906), from the Greek. Visions, Mandates, and Similitudes with Taylor’s own finer sentence-level verse divisions (Similitude 7 included). Best-effort OCR ingest — some chapters are flagged for proofreading.',
    keys: [],
  },
  gad: {
    canHide: true,
    description: "Trans. Beir Bar-Ilan, from Cambridge MS Add. 00.1.20 (Hebrew, copied at Cochin, India, 18th century). Presents itself as a supplement to the Chronicles of Gad the Seer (1 Chr 29:29). 14 chapters.",
    keys: [
      { key: 'gad_direct_speech', symbol: "' ... '", meaning: "Direct prophetic speech — single-quote marks set off divine oracles and angelic utterances. These are part of the source text, not editorial additions." },
    ],
  },
  t_job: {
    canHide: true,
    description: "Trans. M.R. James (1897), from the Greek Pseudepigrapha. An expanded retelling of the Job tradition — Job's farewell address to his children. 12 chapters. Verse numbering follows the James edition; minor boundary differences from later critical editions (Kraft, Schaller) may exist.",
    keys: [
      { key: 't_job_brackets', symbol: '[word]', meaning: 'Text supplied or restored by the translator — not in the Greek manuscript but necessary for sense. E.g. "[And I answered saying]" introduces a speaker where the manuscript is elliptical.' },
      { key: 't_job_parens', symbol: '(word)', meaning: 'Translator clarification or alternate name — e.g. "(Utz)" after "Ausitis", "(deacons)" after "waiters", "(Yemima)" after "Day".' },
    ],
  },
  '1clement': {
    canHide: true,
    description: 'Trans. J.B. Lightfoot (1890). 66 chapters: Chapter 1 is the salutation; Chapters 2–66 follow the traditional 1Clem scheme. Each "verse" is a sentence or short clause — no ancient verse division exists.',
    keys: [
      { key: '1clement_brackets', symbol: '[word]', meaning: 'Text supplied by Lightfoot where the manuscript is damaged or lacunose.' },
    ],
  },
  apoc_abraham: {
    canHide: true,
    description: 'Trans. G.H. Box (1918), from the Slavonic. 32 chapters: 1–8 narrate Abraham’s rejection of his father’s idols; 9–32 the apocalyptic vision. Verse numbering follows the Box edition.',
    keys: [
      { key: 'apoc_abraham_parens', symbol: '(word)', meaning: 'Word supplied by the translator for clarity — not present in the Slavonic source.' },
    ],
  },
  didache_hoole: {
    canHide: false,
    description: 'Trans. Charles H. Hoole (1894). 16 chapters — the Two Ways (1–6), church practice and sacraments (7–10), ministry (11–15), and a closing eschatological warning (16). Verse numbering follows the Hoole edition.',
    keys: [],
  },
  t_jacob: {
    canHide: false,
    description: 'Trans. W.F. Stinespring, in Charlesworth (ed.), Old Testament Pseudepigrapha Vol. 1 ("Testaments of the Three Patriarchs"). 8 chapters. Chapter 5, verses 10–15 are the translator\'s own bracketed summary of a lacuna in the Arabic manuscript, supplied from the Bohairic.',
    keys: [],
  },
  '2baruch': {
    canHide: false,
    description: 'R.H. Charles-based translation (Wesley Center for Applied Theology). 85 chapters, the Syriac Apocalypse of Baruch — distinct from the deuterocanonical 1 Baruch.',
    keys: [],
  },
}

export const TRANSLATIONS = [
  { id: 'kjva',          label: 'KJVA',           description: 'KJV + Apocrypha' },
  { id: 'lxx',           label: 'LXX',            description: 'Brenton Septuagint' },
  { id: 'enoch',         label: '1 Enoch',         description: 'R.H. Charles' },
  { id: 'jubilees',      label: 'Jubilees',        description: 'R.H. Charles' },
  { id: 'apoc_elijah',   label: 'Apoc. Elijah',    description: 'Apocalypse of Elijah' },
  { id: 'recog_clement', label: 'Recog. Clement',  description: 'Recognitions of Clement' },
  { id: 'hermas',        label: 'Hermas',          description: 'Shepherd of Hermas (Roberts-Donaldson)' },
  { id: 'hermas_taylor', label: 'Hermas (Taylor)', description: 'Shepherd of Hermas, trans. Charles Taylor (1903)' },
  { id: 'asc_isaiah',    label: 'Asc. Isaiah',     description: 'Ascension of Isaiah, R.H. Charles' },
  { id: 'ep_barnabas',   label: 'Ep. Barnabas',    description: 'Epistle of Barnabas' },
  { id: 't12p',          label: 'T12 Patriarchs',  description: 'Testaments of the Twelve Patriarchs, R.H. Charles' },
  { id: 'gad',           label: 'Gad the Seer',    description: 'Words of Gad the Seer, trans. Beir Bar-Ilan' },
  { id: 't_job',         label: 'T. Job',           description: 'Testament of Job, trans. M.R. James (1897)' },
  { id: '1clement',      label: '1 Clement',        description: 'First Epistle of Clement to the Corinthians, trans. J.B. Lightfoot' },
  { id: 'apoc_abraham',  label: 'Apoc. Abraham',    description: 'Apocalypse of Abraham, trans. G.H. Box (1918)' },
  { id: 'didache_hoole', label: 'Didache',          description: 'The Teaching of the Twelve Apostles, trans. Charles H. Hoole (1894)' },
  { id: 't_jacob',       label: 'T. Jacob',         description: 'Testament of Jacob, trans. W.F. Stinespring' },
  { id: '2baruch',       label: '2 Baruch',         description: '2 Baruch (Syriac Apocalypse), R.H. Charles-based' },
]

// ── Editions ──────────────────────────────────────────────────────────────────
// An "edition" is a distinct work; most have a single translation (textId), but some
// (e.g. the Shepherd of Hermas) have several. The reference picker shows editions by
// their full name and, only when an edition has more than one translation, a separate
// translation sub-picker.
export interface EditionTranslation { id: string; label: string }
export interface Edition { id: string; label: string; translations: EditionTranslation[] }

export const EDITIONS: Edition[] = [
  { id: 'kjva',          label: 'King James Version (with Apocrypha)', translations: [{ id: 'kjva', label: 'KJV + Apocrypha' }] },
  { id: 'lxx',           label: 'Septuagint (Brenton)',               translations: [{ id: 'lxx', label: 'Brenton LXX' }] },
  { id: 'enoch',         label: '1 Enoch',                            translations: [{ id: 'enoch', label: 'R.H. Charles' }] },
  { id: 'jubilees',      label: 'Jubilees',                           translations: [{ id: 'jubilees', label: 'R.H. Charles' }] },
  { id: 'apoc_elijah',   label: 'Apocalypse of Elijah',               translations: [{ id: 'apoc_elijah', label: 'O.S. Wintermute' }] },
  { id: 'recog_clement', label: 'Recognitions of Clement',            translations: [{ id: 'recog_clement', label: 'Ante-Nicene Fathers' }] },
  { id: 'hermas',        label: 'Shepherd of Hermas',                 translations: [{ id: 'hermas', label: 'Roberts-Donaldson' }, { id: 'hermas_taylor', label: 'Charles Taylor (1903)' }] },
  { id: 'asc_isaiah',    label: 'Ascension of Isaiah',                translations: [{ id: 'asc_isaiah', label: 'R.H. Charles' }] },
  { id: 'ep_barnabas',   label: 'Epistle of Barnabas',                translations: [{ id: 'ep_barnabas', label: 'Samuel Sharpe' }] },
  { id: 't12p',          label: 'Testaments of the Twelve Patriarchs', translations: [{ id: 't12p', label: 'R.H. Charles' }] },
  { id: 'gad',           label: 'Words of Gad the Seer',              translations: [{ id: 'gad', label: 'Beir Bar-Ilan' }] },
  { id: 't_job',         label: 'Testament of Job',                   translations: [{ id: 't_job', label: 'M.R. James (1897)' }] },
  { id: '1clement',      label: 'First Epistle of Clement',           translations: [{ id: '1clement', label: 'J.B. Lightfoot' }] },
  { id: 'apoc_abraham',  label: 'Apocalypse of Abraham',              translations: [{ id: 'apoc_abraham', label: 'G.H. Box (1918)' }] },
  { id: 'didache_hoole', label: 'Didache',                            translations: [{ id: 'didache_hoole', label: 'Charles H. Hoole (1894)' }] },
  { id: 't_jacob',       label: 'Testament of Jacob',                 translations: [{ id: 't_jacob', label: 'W.F. Stinespring' }] },
  { id: '2baruch',       label: '2 Baruch',                           translations: [{ id: '2baruch', label: 'R.H. Charles-based' }] },
]

/** The edition that contains a given translation textId. */
export function editionForTextId(textId: string): Edition | undefined {
  return EDITIONS.find((e) => e.translations.some((t) => t.id === textId))
}
