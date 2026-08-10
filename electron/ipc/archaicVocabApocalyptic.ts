// modern -> archaic entries for asc_isaiah, 2baruch, didache_hoole, apoc_abraham, apoc_elijah
//
// Register was checked per text against the real DBs before any entry was written:
//   asc_isaiah    — R.H. Charles 1900. Fully archaic (thou 27, hath 12, unto 42, "it came to pass").
//   2baruch       — R.H. Charles 1896. Semi-archaic: "unto" 63, "lo!", "besought", "wroth", but
//                   modernized 2nd-person pronouns ("you" 220) — so the gap is vocabulary, not pronouns.
//   didache_hoole — C.H. Hoole 1894. Fully archaic (thou 29, ye 22, thee 12, "cometh", "baptizeth").
//   apoc_abraham  — Rubinkiewicz (OTP, 1983). MODERN register: zero thee/thou/hath/ye. Entries below
//                   are terminology gaps (distinctive proper nouns / divine titles), not archaisms.
//   apoc_elijah   — Wintermute (OTP, 1983). MODERN register: zero thee/thou/hath/ye/unto; uses
//                   contractions ("Don't believe him", 3:1). Entries below are terminology gaps only.
//   gad           — EXCLUDED. Modern composition/translation of the Cochin "Words of Gad the Seer";
//                   narrative prose is fully modern ("you have known that your servant was...", 3:1)
//                   with KJV pastiche only inside quoted divine oracles/psalms, and it mixes registers
//                   inside a single verse ("though Thou wast angry with me, You relented", 1:32).
//                   One narrow entry retained for the oracle formula; see the last rule.
//
// Every archaic string below was confirmed to appear verbatim via
//   sqlite3 -json /Users/roywe/Berean/data/<text>.db "SELECT chapter, verse_num, text FROM verses WHERE lower(text) LIKE '%<phrase>%'"
// The comment on each entry records the confirming chapter:verse and total occurrence count.
import type { ArchaicPhraseRule } from './archaicVocab'

