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
    @State private var previews: [OccurrenceKey: OccurrencePreview] = [:]
    @State private var loaded = false
    @State private var occurrencesLoading = false
    @State private var occurrenceEdition: String?
    @State private var occurrenceBook: String?
    @State private var visibleOccurrences = 40
    @State private var selectedRenderings: Set<String> = []
    @State private var sortByMatches = false

    private var editions: [String] {
        Array(Set(occurrences.map(\.textId))).sorted()
    }

    private var editionOccurrences: [LexiconOccurrence] {
        guard let occurrenceEdition else { return occurrences }
        return occurrences.filter { $0.textId == occurrenceEdition }
    }

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
                    section("Occurrences") {
                        if occurrencesLoading {
                            ProgressView().accessibilityLabel("Loading occurrences")
                        } else if occurrences.isEmpty {
                            Text("No occurrences found").foregroundStyle(.secondary)
                        }
                        if editions.count > 1 {
                            Picker("Edition", selection: $occurrenceEdition) {
                                Text("All Editions").tag(nil as String?)
                                ForEach(editions, id: \.self) { edition in
                                    Text(textInfo(edition).short).tag(Optional(edition))
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        let books = Dictionary(grouping: editionOccurrences, by: \.bookId)
                        if books.count > 1 {
                            Picker("Book", selection: $occurrenceBook) {
                                Text("All Books").tag(nil as String?)
                                ForEach(books.keys.sorted { Reference.bookName($0) < Reference.bookName($1) }, id: \.self) { book in
                                    Text("\(Reference.bookName(book)) (\(books[book]?.count ?? 0))").tag(Optional(book))
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        let scoped = occurrenceBook.flatMap { books[$0] } ?? editionOccurrences
                        let indexed = scoped.enumerated().map { index, occurrence in
                            let preview = previews[OccurrenceKey(occurrence)] ?? Self.occurrencePreview(occurrence, strongsId: strongsId, replacerEnabled: app.wordReplacerEnabled)
                            return (index, occurrence, preview.renderings, preview, OccurrenceKey(occurrence))
                        }
                        let forms = indexed.reduce(into: [String: Int]()) { counts, row in
                            for word in row.2 { counts[word, default: 0] += 1 }
                        }
                        if forms.count > 1 {
                            Menu {
                                ForEach(forms.keys.sorted { (-(forms[$0] ?? 0), $0) < (-(forms[$1] ?? 0), $1) }, id: \.self) { word in
                                    Toggle("\(word) (\(forms[word] ?? 0))", isOn: Binding(
                                        get: { selectedRenderings.contains(word) },
                                        set: { included in
                                            if included { selectedRenderings.insert(word) }
                                            else { selectedRenderings.remove(word) }
                                        }
                                    ))
                                }
                                if !selectedRenderings.isEmpty {
                                    Button("Clear Word Filter") { selectedRenderings = [] }
                                }
                            } label: {
                                Label(selectedRenderings.isEmpty ? "Translated Words" : "Translated Words (\(selectedRenderings.count))",
                                      systemImage: "text.magnifyingglass")
                            }
                        }
                        if scoped.count > 1 {
                            Picker("Sort Occurrences", selection: $sortByMatches) {
                                Text("Default Order").tag(false)
                                Text("Most Matches").tag(true)
                            }
                            .pickerStyle(.menu)
                        }
                        let filtered = indexed.filter { selectedRenderings.isEmpty || !$0.2.isDisjoint(with: selectedRenderings) }
                        let matches = sortByMatches ? filtered.sorted {
                            (-$0.1.matchWordIndices.count, $0.0) < (-$1.1.matchWordIndices.count, $1.0)
                        } : filtered
                        if !scoped.isEmpty {
                            Text("\(matches.count) loaded occurrences")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if !occurrences.isEmpty {
                            Button("Search Scripture for \(e.strongsNum)", systemImage: "magnifyingglass") {
                                app.openSearch(e.strongsNum, reuseTab: true)
                            }
                            .buttonStyle(.interactivePlain)
                        }
                        if compact, !occurrences.isEmpty {
                            Button("Open Full Lexicon", systemImage: "arrow.up.right.square") {
                                app.openLexicon(strongsId, reuseTab: true)
                            }
                            .buttonStyle(.interactivePlain)
                        }
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(matches.prefix(visibleOccurrences)), id: \.4) { _, o, _, preview, _ in
                                let passage = ResolvedPassage(textId: o.textId, bookId: o.bookId, chapter: o.chapter, verse: o.verseNum)
                                Button { app.visitScripture(passage) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack {
                                            Text(passage.label).font(.subheadline.weight(.semibold))
                                                .foregroundStyle(Color.accentColor)
                                            Text(textInfo(passage.textId).short)
                                                .font(.caption).foregroundStyle(.secondary)
                                            Spacer()
                                            Image(systemName: "chevron.forward")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                                .accessibilityHidden(true)
                                        }
                                        Text(highlighted(preview)).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(.rect)
                                }.buttonStyle(.interactivePlain)
                            }
                        }
                        if matches.count > visibleOccurrences {
                            Button("Show More Occurrences", systemImage: "chevron.down") {
                                visibleOccurrences += 40
                            }
                            .buttonStyle(.interactivePlain)
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
        .onChange(of: occurrenceEdition) {
            occurrenceBook = nil
            selectedRenderings = []
            visibleOccurrences = 40
        }
        .onChange(of: occurrenceBook) {
            selectedRenderings = []
            visibleOccurrences = 40
        }
        .onChange(of: app.wordReplacerEnabled) {
            selectedRenderings = []
            updatePreviews()
        }
        .onChange(of: selectedRenderings) { visibleOccurrences = 40 }
        .onChange(of: sortByMatches) { visibleOccurrences = 40 }
        .task(id: strongsId) {
            loaded = false
            entry = nil
            related = []
            occurrences = []
            previews = [:]
            occurrenceEdition = nil
            occurrenceBook = nil
            selectedRenderings = []
            sortByMatches = false
            visibleOccurrences = 40
            occurrencesLoading = true
            let newEntry = await app.lexicon.entry(strongsId)
            guard !Task.isCancelled else { return }
            entry = newEntry
            loaded = true
            guard newEntry != nil else { return }
            let newRelated = await app.lexicon.related(strongsId)
            guard !Task.isCancelled else { return }
            related = newRelated
            let newOccurrences = await app.lexicon.occurrences(strongsId, quickLimit: compact ? 60 : nil)
            guard !Task.isCancelled else { return }
            occurrences = newOccurrences
            updatePreviews()
            occurrencesLoading = false
        }
    }

    private struct OccurrenceKey: Hashable {
        let text: String
        let book: String
        let chapter: Int
        let verse: Int

        init(_ occurrence: LexiconOccurrence) {
            text = occurrence.textId
            book = occurrence.bookId
            chapter = occurrence.chapter
            verse = occurrence.verseNum
        }
    }

    private struct OccurrencePreview {
        let words: [Substring]
        let matches: Set<Int>
        let renderings: Set<String>
    }

    private func updatePreviews() {
        let replacerEnabled = app.wordReplacerEnabled
        previews = occurrences.reduce(into: [:]) { result, occurrence in
            result[OccurrenceKey(occurrence)] = Self.occurrencePreview(occurrence, strongsId: strongsId, replacerEnabled: replacerEnabled)
        }
    }

    private static func occurrencePreview(_ occurrence: LexiconOccurrence, strongsId: String, replacerEnabled: Bool) -> OccurrencePreview {
        let hit = ScriptureHit(textId: occurrence.textId, bookId: occurrence.bookId, chapter: occurrence.chapter,
                               verseNum: occurrence.verseNum, text: occurrence.text, textTagged: occurrence.textTagged,
                               matchWordIndices: occurrence.matchWordIndices, matchedStrongs: [strongsId.uppercased()])
        let snippet = hit.strongsSnippet(replacerEnabled: replacerEnabled)
        let words = (snippet?.text ?? occurrence.text).split(whereSeparator: \.isWhitespace)
        let matches = Set(snippet?.indices ?? occurrence.matchWordIndices)
        let renderings = Set(matches.compactMap { index -> String? in
            guard words.indices.contains(index) else { return nil }
            let word = words[index].filter { $0.isLetter || $0 == "'" || $0 == "’" }.lowercased()
            return word.isEmpty ? nil : word
        })
        return OccurrencePreview(words: words, matches: matches, renderings: renderings)
    }

    private func highlighted(_ preview: OccurrencePreview) -> AttributedString {
        var out = AttributedString()
        for (index, word) in preview.words.enumerated() {
            if index > 0 { out += AttributedString(" ") }
            var text = AttributedString(String(word))
            if preview.matches.contains(index) {
                text.font = .callout.bold()
                text.foregroundColor = .primary
            }
            out += text
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
    @State private var loadedReference: String?
    @State private var classic: [CrossRef] = []
    @State private var tske: [TskeGroup] = []

    var body: some View {
        VStack(spacing: 0) {
            Picker("Source", selection: $source) { Text("TSKe").tag("tske"); Text("Classic").tag("classic") }
                .pickerStyle(.segmented).padding(8)
            if let verse {
                let reference = "\(bookId)|\(chapter)|\(verse)|\(textId)"
                Text(Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: verse, hermas: HermasText(textId: textId)))
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
                Group {
                    if loadedReference == reference {
                        results
                    } else {
                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .task(id: reference) {
                    async let classicResult = app.crossrefs.forVerse(bookId, chapter, verse, textId: textId)
                    async let tskeResult = app.crossrefs.tskeForVerse(bookId, chapter, verse, textId: textId)
                    let (newClassic, newTSKe) = await (classicResult, tskeResult)
                    guard !Task.isCancelled else { return }
                    classic = newClassic.refs
                    tske = newTSKe.groups
                    loadedReference = reference
                }
            } else {
                ContentUnavailableView("Select a verse", systemImage: "hand.tap", description: Text("Select a verse to see its cross references."))
            }
        }
    }

    @ViewBuilder private var results: some View {
        if (source == "classic" ? classic.isEmpty : tske.isEmpty) {
            ContentUnavailableView("No cross references", systemImage: "arrow.triangle.branch")
        } else {
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
        }
    }

    func refRow(_ b: String, _ c: Int, _ v: Int, _ end: Int?, _ text: String, detail: String?) -> some View {
        let passage = ResolvedPassage(textId: "kjva", bookId: b, chapter: c, verse: v > 0 ? v : nil, endVerse: end)
        return Button {
            app.visitScripture(passage)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(passage.label).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                    Spacer()
                    if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    Image(systemName: "chevron.forward")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                Text(VerseDisplay.text(text, tagged: nil, textId: "kjva", replacerEnabled: true, rules: WordReplacer.defaultRules))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(3)
            }
            .contentShape(.rect)
        }.buttonStyle(.interactivePlain)
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
                        }.buttonStyle(.interactivePlain)
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
                            }.buttonStyle(.interactivePlain)
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
