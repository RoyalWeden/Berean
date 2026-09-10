"""
Recognitions of Clement — add ANF chapter titles + fix Book IX chapter merges.

Part 1 — Book IX re-chaptering
  The original seed merged two pairs of ANF chapters in Book IX (its
  chapter-heading regex missed two headings that had wrapped in the source), so
  the book had 36 chapters where ANF has 38. One merged heading also survived as
  four one-word verses ("Gospel" / "More" / "Powerful" / "Than").
    old ch 25  = ANF 25 (vv 1-5) + ANF 26 (vv 6-7)        -> split
    old ch 27  = ANF 28 (vv 1-4) + ANF 29 (vv 9-10)       -> split, drop vv 5-8
  Everything after is renumbered so Book IX runs 1..38, 1:1 with ANF.

Part 2 — chapter titles
  Adds a `title` column to `verses` (already understood by
  electron/ipc/bible.ts's hasTitleCol + rendered by ChapterView as a faint
  heading) and sets it on verse_num 1 of every chapter to the ANF (Roberts-
  Donaldson) chapter heading, verbatim. Book III is stored contiguously (1..65)
  though ANF numbers it 1, then 12..75 (Rufinus dropped chs 2-11); DB ch n>=2
  therefore takes the ANF title for n+10.

Idempotent: skips Part 1 if Book IX already has 38 chapters; Part 2 re-runs
harmlessly (UPDATE by ref).
"""
import sqlite3

DB = '/Users/roywe/Berean/data/recog_clement.db'

# --- ANF chapter titles -----------------------------------------------------
# Keyed by DB book_id -> { db_chapter: title }.  For every book except RCL3 the
# DB chapter number equals the ANF chapter number.

RCL1 = [
    "Clement's Early History; Doubts", "His Distress",
    "His Dissatisfaction with the Schools of the Philosophers",
    "His Increasing Disquiet", "His Design to Test the Immortality of the Soul",
    "Hears of Christ", "Arrival of Barnabas at Rome", "His Preaching",
    "Clement's Interposition on Behalf of Barnabas", "Intercourse with Barnabas",
    "Departure of Barnabas",
    "Clement's Arrival at Cæsarea, and Introduction to Peter",
    "His Cordial Reception by Peter", "His Account of Himself",
    "Peter's First Instruction: Causes of Ignorance",
    "Instruction Continued: the True Prophet",
    "Peter Requests Him to Be His Attendant",
    "His Profiting by Peter's Instruction", "Peter's Satisfaction",
    "Postponement of Discussion with Simon Magus", "Advantage of the Delay",
    "Repetition of Instructions", "Repetition Continued", "Repetition Continued",
    "Repetition Continued", "Friendship of God; How Secured",
    "Account of the Creation", "Account of the Creation Continued",
    "The Giants: the Flood", "Noah's Sons", "World After the Flood", "Abraham",
    "Abraham: His Posterity", "The Israelites in Egypt", "The Exodus",
    "Allowance of Sacrifice for a Time", "The Holy Place",
    "Sins of the Israelites", "Baptism Instituted in Place of Sacrifices",
    "Advent of the True Prophet", "Rejection of the True Prophet",
    "Call of the Gentiles", "Success of the Gospel", "Challenge by Caiaphas",
    "The True Prophet: Why Called the Christ", "Anointing",
    "Adam Anointed a Prophet", "The True Prophet, a Priest",
    "Two Comings of Christ", "His Rejection by the Jews", "The Only Saviour",
    "The Saints Before Christ's Coming", "Animosity of the Jews", "Jewish Sects",
    "Public Discussion", "Sadducees Refuted", "Samaritan Refuted",
    "Scribes Refuted", "Pharisees Refuted", "Disciples of John Refuted",
    "Caiaphas Answered", "Foolishness of Preaching", "Appeal to the Jews",
    "Temple to Be Destroyed", "Tumult Stilled by Gamaliel", "Discussion Resumed",
    "Speech of Gamaliel", "The Rule of Faith", "Two Comings of Christ",
    "Tumult Raised by Saul", "Flight to Jericho", "Peter Sent to Caesarea",
    "Welcomed by Zacchaeus", "Simon Magus Challenges Peter",
]  # 74

