// AUTO-GENERATED provenance data — regenerate with:  python3 scripts/extract_psalm_titles.py
//
// Exact KJV Psalm superscriptions, extracted from the <b>…</b> title spans that open each
// Psalm's verse 1 in kjv+.bbli ("KJV with Strong's Numbers", a public-domain SQLite module).
// Key = Psalm number (1..150). An ABSENT key means that Psalm has NO superscription in the
// KJV (Ps 1, 2, 10, 33, 43, 71, 91, 93–97, 99, 104–107, 111–119, 135–137, 146–150).
// Values are verbatim KJV wording and punctuation, single-spaced.
//
// Renderer usage (KJV / KJVA):
//   • kjv.db  `text`        — verse 1 NEVER contains the superscription; render it as-is.
//   • kjva.db `text_tagged` — verse 1 IS prefixed with the superscription. After stripping
//     {..} braces and * / ! markers, that prefix equals PSALM_TITLES_KJV[n] for every
//     non-corrupt Psalm (verified for all 111 titled non-corrupt Psalms). 39 Psalms have a
//     corrupt text_tagged prefix containing literal `b>{}` / `/b>{Hxxxx}` tokens (a <b> tag
//     the re-seed failed to strip) — see PSALMS_CORRUPT_TEXT_TAGGED_KJVA. For those, treat
//     PSALM_TITLES_KJV[n] as the authority for the title text.

