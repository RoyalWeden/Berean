// Curated modern-English -> archaic-translation-wording phrase table for the three "testament"
// genre pseudepigrapha: Testaments of the Twelve Patriarchs (R.H. Charles, 1908 — same formal
// period English as the existing Jubilees/Enoch entries), Testament of Job (Kohler/James, heavy
// thou/thee register), and Testament of Jacob (Stinespring, OTP — a *modern* rendering, so only
// its genuinely non-obvious periphrases are listed rather than an even share of entries).
// Every entry below was verified against the real text in data/t12p.db / data/t_job.db /
// data/t_jacob.db via direct sqlite3 queries before being added — the inline citation on each
// entry is a confirming book_id + chapter:verse where the archaic string appears verbatim.
//
// textIds values here are exactly one/more of: 't12p' | 't_job' | 't_jacob'
import type { ArchaicPhraseRule } from './archaicVocab'

export const TESTAMENTS_ARCHAIC_VOCAB: ArchaicPhraseRule[] = [
  // --- T12P: the "spirit of X" formula (the structural device of the whole work) ---
  // TREU 2:1 "...concerning the seven spirits of deceit..." (also TSIM 6:6, TLEV 3:3, TISS 4:4)
  { modern: ['demons', 'evil spirits', 'deceiving spirits', 'unclean spirits'], archaic: 'the spirits of deceit', textIds: ['t12p'] },
  // TREU 3:2 "...First, the spirit of fornication is seated in the nature and in the senses..." (also TREU 5:3, TJUD 14:2)
  { modern: ['lust', 'sexual desire', 'temptation to sexual sin'], archaic: 'the spirit of fornication', textIds: ['t12p'] },
  // TDAN 1:8 "Now this is the spirit of anger that persuaded me to crush Joseph..." (also TDAN 2:4)
  { modern: ['anger', 'rage', 'temper', 'wrath'], archaic: 'the spirit of anger', textIds: ['t12p'] },
  // TGAD 1:9 "...And the spirit of hatred was in me..." (also TGAD 3:1, 4:7, 6:2)
  { modern: ['hatred', 'hate', 'resentment', 'bitterness'], archaic: 'the spirit of hatred', textIds: ['t12p'] },
  // TSIM 4:7 "...love each one his brother with a good heart and the spirit of envy will withdraw..."
  { modern: ['envy', 'jealousy', 'covetousness'], archaic: 'the spirit of envy', textIds: ['t12p'] },
  // TGAD 4:7 "...but the spirit of love worketh together with the law of God in long-suffering..."
  { modern: ['love', 'charity', 'brotherly love'], archaic: 'the spirit of love', textIds: ['t12p'] },
  // TJUD 20:1 "...the spirit of truth and the spirit of deceit..." (also TJUD 20:5)
  { modern: ['the Holy Spirit', 'the Spirit', 'the Spirit of Truth'], archaic: 'the spirit of truth', textIds: ['t12p'] },

  // --- T12P: sin vocabulary ---
  // TREU 1:7 "...that ye walk not in the sins of youth and fornication..." (also TREU 3:2, 4:6, 4:7; TSIM 5:3; TJUD 18:2)
  { modern: ['sexual immorality', 'sexual sin', 'adultery', 'immorality', 'lust'], archaic: 'fornication', textIds: ['t12p'] },
  // TSIM 4:5 "...beware, my children, of all jealousy and envy..." (also TREU 3:6, 6:5; TSIM 2:7, 4:9)
  { modern: ['envy', 'resentment', 'covetousness'], archaic: 'jealousy', textIds: ['t12p'] },
  // TDAN 3:5 "...for wrath ever aideth such in lawlessness." (also TDAN 6:6, TNAP 4:1)
  { modern: ['sin', 'wickedness', 'iniquity', 'sinfulness'], archaic: 'lawlessness', textIds: ['t12p'] },
  // TJUD 18:2 "Beware, therefore, my children, of fornication, and the love of money..." (also TJUD 19:1)
  { modern: ['greed', 'avarice', 'materialism', 'covetousness'], archaic: 'the love of money', textIds: ['t12p'] },
  // TASH 3:2 "...for they that are double-faced serve not God..." (also TASH 4:4, 6:2)
  // NOTE: "two-faced" and "hypocrite" as such are NOT in the DB — Charles renders it "double-faced".
  { modern: ['hypocrisy', 'hypocrite', 'two-faced', 'duplicity', 'insincere'], archaic: 'double-faced', textIds: ['t12p'] },

  // --- T12P: virtue vocabulary (the positive half of the testament formula) ---
  // TREU 4:1 "...but walk in singleness of heart in the fear of the Lord..." (also TSIM 4:5 "singleness of soul", TISS 4:1)
  { modern: ['sincerity', 'integrity', 'wholehearted', 'single-minded', 'purity of heart'], archaic: 'singleness of heart', textIds: ['t12p'] },
  // TBEN 4:2 "...with a good mind, that ye also may wear crowns of glory." (also TBEN 5:1, 6:5)
  { modern: ['pure heart', 'good conscience', 'right attitude', 'purity of mind'], archaic: 'a good mind', textIds: ['t12p'] },
  // TJOS 4:2 "...she lauded me openly as chaste..." (also TJOS 4:3, 6:7)
  { modern: ['sexual purity', 'celibacy', 'self-control', 'moral purity'], archaic: 'chastity', textIds: ['t12p'] },
  // TDAN 6:8, TGAD 4:7 "...in long-suffering unto the salvation of men."
  { modern: ['patience', 'forbearance', 'endurance'], archaic: 'long-suffering', textIds: ['t12p'] },
  // TSIM 2:4 "...And my bowels without compassion." (also TZEB 2:1-2 "have mercy upon the bowels of Jacob our father")
  // NOTE: "bowels" here is the seat of compassion, not the organ — a modern query for "compassion" misses these.
  { modern: ['compassion', 'pity', 'mercy', 'tenderness'], archaic: 'bowels', textIds: ['t12p'] },

  // --- T12P: spirit world / divine titles ---
  // TREU 4:11 "...if fornication overcomes not your mind, neither can Beliar overcome you." (also TREU 4:8, 6:4; TSIM 5:3; TISS 7:7)
  // NOTE: the spelling is "Beliar", never "Belial" — "Belial" returns zero rows.
  { modern: ['satan', 'the devil', 'belial', 'the evil one', 'the adversary'], archaic: 'Beliar', textIds: ['t12p'] },
  // TSIM 2:5 "...valour also has been given from the Most High to men..." (also TSIM 6:7, TGAD 3:1 "the law of the Most High")
  { modern: ['God', 'Yehovah', 'the Lord', 'the Almighty'], archaic: 'the Most High', textIds: ['t12p'] },
  // TREU 1:6 "...I call to witness against you this day the God of heaven..." (also TREU 6:9, TISS 7:7)
  { modern: ['God', 'Yehovah', 'the Lord'], archaic: 'the God of heaven', textIds: ['t12p'] },
  // TREU 5:6 "...thus they allured the Watchers who were before the flood..." (also TREU 5:7, TNAP 3:5)
  { modern: ['angels', 'fallen angels', 'the sons of God'], archaic: 'the Watchers', textIds: ['t12p'] },
  // TASH 6:6 "...the angel of peace..."
  { modern: ['guardian angel', 'ministering angel', 'the angel'], archaic: 'the angel of peace', textIds: ['t12p'] },
  // TSIM 5:4 "For I have seen it inscribed in the writing of Enoch..." (also TNAP 4:1)
  { modern: ['the book of Enoch', 'Enochic scripture', 'the prophecy of Enoch'], archaic: 'the writing of Enoch', textIds: ['t12p'] },

  // --- T12P: judgment / eschatology ---
  // TLEV 1:2 "...what things should befall them until the day of judgement." (also TLEV 3:2, 3:3)
  // NOTE the British spelling — "the day of judgment" (US) returns ZERO rows in t12p.db.
  { modern: ['judgment day', 'the day of judgment', 'final judgment', 'the last judgment'], archaic: 'the day of judgement', textIds: ['t12p'] },
  // TLEV 3:3 "...to work vengeance on the spirits of deceit and of Beliar." (also TLEV 2:3, 5:3; TDAN 5:10)
  { modern: ['revenge', 'retribution', 'punishment', 'justice'], archaic: 'vengeance', textIds: ['t12p'] },
  // TLEV 4:4 "...Until the Lord shall visit all the Gentiles in His tender mercies for ever." (also TSIM 7:2, TLEV 8:15)
  { modern: ['the nations', 'non-Jews', 'foreigners', 'the heathen'], archaic: 'the Gentiles', textIds: ['t12p'] },

  // --- T12P: general period verbs / idioms ---
  // TGAD 1:9 "...I was wroth with Joseph until the day that he was sold..." (also TSIM 2:11, TLEV 6:6, TJUD 7:4)
  { modern: ['angry', 'furious', 'enraged'], archaic: 'wroth', textIds: ['t12p'] },
  // TJOS 4:3 "...I lay upon the ground, and besought God..." (also TSIM 2:13, TJUD 7:7, TJOS 5:4, 13:2)
  { modern: ['begged', 'pleaded', 'implored', 'prayed'], archaic: 'besought', textIds: ['t12p'] },
  // TSIM 2:1 "...hearken to the words of truth..." (also TREU 6:8, TSIM 3:1, TSIM 3:2, TJUD 1:3)
  { modern: ['listen', 'pay attention', 'obey', 'heed'], archaic: 'hearken', textIds: ['t12p'] },
  // TLEV 12:3 "...took to wife..." (also TLEV 12:4, 14:6; TJUD 8:3, 10:1)
  { modern: ['married', 'marry', 'marriage', 'wed'], archaic: 'to wife', textIds: ['t12p'] },
  // TREU 4:8 "...himself with the sons of men..." (also TLEV 2:4, 3:9, 4:1; TJUD 24:1; TASH 1:3)
  { modern: ['humanity', 'mankind', 'humankind', 'people'], archaic: 'the sons of men', textIds: ['t12p'] },

  // --- Testament of Job ---
  // TJOB 4:7 "...the Seducer could not bear to see the good [I did]..." (also TJOB 1:13 "the Seducer (Satan)", 4:12)
  { modern: ['satan', 'the devil', 'the tempter', 'the adversary'], archaic: 'the Seducer', textIds: ['t_job'] },
  // TJOB 2:7 "The Evil One, having failed in this, went away..." (also TJOB 5:1)
  { modern: ['satan', 'the devil', 'the tempter'], archaic: 'the Evil One', textIds: ['t_job'] },
  // TJOB 5:10 "...sitting on a dung-hill outside of the city while being plague-stricken." (also TJOB 6:1, 7:9)
  // NOTE hyphenated — "dunghill" and "ash heap" both return zero rows.
  { modern: ['ash heap', 'rubbish heap', 'refuse pile', 'the ashes'], archaic: 'dung-hill', textIds: ['t_job'] },
  // TJOB 1:21 "Then thou must wrestle like an athlete and resist pain, sure of thy reward, overcome trials and afflictions."
  { modern: ['suffering', 'hardship', 'testing', 'trials'], archaic: 'trials and afflictions', textIds: ['t_job'] },
  // TJOB 5:8 "...matter flowed off my body, and many worms covered it." (also TJOB 11:17, 11:18 "the plagues and the worms")
  { modern: ['disease', 'sickness', 'sores', 'illness', 'boils'], archaic: 'the plagues and the worms', textIds: ['t_job'] },
  // TJOB 1:10 "...there was the idol of one worshipped by the people; and I saw constantly burnt-offerings brought to him as a god."
  // (also TJOB 1:13 "burnt-offerings and libations", 1:15, 2:1)
  { modern: ['idolatry', 'idol worship', 'pagan sacrifice', 'pagan worship'], archaic: 'the idol', textIds: ['t_job'] },
  // TJOB 11:12 "...he opened it and took out three-stringed girdles..." (also TJOB 11:14, 11:24 — the daughters' inheritance)
  { modern: ['sashes', 'cords', 'bands', 'the daughters inheritance'], archaic: 'girdles', textIds: ['t_job'] },
  // TJOB 11:27 "She spoke in the dialect of the Cherubim, singing the praise of the Ruler of the cosmic powers..."
  { modern: ['angelic language', 'tongues', 'the language of angels'], archaic: 'the dialect of the Cherubim', textIds: ['t_job'] },
  // TJOB 1:17 "...For I am the archangel of the God." (also TJOB 1:19)
  { modern: ['Michael', 'angel', 'the angel of the Lord'], archaic: 'the archangel', textIds: ['t_job'] },
  // TJOB 1:24 "And also to thee shall it be given, and thou shalt put on a crown of amarant."
  { modern: ['eternal crown', 'crown of glory', 'unfading crown', 'reward'], archaic: 'a crown of amarant', textIds: ['t_job'] },
  // TJOB 1:26 "...I shall from love of God endure until death all that will come upon me..." (also TJOB 1:22, 2:15, 5:10)
  // NOTE: "patience" appears only once (TJOB 5:1) — the concept is carried by "endure"/"endurest" throughout.
  { modern: ['patience', 'perseverance', 'steadfastness', 'patient endurance'], archaic: 'endure', textIds: ['t_job'] },

  // --- Testament of Jacob (Stinespring is modern English — only its real periphrases listed) ---
  // TJAC 1:5 "...our father Jacob, father of fathers..." (also TJAC 7:1, 7:2, 7:7, 7:14, 7:22)
  { modern: ['patriarch', 'Jacob', 'Israel the patriarch'], archaic: 'father of fathers', textIds: ['t_jacob'] },
  // TJAC 5:9 "...their punishment is the fire which will not be extinguished and the outer darkness where there is weeping and gnashing of teeth."
  { modern: ['hell', 'damnation', 'eternal punishment'], archaic: 'the outer darkness', textIds: ['t_jacob'] },
  // TJAC 7:13 "...he would call them the sword of the Lord, which is the river of fire, prepared with its waves to engulf the evildoers..."
  { modern: ['hell', 'lake of fire', 'the fire of judgment'], archaic: 'the river of fire', textIds: ['t_jacob'] },
  // TJAC 1:5 "...for him to steal away from his body..."; TJAC 6:2 "...when he went out from his body..."
  { modern: ['died', 'death', 'passed away', 'dying'], archaic: 'steal away from his body', textIds: ['t_jacob'] },
  // TJAC 7:11 "...their love of mankind, and their acceptance of strangers..." (also TJAC 7:22 "be generous to strangers", 2:23 "take in strangers")
  { modern: ['hospitality', 'welcoming guests', 'kindness to foreigners'], archaic: 'acceptance of strangers', textIds: ['t_jacob'] },
  // TJAC 5:6 "So the heavens rejoiced that he could observe the places of repose."
  { modern: ['paradise', 'heaven', 'the afterlife', 'eternal rest'], archaic: 'the places of repose', textIds: ['t_jacob'] },
  // TJAC 5:7 "And behold, there approached numerous tormentors differing in their aspects." (also TJAC 5:8)
  { modern: ['demons', 'punishing angels', 'devils'], archaic: 'tormentors', textIds: ['t_jacob'] },
  // TJAC 5:4 "...and he blessed them with the celestial blessing."
  { modern: ['heavenly blessing', 'divine blessing', 'benediction'], archaic: 'the celestial blessing', textIds: ['t_jacob'] },
]