RCL2 = [
    "Power of Habit", "Curtailment of Sleep", "Need of Caution",
    "Prudence in Dealing with Opponents",
    "Simon Magus, a Formidable Antagonist", "Simon Magus: His Wickedness",
    "Simon Magus: His History", "Simon Magus: His History",
    "Simon Magus: His Profession", "Simon Magus: His Deception",
    "Simon Magus, at the Head of the Sect of Dositheus", "Simon Magus and Luna",
    "Simon Magus: Secret of His Magic", "Simon Magus, Professes to Be God",
    "Simon Magus, Professed to Have Made a Boy of Air",
    "Simon Magus: Hopelessness of His Case", "Men Enemies to God",
    "Responsibility of Men", "Disputation Begun",
    "The Kingdom of God and His Righteousness",
    "Righteousness the Way to the Kingdom", "Righteousness; What It is",
    "Simon Refuses Peace", "Peter's Explanation",
    "Principles on Which the Discussion Should Be Conducted",
    "Simon's Interruption", "Questions and Answers",
    "Consistency of Christ's Teaching", "Peace and Strife",
    "Peace to the Sons of Peace", "Peace and War", "Simon's Challenge",
    "Authority", "Order of Proof", "How Error Cannot Stand with Truth",
    "Altercation", "Simon's Subtlety", "Simon's Creed",
    "Argument for Polytheism", "Peter's Answer", "The Answer, Continued",
    "Guardian Angels", "No God But Jehovah",
    "The Serpent, the Author of Polytheism", "Polytheism Inexcusable",
    "Christ Acknowledged the God of the Jews", "Simon's Cavil", "Peter's Answer",
    "The Supreme Light", "Simon's Presumption", "The Sixth Sense",
    "Reductio Ad Absurdum", "Simon's Blasphemy",
    "How Simon Learned from the Law What the Law Does Not Teach",
    "Simon's Objections Turned Against Himself", "No God Above the Creator",
    "Simon's Inconsistency", "Simon's God Unjust", "The Creator Our Father",
    "The Creator the Supreme God", "Imagination",
    "Peter's Experience of Imagination", "Peter's Reverie", "Andrew's Rebuke",
    "Fallacy of Imagination", "Existence and Conception",
    "The Law Teaches of Immensity", "The Visible and the Invisible Heaven",
    "Faith and Reason", "Adjournment", "Separation from the Unclean",
    "The Remedy",
]  # 72

# Book III — keyed by ANF chapter number (1, then 12..75).
RCL3_ANF = {
    1: "Pearls Before Swine", 12: "Second Day's Discussion", 13: "Simon a Seducer",
    14: "Simon Claims the Fulfilment of Peter's Promise", 15: "Simon's Arrogance",
    16: "Existence of Evil", 17: "Not Admitted by All",
    18: "Manner of Conducting the Discussion", 19: "Desire of Instruction",
    20: "Common Principles", 21: "Freedom of the Will", 22: "Responsibility",
    23: "Origin of Evil", 24: "God the Author of Good, Not of Evil",
    25: '"Who Hath Resisted His Will?"', 26: "No Goodness Without Liberty",
    27: "The Visible Heaven: Why Made", 28: "Why to Be Dissolved",
    29: "Corruptible and Temporary Things Made by the Incorruptible and Eternal",
    30: "How the Pure in Heart See God", 31: "Diligence in Study",
    32: "Peter's Private Instruction", 33: "Learners and Cavillers",
    34: "Against Order is Against Reason", 35: "Learning Before Teaching",
    36: "Self-Evidence of the Truth", 37: "God Righteous as Well as Good",
    38: "God's Justice Shown at the Day of Judgment",
    39: "Immortality of the Soul",
    40: "Proved by the Success of the Wicked in This Life", 41: "Cavils of Simon",
    42: '"Full of All Subtlety and All Mischief"', 43: "Simon's Subterfuges",
    44: "Sight or Hearing?", 45: "A Home-Thrust", 46: "Simon's Rage",
    47: "Simon's Vaunt", 48: "Attempts to Create a Disturbance",
    49: "Simon's Retreat", 50: "Peter's Benediction", 51: "Peter's Accessibility",
    52: "False Signs and Miracles", 53: "Self-Love the Foundation of Goodness",
    54: "God to Be Supremely Loved",
    55: "Ten Commandments Corresponding to the Plagues of Egypt",
    56: "Simon Resisted Peter, as the Magicians Moses",
    57: "Miracles of the Magicians", 58: "Truth Veiled with Love",
    59: "Good and Evil in Pairs", 60: "Uselessness of Pretended Miracles",
    61: "Ten Pairs", 62: "The Christian Life", 63: "A Deserter from Simon's Camp",
    64: "Declaration of Simon's Wickedness", 65: "Peter Resolves to Follow Simon",
    66: "Zacchæus Made Bishop of Cæsarea; Presbyters and Deacons Ordained",
    67: "Invitation to Baptism", 68: "Twelve Sent Before Him",
    69: "Arrangements Approved by All the Brethren", 70: "Departure of the Twelve",
    71: "Peter Prepares the Cæsareans for His Departure",
    72: "More Than Ten Thousand Baptized", 73: "Tidings of Simon",
    74: "Farewell to Cæsarea", 75: "Contents of Clement's Despatches to James",
}
# DB ch 1 -> ANF 1; DB ch n (2..65) -> ANF n+10
RCL3 = {db: RCL3_ANF[1 if db == 1 else db + 10] for db in range(1, 66)}