export const PSALM_TITLES_KJV: Record<number, string> = {
  3: "A Psalm of David, when he fled from Absalom his son.",
  4: "To the chief Musician on Neginoth, A Psalm of David.",
  5: "To the chief Musician upon Nehiloth, A Psalm of David.",
  6: "To the chief Musician on Neginoth upon Sheminith, A Psalm of David.",
  7: "Shiggaion of David, which he sang unto the LORD, concerning the words of Cush the Benjamite.",
  8: "To the chief Musician upon Gittith, A Psalm of David.",
  9: "To the chief Musician upon Muthlabben, A Psalm of David.",
  11: "To the chief Musician, A Psalm of David.",
  12: "To the chief Musician upon Sheminith, A Psalm of David.",
  13: "To the chief Musician, A Psalm of David.",
  14: "To the chief Musician, A Psalm of David.",
  15: "A Psalm of David.",
  16: "Michtam of David.",
  17: "A Prayer of David.",
  18: "To the chief Musician, A Psalm of David, the servant of the LORD, who spake unto the LORD the words of this song in the day that the LORD delivered him from the hand of all his enemies, and from the hand of Saul: And he said,",
  19: "To the chief Musician, A Psalm of David.",
  20: "To the chief Musician, A Psalm of David.",
  21: "To the chief Musician, A Psalm of David.",
  22: "To the chief Musician upon Aijeleth Shahar, A Psalm of David.",
  23: "A Psalm of David.",
  24: "A Psalm of David.",
  25: "A Psalm of David.",
  26: "A Psalm of David.",
  27: "A Psalm of David.",
  28: "A Psalm of David.",
  29: "A Psalm of David.",
  30: "A Psalm and Song at the dedication of the house of David.",
  31: "To the chief Musician, A Psalm of David.",
  32: "A Psalm of David, Maschil.",
  34: "A Psalm of David, when he changed his behaviour before Abimelech; who drove him away, and he departed.",
  35: "A Psalm of David.",
  36: "To the chief Musician, A Psalm of David the servant of the LORD.",
  37: "A Psalm of David.",
  38: "A Psalm of David, to bring to remembrance.",
  39: "To the chief Musician, even to Jeduthun, A Psalm of David.",
  40: "To the chief Musician, A Psalm of David.",
  41: "To the chief Musician, A Psalm of David.",
  42: "To the chief Musician, Maschil, for the sons of Korah.",
  44: "To the chief Musician for the sons of Korah, Maschil.",
  45: "To the chief Musician upon Shoshannim, for the sons of Korah, Maschil, A Song of loves.",
  46: "To the chief Musician for the sons of Korah, A Song upon Alamoth.",
  47: "To the chief Musician, A Psalm for the sons of Korah.",
  48: "A Song and Psalm for the sons of Korah.",
  49: "To the chief Musician, A Psalm for the sons of Korah.",
  50: "A Psalm of Asaph.",
  51: "To the chief Musician, A Psalm of David, when Nathan the prophet came unto him, after he had gone in to Bathsheba.",
  52: "To the chief Musician, Maschil, A Psalm of David, when Doeg the Edomite came and told Saul, and said unto him, David is come to the house of Ahimelech.",
  53: "To the chief Musician upon Mahalath, Maschil, A Psalm of David.",
  54: "To the chief Musician on Neginoth, Maschil, A Psalm of David, when the Ziphims came and said to Saul, Doth not David hide himself with us?",
  55: "To the chief Musician on Neginoth, Maschil, A Psalm of David.",
  56: "To the chief Musician upon Jonathelemrechokim, Michtam of David, when the Philistines took him in Gath.",
  57: "To the chief Musician, Altaschith, Michtam of David, when he fled from Saul in the cave.",
  58: "To the chief Musician, Altaschith, Michtam of David.",
  59: "To the chief Musician, Altaschith, Michtam of David; when Saul sent, and they watched the house to kill him.",
  60: "To the chief Musician upon Shushaneduth, Michtam of David, to teach; when he strove with Aramnaharaim and with Aramzobah, when Joab returned, and smote of Edom in the valley of salt twelve thousand.",
  61: "To the chief Musician upon Neginah, A Psalm of David.",
  62: "To the chief Musician, to Jeduthun, A Psalm of David.",
  63: "A Psalm of David, when he was in the wilderness of Judah.",
  64: "To the chief Musician, A Psalm of David.",
  65: "To the chief Musician, A Psalm and Song of David.",
  66: "To the chief Musician, A Song or Psalm.",
  67: "To the chief Musician on Neginoth, A Psalm or Song.",
  68: "To the chief Musician, A Psalm or Song of David.",
  69: "To the chief Musician upon Shoshannim, A Psalm of David.",
  70: "To the chief Musician, A Psalm of David, to bring to remembrance.",
  72: "A Psalm for Solomon.",
  73: "A Psalm of Asaph.",
  74: "Maschil of Asaph.",
  75: "To the chief Musician, Altaschith, A Psalm or Song of Asaph.",
  76: "To the chief Musician on Neginoth, A Psalm or Song of Asaph.",
  77: "To the chief Musician, to Jeduthun, A Psalm of Asaph.",
  78: "Maschil of Asaph.",
  79: "A Psalm of Asaph.",
  80: "To the chief Musician upon Shoshannimeduth, A Psalm of Asaph.",
  81: "To the chief Musician upon Gittith, A Psalm of Asaph.",
  82: "A Psalm of Asaph.",
  83: "A Song or Psalm of Asaph.",
  84: "To the chief Musician upon Gittith, A Psalm for the sons of Korah.",
  85: "To the chief Musician, A Psalm for the sons of Korah.",
  86: "A Prayer of David.",
  87: "A Psalm or Song for the sons of Korah.",
  88: "A Song or Psalm for the sons of Korah, to the chief Musician upon Mahalath Leannoth, Maschil of Heman the Ezrahite.",
  89: "Maschil of Ethan the Ezrahite.",
  90: "A Prayer of Moses the man of God.",
  92: "A Psalm or Song for the sabbath day.",
  98: "A Psalm.",
  100: "A Psalm of praise.",
  101: "A Psalm of David.",
  102: "A Prayer of the afflicted, when he is overwhelmed, and poureth out his complaint before the LORD.",
  103: "A Psalm of David.",
  108: "A Song or Psalm of David.",
  109: "To the chief Musician, A Psalm of David.",
  110: "A Psalm of David.",
  120: "A Song of degrees.",
  121: "A Song of degrees.",
  122: "A Song of degrees of David.",
  123: "A Song of degrees.",
  124: "A Song of degrees of David.",
  125: "A Song of degrees.",
  126: "A Song of degrees.",
  127: "A Song of degrees for Solomon.",
  128: "A Song of degrees.",
  129: "A Song of degrees.",
  130: "A Song of degrees.",
  131: "A Song of degrees of David.",
  132: "A Song of degrees.",
  133: "A Song of degrees of David.",
  134: "A Song of degrees.",
  138: "A Psalm of David.",
  139: "To the chief Musician, A Psalm of David.",
  140: "To the chief Musician, A Psalm of David.",
  141: "A Psalm of David.",
  142: "Maschil of David; A Prayer when he was in the cave.",
  143: "A Psalm of David.",
  144: "A Psalm of David.",
  145: "David's Psalm of praise.",
};

/**
 * Psalms whose kjva.db `text_tagged` verse-1 prefix is corrupt: it contains literal
 * `b>{}` / `/b>{Hxxxx}` tokens (an unstripped <b> tag from the re-seed). The bbli source —
 * and therefore PSALM_TITLES_KJV — is clean for all of these; use it as the title authority.
 */
