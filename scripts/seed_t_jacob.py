"""
seed_t_jacob.py — Seed t_jacob.db with the Testament of Jacob
Source: W.F. Stinespring translation, in Charlesworth (ed.), Old Testament
Pseudepigrapha, Vol. 1 ("Testaments of the Three Patriarchs"), pp. 913-918.
Transcribed from /Users/roywe/Downloads/testament-of-jacob.pdf (page images,
not the PDF's raw text layer — the raw layer has ligature dropouts, e.g.
"identi es"/"con dence"/"nished", and the printed page interleaves marginal
cross-reference citations and footnote markers into the running text, both
of which are omitted here as apparatus rather than translated text).

Verse-boundary rule (confirmed against the source images): the printed page
shows a verse's number in the left margin next to whatever LINE that verse's
text happens to start on — but when the previous verse's tail text still
occupies the front of that same line, the actual boundary is marked mid-line
by a "•" character, not by the margin number's line position. So the text
BEFORE a "•" on a numbered line belongs to the PREVIOUS verse (continuing
from the line above), and the margin number's own verse begins AT the "•".
A margin number on a line with no "•" before it (a fresh sentence start,
often after the previous verse already ended in terminal punctuation) marks
its boundary at the line's own start, same as usual. Compound margin labels
like "2,3" mark two boundaries falling on one printed line — one per "•" (or
one at the line start, for the label's first number, if that verse begins
without a preceding "•").
"""
import sqlite3, os

DB = '/Users/roywe/Berean/data/t_jacob.db'

# ── Stinespring translation, verse data ──────────────────────────────────────
# Chapter 5, verses 10-15 are Stinespring's own bracketed editorial summary of a
# lacuna in the Arabic manuscript (supplied from the Bohairic), printed as
# numbered verses in the source — kept as-is, brackets included.