RCL4 = [
    "Halt at Dora", "Reception in the House of Maro", "Simon's Flight",
    "The Harvest Plenteous", "Moses and Christ", "A Congregation",
    "The Sick Healed", "Providence Vindicated",
    "State of Innocence a State of Enjoyment", "Sin the Cause of Suffering",
    "Suffering Salutary", "Translation of Enoch", "Origin of Idolatry",
    "God Both Good and Righteous", "How Demons Get Power Over Men",
    "Why They Wish to Possess Men", "The Gospel Gives Power Over Demons",
    "This Power in Proportion to Faith", "Demons Incite to Idolatry",
    "Folly of Idolatry", "Heathen Oracles", "Why They Sometimes Come True",
    "Evil Not in Substance", "Why God Permits Evil",
    "Evil Beings Turned to Good Account", "Evil Angels Seducers",
    "Ham the First Magician", "Tower of Babel", "Fire-Worship of the Persians",
    "Hero-Worship", "Idolatry Led to All Immorality", "Invitation",
    "The Weakest Christian More Powerful Than the Strongest Demon",
    "Temptation of Christ", "False Apostles", "The Garments Unspotted",
    "The Congregation Dismissed",
]  # 37

RCL5 = [
    "Peter's Salutation", "Suffering the Effect of Sin", "Faith and Unbelief",
    "Ignorance the Mother of Evils", "Advantages of Knowledge", "Free-Will",
    "Responsibility of Knowledge", "Desires of the Flesh to Be Subdued",
    "The Two Kingdoms", "Yeshua the True Prophet",  # ANF reads "Jesus"; app convention
    "The Expectation of the Gentiles", "Call of the Gentiles",
    "Invitation of the Gentiles", "Idols Unprofitable", "Folly of Idolatry",
    "God Alone a Fit Object of Worship", "Suggestions of the Old Serpent",
    "His First Suggestion", "His Second Suggestion", "Egyptian Idolatry",
    "Egyptian Idolatry More Reasonable Than Others",
    "Second Suggestion Continued", "Third Suggestion", "Fourth Suggestion",
    "Fifth Suggestion", "Sixth Suggestion", "Creatures Take Vengeance on Sinners",
    "Eternity of Punishments", "God's Care of Human Things",
    "Religion of Fathers to Be Abandoned", "Paganism, Its Enormities",
    "True Religion Calls to Sobriety and Modesty", "Origin of Impiety",
    "Who are Worshippers of God?", "Judgment to Come", "Conclusion of Discourse",
]  # 36

RCL6 = [
    "Diligence in Study", "Much to Be Done in a Little Time", "Righteous Anger",
    "Not Peace, But a Sword", "How the Fight Begins",
    "God to Be Loved More Than Parents", "The Earth Made for Men",
    "Necessity of Baptism", "Use of Baptism", "Necessity of Good Works",
    "Inward and Outward Cleansing", "Importance of Chastity",
    "Superiority of Christian Morality", "Knowledge Enhances Responsibility",
    "Bishops, Presbyters, Deacons, and Widows Ordained at Tripolis",
]  # 15

