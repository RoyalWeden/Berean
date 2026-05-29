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
    description: 'Ante-Nicene Fathers edition. Divided into Visions, Mandates, and Similitudes. Each "verse" shown here is a paragraph-sized passage — no traditional verse numbers exist in the source.',
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
}

export const TRANSLATIONS = [
  { id: 'kjva',          label: 'KJVA',           description: 'KJV + Apocrypha' },
  { id: 'lxx',           label: 'LXX',            description: 'Brenton Septuagint' },
  { id: 'enoch',         label: '1 Enoch',         description: 'R.H. Charles' },
  { id: 'jubilees',      label: 'Jubilees',        description: 'R.H. Charles' },
  { id: 'apoc_elijah',   label: 'Apoc. Elijah',    description: 'Apocalypse of Elijah' },
  { id: 'recog_clement', label: 'Recog. Clement',  description: 'Recognitions of Clement' },
  { id: 'hermas',        label: 'Hermas',          description: 'Shepherd of Hermas' },
  { id: 'asc_isaiah',    label: 'Asc. Isaiah',     description: 'Ascension of Isaiah, R.H. Charles' },
  { id: 'ep_barnabas',   label: 'Ep. Barnabas',    description: 'Epistle of Barnabas' },
  { id: 't12p',          label: 'T12 Patriarchs',  description: 'Testaments of the Twelve Patriarchs, R.H. Charles' },
  { id: 'gad',           label: 'Gad the Seer',    description: 'Words of Gad the Seer, trans. Beir Bar-Ilan' },
  { id: 't_job',         label: 'T. Job',           description: 'Testament of Job, trans. M.R. James (1897)' },
  { id: '1clement',      label: '1 Clement',        description: 'First Epistle of Clement to the Corinthians, trans. J.B. Lightfoot' },
]