VERSES = {
    1: [
        (1,  "In the name of the Father, the Son, and the Holy Spirit, the one God."),
        (2,  "We begin, with the help of God Most High and through his mediation, to write the life story of our father, the patriarch Jacob, son of the patriarch Isaac, on the twenty-eighth day of the month of Misri."),
        (3,  "May the blessing of his prayer guard us and protect us from the temptations of the obstinate enemy. Amen, amen, amen!"),
        (4,  "He said, \"Come, listen, my beloved ones and my brethren who love the Lord, to what has been received.\""),
        (5,  "Now when the time of our father Jacob, father of fathers, son of Isaac, son of Abraham, approached and drew near for him to steal away from his body, this faithful one was advanced in years and distinction."),
        (6,  "So the Lord sent to him Michael, the chief of the angels, who said to him, \"O Israel, my beloved, of noble lineage, write down your spoken legacy and your instruction for your household and give them a covenant; also concern yourself with the proper ordering of your household, for the time has drawn near for you to go to your fathers to rejoice with them forever.\""),
        (7,  "So when our father Jacob, the faithful one, heard this from the angel, he answered and said, as was his custom every day to speak in this manner with the angels, \"Let the will of the Lord be done.\""),
        (8,  "And God pronounced a blessing upon our father Jacob."),
        (9,  "Jacob had a secluded place which he would enter to offer his prayers before the Lord in the night and in the day."),
        (10, "The angels would visit him and guard him and strengthen him in all things."),
        (11, "God blessed him and multiplied his people in the land of Egypt at the time when he went down to the land of Egypt to meet his son Joseph."),
        (12, "His eyes had become dull from weeping, but when he went down to Egypt he saw clearly when he beheld his son."),
        (13, "So Jacob-Israel bowed with his face to the ground, then fell upon the neck of his son Joseph and kissed him, while weeping and saying, \"I can die now, O my son, because I have seen your face once more in my lifetime; O my beloved son.\""),
    ],
    2: [
        (1,  "Joseph continued to rule over all Egypt, while Jacob stayed in the land of Goshen for seventeen years and became very old, so that his life-span was completed."),
        (2,  "He continually kept all the commandments and feared the Lord."),
        (3,  "His eyes grew dim and his lifetime was so nearly finished that he could not see a single person because of his long life and senility."),
        (4,  "Then he lifted his eyes toward the light of Isaac, but he was afraid and became disturbed."),
        (5,  "So the angel said to him, \"Do not fear, O Jacob; I am the angel who has been walking with you and guarding you from your infancy.\""),
        (6,  "\"I announced that you would receive the blessing of your father and of Rebecca, your mother.\""),
        (7,  "\"I am the one who is with you, O Israel, in all your acts and in everything which you have witnessed.\""),
        (8,  "\"I saved you from Laban when he was endangering you and pursuing you.\""),
        (9,  "\"At that time I gave you all his possessions and blessed you, your wives, your children, and your flocks.\""),
        (10, "\"I am the one who saved you from the hand of Esau.\""),
        (11, "\"I am the one who accompanied you to the land of Egypt, O Israel, and a very great people was given to you.\""),
        (12, "\"Blessed is your father Abraham, for he has become the friend of God—may he (God) be exalted!—because of his generosity and love of strangers.\""),
        (13, "Blessed is your father Isaac who begot you, for he was a perfect sacrifice, acceptable to God."),
        (14, "\"Blessed are you also, O Jacob, for you have seen God face to face.\""),
        (15, "\"You saw the angel of God—may he be exalted!—and you saw the ladder standing firm on the ground with its top in the heavens.\""),
        (16, "\"Then you beheld the Lord sitting at its top with a power which no one could describe.\""),
        (17, "\"You spoke out and said, 'This is the house of God and this is the gate of heaven.'\""),
        (18, "\"Blessed are you, for you have come near to God and he is strong among mankind, so now do not be troubled, O chosen one of God.\""),
        (19, "\"Blessed are you, O Israel, and blessed is all your progeny.\""),
        (20, "\"For all of you will be called 'the patriarchs' to the end of the age and of the epochs; you are the people and the lineage of the servants of God.\""),
        (21, "\"Blessed be the nation which will strive for your purity and will see your good works.\""),
        (22, "\"Blessed be the man who will remember you on the day of your noble festival.\""),
        (23, "\"Blessed be the one who will perform acts of mercy in honor of your several names, and will give someone a cup of water to drink, or will come with an offering to the sanctuary, or will take in strangers, or visit the sick and console their children, or will clothe a naked one in honor of your several names.\""),
        (24, "\"Such a one shall neither lack any of the good things of this world, nor life everlasting in the world to come.\""),
        (25, "\"Moreover, whoever shall have caused to be written the stories of your several lives and sufferings at his own expense, or shall have written them by his own hand, or shall have read them soberly, or shall hear them in faith, or shall remember your deeds—such persons will have their sins forgiven and their trespasses pardoned, and they will go on account of you and your progeny into the kingdom of heaven.\""),
        (26, "\"And now rise up, Jacob, for you will be translated from hardship and pain of heart to eternal rest, and you will enter into the repose which shall not pass away, into mercy, eternal light, and spiritual joy.\""),
        (27, "\"So now make your statement to your household, and peace be upon you, for I am about to go to him who sent me.'\""),
    ],
    3: [
        (1,  "So when the angel had made this statement to our father Jacob, he ascended from him into heaven, as Jacob bade him farewell."),
        (2,  "Those who were around Jacob heard him as he thanked God and glorified him with praise."),
        (3,  "And all the members of his household, great and small, gathered around him, weeping over him, deeply grieving and saying, \"You are going away and leaving us as orphans.\""),
        (4,  "And they kept on saying to him, \"O our beloved father, what shall we do, for we are in a strange land?\""),
        (5,  "So Jacob said to them, \"Do not fear; God himself appeared to me in Upper Mesopotamia and said to me, 'I am the God of your fathers; do not fear, for I am with you forever and with your descendants who will come after you."),
        (6,  "This land in which you are I am about to give to you and to your descendants after you forever."),
        (7,  "And do not be afraid to go down to Egypt."),
        (8,  "I will make for you a great people and your descendants will increase and multiply forever."),
        (9,  "Joseph will put his hand on your eyes and your people will multiply in the land of Egypt."),
        (10, "Afterward they will come to this place and will be without care."),
        (11, "I will do good to them for your sake, though for the time being they will be displaced from here.'\""),
    ],
    4: [
        (1,  "After this, the time for Jacob-Israel to leave his body had arrived."),
        (2,  "So he summoned Joseph and said to him, \"If indeed you have found grace, place your blessed hand under my side and swear an oath before the Lord that you will place my body in the tomb of my fathers.\""),
        (3,  "Then Joseph said to him, \"I will do exactly what you command me, O beloved of God.\""),
        (4,  "But he said to Joseph, \"I want you to swear to me.\""),
        (5,  "So Joseph swore to Jacob, his father, to the effect that he would carry his body to the tomb of his fathers, and Jacob accepted the oath of his son."),
        (6,  "Afterward, this report reached Joseph: \"Your father has become uneasy.\""),
        (7,  "So he took his two sons, Ephraim and Manasseh, and went before his father Jacob."),
        (8,  "Joseph said to him, \"These are my sons whom God has given me in the land of Egypt to come after me.\""),
        (9,  "Israel said, \"Bring them closer to me here.\""),
        (10, "For the eyes of Israel had become dim from his advanced age so that he could not see."),
        (11, "So Joseph brought his sons closer and Jacob kissed them."),
        (12, "Then Joseph commanded them, namely Ephraim and Manasseh, to bow down before Jacob to the ground."),
        (13, "Joseph took Manasseh and put him at Israel's right hand and Ephraim at his left hand."),
        (14, "But Israel reversed his hands and let his right hand rest upon the head of Ephraim and his left hand upon the head of Manasseh."),
        (15, "He blessed them and gave them back to their father and said, \"May the God under whose authority my fathers, Abraham and Isaac, served in reverence, the God who has strengthened me from my youth up to the present time when the angel has saved me from all my afflictions, may he bless these lads, Manasseh and Ephraim."),
        (16, "May my name be upon them, also the names of my holy fathers, Abraham and Isaac.\""),
        (17, "After this, Israel said to Joseph, \"I shall die, and all of you will return to the land of your fathers and God will be with you.\""),
        (18, "And you personally have received a mighty favor, greater than that of your brothers, for I have taken this arrow with my bow and my sword from the Amorites(?).\""),
    ],
    5: [
        (1,  "Then Jacob sent for all his children and said to them, \"Gather around me that I may inform you of everything which will come upon you and what will overtake each one of you in the last days.\""),
        (2,  "So they gathered around Israel from the eldest to the youngest of them."),
        (3,  "Then Jacob-Israel spoke up and said to his sons, \"Listen, O sons of Jacob, listen to your father Israel, from Reuben my firstborn to Benjamin.\""),
        (4,  "Then he told them what would come upon the twelve children, calling each one of them and his tribe by name; and he blessed them with the celestial blessing."),
        (5,  "After this they were silent for a short time in order that he might rest."),
        (6,  "So the heavens rejoiced that he could observe the places of repose."),
        (7,  "And behold, there approached numerous tormentors differing in their aspects."),
        (8,  "They were prepared to torment the sinners, who are these: adulterers, male and female; those lusting after males; the vicious who degrade the semen given by God; the astrologers and the sorcerers; the evildoers and the worshipers of idols who hold onto abominations; and the slanderers who pass judgment(?) with two tongues (deceitfully)."),
        (9,  "And as to all these sinners, their punishment is the fire which will not be extinguished and the outer darkness where there is weeping and gnashing of teeth."),
        (10, "[Here there is a lacuna in the Arabic text. In the Bohairic, Jacob is again taken up, this time to heaven, where all is light and joy."),
        (11, "He sees Abraham and Isaac and is shown all the joys of the redeemed."),
        (12, "Jacob returns to earth, gives instructions for his burial in the land of his fathers, and passes away at the age of 147 years."),
        (13, "The Lord comes down with the angels Michael and Gabriel to bear Jacob's soul to heaven."),
        (14, "Joseph orders his father's body to be embalmed in the Egyptian manner."),
        (15, "Forty days are spent in the embalming process, and eighty more days are spent in mourning for the patriarch.]"),
    ],
    6: [
        (1,  "And when the days of their mourning were finished, Pharaoh was still weeping over Jacob because of his regard for Joseph."),
        (2,  "Then Joseph addressed the nobles of Pharaoh and said to them, \"Since I have found favor with you, will you speak on my behalf to Pharaoh the king, and say to him that Jacob made me take an oath that when he went out from his body I would bury his body in the tomb of my fathers in the land of Canaan, in that very place?\""),
        (3,  "So Pharaoh said to Joseph, \"Go in peace and bury your father in accordance with the oath which he required of you.\""),
        (4,  "\"And take with you chariots and horses, the best of my kingdom and from my own household as you desire.\""),
        (5,  "So Joseph worshiped God in the presence of Pharaoh, went forth from him, and set out to bury his father."),
        (6,  "And there set out with him the slaves of Pharaoh, the elders of Egypt, all the household of Joseph, and his brothers and all Israel."),
        (7,  "They all went up with him into the chariots, and the entourage moved along like a great army."),
        (8,  "They descended into the land of Canaan to the riverbank across the Jordan and they mourned for him in that place with very great grief indeed."),
        (9,  "They maintained that great grief for him for seven days."),
        (10, "So when the inhabitants of Dan heard about the mourning in their land, they said, \"This great mourning is that of the Egyptians.\""),
        (11, "To this day [they call that place \"the Mourning of the Egyptians\"]."),
        (12, "Then Israel was carried forward and was buried in the land of Canaan in the second tomb."),
        (13, "This is the one which Abraham had bought with authorization for burials from Ephron opposite Mamre."),
        (14, "After that Joseph returned to the land of Egypt with his brothers and all the retinue of Pharaoh."),
        (15, "And Joseph lived after the death of his father many years."),
        (16, "He continued to rule over Egypt, though Jacob had died and was left behind with his own people."),
    ],
    7: [
        (1,  "This is what we have transmitted: We have described the demise of and the mourning for the father of fathers, Jacob-Israel, to the extent of our ability to do this; also as it is written in the spiritual books of God and as we have found it in the ancient treasury of knowledge of our fathers, the holy, pure apostles."),
        (2,  "And if you wish to know the life history and get new knowledge of the father of fathers, Jacob, then take a father who is attested in the Old Testament."),
        (3,  "Moses is the one who wrote it, the first of the prophets, the author of the Law."),
        (4,  "Read from it and enlighten your insights."),
        (5,  "You will find this and more in it, written for your sake."),
        (6,  "You will find that God and his angels were their friends while they were in their bodies, and that God kept on speaking to them many times in various passages from the Book."),
        (7,  "Also he says in many passages with regard to the patriarch Jacob, the father of fathers, in the Book, thus, \"My son, I will bless your descendants like the stars of the heavens.\""),
        (8,  "And our father Jacob would speak to his son Joseph and say to him, \"My God appeared to me in the land of Canaan at Luz and blessed me and said to me, 'I will bless you and multiply you and make you a mighty people."),
        (9,  "They shall go out (to war?) like the other nations of this earth and your descendants will increase forever.'\" This is what we have heard, O my brothers and my loved ones, from our fathers, the patriarchs."),
        (10, "And it is incumbent upon us that we have zeal for their deeds, their"),
        (11, "purity, their faith, their love of mankind, and their acceptance of strangers; in order that we may lay claim to be their sons in the kingdom of heaven, so that they will intercede for us before God that we may be saved from the torture of hell."),
        (12, "These are the ones whom the Arabs have designated as the holy fathers."),
        (13, "Jacob instructed his sons with regard to punishment, and he would call them the sword of the Lord, which is the river of fire, prepared with its waves to engulf the evildoers and the impure."),
        (14, "These are the things the power of which the father of fathers, Jacob, expounded and taught to all his sons that the wise ones might hear and pursue righteousness in mutual love with mercy and compassion."),
        (15, "For mercy saves people from penalties and mercy overcomes a multitude of wrongs."),
        (16, "Truly, one who shows mercy to the poor, that one makes a loan to God."),
        (17, "So now, my beloved sons, do not slacken from prayer and fasting ever at any time, and by the life of the religion you will drive away the demons."),
        (18, "O my dear son, avoid the evil ways of the world, which are anger and depravity and all vicious deeds."),
        (19, "And beware of injustice and blasphemy and abduction."),
        (20, "For the unjust will not inherit the kingdom of God, nor will the adulterers, nor the accursed, nor those who commit outrages and have sexual intercourse with males, nor the gluttons, nor the worshipers of idols, nor those who utter imprecations, nor those who pollute themselves outside of pure marriage; and others whom we have not presented or even mentioned shall not come near the kingdom of God."),
        (21, "O my sons, honor the saints, for they are the ones who will intercede for you."),
        (22, "O my sons, be generous to strangers and you will be given exactly what was given to the great Abraham, the father of fathers, and to our father Isaac, his son."),
        (23, "O my sons, do for the poor what will increase compassion for them here and now, so that God will give you the bread of life forever in the kingdom of God."),
        (24, "For to the one who has given a poor person bread in this world God will give a portion from the tree of life."),
        (25, "Clothe the poor person who is naked on the earth, so that God may clothe you with the apparel of glory in the kingdom of heaven, and you will be the sons of our holy fathers, Abraham, Isaac, and Jacob in heaven forever."),
        (26, "Be concerned with the reading of the word of God in his books here below, and remember the saints who have written of their lives, their sufferings, and their prostrations in prayer."),
        (27, "In the future, it shall not be prevented that they should be inscribed in the book of life in the kingdom of heaven."),
        (28, "And you will be counted among the saints, those who pleased God in their lifetime and will rejoice with the angels in the land of eternal life."),
    ],
    8: [
        (1,  "You shall honor the memory of our fathers, the patriarchs, at this time each year and on this same day, which is the twenty-eighth of the month of Misri."),
        (2,  "This is what we have found written in the ancient documents of our fathers, the saints who were pleasing to God."),
        (3,  "Because of their intercession and their prayer, we shall have all things, namely a share and a place in the kingdom of heaven which belongs to our Lord and our God and our Master and our Savior, Jesus the Messiah."),
        (4,  "He is the one whom we ask to forgive us for our mistakes and our errors and to overlook our misdeeds."),
        (5,  "May he be kind to us on the day of his judgment and let us hear the voice filled with joy, kindness, and gladness, saying, \"Come to me, O blessed ones of my Father, inherit the kingdom which was yours from before the creation of the world.\""),
        (6,  "And may we be worthy to receive his divine secrets, which are the means to the pardon of our sins."),
        (7,  "May he help us toward the salvation of our souls, and may he ward off from us the blows of the wicked enemy."),
        (8,  "May he let us stand at his right hand on the great and terrible day for the intercession of the mistress of intercessions, the source of purity, generosity, and blessings, the mother of salvation; and for the intercession of all the martyrs, saints, doers of pleasing deeds, and everyone who has pleased the Lord with his pious deeds and his good will."),
        (9,  "Amen, amen, amen. And praise to God always, forever, eternally."),
    ],
}

