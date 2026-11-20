import SwiftUI
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
        case keyword([String], [Verse])
        case nothing
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Ask about a verse, a word, or a topic", text: $question)
                        .focused($focused)
                        .submitLabel(.search)
                        .onSubmit { Task { await ask() } }
                    Button("Ask", systemImage: "sparkle.magnifyingglass") { Task { await ask() } }
                        .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || asking)
                } footer: {
                    Text("Try: John 3:16 · H2617 · compare H2617 and H7356 · word study on grace · How does Isaiah 7:14 read in the LXX? · verses on the Sabbath, not from Exodus")
                }
                if asking { ProgressView() }
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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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

    private func finish(_ action: @escaping () -> Void) { dismiss(); DispatchQueue.main.async(execute: action) }

    private func ask() async {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        asking = true
        asked = q
        savedChatId = nil
        defer { asking = false }
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
                answer = .passage("\(Reference.bookName(p.bookId)) \(p.chapter)" + (range.map { ":\($0)" } ?? ""), Array(verses))
                return
            }
        }
        // 3. Keyword search (KJV): all words, then any, then shortened stems.
        // "…but not human rulers", "…, not from Romans": removed from the search, applied as a filter.
        let excluded = ModelFreeAsk.exclusions(q) { phrase in
            let name = phrase.replacingOccurrences(of: #"^(?:the\s+book\s+of\s+)"#, with: "", options: [.regularExpression, .caseInsensitive])
            return app.resolvePassage("\(name) 1")?.bookId
        }
        let words = ModelFreeAsk.keywords(excluded.remainder)
        guard !words.isEmpty else { answer = .nothing; return }
        var rows = await app.bible.searchText(words.joined(separator: " "), textId: "kjva", mode: .all)
        if rows.count < 3 { rows += await app.bible.searchText(words.joined(separator: " "), textId: "kjva", mode: .any) }
        if rows.isEmpty { rows = await app.bible.searchText(ModelFreeAsk.stems(words).joined(separator: " "), textId: "kjva", mode: .any) }
        var seen = Set<String>(), verses: [Verse] = []
        for r in rows {
            let v = Verse(textId: "kjva", bookId: r.bookId, chapter: r.chapter, verse: r.verseNum, text: r.text)
            if excluded.bookIds.contains(r.bookId) || ModelFreeAsk.mentionsExcluded(r.text, terms: excluded.terms) { continue }
            guard seen.insert(v.id).inserted else { continue }
            verses.append(v)
            if verses.count >= 12 { break }
        }
        answer = .keyword(words, verses)
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
