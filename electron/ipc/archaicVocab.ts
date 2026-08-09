// Curated modern-English -> archaic-translation-wording phrase table for pseudepigrapha texts
// (Jubilees and 1 Enoch are both R.H. Charles, 1913/1917 — formal, period English that a
// modern-phrased search keyword will often miss verbatim). Every entry below was verified
// against the real text in data/jubilees.db / data/enoch.db via direct sqlite3 queries before
// being added — see the inline citation comment on each entry for the confirming chapter:verse.
// Used by aiLookup.ts's searchKeywords to expand a keyword into archaic variants when searching
// a pseudepigrapha focus text, the same way getWordReplacerVariants expands user-configured
// word-replacer variants.

export interface ArchaicPhraseRule {
  /** Modern word(s)/phrase(s) that, if present in an extracted keyword, trigger this expansion. */
  modern: string[]
  /** The archaic phrase to add as a search variant. */
  archaic: string
  /** Which text(s) this applies to — textId values used elsewhere in this app. */
  textIds: Array<'jubilees' | 'enoch'>
}

export const PSEUDEPIGRAPHA_ARCHAIC_VOCAB: ArchaicPhraseRule[] = [
  // --- Idolatry cluster (Jubilees) ---
  // Jubilees 12:12 — "...Abram arose by night, and burned the house of the idols..."
  { modern: ['idolatry', 'idol worship', 'idol temple'], archaic: 'the house of the idols', textIds: ['jubilees'] },
  // Jubilees 1:10 — "...high places and groves and graven images, and they will worship, each his own (graven image)..."
  // also Jubilees 11:3, 11:15, 21:5
  { modern: ['idols', 'false gods', 'statues', 'carved images'], archaic: 'graven images', textIds: ['jubilees'] },
  // Jubilees 11:3 — "...And they made for themselves molten images..." (also 21:5)
  { modern: ['idols', 'false gods', 'cast images'], archaic: 'molten images', textIds: ['jubilees'] },
  // Jubilees 11:3 — "...and they worshipped each the idol, the molten image which they had made for themselves..."
  { modern: ['worship idols', 'idol worship', 'worshipping idols'], archaic: 'worshipped each the idol', textIds: ['jubilees'] },
  // Jubilees 1:8 — "...they will turn to strange gods, to (gods) which cannot deliver them..." (also 31:1, 31:2)
  { modern: ['foreign gods', 'other gods', 'false gods', 'pagan gods'], archaic: 'strange gods', textIds: ['jubilees'] },

  // --- Sin / defilement ---
  // Jubilees 11:3 — "...seduced (them) into committing transgression and uncleanness." (also 9:15, 11:5)
  { modern: ['sin', 'wickedness', 'evil', 'wrongdoing'], archaic: 'transgression', textIds: ['jubilees', 'enoch'] },
  // Jubilees 1:8, 11:3, 11:16 — "...after graven images and after uncleanness..."
  { modern: ['impurity', 'defilement', 'sin', 'unclean'], archaic: 'uncleanness', textIds: ['jubilees', 'enoch'] },
  // 1 Enoch 8:2 — "...and they committed fornication, and they were led astray..."; Jubilees 7:20
  { modern: ['sexual immorality', 'adultery', 'immorality', 'sexual sin'], archaic: 'fornication', textIds: ['jubilees', 'enoch'] },

  // --- Spirit world ---
  // Jubilees 11:3 — "...and malignant spirits assisted and seduced (them)..."
  { modern: ['demons', 'evil spirits', 'unclean spirits'], archaic: 'malignant spirits', textIds: ['jubilees'] },
  // Jubilees 10:8 — "And the chief of the spirits, Mastêmâ, came and said..." (also 11:4 "the prince Mastêmâ", 17:16)
  { modern: ['satan', 'the devil', 'the adversary', 'the accuser'], archaic: 'Mastêmâ', textIds: ['jubilees'] },
  // 1 Enoch 1:5 — "...And the Watchers shall quake..." (also 10:7, 10:9, 15:2); Jubilees 4:15, 4:22, 7:21
  { modern: ['angels', 'fallen angels', 'the fallen ones'], archaic: 'the Watchers', textIds: ['enoch', 'jubilees'] },
  // Jubilees 2:2 — "...all the spirits which serve before him -the angels of the presence..." (also 1:26, 1:28, 2:18)
  { modern: ['angels', 'archangels', 'ministering angels'], archaic: 'the angels of the presence', textIds: ['jubilees'] },
  // 1 Enoch 7:4 — "...the giants turned against them and devoured mankind." (also 15:8, 15:11, 16:1); Jubilees 7:22
  // NOTE: "Nephilim" does NOT appear in either DB — Charles renders the related term "Naphidim"/"Naphil".
  { modern: ['giants', 'nephilim'], archaic: 'the giants', textIds: ['enoch', 'jubilees'] },

  // --- Divine titles / messianic ---
  // 1 Enoch 37:2 — "...Hear, ye men of old time..." / the Parables' standing divine title (also 37:4, 38:2)
  { modern: ['God', 'the Lord', 'Yehovah'], archaic: 'the Lord of Spirits', textIds: ['enoch'] },
  // 1 Enoch 39:5 — Parables title (also 40:5, 45:3)
  { modern: ['messiah', 'the chosen one', 'the anointed one'], archaic: 'the Elect One', textIds: ['enoch'] },
  // 1 Enoch 46:3 — "This is the Son of Man who hath righteousness..." (also 46:2, 46:4, 48:2)
  { modern: ['messiah', 'Yeshua', 'the chosen one'], archaic: 'the Son of Man', textIds: ['enoch'] },

  // --- Law / covenant framing devices ---
  // Jubilees 3:10 — "...the commandment is written on the heavenly tablets..."; 1 Enoch 81:2 — "And I observed the heavenly tablets..."
  { modern: ['law', 'commandments', 'torah', 'decrees'], archaic: 'the heavenly tablets', textIds: ['jubilees', 'enoch'] },
  // Jubilees 1:4 — "...the earlier and the later history of the division of all the days of the law and of the testimony." (also 1:25, 1:28, 4:19)
  { modern: ['covenant', 'witness', 'testament'], archaic: 'the testimony', textIds: ['jubilees'] },

  // --- Places ---
  // 1 Enoch 32:3 — "And I came to the Garden of Righteousness..." (also 77:3)
  { modern: ['paradise', 'eden', 'garden of eden', 'heaven'], archaic: 'the garden of righteousness', textIds: ['enoch'] },
  // Jubilees 1:28 — "...the sanctuary of the Lord shall be made in Jerusalem..." (also 3:10, 3:13)
  { modern: ['temple', 'the temple'], archaic: 'the sanctuary', textIds: ['jubilees'] },
  // 1 Enoch 51:1 — "...And Sheol also shall give back that which it has received..."; Jubilees 5:14 (also Enoch 56:8, 63:10)
  { modern: ['hell', 'the grave', 'the underworld', 'hades'], archaic: 'Sheol', textIds: ['enoch', 'jubilees'] },
  // 1 Enoch 10:13 — "...they shall be led off to the abyss of fire..."; Jubilees 6:26 (also Enoch 21:7, 54:5)
  { modern: ['hell', 'the pit', 'the deep', 'bottomless pit'], archaic: 'the abyss', textIds: ['enoch', 'jubilees'] },

  // --- Judgment / flood ---
  // 1 Enoch 10:6 — "And on the day of the great judgement he shall be cast into the fire." (also 19:1, 94:9)
  // NOTE the British spelling: Enoch uses "judgement", Jubilees uses "judgment" — a modern query will miss one of them.
  { modern: ['judgment day', 'final judgment', 'day of judgment', 'the judgment'], archaic: 'the great judgement', textIds: ['enoch'] },
  // Jubilees 4:24 — "...(God) brought the waters of the flood upon all the land of Eden..." (also 5:19, 5:21, 7:34)
  { modern: ['the flood', 'the deluge', 'noahs flood'], archaic: 'the waters of the flood', textIds: ['jubilees'] },

  // --- General period-English verbs / idioms (both texts) ---
  // 1 Enoch 18:16 — "And He was wroth with them..."; Jubilees 3:23 — "And God cursed the serpent, and was wroth with it for ever"
  { modern: ['angry', 'anger', 'furious', 'wrath'], archaic: 'wroth', textIds: ['enoch', 'jubilees'] },
  // 1 Enoch 13:4 — "And they besought me to draw up a petition for them..."; Jubilees 19:5 (also Enoch 60:9, 83:10)
  { modern: ['pleaded', 'begged', 'prayed', 'asked'], archaic: 'besought', textIds: ['enoch', 'jubilees'] },
  // 1 Enoch 10:12 — "...bind them fast for seventy generations..."; Jubilees 2:20 (also Enoch 39:5, 40:4)
  { modern: ['forever', 'eternally', 'for all time'], archaic: 'for ever and ever', textIds: ['enoch', 'jubilees'] },
  // 1 Enoch 6:1 — "...when the children of men had multiplied..."; Jubilees 4:15, 4:19 (also Enoch 6:2, 10:7)
  { modern: ['humanity', 'mankind', 'humankind', 'people'], archaic: 'the children of men', textIds: ['enoch', 'jubilees'] },
  // Jubilees 4:15 — "...Mahalalel took unto him to wife DinaH..." (also 25:8, 28:17, 28:20)
  { modern: ['married', 'marry', 'marriage', 'wed'], archaic: 'to wife', textIds: ['jubilees'] },
]
