import SwiftUI
import TipKit
import BereanBible
import BereanReference
import BereanText
import BereanCore
import BereanNotes

/// Ask Berean, model-free (original modelFreeLookup.ts, G01; on iPhone the only path — G10).
/// Order as the original: word study / Strong's → reference → keyword search. Only the keyword
/// fallback is labelled as having run without an AI model (original NO_MODEL_INSTALLED, partial).
struct AskBereanView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var answer: Answer?
    @State private var asking = false
    @State private var asked = ""
    @State private var savedChatId: String?
    /// The conversation so far (follow-ups resolve against it) and the last "Interpreted as …".
    @State private var convo = AskFollowUp.State()
    @State private var interpreted: String?
    @FocusState private var focused: Bool

    struct Verse: Identifiable, Hashable {
        let textId: String, bookId: String, chapter: Int, verse: Int, text: String
        var id: String { "\(textId)|\(bookId)|\(chapter)|\(verse)" }
        var label: String { "\(Reference.bookName(bookId)) \(chapter):\(verse)" }
    }
    enum Answer {
        case strongs(LexiconEntry, [Verse], alternatives: [LexiconEntry])
        case passage(String, [Verse])
        case compare([LexiconEntry])
        case parallel(String, kjv: [Verse], lxx: [Verse])
        case passages([(title: String, verses: [Verse])])
        case wordTable([(title: String, words: [(word: String, ids: [String], gloss: String)])])
        case keyword([String], [Verse])
        case nothing
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField(asked.isEmpty ? "Ask about a verse, a word, or a topic" : "Ask a follow-up — “now only Greek”, “five more”", text: $question)
                        .focused($focused)
                        .submitLabel(.search)
                        .onSubmit { Task { await ask() } }
                    Button("Ask", systemImage: "sparkle.magnifyingglass") { Task { await ask() } }
                        .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || asking)
                } footer: {
                    if asked.isEmpty { Text("Try: John 3:16 · H2617 · compare H2617 and H7356 · word study on grace · How does Isaiah 7:14 read in the LXX? · verses on the Sabbath, not from Exodus") }
                }
                if asking { ProgressView() }
                if !asked.isEmpty, !asking {
                    TipView(AskFollowUpTip()).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    Section {
                        Label(asked, systemImage: "questionmark.bubble").font(.headline)
                        if let interpreted {
                            Label("Interpreted as: \(interpreted)", systemImage: "arrow.turn.down.right").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let answer {
                    results(answer)
                    Section {
                        if savedChatId != nil {
                            Label("Saved to Berean Chat", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        } else {
                            Button("Save to Berean Chat", systemImage: "bubble.left.and.text.bubble.right") { save(answer) }
                        }
                    }
                }
            }
            .navigationTitle("Ask Berean")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    // Original Ask options: the collections searched (a question's "only …" still wins).
                    Menu("Search In", systemImage: "books.vertical") {
                        ForEach(ModelFreeAsk.Collection.allCases, id: \.self) { c in
                            Toggle(Self.collectionLabel(c), isOn: Binding(
                                get: { app.askCollections.contains(c) },
                                set: { on in
                                    var set = app.askCollections.filter { $0 != c }
                                    if on { set.append(c) }
                                    app.askCollections = ModelFreeAsk.Collection.allCases.filter(set.contains)
                                }))
                        }
                        Divider()
                        Text("Without an AI model, Ask Berean searches the KJV and its Apocrypha.")
                    }
                }
            }
            .onAppear { focused = true }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    @ViewBuilder private func results(_ answer: Answer) -> some View {
        switch answer {
        case .strongs(let e, let verses, let alternatives):
            Section("Strong's \(e.strongsNum)") {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(e.lemma).font(.title2)
                        Text(e.transliteration).italic().foregroundStyle(.secondary)
                    }
                    if !e.gloss.isEmpty { Text(e.gloss).font(.headline) }
                    if !e.definition.isEmpty { Text(e.definition).font(.callout) }
                    if e.occurrences > 0 { Text("\(e.occurrences) occurrences").font(.caption).foregroundStyle(.secondary) }
                }
                Button("Open Lexicon Entry", systemImage: "character.book.closed") { finish { app.openLexicon(e.strongsNum, reuseTab: true) } }
            }
            if !alternatives.isEmpty {
                Section("Also") {
                    ForEach(alternatives, id: \.strongsNum) { alt in
                        Button {
                            Task { self.answer = .strongs(alt, await occurrences(alt.strongsNum), alternatives: [e]) }
                        } label: {
                            Text("\(alt.strongsNum.hasPrefix("G") ? "Greek" : "Hebrew") \(alt.strongsNum) · \(alt.lemma) (\(alt.transliteration)) — \(alt.gloss)")
                                .lineLimit(2)
                        }
                    }
                }
            }
            verseSection("Where it appears", verses)
        case .passage(let title, let verses):
            verseSection(title, verses)
        case .compare(let entries):
            ForEach(entries, id: \.strongsNum) { e in
                Section("Strong's \(e.strongsNum)") {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(e.lemma).font(.title3)
                            Text(e.transliteration).italic().foregroundStyle(.secondary)
                            Spacer()
                            Text("\(e.occurrences)×").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        if !e.gloss.isEmpty { Text(e.gloss).font(.headline) }
                        if !e.definition.isEmpty { Text(e.definition).font(.callout).lineLimit(5) }
                    }
                    Button("Open Lexicon Entry", systemImage: "character.book.closed") { finish { app.openLexicon(e.strongsNum, reuseTab: true) } }
                }
            }
        case .parallel(let title, let kjv, let lxx):
            verseSection("\(title) · KJV", kjv)
            verseSection("\(title) · Brenton LXX", lxx)
        case .passages(let groups):
            ForEach(Array(groups.enumerated()), id: \.offset) { _, g in verseSection(g.title, g.verses) }
        case .wordTable(let tables):
            ForEach(Array(tables.enumerated()), id: \.offset) { _, t in
                Section(t.title) {
                    ForEach(Array(t.words.enumerated()), id: \.offset) { _, w in
                        HStack(alignment: .firstTextBaseline) {
                            Text(w.word).frame(minWidth: 90, alignment: .leading)
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 2) {
                                ForEach(w.ids, id: \.self) { id in
                                    Button { finish { app.openLexicon(id, reuseTab: true) } } label: {
                                        Text(id).font(.caption.monospaced().weight(.semibold))
                                    }
                                    .buttonStyle(.interactivePlain).foregroundStyle(.tint)
                                }
                                if !w.gloss.isEmpty { Text(w.gloss).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            }
                        }
                    }
                }
            }
        case .keyword(let words, let verses):
            if verses.isEmpty {
                Section { Text("No verses matched “\(words.joined(separator: " "))”.").foregroundStyle(.secondary) }
            } else {
                verseSection("Verses with “\(words.joined(separator: " "))”", verses)
            }
            Section {
                Label("Matched words in the KJV — answered without an AI model on this device.", systemImage: "info.circle")
                    .font(.caption).foregroundStyle(.secondary)
            }
        case .nothing:
            Section { Text("Ask about a verse, a word, or a topic.").foregroundStyle(.secondary) }
        }
    }

    private func verseSection(_ title: String, _ verses: [Verse]) -> some View {
        Section(title) {
            ForEach(verses) { v in
                Button {
                    finish { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verse, textId: v.textId, reuseTab: false) }
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(v.label).font(.caption.weight(.semibold)).foregroundStyle(.tint)
                        Text(app.wordReplacerEnabled ? WordReplacer.apply(v.text, rules: app.wordReplacerRules) : v.text)
                            .foregroundStyle(.primary).lineLimit(4)
                    }
                }
                .buttonStyle(.interactivePlain)
            }
        }
    }

    /// Original COLLECTIONS labels.
    static func collectionLabel(_ c: ModelFreeAsk.Collection) -> String {
        switch c {
        case .canon: "Old and New Testament (66 books)"
        case .apocrypha: "Apocrypha / Deuterocanon (KJV 1611)"
        case .pseudepigrapha: "Pseudepigrapha (Enoch, Jubilees, Testaments…)"
        case .earlyChristian: "Early Christian writings (Hermas, Clement, Didache…)"
        case .lxx: "Septuagint (Brenton English)"
        }
    }

    private func finish(_ action: @escaping () -> Void) { dismiss(); DispatchQueue.main.async(execute: action) }

    private func ask() async {
        let raw = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        focused = false   // let the answer be seen; the keyboard used to cover it
        asking = true
        asked = raw
        question = ""   // ready for a follow-up
        savedChatId = nil
        // A follow-up ("now only Greek", "five more", "compare the first two") becomes a full request.
        let followUp = AskFollowUp.resolve(raw, state: convo)
        interpreted = followUp?.reason
        let q = followUp?.question ?? raw
        defer {
            asking = false
            remember(raw: raw, effective: q, isFollowUp: followUp != nil)
            focused = true   // ready for the follow-up
        }
        // Word by word with Strong's numbers (follow-up on the verses shown, or asked directly).
        let tableRefs: [String]? = followUp?.wordTable ?? (ModelFreeAsk.wordTableRequest(q) != nil
            ? ModelFreeAsk.referenceGroups(q).compactMap { $0.lazy.first { app.resolvePassage($0) != nil } } : nil)
        if let tableRefs, !tableRefs.isEmpty {
            var tables: [(title: String, words: [(word: String, ids: [String], gloss: String)])] = []
            var glosses: [String: String] = [:]
            var budget = 3   // verses, as the original's word tables
            for ref in tableRefs {
                let plain = ref.components(separatedBy: " · ").first ?? ref
                guard budget > 0, let p = app.resolvePassage(plain) else { continue }
                let rows = await app.bible.queryChapter(p.bookId, p.chapter, textId: "kjva")
                let from = p.verse ?? 1, to = min(p.endVerse ?? p.verse ?? from, from + budget - 1)
                for row in rows where row.verseNum >= from && row.verseNum <= to {
                    budget -= 1
                    var words: [(word: String, ids: [String], gloss: String)] = []
                    for token in TaggedText.parse(row.textTagged ?? row.text) {
                        let ids: [String]
                        switch token.strongs { case .one(let id)?: ids = [id]; case .many(let many)?: ids = many; case nil: ids = [] }
                        guard !token.word.trimmingCharacters(in: .punctuationCharacters.union(.whitespaces)).isEmpty else { continue }
                        // The transliteration reads better than the first KJV-usage item ("X exceeding" for G2316).
                        for id in ids where glosses[id] == nil { glosses[id] = await app.lexicon.entry(id)?.transliteration ?? "" }
                        words.append((token.word, ids, ids.compactMap { glosses[$0] }.filter { !$0.isEmpty }.joined(separator: " · ")))
                    }
                    tables.append(("\(Reference.bookName(p.bookId)) \(p.chapter):\(row.verseNum)", words))
                }
            }
            if !tables.isEmpty { answer = .wordTable(tables); return }
        }
        // Follow-up "any in Proverbs?": the last Strong's number's occurrences in that book.
        if let id = followUp?.occurrencesOf, let phrase = followUp?.inBook,
           let book = app.resolvePassage("\(phrase) 1")?.bookId, let entry = await app.lexicon.entry(id) {
            let verses = await app.lexicon.occurrences(id, bookId: book).prefix(30)
                .map { Verse(textId: $0.textId, bookId: $0.bookId, chapter: $0.chapter, verse: $0.verseNum, text: $0.text) }
            interpreted = verses.isEmpty ? "\(id) does not occur in \(Reference.bookName(book))" : "\(id) in \(Reference.bookName(book)) — \(verses.count) verse\(verses.count == 1 ? "" : "s")"
            answer = .strongs(entry, Array(verses), alternatives: [])
            return
        }
        // 0. Two or more Strong's numbers: their entries side by side (original lexical comparison).
        let ids = ModelFreeAsk.strongsIds(q)
        if ids.count >= 2 {
            var entries: [LexiconEntry] = []
            for id in ids.prefix(4) { if let e = await app.lexicon.entry(id) { entries.append(e) } }
            if entries.count >= 2 { answer = .compare(entries); return }
        }
        // 0b. One passage in the KJV and Brenton's LXX (original translation parallel).
        if ModelFreeAsk.asksTranslationParallel(q),
           let p = ModelFreeAsk.referenceCandidates(q).lazy.compactMap({ app.resolvePassage($0) }).first {
            func verses(_ textId: String) async -> [Verse] {
                let rows = await app.bible.queryChapter(p.bookId, p.chapter, textId: textId)
                let from = p.verse ?? 1, to = p.endVerse ?? p.verse ?? Int.max
                return rows.filter { $0.verseNum >= from && $0.verseNum <= to }.prefix(30)
                    .map { Verse(textId: textId, bookId: p.bookId, chapter: p.chapter, verse: $0.verseNum, text: $0.text) }
            }
            let kjv = await verses("kjva"), lxx = await verses("lxx")
            if !kjv.isEmpty || !lxx.isEmpty {
                let range = p.verse.map { v in p.endVerse.map { "\(v)–\($0)" } ?? "\(v)" }
                answer = .parallel("\(Reference.bookName(p.bookId)) \(p.chapter)" + (range.map { ":\($0)" } ?? ""), kjv: kjv, lxx: lxx)
                return
            }
        }
        // 0c. Two to four passages side by side ("compare Genesis 1:1 and John 1:1").
        if ModelFreeAsk.asksPassageComparison(q) {
            var groups: [(title: String, verses: [Verse])] = []
            for candidates in ModelFreeAsk.referenceGroups(q).prefix(4) {
                guard let p = candidates.lazy.compactMap({ app.resolvePassage($0) }).first else { continue }
                let rows = await app.bible.queryChapter(p.bookId, p.chapter, textId: p.textId)
                let from = p.verse ?? 1, to = p.endVerse ?? p.verse ?? Int.max
                let verses = rows.filter { $0.verseNum >= from && $0.verseNum <= to }.prefix(30)
                    .map { Verse(textId: p.textId, bookId: p.bookId, chapter: p.chapter, verse: $0.verseNum, text: $0.text) }
                let range = p.verse.map { v in p.endVerse.map { "\(v)–\($0)" } ?? "\(v)" }
                let edition = p.textId == "kjva" ? "" : " · \(textInfo(p.textId).short)"
                if !verses.isEmpty { groups.append(("\(Reference.bookName(p.bookId)) \(p.chapter)" + (range.map { ":\($0)" } ?? "") + edition, Array(verses))) }
            }
            if groups.count >= 2 { answer = .passages(groups); return }
        }
        // 1. Strong's id or a word study.
        if let id = StrongsId.normalize(q), let entry = await app.lexicon.entry(id) {
            answer = .strongs(entry, await occurrences(id), alternatives: []); return
        }
        if let study = ModelFreeAsk.wordStudy(q) {
            // A named language decides; otherwise show the Hebrew match with the Greek one as an alternative.
            let langs = study.lang.map { [$0] } ?? ["H", "G"]
            var found: [LexiconEntry] = []
            for lang in langs {
                if let entry = ModelFreeAsk.best(await app.lexicon.search(study.word, lang: lang), for: study.word) { found.append(entry) }
            }
            if let first = found.first {
                answer = .strongs(first, await occurrences(first.strongsNum), alternatives: Array(found.dropFirst())); return
            }
        }
        // 2. A reference.
        if let p = app.resolvePassage(q) {
            let rows = await app.bible.queryChapter(p.bookId, p.chapter, textId: p.textId)
            let from = p.verse ?? 1, to = p.endVerse ?? p.verse ?? Int.max
            let verses = rows.filter { $0.verseNum >= from && $0.verseNum <= to }.prefix(60)
                .map { Verse(textId: p.textId, bookId: p.bookId, chapter: p.chapter, verse: $0.verseNum, text: $0.text) }
            if !verses.isEmpty {
                let range = p.verse.map { v in p.endVerse.map { "\(v)–\($0)" } ?? "\(v)" }
                let edition = p.textId == "kjva" ? "" : " · \(textInfo(p.textId).short)"
                answer = .passage("\(Reference.bookName(p.bookId)) \(p.chapter)" + (range.map { ":\($0)" } ?? "") + edition, Array(verses))
                return
            }
        }
        // 3. Keyword search (KJV): all words, then any, then shortened stems.
        // "…but not human rulers", "…, not from Romans": removed from the search, applied as a filter.
        let excluded = ModelFreeAsk.exclusions(q) { phrase in
            let name = phrase.replacingOccurrences(of: #"^(?:the\s+book\s+of\s+)"#, with: "", options: [.regularExpression, .caseInsensitive])
            return app.resolvePassage("\(name) 1")?.bookId
        }
        let collections = ModelFreeAsk.activeCollections(q, setting: app.askCollections)
        // "…only in the Psalms": search that book only.
        let onlyIn = ModelFreeAsk.onlyInBook(excluded.remainder)
        let onlyBook = onlyIn.flatMap { app.resolvePassage("\($0.phrase) 1")?.bookId }
        let words = ModelFreeAsk.withoutScopeWords(ModelFreeAsk.keywords(onlyBook != nil ? onlyIn!.remainder : excluded.remainder))
        let books = onlyBook.map { [$0] }
        guard !words.isEmpty else { answer = .nothing; return }
        var rows = await app.bible.searchText(words.joined(separator: " "), textId: "kjva", mode: .all, bookIds: books)
        if rows.count < 3 { rows += await app.bible.searchText(words.joined(separator: " "), textId: "kjva", mode: .any, bookIds: books) }
        if rows.isEmpty { rows = await app.bible.searchText(ModelFreeAsk.stems(words).joined(separator: " "), textId: "kjva", mode: .any, bookIds: books) }
        var seen = Set<String>(), verses: [Verse] = []
        for r in rows {
            let v = Verse(textId: "kjva", bookId: r.bookId, chapter: r.chapter, verse: r.verseNum, text: r.text)
            if excluded.bookIds.contains(r.bookId) || ModelFreeAsk.mentionsExcluded(r.text, terms: excluded.terms) { continue }
            if followUp?.excludeRefs.contains(v.label) == true { continue }   // "more": not the ones already shown
            if !collections.contains(ModelFreeAsk.collection(textId: "kjva", bookId: r.bookId)) { continue }
            guard seen.insert(v.id).inserted else { continue }
            verses.append(v)
            if verses.count >= (followUp?.limit ?? 12) { break }
        }
        answer = .keyword(words, verses)
    }

    /// Updates the conversation state from the answer just shown (original stateFromTurns, natively).
    private func remember(raw: String, effective: String, isFollowUp: Bool) {
        if !isFollowUp { convo.topicQuestion = effective }
        if let scope = AskFollowUp.scopePhrase(effective) { convo.scopePhrase = scope }
        if raw.range(of: #"\b(any testament|remove (?:the )?(?:restriction|filter)s?|start over|new topic)\b"#, options: [.regularExpression, .caseInsensitive]) != nil { convo.scopePhrase = nil }
        if let study = ModelFreeAsk.wordStudy(effective) { convo.term = study.word; convo.lang = study.lang }
        switch answer {
        case .strongs(let e, let verses, let alternatives):
            convo.strongs = [e.strongsNum] + alternatives.map(\.strongsNum) + convo.strongs.filter { $0 != e.strongsNum }
            convo.refs = verses.map(\.label)
        case .compare(let entries):
            convo.strongs = entries.map(\.strongsNum)
        case .passage(_, let verses):
            convo.refs = verses.map(\.label)
            if !isFollowUp { convo.refs = [effective] + convo.refs.filter { $0 != effective } }
        case .parallel(let title, _, _):
            convo.refs = [title]
        case .passages(let groups):
            convo.refs = groups.map(\.title)
        case .wordTable(let tables):
            convo.strongs = tables.flatMap { $0.words.flatMap(\.ids) }
        case .keyword(_, let verses):
            // "more" keeps excluding everything shown so far in this thread of the topic.
            convo.refs = (isFollowUp ? convo.refs : []) + verses.map(\.label)
        default: break
        }
    }

    /// Writes the exchange into Berean Chat in the original message shape (a new conversation).
    private func save(_ answer: Answer) {
        guard let chats = app.chats else { return }
        func results(_ verses: [Verse], source: String) -> JSValue {
            .array(verses.map { v in
                var o = JSObject()
                o["textId"] = .string(JSString(v.textId)); o["bookId"] = .string(JSString(v.bookId))
                o["bookName"] = .string(JSString(Reference.bookName(v.bookId))); o["chapter"] = .number(Double(v.chapter))
                o["verse"] = .number(Double(v.verse)); o["text"] = .string(JSString(v.text)); o["source"] = .string(JSString(source))
                return .object(o)
            })
        }
        func card(_ e: LexiconEntry) -> JSValue {
            var c = JSObject()
            c["strongsNum"] = .string(JSString(e.strongsNum)); c["lemma"] = .string(JSString(e.lemma))
            c["transliteration"] = .string(JSString(e.transliteration)); c["gloss"] = .string(JSString(e.gloss))
            c["definition"] = .string(JSString(e.definition)); c["derivation"] = .string(JSString(e.derivation))
            c["occurrenceCount"] = .number(Double(e.occurrences))
            return .object(c)
        }
        var f = JSObject()
        switch answer {
        case .strongs(let e, let verses, _):
            f["results"] = results(verses, source: "strongs"); f["visibleCount"] = .number(Double(min(verses.count, 6)))
            f["strongsCard"] = card(e)
            f["summary"] = .string(JSString("Strong's \(e.strongsNum) · \(e.lemma) (\(e.transliteration)) — \(e.gloss)"))
        case .compare(let entries):
            f["results"] = .array([]); f["visibleCount"] = .number(0)
            f["summary"] = .string(JSString(entries.map { "\($0.strongsNum) \($0.transliteration) — \($0.gloss)" }.joined(separator: " · ")))
        case .passage(let title, let verses):
            f["results"] = results(verses, source: "named"); f["visibleCount"] = .number(Double(verses.count))
            f["summary"] = .string(JSString(title))
        case .wordTable(let tables):
            f["results"] = .array([]); f["visibleCount"] = .number(0)
            f["summary"] = .string(JSString(tables.map { t in t.title + ": " + t.words.map { w in w.ids.isEmpty ? w.word : "\(w.word) (\(w.ids.joined(separator: "/")))" }.joined(separator: " ") }.joined(separator: "\n")))
        case .passages(let groups):
            let all = groups.flatMap(\.verses)
            f["results"] = results(all, source: "named"); f["visibleCount"] = .number(Double(all.count))
            f["summary"] = .string(JSString(groups.map(\.title).joined(separator: " · ")))
        case .parallel(let title, let kjv, let lxx):
            f["results"] = results(kjv + lxx, source: "named"); f["visibleCount"] = .number(Double(kjv.count + lxx.count))
            f["summary"] = .string(JSString("\(title) — KJV and Brenton LXX"))
        case .keyword(let words, let verses):
            f["results"] = results(verses, source: "keyword"); f["visibleCount"] = .number(Double(min(verses.count, 6)))
            f["keywords"] = .array(words.map { .string(JSString($0)) })
            f["errorCode"] = "NO_MODEL_INSTALLED"; f["partial"] = .bool(!verses.isEmpty)
            // The original's replyTextFor(NO_MODEL_INSTALLED) copy.
            f["content"] = .string(JSString("AI model not installed. The AI model isn't available on this device." + (verses.isEmpty ? "" : " Results found without the AI model are shown below.")))
        case .nothing:
            return
        }
        if let chat = try? chats.upsert(chatId: nil, title: asked, messages: chats.aiExchange(question: asked, replyFields: f)) {
            savedChatId = chat.id
        }
    }

    private func occurrences(_ id: String) async -> [Verse] {
        await app.lexicon.occurrences(id, quickLimit: 6).prefix(6)
            .map { Verse(textId: $0.textId, bookId: $0.bookId, chapter: $0.chapter, verse: $0.verseNum, text: $0.text) }
    }
}
