import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes

/// A lexicon entry with definition, related words and occurrences (Lexicon tab and study inspector).
struct LexiconEntryView: View {
    @Environment(AppModel.self) private var app
    let strongsId: String
    var compact = false
    @State private var entry: LexiconEntry?
    @State private var related: [LexiconRelated] = []
    @State private var occurrences: [LexiconOccurrence] = []
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let e = entry {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(e.strongsNum).font(.caption.monospaced()).foregroundStyle(.secondary)
                        Text(e.lemma).font(.system(size: compact ? 28 : 36, weight: .regular, design: .serif))
                        Text([e.transliteration, e.pronunciation].filter { !$0.isEmpty }.joined(separator: " · ")).foregroundStyle(.secondary)
                    }
                    if !e.gloss.isEmpty { Text(e.gloss).font(.headline) }
                    if !e.definition.isEmpty { section("Definition") { Text(e.definition).textSelection(.enabled) } }
                    if !e.derivation.isEmpty { section("Derivation") { Text(e.derivation).textSelection(.enabled) } }
                    if !e.extendedDef.isEmpty, !compact { section("Extended") { Text(e.extendedDef).textSelection(.enabled) } }
                    if !related.isEmpty {
                        section("Related") {
                            ForEach(related, id: \.strongsNum) { r in
                                Button { app.openLexicon(r.strongsNum, reuseTab: true) } label: {
                                    HStack { Text(r.strongsNum).monospaced(); Text(r.lemma); Text(r.gloss).foregroundStyle(.secondary).lineLimit(1) }
                                }.buttonStyle(.borderless)
                            }
                        }
                    }
                    section("Occurrences (\(occurrences.count)\(occurrences.count >= 1000 ? "+" : ""))") {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(occurrences.prefix(compact ? 40 : 400).enumerated()), id: \.offset) { _, o in
                                Button { app.openScripture(bookId: o.bookId, chapter: o.chapter, verse: o.verseNum, textId: o.textId, reuseTab: true) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(Reference.bookChapterVerseLabel(o.bookId, chapter: o.chapter, verse: o.verseNum))\(o.textId == "lxx" ? " LXX" : "")").font(.subheadline.weight(.semibold))
                                        Text(highlighted(o)).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                } else if loaded {
                    ContentUnavailableView("No entry for \(strongsId)", systemImage: "character.book.closed")
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: strongsId) {
            loaded = false
            entry = await app.lexicon.entry(strongsId)
            related = await app.lexicon.related(strongsId)
            occurrences = await app.lexicon.occurrences(strongsId, quickLimit: compact ? 60 : nil)
            loaded = true
        }
    }

    func highlighted(_ o: LexiconOccurrence) -> AttributedString {
        let words = o.text.split(separator: " ").map(String.init)
        var out = AttributedString()
        for (i, w) in words.enumerated() {
            if i > 0 { out += AttributedString(" ") }
            var a = AttributedString(w)
            if o.matchWordIndices.contains(i) { a.font = .callout.bold(); a.foregroundColor = .primary }
            out += a
        }
        return out
    }

    @ViewBuilder func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary)
            content()
        }
    }
}

/// Cross references for a verse: Classic (votes) or TSKe (grouped by heading), switchable as in the existing app.
struct CrossRefsView: View {
    @Environment(AppModel.self) private var app
    let bookId: String, chapter: Int, verse: Int?, textId: String
    @AppStorage("crossrefSource") private var source = "tske"
    @State private var classic: [CrossRef] = []
    @State private var tske: [TskeGroup] = []

    var body: some View {
        VStack(spacing: 0) {
            Picker("Source", selection: $source) { Text("TSKe").tag("tske"); Text("Classic").tag("classic") }
                .pickerStyle(.segmented).padding(8)
            if let verse {
                List {
                    if source == "classic" {
                        ForEach(Array(classic.enumerated()), id: \.offset) { _, r in refRow(r.bookId, r.chapter, r.verse, r.endVerse, r.text, detail: r.votes > 0 ? "\(r.votes)" : nil) }
                    } else {
                        ForEach(Array(tske.enumerated()), id: \.offset) { _, g in
                            Section(g.isReciprocal ? "Reciprocal" : (g.heading ?? "")) {
                                ForEach(Array(g.refs.enumerated()), id: \.offset) { _, r in refRow(r.bookId, r.chapter, r.verse, r.endVerse, r.text, detail: r.context) }
                            }
                        }
                    }
                }
                .overlay { if (source == "classic" ? classic.isEmpty : tske.isEmpty) { ContentUnavailableView("No cross references", systemImage: "arrow.triangle.branch") } }
                .task(id: "\(bookId)|\(chapter)|\(verse)|\(textId)") {
                    classic = await app.crossrefs.forVerse(bookId, chapter, verse, textId: textId).refs
                    tske = await app.crossrefs.tskeForVerse(bookId, chapter, verse, textId: textId).groups
                }
            } else {
                ContentUnavailableView("Select a verse", systemImage: "hand.tap", description: Text("Click a verse to see its cross references."))
            }
        }
    }

    func refRow(_ b: String, _ c: Int, _ v: Int, _ end: Int?, _ text: String, detail: String?) -> some View {
        Button { app.openScripture(bookId: b, chapter: c, verse: v, reuseTab: true) } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(Reference.bookChapterVerseLabel(b, chapter: c, verse: v) + (end.map { "-\($0)" } ?? "")).font(.subheadline.weight(.semibold))
                    Spacer()
                    if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Text(VerseDisplay.text(text, tagged: nil, textId: "kjva", replacerEnabled: true, rules: WordReplacer.defaultRules))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(3)
            }
        }.buttonStyle(.plain)
    }
}