export const PSALMS_CORRUPT_TEXT_TAGGED_KJVA: readonly number[] = [
  11, 14, 18, 25, 26, 27, 28, 30, 32, 34, 35, 36, 37, 39, 48, 52, 53, 54, 55, 61,
  65, 66, 67, 68, 69, 70, 72, 75, 76, 81, 83, 87, 88, 92, 103, 108, 138, 144, 145,
];

// ---------------------------------------------------------------------------
// Brenton LXX  —  data/lxx_brenton.db, book_id='PSA', LXX/Greek versification
// (Psalm numbers diverge from the Hebrew/KJV after Ps 9; e.g. the Nathan/Bathsheba
// psalm is Brenton 50, KJV 51).
//
// In Brenton the superscription is stored either as WHOLE leading verses, or inline at the
// head of verse 1 with body text following on the SAME verse.
//
//   PSALM_TITLE_VERSE_COUNT_BRENTON[n] = number of leading verses that are ENTIRELY
//   superscription (1 or 2). Only entries > 0 are listed. Body begins at verse (count + 1).
//   Brenton Ps 50, 51, 53, 59 have a 2-verse title: v1 plus a "when …" historical note in v2.
//   (verified by printing v1 + v2 of all 150 Psalms — see scripts/extract_psalm_titles.py.)
//
//   PSALMS_TITLE_INLINE_IN_V1_BRENTON = Psalms where verse 1 reads  "<title>. <body…>"  on a
//   single verse. The renderer must strip a TEXT PREFIX from verse 1 (up to and including the
//   period that closes the title clause), NOT a whole verse. The exact prefix per Psalm is
//   given by PSALM_TITLE_PREFIX_BRENTON below — verbatim from data/lxx_brenton.db verse 1,
//   including trailing punctuation. The title wording varies ("A Psalm of David.",
//   "Alleluia.", "A Song of Degrees.", "[A Psalm] of David.", …). For all 85 the boundary is
//   the first ". " in verse 1 (verified by eye — none of the 85 has an internal period inside
//   the title clause; the "For the end. Destroy not: …" hazard only occurs in Ps 55–58, which
//   are whole-verse, not inline).
//
//   PSALM_TITLE_PREFIX_BRENTON[n] = the leading superscription substring of Brenton verse 1
//   for each of the 85 inline Psalms. Strip this exact prefix (plus the single following
//   space) from verse 1 to get the body. NOTE Ps 100: the prefix "A Psalm of David." is
//   clean, but the residual body ("I will sing to thee, O Lord, of mercy and judgment; I will
//   sing a psalm,") is a partial sentence that continues into verse 2 — a rendering concern,
//   not a prefix defect.
//
//   Brenton Ps 1 and Ps 2 have no superscription at all (count 0, not inline).
//   (all three Brenton consts regenerated with scripts/extract_brenton_psalm_prefixes.py)
// ---------------------------------------------------------------------------
export const PSALM_TITLE_VERSE_COUNT_BRENTON: Record<number, number> = {
  3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 17: 1, 18: 1, 19: 1,
  20: 1, 21: 1, 29: 1, 30: 1, 33: 1, 35: 1, 37: 1, 38: 1, 39: 1, 40: 1, 41: 1,
  43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 50: 2, 51: 2, 52: 1, 53: 2, 54: 1,
  55: 1, 56: 1, 57: 1, 58: 1, 59: 2, 60: 1, 61: 1, 62: 1, 63: 1, 64: 1, 66: 1,
  67: 1, 68: 1, 69: 1, 74: 1, 75: 1, 76: 1, 79: 1, 80: 1, 82: 1, 83: 1, 84: 1,
  87: 1, 88: 1, 91: 1, 101: 1, 107: 1, 139: 1, 141: 1,
};

export const PSALMS_TITLE_INLINE_IN_V1_BRENTON: readonly number[] = [
  10, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 31, 32, 34, 36, 42, 49, 65, 70,
  71, 72, 73, 77, 78, 81, 85, 86, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100, 102,
  103, 104, 105, 106, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
  120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
  136, 137, 138, 140, 142, 143, 144, 145, 146, 147, 148, 149, 150,
];