RCL7 = [
    "Journey from Tripolis", "Disciples Divided into Two Bands", "Order of March",
    "Clement's Joy at Remaining with Peter", "Clement's Affection for Peter",
    "Peter's Simplicity of Life", "Peter's Humility", "Clement's Family History",
    "Disappearance of His Mother and Brothers", "Disappearance of His Father",
    "Different Effects of Suffering on Heathens and Christians",
    "Excursion to Aradus", "The Beggar Woman", "The Woman's Grief",
    "The Woman's Story", "The Woman's Story Continued",
    "The Woman's Story Continued", "The Woman's Story Continued",
    "Peter's Reflections on the Story", "Peter's Statement to the Woman",
    "A Discovery", "A Happy Meeting", "A Miracle", "Departure from Aradus",
    "Journeyings", "Recapitulation", "Recapitulation Continued",
    "More Recognitions", '"Nothing Common or Unclean"',
    '"Who Can Forbid Water?"', "Too Much Joy",
    '"He Bringeth Them Unto Their Desired Haven"', "Another Wreck Prevented",
    "Baptism Must Be Preceded by Fasting", "Desiring the Salvation of Others",
    "The Sons' Pleading", "Peter Inexorable", "Reward of Chastity",
]  # 38

RCL8 = [
    "The Old Workman", "Genesis", "A Friendly Conference", "The Question Stated",
    "Freedom of Discussion Allowed", "The Other Side of the Question Stated",
    "The Way Cleared", "Instincts", "Simple and Compound",
    "Creation Implies Providence", "General or Special Providence",
    "Prayer Inconsistent with Genesis", "A Creator Necessary", "Mode of Creation",
    "Theories of Creation", "The World Made of Nothing by a Creator",
    "Doctrine of Atoms Untenable",
    "The Concourse of Atoms Could Not Make the World",
    "More Difficulties of the Atomic Theory", "Plato's Testimony",
    "Mechanical Theory", "Motions of the Stars", "Providence in Earthly Things",
    "Rivers and Seas", "Plants and Animals", "Germination of Seeds",
    "Power of Water", "The Human Body", "Symmetry of the Body",
    "Breath and Blood", "The Intestines", "Generation",
    "Correspondences in Creation", "Time of Making the World",
    "A Contest of Hospitality", "Arrangements for To-Morrow",
    '"The Form of Sound Words, Which Ye Have Heard of Me"',
    "The Chief Man's House", "Recapitulation of Yesterday's Argument", "Genesis",
    "The Rainbow", "Types and Forms",
    "Things Apparently Useless and Vile Made by God", "Ordinate and Inordinate",
    "Motions of the Sun and Moon",
    "Sun and Moon Ministers Both of Good and Evil",
    "Chastisements on the Righteous and the Wicked", "Chastisements for Sins",
    "God's Precepts Despised", "The Flood", "Evils Brought in by Sin",
    '"No Rose Without Its Thorn"',
    "Everything Has Its Corresponding Contrary", "An Illustration",
    "The Two Kingdoms", "Origin of Evil", "The Old Man Unconvinced",
    "Sitting in Judgment Upon God", "The True Prophet",
    "His Deliverances Not to Be Questioned", "Ignorance of the Philosophers",
    "End of the Conference",
]  # 62

RCL9 = [
    "An Explanation", "Preliminaries", "Beginning of the Discussion",
    "Why the Evil Prince Was Made", "Necessity of Inequality",
    "Arrangements of the World for the Exercise of Virtue",
    "The Old and the New Birth", "Uses of Evils", '"Conceived in Sin"',
    "Tow Smeared with Pitch", "Fear", "Astrologers",
    "Retribution Here or Hereafter", "Knowledge Deadens Lusts",
    "Fear of Men and of God", "Imperfect Conviction", "Astrological Lore",
    "The Reply", "Refutation of Astrology", "Brahmans", "Districts of Heaven",
    "Customs of the Gelones", "Manners of the Susidæ",
    "Different Customs of Different Countries", "Not Genesis, But Free-Will",
    "Climates", 'Doctrine of "Climates" Untenable', "Jewish Customs",
    'The Gospel More Powerful Than "Genesis"',
    '"Genesis" Inconsistent with God\'s Justice', "Value of Knowledge",
    "Stubborn Facts", "An Approaching Recognition", "The Other Side of the Story",
    "Revelations", "New Revelations", "Another Recognition", '"Angels Unawares"',
]  # 38