export const APOCALYPTIC_ARCHAIC_VOCAB: ArchaicPhraseRule[] = [
  // ===================== 2 Baruch (Charles 1896) =====================
  // 2 Baruch 21:3 — "...I began to speak in the presence of the Mighty One, and said:" (also 32:1, 32:6, 54:1) — 39 occurrences
  { modern: ['God', 'the Lord', 'Yehovah', 'the Almighty'], archaic: 'the Mighty One', textIds: ['2baruch'] },
  // 2 Baruch 10:18 — "...(you priests) take you the keys of the sanctuary, And cast them into the height of heaven..." (also 59:4, 61:2)
  { modern: ['temple', 'the temple'], archaic: 'the sanctuary', textIds: ['2baruch'] },
  // 2 Baruch 13:3 — "...you shall therefore be assuredly preserved to the consummation of the times..." (also 19:5, 21:8, 21:12) — 6 occurrences
  { modern: ['end times', 'the last days', 'end of the world', 'the end of the age'], archaic: 'the consummation of the times', textIds: ['2baruch'] },
  // 2 Baruch 78:5 — "...in order that, at the last times, you may be found worthy of your fathers." (also 6:8, 76:4)
  { modern: ['end times', 'the last days', 'the end'], archaic: 'the last times', textIds: ['2baruch'] },
  // 2 Baruch 39:7 — "...then the principate of My Messiah will be revealed, which is like the fountain and the vine..." (also 40:3, 75:8)
  { modern: ['messianic kingdom', 'the reign of the messiah', 'the kingdom of the messiah', 'messiahs rule'], archaic: 'the principate of My Messiah', textIds: ['2baruch'] },
  // 2 Baruch 40:3 — "And his principate will stand for ever, until the world of corruption is at an end..."
  { modern: ['this present world', 'the fallen world', 'this age', 'the present age'], archaic: 'the world of corruption', textIds: ['2baruch'] },
  // 2 Baruch 11:6 — "...That you might go and announce in Sheol, And say to the dead:" (also 21:23, 23:5) — 7 occurrences
  { modern: ['hell', 'the grave', 'the underworld', 'hades'], archaic: 'Sheol', textIds: ['2baruch'] },
  // 2 Baruch 6:1 — "...lo! the army of the Chaldees surrounded the city..." (also 8:4)
  // NOTE: "Babylonians" does NOT appear in 2baruch.db — Charles uses only "the Chaldees".
  { modern: ['babylonians', 'the babylonian army', 'babylonian invaders'], archaic: 'the Chaldees', textIds: ['2baruch'] },
  // 2 Baruch 25:3 — "...they shall fall into many tribulations..." (also 25:4, 26:1, 32:6) — 10 occurrences
  { modern: ['suffering', 'affliction', 'persecution', 'hardship'], archaic: 'tribulation', textIds: ['2baruch'] },
  // 2 Baruch 54:1 — "And I besought the Mighty One, and said:" (also 54:7, 54:20, 56:1)
  { modern: ['pleaded', 'begged', 'prayed', 'asked'], archaic: 'besought', textIds: ['2baruch'] },
  // 2 Baruch 53:7 — "...it rained black waters, and they were darker than had been all those waters..." (also 56:5, 56:8) — 6 occurrences
  // Charles's cloud-vision idiom: the dark/evil epochs of history.
  { modern: ['evil ages', 'wicked periods', 'dark times', 'evil generations'], archaic: 'black waters', textIds: ['2baruch'] },

  // ===================== Ascension of Isaiah (Charles 1900) =====================
  // Asc. Isaiah 3:18 — "...the resurrection of the Beloved... and in His ascension into the seventh heaven whence He came" (also 1:4, 1:13, 3:13) — 14 occurrences
  // NOTE: "messiah" appears ZERO times in asc_isaiah.db; "christ" 7 and "Yeshua" 3 (mostly ch. 11's
  // nativity section) against 14 for "the Beloved" — Charles's standing title for the Son is "the Beloved".
  { modern: ['Yeshua', 'the messiah', 'christ', 'the son of God'], archaic: 'the Beloved', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 2:4 — "...for the angel of lawlessness, who is the ruler of this world, is Beliar..." (also 1:8, 1:9) — 11 occurrences
  { modern: ['satan', 'the devil', 'the adversary', 'antichrist'], archaic: 'Beliar', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 7:9 — "...there I saw Sammael and his hosts, and there was great fighting therein..." (also 1:8, 1:11, 2:1) — 8 occurrences
  { modern: ['satan', 'the devil', 'the accuser'], archaic: 'Sammael', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 2:4 — "...the angel of lawlessness, who is the ruler of this world..." (2 occurrences of the phrase)
  { modern: ['prince of this world', 'god of this world', 'ruler of the earth'], archaic: 'the ruler of this world', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 1:9 — "...and Beliar will dwell in Manasseh, and by his hands I shall be sawn asunder."
  // The single defining phrase for Isaiah's martyrdom; a modern query will never match it.
  { modern: ['martyred', 'executed', 'killed', 'sawn in two', 'put to death'], archaic: 'sawn asunder', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 9:36 — "And I saw the great glory, the eyes of my spirit being open..."; 10:16 — "These commands I heard the Great Glory giving to my Lord."
  { modern: ['God', 'the glory of God', 'the divine presence', 'the Father'], archaic: 'the Great Glory', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 7:9 — "And we ascended to the firmament, I and he..." (also 4:2, 6:13) — 11 occurrences
  { modern: ['the sky', 'the heavens', 'the atmosphere'], archaic: 'the firmament', textIds: ['asc_isaiah'] },
  // Asc. Isaiah 9:6 — "And he raised me up into the seventh heaven, and I saw there a wonderful light and angels innumerable." (also 3:13, 3:18, 4:14) — 19 occurrences
  { modern: ['highest heaven', 'the throne room of God', 'the top heaven'], archaic: 'the seventh heaven', textIds: ['asc_isaiah'] },

  // ===================== Didache (Hoole 1894) =====================
  // Didache 1:1 — "There are two paths, one of life and one of death, and the difference is great between the two paths."
  // NOTE: "two ways" appears ZERO times in didache_hoole.db — Hoole renders it "two paths" throughout,
  // so the standard modern name for this section will not match anything without this expansion.
  { modern: ['the two ways', 'two ways'], archaic: 'two paths', textIds: ['didache_hoole'] },
  // Didache 1:2 — "Now the path of life is this -- first, thou shalt love the God who made thee..." (also 4:14)
  { modern: ['the way of life'], archaic: 'the path of life', textIds: ['didache_hoole'] },
  // Didache 5:1 — "But the path of death is this. First of all, it is evil, and full of cursing..."
  { modern: ['the way of death'], archaic: 'the path of death', textIds: ['didache_hoole'] },
  // Didache 9:1 — "But concerning the Eucharist, after this fashion give ye thanks." (also 9:5, 10:6)
  { modern: ['communion', 'the lords supper', 'breaking of bread', 'the last supper'], archaic: 'the Eucharist', textIds: ['didache_hoole'] },
  // Didache 7:1 — "...baptize in the name of the Father, and of the Son, and of the Holy Spirit, in running water;" (also 7:2)
  // NOTE: "living water" appears ZERO times — Hoole renders the baptismal requirement "running water".
  { modern: ['living water', 'flowing water', 'moving water'], archaic: 'running water', textIds: ['didache_hoole'] },
  // Didache 13:3 — "Thou shalt, therefore, take the firstfruits of every produce of the wine-press and threshing-floor..." (also 13:5, 13:6) — 4 occurrences
  { modern: ['first fruits', 'the first fruits'], archaic: 'firstfruits', textIds: ['didache_hoole'] },
  // Didache 16:4 — "...and then shall the Deceiver of the world appear as the Son of God, and shall do signs and wonders..."
  // NOTE: "antichrist" appears ZERO times in didache_hoole.db.
  { modern: ['antichrist', 'the antichrist', 'the beast', 'the false messiah'], archaic: 'the Deceiver of the world', textIds: ['didache_hoole'] },

  // ===================== Apocalypse of Abraham (Rubinkiewicz, modern register — terminology gaps only) =====================
  // Apoc. Abraham 13:7 — "This is disgrace, this is Azazel!" (also 13:8, 14:6) — 10 occurrences
  // NOTE: "satan"/"the devil" appear ZERO times; the tempter/accuser figure is named only Azazel.
  { modern: ['satan', 'the devil', 'the tempter', 'the accuser'], archaic: 'Azazel', textIds: ['apoc_abraham'] },
  // Apoc. Abraham 26:1 — "And I said, \"Eternal, Mighty One! Why did you establish it to be so...\"" (also 13:10, 27:6) — 5 occurrences
  { modern: ['God', 'the Lord', 'Yehovah', 'almighty God'], archaic: 'Eternal, Mighty One', textIds: ['apoc_abraham'] },
  // Apoc. Abraham 10:13 — "...the land which he whom you have called the Eternal One has prepared" (also 10:16, 12:4) — 9 occurrences
  { modern: ['God', 'the Lord', 'Yehovah', 'the everlasting God'], archaic: 'the Eternal One', textIds: ['apoc_abraham'] },
  // Apoc. Abraham 27:5 — "...the hordes of the heathen. They are killing some and holding others as aliens..." (also 28:5, 29:2) — 6 occurrences
  { modern: ['the nations', 'the gentiles', 'pagans', 'foreigners'], archaic: 'the heathen', textIds: ['apoc_abraham'] },

  // ===================== Apocalypse of Elijah (Wintermute, modern register — terminology gaps only) =====================
  // Apoc. Elijah 3:1 — "...the son of lawlessness will appear, saying, \"I am the Christ,\" although he is not." (also 1:10, 3:5) — 13 occurrences
  // NOTE: "antichrist" appears ZERO times in apoc_elijah.db.
  { modern: ['antichrist', 'the antichrist', 'the man of sin', 'the false messiah'], archaic: 'the son of lawlessness', textIds: ['apoc_elijah'] },
  // Apoc. Elijah 4:1 — "The virgin, whose name is Tabitha, will hear that the shameless one has revealed himself in the holy places." (also 4:3, 4:7) — 7 occurrences
  { modern: ['antichrist', 'the antichrist', 'the beast', 'the deceiver'], archaic: 'the shameless one', textIds: ['apoc_elijah'] },
  // Apoc. Elijah 1:6 — "He did not inform a messenger or a chief-messenger or any principality..." (also 1:10, 1:11, 5:2) — 11 occurrences
  // NOTE: "angel" appears ZERO times in apoc_elijah.db — this translation renders angelos as "messenger" throughout.
  { modern: ['angel', 'angels', 'archangel', 'the angels'], archaic: 'messenger', textIds: ['apoc_elijah'] },

  // ===================== Gad the Seer (modern composition — single narrow entry) =====================
  // Gad 6:2 — "Thus saith the Lord: Let not the mighty man glory in his might." — 7 occurrences of "thus saith the Lord".
  // The ONLY consistently archaic feature of this text: quoted divine oracles use the KJV formula while
  // the surrounding narrative is fully modern. No other archaic-vocab rules are justified for gad.
  { modern: ['the Lord says', 'declares the Lord', 'says the Lord', 'the word of the Lord says'], archaic: 'thus saith the Lord', textIds: ['gad'] },
]