/// Full-text Scripture search results (Search tab), grouped by book; a result opens Scripture.
struct SearchResultsView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var results: [VerseSearchRow] = []
    @State private var textId = "kjva"
    @State private var mode: WordMode = .all
    @State private var loading = false

    var query: String { app.findTab(tabId)?.state["query"]?.stringValue?.string ?? "" }

    var body: some View {
        if query.hasPrefix("#"), query.count > 1 {
            TagResultsView(tagName: String(query.dropFirst()).trimmingCharacters(in: .whitespaces)).navigationTitle(query)
        } else { ScriptureSearchView(tabId: tabId) }
    }

    var wordResults: some View {
        List {
            Section {
                HStack {
                    Picker("Text", selection: $textId) { ForEach(availableTexts) { Text($0.name).tag($0.id) } }.frame(maxWidth: 260)
                    Picker("Match", selection: $mode) { Text("All words").tag(WordMode.all); Text("Any word").tag(WordMode.any); Text("Phrase").tag(WordMode.phrase) }
                        .pickerStyle(.segmented).frame(maxWidth: 280)
                    Spacer()
                    Text(loading ? "Searching…" : "\(results.count) verses").foregroundStyle(.secondary)
                }
            }
            ForEach(grouped, id: \.0) { book, rows in
                Section(Reference.bookName(book)) {
                    ForEach(rows, id: \.self) { r in
                        Button { app.openScripture(bookId: r.bookId, chapter: r.chapter, verse: r.verseNum, textId: textId) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Reference.bookChapterVerseLabel(r.bookId, chapter: r.chapter, verse: r.verseNum)).font(.subheadline.weight(.semibold))
                                Text(VerseDisplay.text(r.text, tagged: r.textTagged, textId: textId, replacerEnabled: true, rules: WordReplacer.defaultRules))
                                    .font(.callout).foregroundStyle(.secondary).lineLimit(3)
                            }
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("Search: \(query)")
        .task(id: "\(query)|\(textId)|\(mode.rawValue)") {
            loading = true
            var rows: [VerseSearchRow] = []
            var seen = Set<String>()
            for variant in WordReplacer.searchVariants(query, rules: WordReplacer.defaultRules) {
                for r in await app.bible.searchText(variant, textId: textId, mode: mode) where seen.insert("\(r.bookId)|\(r.chapter)|\(r.verseNum)").inserted { rows.append(r) }
            }
            results = rows
            loading = false
        }
    }

    var grouped: [(String, [VerseSearchRow])] {
        var order: [String] = [], map: [String: [VerseSearchRow]] = [:]
        for r in results.sorted(by: { (Reference.bookOrder($0.bookId), $0.chapter, $0.verseNum) < (Reference.bookOrder($1.bookId), $1.chapter, $1.verseNum) }) {
            if map[r.bookId] == nil { order.append(r.bookId) }
            map[r.bookId, default: []].append(r)
        }
        return order.map { ($0, map[$0]!) }
    }
}

extension VerseSearchRow: @retroactive Hashable {
    public func hash(into h: inout Hasher) { h.combine(bookId); h.combine(chapter); h.combine(verseNum) }
}


/// "#name" search: every verse and chapter tagged with that tag, grouped by tag member, with the verse text.
struct TagResultsView: View {
    @Environment(AppModel.self) private var app
    let tagName: String
    @State private var tag: VerseTagSummary?
    @State private var members: [TagMemberDetail] = []
    @State private var texts: [String: String] = [:]

    var body: some View {
        List {
            if let tag {
                Section {
                    HStack { TagChip(name: tag.name, color: tag.color, slot: tag.colorSlot); Spacer()
                        Text("\(tag.verseCount) verse\(tag.verseCount == 1 ? "" : "s") · \(tag.chapterCount) chapter\(tag.chapterCount == 1 ? "" : "s")").foregroundStyle(.secondary) }
                }
                ForEach(members) { m in
                    Section(m.label) {
                        ForEach(m.wholeChapters, id: \.bookId) { c in
                            Button { app.openScripture(bookId: c.bookId, chapter: c.chapter, reuseTab: true) } label: { Label(Reference.bookChapterLabel(c.bookId, chapter: Double(c.chapter)), systemImage: "book") }
                        }
                        ForEach(m.verses, id: \.verse) { v in
                            Button { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verse, reuseTab: true) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verse)).font(.headline)
                                    Text(texts["\(v.bookId).\(v.chapter).\(v.verse)"] ?? "").foregroundStyle(.secondary).lineLimit(3)
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                }
            } else {
                ContentUnavailableView("No tag named #\(tagName)", systemImage: "tag", description: Text("Tag verses from the verse menu (Tag Verse…)."))
            }
        }
        .task(id: "\(tagName)|\(app.tagsRevision)") {
            tag = (try? app.verseTags?.list())?.first { $0.name.caseInsensitiveCompare(tagName) == .orderedSame }
            members = tag.flatMap { try? app.verseTags?.members([$0.id]) } ?? []
            let refs = members.flatMap { $0.verses.map { ($0.bookId, $0.chapter, $0.verse) } }
            let rows = await app.bible.queryVerses(refs.map { (bookId: $0.0, chapter: $0.1, verse: $0.2) }, textId: app.defaultText)
            texts = Dictionary(rows.map { ($0.key, VerseDisplay.text($0.value.text, tagged: nil, textId: app.defaultText, replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)) }, uniquingKeysWith: { a, _ in a })
        }
    }
}
