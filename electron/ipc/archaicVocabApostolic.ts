// Curated modern-English -> archaic-translation-wording phrase table for the "Apostolic Fathers"
// era texts: Shepherd of Hermas (two independent translations), Epistle of Barnabas, 1 Clement,
// and the Recognitions of Clement. Every entry below was verified against the real text in
// data/hermas.db / data/hermas_taylor.db / data/ep_barnabas.db / data/1clement.db /
// data/recog_clement.db via direct sqlite3 queries before being added — see the inline citation
// comment on each entry for the confirming book_id + chapter:verse.
//
// IMPORTANT: hermas.db (ANF / Roberts-Donaldson register) and hermas_taylor.db (Charles Taylor)
// are genuinely different translations of the same work and frequently DO NOT share wording.
// Where verified wording differs, the entries below are split by textId rather than sharing both.
// Known divergences confirmed by query:
//   "double-souled" (hermas, 2 hits)   vs  "doubleminded"/"doublemindedness" (hermas_taylor, ~21 hits)
//   "self-restraint" (hermas, 4 hits)  vs  0 hits in hermas_taylor (Taylor says "Continence")
//   "the old woman"  (hermas, 2 hits)  vs  0 hits in hermas_taylor
//   "quoth"          (hermas, 0 hits)  vs  hermas_taylor's standard speech tag
// Shared wording (verified in BOTH): "the tower", "the virgins", "the Angel of Repentance",
// "the black", "Continence", "shepherd".
//
// textIds values are exactly one/more of: 'hermas' | 'hermas_taylor' | 'ep_barnabas' | '1clement' | 'recog_clement'
import type { ArchaicPhraseRule } from './archaicVocab'