/**
 * Exact leading superscription substring of Brenton verse 1 for each of the 85 Psalms in
 * PSALMS_TITLE_INLINE_IN_V1_BRENTON. Verbatim from data/lxx_brenton.db (book_id='PSA'),
 * including trailing punctuation. To render the body of an inline Psalm, strip this prefix
 * and the one space that follows it from verse 1.
 *   e.g.  10  -> 'For the end, a Psalm of David.'
 *         136 -> 'For David, [a Psalm] of Jeremias.'
 * Regenerate with:  python3 scripts/extract_brenton_psalm_prefixes.py
 */
export const PSALM_TITLE_PREFIX_BRENTON: Record<number, string> = {
  10: 'For the end, a Psalm of David.',
  13: 'For the end, a Psalm of David.',
  14: 'A Psalm of David.',
  15: 'A writing of David.',
  16: 'A Prayer of David.',
  22: 'A Psalm of David.',
  23: 'A Psalm for David on the first day of the week.',
  24: 'A Psalm of David.',
  25: '[A Psalm] of David.',
  26: '[A Psalm] of David, before he was anointed.',
  27: '[A Psalm] of David.',
  28: 'A Psalm of David [on the occasion] of the solemn assembly of the Tabernacle.',
  31: '[A Psalm] of instruction by David.',
  32: '[A Psalm] of David.',
  34: '[A Psalm] of David.',
  36: '[A Psalm] of David.',
  42: 'A Psalm of David.',
  49: 'A Psalm for Asaph.',
  65: 'For the end, a Song of a Psalm of resurrection.',
  70: 'By David, [a Psalm sung by] the sons of Jonadab, and the first that were taken captive.',
  71: 'For Solomon.',
  72: 'A Psalm for Asaph.',
  73: '[A Psalm] of instruction for Asaph.',
  77: '[A Psalm] of instruction for Asaph.',
  78: 'A Psalm for Asaph.',
  81: 'A Psalm for Asaph.',
  85: 'A Prayer of David.',
  86: 'A Psalm of a Song for the sons of Core.',
  89: 'A Prayer of Moses the man of God.',
  90: 'Praise of a Song, by David.',
  92: 'For the day before the Sabbath, when the land was [first] inhabited, the praise of a Song by David.',
  93: 'A Psalm of David for the fourth [day] of the week.',
  94: 'The praise of a Song by David.',
  95: 'When the house was built after the Captivity, a Song by David.',
  96: 'For David, when his land is established.',
  97: 'A Psalm of David.',
  98: 'A Psalm of David.',
  99: 'A Psalm for Thanksgiving.',
  100: 'A Psalm of David.', // residual body continues into v2 — see header note
  102: '[A Psalm] of David.',
  103: '[A Psalm] of David.',
  104: 'Alleluia.',
  105: 'Alleluia.',
  106: 'Alleluia.',
  108: 'For the end, a Psalm of David.',
  109: 'A Psalm of David.',
  110: 'Alleluia.',
  111: 'Alleluia.',
  112: 'Alleluia.',
  113: 'Alleluia.',
  114: 'Alleluia.',
  115: 'Alleluia.',
  116: 'Alleluia.',
  117: 'Alleluia.',
  118: 'Alleluia.',
  119: 'A Song of Degrees.',
  120: 'A Song of Degrees.',
  121: 'A Song of Degrees.',
  122: 'A Song of Degrees.',
  123: 'A Song of Degrees.',
  124: 'A Song of Degrees.',
  125: 'A Song of Degrees.',
  126: 'A Song of Degrees.',
  127: 'A Song of Degrees.',
  128: 'A Song of Degrees.',
  129: 'A Song of Degrees.',
  130: 'A Song of Degrees.',
  131: 'A Song of Degrees.',
  132: 'A Song of Degrees.',
  133: 'A Song of Degrees.',
  134: 'Alleluia.',
  135: 'Alleluia.',
  136: 'For David, [a Psalm] of Jeremias.',
  137: 'A Psalm for David, of Aggæus and Zacharias.',
  138: 'For the end, a Psalm of David.',
  140: 'A Psalm of David.',
  142: 'A Psalm of David, when his son pursued him.',
  143: '[A Psalm] of David concerning Goliad.',
  144: "David's [Psalm of] praise.",
  145: 'Alleluia, [a Psalm] of Aggæus and Zacharias.',
  146: 'Alleluia, [a Psalm] of Aggæus and Zacharias.',
  147: 'Alleluia, [a Psalm] of Aggæus and Zacharias.',
  148: 'Alleluia, [a Psalm] of Aggæus and Zacharias.',
  149: 'Alleluia.',
  150: 'Alleluia.',
};