RCL10 = [
    "Probation", "A Difficulty", "A Suggestion", "Free Inquiry", "Good and Evil",
    "Peter's Authority", "Clement's Argument", "Admitted Evils",
    "Existence of Evil on Astrological Principles", "How to Make Progress",
    "Test of Astrology", "Astrology Baffled by Free-Will", "People Admitted",
    "No Man Has Universal Knowledge", "Clement's Disclosure",
    '"Would that All God\'s People Were Prophets."', "Gentile Cosmogony",
    "Family of Saturn", "Their Destinies", "Doings of Jupiter",
    "A Black Catalogue", "Vile Transformation of Jupiter", "Why a God?",
    "Folly of Polytheism", "Dead Men Deified", "Metamorphoses",
    "Inconsistency of Polytheists", "Buttresses of Gentilism", "Allegories",
    "Cosmogony of Orpheus", "Hesiod's Cosmogony", "Allegorical Interpretation",
    "Allegory of Jupiter, Etc.", "Other Allegories",
    "Uselessness of These Allegories", "The Allegories an Afterthought",
    "Like Gods, Like Worshippers", "Writings of the Poets", "All for the Best",
    "Further Information Sought", "Explanation of Mythology",
    "Interpretation of Scripture", "A Word of Exhortation", "Earnestness",
    "All Ought to Repent", "The Sure Word of Prophecy",
    '"A Faithful Saying, and Worthy of All Acceptation."',
    "Errors of the Philosophers", "God's Long-Suffering",
    "Philosophers Not Benefactors of Men", "Christ the True Prophet",
    "Appion and Anubion", "A Transformation", "Excitement in Antioch",
    "A Stratagem", "Simon's Design in the Transformation", "Great Grief",
    "How It All Happened", "A Scene of Mourning", "A Counterplot", "A Mine Dug",
    "A Case of Conscience", "A Pious Fraud", "A Competition in Lying",
    "Success of the Plot", "Truth Told by Lying Lips",
    "Faustinianus is Himself Again", "Peter's Entry into Antioch",
    "Peter's Thanksgiving", "Miracles", "Success", "Happy Ending",
]  # 72

TITLES = {
    'RCL1': {i + 1: t for i, t in enumerate(RCL1)},
    'RCL2': {i + 1: t for i, t in enumerate(RCL2)},
    'RCL3': RCL3,
    'RCL4': {i + 1: t for i, t in enumerate(RCL4)},
    'RCL5': {i + 1: t for i, t in enumerate(RCL5)},
    'RCL6': {i + 1: t for i, t in enumerate(RCL6)},
    'RCL7': {i + 1: t for i, t in enumerate(RCL7)},
    'RCL8': {i + 1: t for i, t in enumerate(RCL8)},
    'RCL9': {i + 1: t for i, t in enumerate(RCL9)},
    'RCL10': {i + 1: t for i, t in enumerate(RCL10)},
}