SCHEMA = """
CREATE TABLE books (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    short_name     TEXT NOT NULL,
    testament      TEXT NOT NULL,
    chapters_count INTEGER NOT NULL
);
CREATE TABLE verses (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id   TEXT NOT NULL,
    chapter   INTEGER NOT NULL,
    verse_num INTEGER NOT NULL,
    text      TEXT NOT NULL,
    UNIQUE(book_id, chapter, verse_num)
);
CREATE INDEX idx_verses_ref ON verses(book_id, chapter);
CREATE VIRTUAL TABLE verses_fts USING fts5(
    text, book_id UNINDEXED, chapter UNINDEXED, verse_num UNINDEXED,
    content=verses, content_rowid=id
);
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
    INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num)
    VALUES (new.id, new.text, new.book_id, new.chapter, new.verse_num);
END;
"""


def main():
    for ext in ('', '-shm', '-wal'):
        p = DB + ext
        if os.path.exists(p):
            os.remove(p)
            print(f'Removed {p}')

    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO books VALUES ('TJAC','Testament of Jacob','T.Jac','Pseudepigrapha',8)"
    )

    total = 0
    for ch in range(1, 9):
        verses = VERSES[ch]
        for v_num, text in verses:
            conn.execute(
                "INSERT INTO verses (book_id,chapter,verse_num,text) VALUES ('TJAC',?,?,?)",
                (ch, v_num, text)
            )
            total += 1
        print(f'  Chapter {ch}: {len(verses)} verses')

    conn.commit()
    conn.close()
    print(f'\nTestament of Jacob seeded: 8 chapters, {total} verses')


if __name__ == '__main__':
    main()