export const APOSTOLIC_ARCHAIC_VOCAB: ArchaicPhraseRule[] = [
  // ============================ SHEPHERD OF HERMAS ============================

  // --- The central allegory: the Church is never called "the church" in the narrative ---
  // hermas HER_SIM 41:1 — "'And the tower,' I asked, 'what does it mean?' 'This tower,' he replied, 'is the Church.'"
  // hermas_taylor HER_SIM 41:1 — "BUT the tower, quoth I, what is it? This tower, quoth he, is the Church."
  // (95 hits in hermas.db, 98 in hermas_taylor.db — the dominant way the Church is referred to)
  { modern: ['church', 'the church', 'body of believers', 'congregation'], archaic: 'the tower', textIds: ['hermas', 'hermas_taylor'] },
  // hermas HER_VIS 8:2 — "And he said, 'It is the Church.' And I said to him, 'Why then is she an old woman?'"
  // also HER_VIS 9:5, 18:4. NOT present in hermas_taylor.db (0 hits — Taylor writes "ancient dame").
  { modern: ['church', 'the church'], archaic: 'the old woman', textIds: ['hermas'] },
  // hermas HER_SIM 41:1 — "'And these virgins, who are they?' 'They are holy spirits...'"
  // hermas_taylor HER_SIM 31:1 — "...the six men called the virgins, and commanded them to carry all the stones..."
  { modern: ['holy spirits', 'virtues', 'spiritual powers'], archaic: 'the virgins', textIds: ['hermas', 'hermas_taylor'] },

  // --- Hermas' angelic guide ---
  // hermas HER_MAN 22:5 — "...for I will be with you, the angel of repentance, who am lord over him."
  // hermas_taylor HER_MAN 22:7 — "For I, the Angel of Repentance, who have dominion over him, will be with you."
  { modern: ['angel', 'guide', 'mentor', 'the messenger'], archaic: 'the Angel of Repentance', textIds: ['hermas', 'hermas_taylor'] },
  // hermas HER_SIM 18:4 — "And the Shepherd said to me, 'Do not be surprised if the tree remains sound...'"
  // hermas_taylor HER_VIS 25:1 — "...there came in a man of stately look, in the attire of a shepherd..."
  { modern: ['angel', 'guide', 'the teacher'], archaic: 'the Shepherd', textIds: ['hermas', 'hermas_taylor'] },

  // --- Double-mindedness: the single most fragmented term across these translations ---
  // Modern editions (Lightfoot/Holmes) say "double-minded"; NONE of these DBs agree with each other.
  // hermas HER_MAN 15:4 — "For those who doubt regarding God are double-souled, and obtain not one of
  // their requests."; also HER_MAN 15:5 "For every double-souled man, even if he repent..."
  { modern: ['double-minded', 'doubleminded', 'wavering', 'divided heart', 'doubting'], archaic: 'double-souled', textIds: ['hermas'] },
  // hermas_taylor HER_VIS 12:3 — "...shall be revealed to thee because of the doubleminded, who debate in
  // their hearts whether these things be so or not"; also HER_VIS 23:4, HER_MAN 9:1 (unhyphenated, one word)
  { modern: ['double-minded', 'wavering', 'divided heart', 'doubting'], archaic: 'doubleminded', textIds: ['hermas_taylor'] },
  // hermas_taylor HER_MAN 14:1 — "Put away from thee doublemindedness, and doubt not to ask anything at all from God"
  // also HER_MAN 14:7 "Cleanse therefore thy heart from doubtfulness and put on faith"
  { modern: ['double-mindedness', 'doubt', 'indecision', 'wavering'], archaic: 'doublemindedness', textIds: ['hermas_taylor'] },

  // --- Virtue vocabulary ---
  // hermas HER_MAN 11:1 — "...directions in the first commandment to attend to faith, and fear, and self-restraint."
  // also HER_VIS 16:5, HER_MAN 14:7. VERIFIED ABSENT from hermas_taylor.db (0 hits) — do not share this textId.
  { modern: ['self-control', 'self control', 'temperance', 'discipline'], archaic: 'self-restraint', textIds: ['hermas'] },
  // hermas HER_SIM 43:1 — "The first is Faith, the second Continence, the third Power, the fourth Patience."
  // hermas_taylor HER_VIS 16:4 — "The next, that is girded and manlike, is named Continence. She is the daughter of Faith."
  { modern: ['self-control', 'self control', 'temperance', 'abstinence'], archaic: 'Continence', textIds: ['hermas', 'hermas_taylor'] },
  // hermas HER_SIM 43:3 — "The first is Unbelief, the second: Incontinence, the third Disobedience, the fourth Deceit."
  { modern: ['lack of self-control', 'indulgence', 'excess'], archaic: 'Incontinence', textIds: ['hermas'] },

  // --- Taylor's speech tag (a keyword search for dialogue will miss this entirely) ---
  // hermas_taylor HER_VIS 1:6 — "Nay, quoth she, but hear the things that I will tell thee..."; also HER_VIS 1:8, 2:4
  { modern: ['said', 'she said', 'he said', 'replied'], archaic: 'quoth', textIds: ['hermas_taylor'] },

  // ============================ EPISTLE OF BARNABAS ============================

  // EPB 4:3 — "...we oppose ourselves as becometh sons of God, so that the Black One should gain no side entrance."
  // also EPB 20:1 "But the way of the Black one is full of crookedness and cursing..."
  { modern: ['satan', 'the devil', 'the adversary', 'the enemy'], archaic: 'the Black One', textIds: ['ep_barnabas'] },
  // EPB 2:5 — "...so that the Evil one should not by making among us a side entrance of going astray sling us away..."
  // also EPB 21:2 "The day is at hand in which all things will perish together with the evil one."
  { modern: ['satan', 'the devil', 'the adversary'], archaic: 'the Evil one', textIds: ['ep_barnabas'] },
  // EPB 15:6 — "...I shall make the beginning of the eighth day,' that is, the beginning of another world.
  // Therefore let us also keep the eighth day in joyfulness..."
  { modern: ['sunday', 'the lords day', 'resurrection day', 'first day of the week'], archaic: 'the eighth day', textIds: ['ep_barnabas'] },
  // EPB 19:1 — "The way of light then is this. If any one wishes to travel the way to the appointed place..."
  // also EPB 19:7 "This is the way of light."
  { modern: ['righteousness', 'righteous living', 'the right path', 'godly living'], archaic: 'the way of light', textIds: ['ep_barnabas'] },
  // EPB 5:4 — "...who having knowledge of the way of righteousness hurries himself off into the way of darkness."
  { modern: ['sin', 'wickedness', 'the wrong path', 'evil living'], archaic: 'the way of darkness', textIds: ['ep_barnabas'] },
  // EPB 20:1 — "...idolatry, over-confidence, arrogance of power, hypocrisy, double-heartedness, adultery, murder..."
  { modern: ['double-minded', 'doubleminded', 'divided heart', 'hypocrisy'], archaic: 'double-heartedness', textIds: ['ep_barnabas'] },

  // ============================ 1 CLEMENT ============================

  // 1CL 2:1 — "...the detestable and unholy sedition, so alien and strange to the elect of God..."
  // also 1CL 3:6, 4:2, 48:6 (11 hits) — the letter's entire subject is never called "division" or "conflict".
  { modern: ['division', 'divisions', 'split', 'conflict', 'church split', 'rebellion'], archaic: 'sedition', textIds: ['1clement'] },
  // 1CL 3:6 — "Every sedition and every schism was abominable to you."
  { modern: ['division', 'split', 'factions'], archaic: 'schism', textIds: ['1clement'] },
  // 1CL 9:2 — "Yea and the Master of the universe Himself spake concerning repentance with an oath"
  // also 1CL 8:5, 10:4, 21:11, 25:1 (16 hits) — the letter's habitual divine title.
  { modern: ['God', 'the Lord', 'Yehovah', 'the Almighty'], archaic: 'the Master', textIds: ['1clement'] },
  // 1CL 45:4 — "Blessed are those presbyters who have gone before..."; also 1CL 48:6, 55:2
  { modern: ['elders', 'church leaders', 'pastors', 'overseers'], archaic: 'presbyters', textIds: ['1clement'] },
  // 1CL 4:2 — "Hence come jealousy and envy, strife and sedition, persecution and tumult, war and captivity."
  // also 1CL 5:7, 6:2, 6:5 — Lightfoot pairs these as a fixed formula.
  { modern: ['envy', 'jealousy', 'resentment'], archaic: 'jealousy and envy', textIds: ['1clement'] },
  // 1CL 17:2 — "...came not in the pomp of arrogance or of pride, though He might have done so, but in
  // lowliness of mind..."; also 1CL 14:3, 18:2 (6 hits)
  { modern: ['humility', 'humbleness', 'meekness'], archaic: 'lowliness of mind', textIds: ['1clement'] },
  // 1CL 6:5 — "By reason of jealousy and strife Paul by his example pointed out the prize of patient endurance."
  // also 1CL 6:6
  { modern: ['patience', 'perseverance', 'endurance', 'steadfastness'], archaic: 'patient endurance', textIds: ['1clement'] },
  // 1CL 21:11 — "All these things the great Creator and Master of the universe ordered to be in peace and concord..."
  // also 1CL 64:2, 66:1
  { modern: ['unity', 'harmony', 'peace', 'reconciliation'], archaic: 'peace and concord', textIds: ['1clement'] },

  // ============================ RECOGNITIONS OF CLEMENT ============================

  // RCL1 16:1 — "...is He, we say, who is called the true Prophet, who alone can enlighten the souls of men..."
  // also RCL1 16:3, 17:2 (49 hits across the 10 books) — the Recognitions' standing christological title.
  { modern: ['messiah', 'Yeshua', 'christ', 'the anointed one'], archaic: 'the true Prophet', textIds: ['recog_clement'] },
  // RCL2 5:2 — "...and what is worse than all, he is greatly skilled in the magic art."
  // also RCL2 6:6 "...he depends upon magic arts and wicked devices", RCL2 9:2 (10 hits)
  { modern: ['sorcery', 'magic', 'witchcraft', 'occult'], archaic: 'magic art', textIds: ['recog_clement'] },
  // RCL1 19:2 — "...for I am to have a contest with Simon the magician."; also RCL1 21:4 "the magician Simon",
  // RCL10 56:1 "Simon Magus"
  { modern: ['sorcerer', 'magician', 'wizard', 'simon magus'], archaic: 'Simon the magician', textIds: ['recog_clement'] },
  // RCL1 42:1 — "But inasmuch as it was necessary that the Gentiles should be called into the room of those
  // who remained unbelieving..."; also RCL1 50:1, 50:2
  { modern: ['nations', 'non-jews', 'the heathen', 'pagans'], archaic: 'the Gentiles', textIds: ['recog_clement'] },
  // RCL4 34:3 — "...to send forth into this world false prophets, and false apostles, and false teachers,
  // who should speak indeed in the name of Christ..."; also RCL8 53:1
  { modern: ['heretics', 'deceivers', 'cult leaders'], archaic: 'false prophets', textIds: ['recog_clement'] },
]