def rechapter_book_ix(conn):
    cur = conn.cursor()
    n = cur.execute("SELECT COUNT(DISTINCT chapter) FROM verses WHERE book_id='RCL9'").fetchone()[0]
    if n == 38:
        print('Book IX already has 38 chapters — skipping re-chaptering.')
        return
    assert n == 36, f'Book IX has {n} chapters, expected 36 or 38'

    rows = cur.execute(
        "SELECT chapter, verse_num, text FROM verses WHERE book_id='RCL9' ORDER BY chapter, verse_num"
    ).fetchall()
    by_ch = {}
    for ch, vn, txt in rows:
        by_ch.setdefault(ch, []).append((vn, txt))

    # sanity: the split points are where we expect them
    assert by_ch[25][5][1].startswith('"But some one skilled in the science of mathematics'), by_ch[25][5][1][:60]
    assert [t for _, t in by_ch[27][4:8]] == ['Gospel', 'More', 'Powerful', 'Than'], by_ch[27][4:8]
    assert by_ch[27][8][1].startswith('"But I shall give a still stronger proof'), by_ch[27][8][1][:60]

    new_chapters = []  # list of list[str] (0-based -> chapter i+1)
    for ch in range(1, 25):
        new_chapters.append([t for _, t in by_ch[ch]])
    new_chapters.append([t for _, t in by_ch[25][:5]])   # 25  ANF 25
    new_chapters.append([t for _, t in by_ch[25][5:]])   # 26  ANF 26
    new_chapters.append([t for _, t in by_ch[26]])       # 27  ANF 27
    new_chapters.append([t for _, t in by_ch[27][:4]])   # 28  ANF 28
    new_chapters.append([t for _, t in by_ch[27][8:]])   # 29  ANF 29 (drop vv 5-8)
    for ch in range(28, 37):
        new_chapters.append([t for _, t in by_ch[ch]])   # 30..38  ANF 30..38
    assert len(new_chapters) == 38

    cur.execute("DELETE FROM verses WHERE book_id='RCL9'")
    for ci, verses in enumerate(new_chapters, start=1):
        for vi, txt in enumerate(verses, start=1):
            cur.execute(
                "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES ('RCL9', ?, ?, ?)",
                (ci, vi, txt),
            )
    cur.execute("UPDATE books SET chapters_count=38 WHERE id='RCL9'")
    print(f'Book IX re-chaptered: 36 -> 38 ({sum(len(c) for c in new_chapters)} verses).')


def add_titles(conn):
    cur = conn.cursor()
    cols = [r[1] for r in cur.execute("PRAGMA table_info(verses)").fetchall()]
    if 'title' not in cols:
        cur.execute("ALTER TABLE verses ADD COLUMN title TEXT")
        print('Added verses.title column.')

    total = 0
    for book_id, chmap in TITLES.items():
        db_chapters = [r[0] for r in cur.execute(
            "SELECT DISTINCT chapter FROM verses WHERE book_id=? ORDER BY chapter", (book_id,)
        ).fetchall()]
        assert db_chapters == sorted(chmap), \
            f'{book_id}: DB chapters {db_chapters[:3]}..{db_chapters[-3:]} vs titles {sorted(chmap)[:3]}..{sorted(chmap)[-3:]}'
        for ch, title in chmap.items():
            cur.execute(
                "UPDATE verses SET title=? WHERE book_id=? AND chapter=? AND verse_num=1",
                (title, book_id, ch),
            )
            total += cur.rowcount
    print(f'Set {total} chapter titles.')


def main():
    conn = sqlite3.connect(DB)
    try:
        rechapter_book_ix(conn)
        add_titles(conn)
        conn.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")
        conn.commit()

        cur = conn.cursor()
        ok = cur.execute("PRAGMA integrity_check").fetchone()[0]
        counts = cur.execute(
            "SELECT book_id, COUNT(DISTINCT chapter) FROM verses GROUP BY book_id ORDER BY CAST(SUBSTR(book_id,4) AS INT)"
        ).fetchall()
        missing = cur.execute("""
            SELECT v.book_id, v.chapter FROM verses v
            WHERE v.verse_num=1 AND (v.title IS NULL OR v.title='')
        """).fetchall()
        misplaced = cur.execute("SELECT COUNT(*) FROM verses WHERE verse_num<>1 AND title IS NOT NULL").fetchone()[0]
        print(f'\nintegrity={ok}  chapters-without-title={missing or "none"}  title-on-non-v1={misplaced}')
        print('book chapter counts:', {b: c for b, c in counts})
        print('\nSamples:')
        for ref in [('RCL3', 45), ('RCL3', 46), ('RCL9', 25), ('RCL9', 26),
                    ('RCL9', 29), ('RCL1', 74), ('RCL2', 72), ('RCL10', 25)]:
            row = cur.execute(
                "SELECT title, substr(text,1,60) FROM verses WHERE book_id=? AND chapter=? AND verse_num=1", ref
            ).fetchone()
            print(f'  {ref[0]} {ref[1]}: [{row[0]}]  {row[1]}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
