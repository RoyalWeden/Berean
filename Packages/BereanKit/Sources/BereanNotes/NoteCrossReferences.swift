import BereanReference
import BereanSQLite

public struct NoteCrossReferences: Sendable {
    public struct Link: Sendable {
        public let bookId: String
        public let chapter: Int
        public let verse: Int?
        public let endVerse: Int?
        public let textId: String
        public let note: Note
        public let context: String

        fileprivate var key: String {
            "\(textId)|\(bookId)|\(chapter)|\(verse ?? 0)|\(endVerse ?? 0)"
        }
    }

    /// Verse zero is the chapter itself.
    public let byVerse: [Int: [Link]]
    public let indirect: [Note]
}

extension NotesService {
    /// Verse notes that cite the whole chapter. Match the chapter number first so aliases
    /// and abbreviated book names are left to the reference parser.
    public func notesCitingChapter(_ bookId: String, _ chapter: Int, textId: String) throws -> [Note] {
        let hermas = HermasText(textId: textId)
        let number = Int(Reference.displayChapter(bookId, Double(chapter)))
        let candidates = try db.query("""
            SELECT n.* FROM notes_fts
            JOIN notes n ON n.rowid = notes_fts.rowid
            WHERE notes_fts MATCH ? AND n.deleted_at IS NULL AND n.verse_ref IS NOT NULL
            ORDER BY n.updated_at DESC, n.id
            """, [.text(Self.ftsQuery(String(number), phrase: false))])
        return candidates.map(Self.note).filter { note in
            guard let attachment = note.verseRef,
                  attachment.split(separator: ",").contains(where: { Reference.parseNoteAttachment(String($0))?.verse != nil })
            else { return false }
            return NoteVerseRefs.extract(content: note.content, title: note.title, hermas: hermas)
                .contains { $0.bookId == bookId && $0.chapter == chapter && $0.isChapter }
        }
    }

    /// Read-only counterpart of the legacy My Notes cross-reference source.
    public func crossReferences(bookId: String, chapter: Int, textId: String, selected: Set<Int> = []) throws -> NoteCrossReferences {
        let attached = try attachedNotes(bookId, chapter, textId: textId)
        let attachedIDs = Set(attached.map(\.id))
        let hermas = HermasText(textId: textId)
        let chapterLabel = Reference.bookChapterVerseLabel(bookId, chapter: chapter, hermas: hermas)
        let candidates = try search(chapterLabel + ":", limit: 80)
        var links: [Int: [NoteCrossReferences.Link]] = [:]
        var seen: [Int: Set<String>] = [:]
        var indirect: [Note] = []

        func numbers(_ first: Int?, _ last: Int?) -> [Int] {
            guard let first else { return selected.isEmpty ? [0] : [] }
            let range = first...max(first, last ?? first)
            if !selected.isEmpty { return selected.filter(range.contains).sorted() }
            // Note citation grammar accepts up to three digits. Bound imported attachment ranges too.
            guard first <= 999 else { return [first] }
            return Array(first...min(range.upperBound, 999))
        }

        func add(_ link: NoteCrossReferences.Link, at verse: Int) {
            if link.bookId == bookId && link.chapter == chapter && link.verse == (verse == 0 ? nil : verse)
                && link.textId == textId && (link.endVerse == nil || link.endVerse == link.verse) { return }
            guard seen[verse, default: []].insert(link.key).inserted else { return }
            links[verse, default: []].append(link)
        }

        func citations(_ note: Note) -> [NoteCrossReferences.Link] {
            NoteVerseRefs.extract(content: note.content, title: note.title, hermas: hermas).map { ref in
                .init(bookId: ref.bookId, chapter: ref.chapter, verse: ref.isChapter ? nil : ref.verse,
                      endVerse: ref.endVerse, textId: ref.lxx ? "lxx" : Reference.translation(forBook: ref.bookId, hermas: hermas) ?? "kjva",
                      note: note, context: ref.context)
            }
        }

        for note in attached {
            let outgoing = citations(note)
            for attachment in Self.attachments(note, bookId: bookId, chapter: chapter, textId: textId) {
                for verse in numbers(attachment.verse, attachment.endVerse) {
                    for link in outgoing { add(link, at: verse) }
                }
            }
        }

        for note in candidates where !attachedIDs.contains(note.id) {
            let outgoing = citations(note)
            let mentions = outgoing.filter { $0.bookId == bookId && $0.chapter == chapter }
            guard !mentions.isEmpty else { continue }
            let matching = Set(mentions.flatMap { mention in
                if mention.verse == nil && !selected.isEmpty { return Array(selected) }
                return numbers(mention.verse, mention.endVerse)
            })
            guard !matching.isEmpty else { continue }
            guard let attachment = note.verseRef else {
                indirect.append(note)
                continue
            }
            let sources = attachment.split(separator: ",").compactMap { Reference.parseNoteAttachment(String($0)) }
            for verse in matching.sorted() {
                for source in sources {
                    add(.init(bookId: source.bookId, chapter: source.chapter, verse: source.verse, endVerse: source.endVerse,
                              textId: note.textId, note: note, context: mentions[0].context), at: verse)
                }
                for link in outgoing { add(link, at: verse) }
            }
        }

        return .init(byVerse: links, indirect: indirect)
    }
}
