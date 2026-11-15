import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes

/// A lexicon entry with definition, related words and occurrences (Lexicon tab and study inspector).
struct LexiconEntryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    let strongsId: String
    let tabId: String
    var compact = false
    @State private var entry: LexiconEntry?
    @State private var related: [LexiconRelated] = []
    @State private var occurrences: [LexiconOccurrence] = []
    @State private var previews: [OccurrenceKey: OccurrencePreview] = [:]
    @State private var adjacent: (previous: String?, next: String?) = (nil, nil)
    @State private var loaded = false
    @State private var occurrencesLoading = false
    @State private var scrollPosition = ScrollPosition()
    @State private var restoredScrollEntry: String?
    @State private var restoredWithChangedWordReplacement = false
    @State private var occurrenceEdition: String?
    @State private var occurrenceBook: String?
    @State private var visibleOccurrences = 40
    @State private var selectedRenderings: Set<String> = []
    @State private var sortByMatches = false

    struct OccurrenceOptions: Equatable {
        let pageLimit: Int
        let edition: String?
        let book: String?
        let renderings: Set<String>
        let sortByMatches: Bool
        let wordReplacerEnabled: Bool
    }

    private var occurrenceOptions: OccurrenceOptions {
        OccurrenceOptions(pageLimit: visibleOccurrences, edition: occurrenceEdition,
                          book: occurrenceBook, renderings: selectedRenderings, sortByMatches: sortByMatches,
                          wordReplacerEnabled: app.wordReplacerEnabled)
    }

    private var editions: [String] {
        Array(Set(occurrences.map(\.textId))).sorted()
    }

    private var editionOccurrences: [LexiconOccurrence] {
        guard let occurrenceEdition else { return occurrences }
        return occurrences.filter { $0.textId == occurrenceEdition }
    }

    private typealias IndexedOccurrence = (Int, LexiconOccurrence, Set<String>, OccurrencePreview, OccurrenceKey)

    private func indexedOccurrences(_ scoped: [LexiconOccurrence]) -> [IndexedOccurrence] {
        return scoped.enumerated().map { index, occurrence in
            let preview = previews[OccurrenceKey(occurrence)] ?? Self.occurrencePreview(occurrence, strongsId: strongsId, replacerEnabled: app.wordReplacerEnabled)
            return (index, occurrence, preview.renderings, preview, OccurrenceKey(occurrence))
        }
    }

    private func matchingOccurrences(_ indexed: [IndexedOccurrence]) -> [IndexedOccurrence] {
        let filtered = indexed.filter { selectedRenderings.isEmpty || !$0.2.isDisjoint(with: selectedRenderings) }
        return sortByMatches ? filtered.sorted {
            (-$0.1.matchWordIndices.count, $0.0) < (-$1.1.matchWordIndices.count, $1.0)
        } : filtered
    }

    /// The reader's word replacer (e.g. LORD → Yehovah) applied to lexicon prose, as the original does.
    private func replaced(_ text: String) -> String {
        app.wordReplacerEnabled ? WordReplacer.apply(text, rules: WordReplacer.defaultRules) : text
    }

    /// Gloss shown for an entry; Strong's "unrepresented in English" (H853) gets the original's plain explanation.
    private func displayGloss(_ e: LexiconEntry) -> String {
        if e.gloss.lowercased().contains("unrepresented in english") {
            return replaced("Untranslated particle (\(e.strongsNum)) — marks the definite direct object in Hebrew; has no English equivalent and is not rendered in translation")
        }
        return replaced(e.gloss)
    }

    /// BDB notes with grammatical abbreviations expanded (italic, accent) — original LexiconPanel BdbNotesText.
    private func bdbText(_ text: String) -> Text {
        var out = AttributedString()
        for token in BdbNotes.tokens(text) {
            switch token {
            case .text(let t): out += AttributedString(t)
            case .number(let n):
                var a = AttributedString(n); a.foregroundColor = .secondary; out += a
            case .abbr(let expanded, _):
                var a = AttributedString(expanded); a.font = .body.italic(); a.foregroundColor = Color.accentColor.opacity(0.85); out += a
            }
        }
        return Text(out)
    }

    /// Definition / derivation text with Strong's cross-references as links (⌘-click opens a new tab on the Mac).
    private func linkedText(_ text: String, lang: Character) -> Text {
        var out = AttributedString()
        for token in StrongsRefTokens.tokens(text, lang: lang) {
            switch token {
            case .text(let t): out += AttributedString(t)
            case .ref(let id):
                var a = AttributedString(id)
                a.link = URL(string: "berean-lexicon:\(id)")
                a.font = .body.monospaced()
                a.foregroundColor = .accentColor
                out += a
            }
        }
        return Text(out)
    }

    /// Context menu for a Strong's number (original StrongsContextMenu.tsx).
    @ViewBuilder private func strongsMenu(_ id: String, gloss: String) -> some View {
        Button("Open", systemImage: "character.book.closed") { app.navigateLexicon(id, in: tabId) }
        Button("Open in New Tab", systemImage: "plus.square.on.square") { app.openLexicon(id) }
        Divider()
        Button("Copy \(id)", systemImage: "doc.on.doc") { copyToPasteboard(id) }
        if !gloss.isEmpty { Button("Copy \(id) with Gloss", systemImage: "doc.on.doc") { copyToPasteboard("Strong's \(id) — \(gloss)") } }
    }

    private func copyToPasteboard(_ s: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string)
        #else
        UIPasteboard.general.string = s
        #endif
    }

    private var lexiconLinkAction: OpenURLAction {
        OpenURLAction { url in
            guard url.scheme == "berean-lexicon", let id = StrongsId.normalize(url.absoluteString.replacingOccurrences(of: "berean-lexicon:", with: "")) else { return .systemAction }
            #if os(macOS)
            if NSEvent.modifierFlags.contains(.command) { app.openLexicon(id); return .handled }
            #endif
            app.navigateLexicon(id, in: tabId)
            return .handled
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let e = entry, e.strongsNum == strongsId.uppercased() {
                        VStack(alignment: .leading, spacing: 4) {
                            if compact {
                                HStack {
                                    Text(e.strongsNum).font(.caption.monospaced()).foregroundStyle(.secondary)
                                    Spacer()
                                    entryNavigation
                                }
                            }
                            Text(e.lemma).font(.system(size: compact ? 28 : 36, weight: .regular, design: .serif))
                            Text([e.transliteration, e.pronunciation].filter { !$0.isEmpty }.joined(separator: " · ")).foregroundStyle(.secondary)
                        }
                        if !e.gloss.isEmpty { linkedText(displayGloss(e), lang: e.strongsNum.first ?? "H").font(.headline).textSelection(.enabled).environment(\.openURL, lexiconLinkAction) }
                        if !e.definition.isEmpty { section("Definition") { linkedText(replaced(e.definition), lang: e.strongsNum.first ?? "H").textSelection(.enabled).environment(\.openURL, lexiconLinkAction) } }
                        if !e.derivation.isEmpty { section("Derivation") { linkedText(replaced(e.derivation), lang: e.strongsNum.first ?? "H").textSelection(.enabled).environment(\.openURL, lexiconLinkAction) } }
                        if !e.extendedDef.isEmpty, !compact {
                            if e.strongsNum.hasPrefix("H") {
                                section("BDB Notes") { bdbText(replaced(e.extendedDef)).textSelection(.enabled) }
                            } else {
                                section("Extended") { Text(replaced(e.extendedDef)).textSelection(.enabled) }
                            }
                        }
                        if !related.isEmpty {
                            section("Derived Terms") {
                                ForEach(related, id: \.strongsNum) { r in
                                    Button { app.navigateLexicon(r.strongsNum, in: tabId) } label: {
                                        HStack(spacing: 8) {
                                            Text(r.strongsNum).monospaced().foregroundStyle(Color.accentColor)
                                            Text(r.lemma)
                                            Text(r.gloss).foregroundStyle(.secondary).lineLimit(1)
                                            Spacer(minLength: 0)
                                            Image(systemName: "chevron.forward")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                                .accessibilityHidden(true)
                                        }
                                        .frame(minHeight: entryControlHeight)
                                        .contentShape(.rect)
                                    }.buttonStyle(.interactivePlain)
                                    .contextMenu { strongsMenu(r.strongsNum, gloss: r.gloss) }
                                }
                            }
                        }
                        section("Occurrences") {
                            if occurrencesLoading {
                                ProgressView().accessibilityLabel("Loading occurrences")
                            } else if occurrences.isEmpty {
                                Text("No occurrences found").foregroundStyle(.secondary)
                            }
                            let books = Dictionary(grouping: editionOccurrences, by: \.bookId)
                            let scoped = occurrenceBook.flatMap { books[$0] } ?? editionOccurrences
                            let indexed = indexedOccurrences(scoped)
                            let forms = indexed.reduce(into: [String: Int]()) { counts, row in
                                for word in row.2 { counts[word, default: 0] += 1 }
                            }
                            let matches = matchingOccurrences(indexed)
                            if !occurrences.isEmpty {
                                HStack {
                                    Text("\(matches.count) loaded occurrences")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Spacer(minLength: 4)
                                    occurrenceFilters(books: books, forms: forms, canSort: scoped.count > 1)
                                }
                                let activeFilters = [
                                    occurrenceEdition.map { textInfo($0).short },
                                    occurrenceBook.map { Reference.bookName($0) },
                                    selectedRenderings.isEmpty ? nil : "\(selectedRenderings.count) translated words"
                                ].compactMap { $0 }
                                if !activeFilters.isEmpty {
                                    Text(activeFilters.joined(separator: " · "))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if !occurrences.isEmpty {
                                Button("Search Scripture for \(e.strongsNum)", systemImage: "magnifyingglass") {
                                    leaveInspector()
                                    app.openSearch(e.strongsNum, reuseTab: true, returningTo: tabId)
                                }
                                .buttonStyle(.interactivePlain)
                            }
                            if compact, !occurrences.isEmpty {
                                Button("Open Full Lexicon", systemImage: "arrow.up.right.square") {
                                    leaveInspector()
                                    app.openLexicon(strongsId, reuseTab: true)
                                }
                                .buttonStyle(.interactivePlain)
                            }
                            LazyVStack(alignment: .leading, spacing: 8) {
                                ForEach(Array(matches.prefix(visibleOccurrences)), id: \.4) { _, o, _, preview, key in
                                    let passage = ResolvedPassage(textId: o.textId, bookId: o.bookId, chapter: o.chapter, verse: o.verseNum)
                                    Button {
                                        if !compact {
                                            app.lexiconOccurrenceReturns[tabId, default: [:]][strongsId] = key
                                        }
                                        leaveInspector()
                                        app.visitScripture(passage, returningTo: tabId)
                                    } label: {
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
                                        .frame(maxWidth: .infinity, minHeight: entryControlHeight, alignment: .leading)
                                        .padding(.vertical, 4)
                                        .contentShape(.rect)
                                    }.buttonStyle(.interactivePlain).id(key)
                                }
                            }
                            if matches.count > visibleOccurrences {
                                HStack(spacing: 16) {
                                    Button("Show More Occurrences", systemImage: "chevron.down") {
                                        visibleOccurrences += 40
                                    }
                                    Button("Show All \(matches.count)") { visibleOccurrences = matches.count }
                                }
                                .buttonStyle(.interactivePlain)
                            } else if visibleOccurrences > 40, matches.count > 40 {
                                Button("Show Fewer", systemImage: "chevron.up") { visibleOccurrences = 40 }
                                    .buttonStyle(.interactivePlain)
                            }
                        }
                    } else if loaded && entry == nil {
                        ContentUnavailableView("No entry for \(strongsId)", systemImage: "character.book.closed")
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollPosition($scrollPosition)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.contentOffset.y + geometry.contentInsets.top)
            } action: { _, offset in
                guard !compact, !occurrencesLoading,
                      entry?.strongsNum == strongsId.uppercased(),
                      app.activeTab?.id == tabId,
                      restoredScrollEntry == strongsId else { return }
                app.lexiconScrollOffsets[tabId, default: [:]][strongsId] = offset
            }
            .task(id: occurrencesLoading) {
                guard !compact, !occurrencesLoading,
                      entry?.strongsNum == strongsId.uppercased() else { return }
                defer { if !Task.isCancelled { restoredScrollEntry = strongsId } }
                if let key = app.lexiconOccurrenceReturns[tabId]?.removeValue(forKey: strongsId),
                   let index = matchingOccurrences(indexedOccurrences(
                       editionOccurrences.filter { occurrenceBook == nil || $0.bookId == occurrenceBook }
                   )).firstIndex(where: { $0.4 == key }) {
                    let requiredLimit = (index / 40 + 1) * 40
                    visibleOccurrences = max(visibleOccurrences, requiredLimit)
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    proxy.scrollTo(key, anchor: .center)
                    // Discard the older browsing offset after an explicit return.
                    app.lexiconScrollOffsets[tabId]?.removeValue(forKey: strongsId)
                } else if !restoredWithChangedWordReplacement,
                          let offset = app.lexiconScrollOffsets[tabId]?[strongsId] {
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    scrollPosition.scrollTo(y: offset)
                } else {
                    scrollPosition.scrollTo(edge: .top)
                }
            }
        }
        .toolbar {
            // Full Lexicon tab: previous / next entry and search live in the window toolbar (top right).
            if !compact {
                ToolbarItemGroup(placement: .primaryAction) {
                    toolbarAdjacentButton(adjacent.previous, title: "Previous Entry", symbol: "chevron.backward")
                    toolbarAdjacentButton(adjacent.next, title: "Next Entry", symbol: "chevron.forward")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Search Lexicon", systemImage: "magnifyingglass") { app.openLexiconSearch() }
                        .help("Search the Lexicon")
                }
            }
        }
        .id(strongsId)
        .onChange(of: app.wordReplacerEnabled) {
            selectedRenderings = []
            visibleOccurrences = 40
            updatePreviews()
        }
        .onChange(of: occurrenceOptions) { _, options in
            guard !compact, !occurrencesLoading,
                  entry?.strongsNum == strongsId.uppercased() else { return }
            if let previous = app.lexiconOccurrenceOptions[tabId]?[strongsId],
               previous.edition != options.edition || previous.book != options.book
                || previous.renderings != options.renderings || previous.sortByMatches != options.sortByMatches
                || previous.wordReplacerEnabled != options.wordReplacerEnabled {
                app.lexiconScrollOffsets[tabId]?.removeValue(forKey: strongsId)
            }
            app.lexiconOccurrenceOptions[tabId, default: [:]][strongsId] = options
        }
        .task(id: strongsId) {
            restoredScrollEntry = nil
            restoredWithChangedWordReplacement = false
            loaded = false
            entry = nil
            adjacent = (nil, nil)
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
            let neighbors = await app.lexicon.adjacentEntries(strongsId)
            guard !Task.isCancelled else { return }
            adjacent = neighbors
            let newRelated = await app.lexicon.related(strongsId)
            guard !Task.isCancelled else { return }
            related = newRelated
            let newOccurrences = await app.lexicon.occurrences(strongsId, quickLimit: compact ? 60 : nil)
            guard !Task.isCancelled else { return }
            occurrences = newOccurrences
            updatePreviews()
            if !compact, let options = app.lexiconOccurrenceOptions[tabId]?[strongsId] {
                occurrenceEdition = options.edition
                occurrenceBook = options.book
                restoredWithChangedWordReplacement = options.wordReplacerEnabled != app.wordReplacerEnabled
                selectedRenderings = restoredWithChangedWordReplacement ? [] : options.renderings
                sortByMatches = options.sortByMatches
                visibleOccurrences = options.pageLimit
            }
            occurrencesLoading = false
        }
    }

    private func leaveInspector() {
        #if os(iOS)
        if compact { dismiss() }
        #endif
    }

    private func occurrenceFilters(books: [String: [LexiconOccurrence]], forms: [String: Int], canSort: Bool) -> some View {
        let filtered = occurrenceEdition != nil || occurrenceBook != nil || !selectedRenderings.isEmpty || sortByMatches
        return Menu {
            if editions.count > 1 {
                Picker("Edition", selection: Binding(get: { occurrenceEdition }, set: {
                    occurrenceEdition = $0
                    occurrenceBook = nil
                    selectedRenderings = []
                    visibleOccurrences = 40
                })) {
                    Text("All Editions").tag(nil as String?)
                    ForEach(editions, id: \.self) { edition in
                        Text(textInfo(edition).short).tag(Optional(edition))
                    }
                }
                .pickerStyle(.menu).clickableCursor()
            }
            if books.count > 1 {
                Picker("Book", selection: Binding(get: { occurrenceBook }, set: {
                    occurrenceBook = $0
                    selectedRenderings = []
                    visibleOccurrences = 40
                })) {
                    Text("All Books").tag(nil as String?)
                    ForEach(books.keys.sorted { Reference.bookName($0) < Reference.bookName($1) }, id: \.self) { book in
                        Text("\(Reference.bookName(book)) (\(books[book]?.count ?? 0))").tag(Optional(book))
                    }
                }
                .pickerStyle(.menu).clickableCursor()
            }
            if forms.count > 1 {
                Menu {
                    ForEach(forms.keys.sorted { (-(forms[$0] ?? 0), $0) < (-(forms[$1] ?? 0), $1) }, id: \.self) { word in
                        Toggle("\(word) (\(forms[word] ?? 0))", isOn: Binding(
                            get: { selectedRenderings.contains(word) },
                            set: { included in
                                if included { selectedRenderings.insert(word) }
                                else { selectedRenderings.remove(word) }
                                visibleOccurrences = 40
                            }
                        ))
                    }
                    if !selectedRenderings.isEmpty {
                        Button("Clear Word Filter") { selectedRenderings = []; visibleOccurrences = 40 }
                    }
                } label: {
                    Label(selectedRenderings.isEmpty ? "Translated Words" : "Translated Words (\(selectedRenderings.count))",
                          systemImage: "text.magnifyingglass")
                }
            }
            if canSort {
                Picker("Sort Occurrences", selection: Binding(get: { sortByMatches }, set: {
                    sortByMatches = $0
                    visibleOccurrences = 40
                })) {
                    Text("Default Order").tag(false)
                    Text("Most Matches").tag(true)
                }
                .pickerStyle(.menu).clickableCursor()
            }
            if filtered {
                Button("Reset Options") {
                    occurrenceEdition = nil
                    occurrenceBook = nil
                    selectedRenderings = []
                    sortByMatches = false
                    visibleOccurrences = 40
                }
            }
        } label: {
            Label("Occurrence Options", systemImage: filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .labelStyle(.iconOnly)
                .frame(minWidth: entryControlHeight, minHeight: entryControlHeight)
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton).clickableCursor()
        .menuIndicator(.hidden)
        #if os(macOS)
        .pointerStyle(.link)
        #else
        .hoverEffect(.highlight)
        #endif
    }

    private var entryNavigation: some View {
        HStack(spacing: 2) {
            adjacentButton(adjacent.previous, title: "Previous Entry", symbol: "chevron.backward")
            adjacentButton(adjacent.next, title: "Next Entry", symbol: "chevron.forward")
        }
    }

    private var entryControlHeight: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    private func toolbarAdjacentButton(_ destination: String?, title: String, symbol: String) -> some View {
        Button(title, systemImage: symbol) { if let destination { app.navigateLexicon(destination, in: tabId) } }
            .disabled(destination == nil)
            .help(destination.map { "\(title), \($0)" } ?? title)
    }

    private func adjacentButton(_ destination: String?, title: String, symbol: String) -> some View {
        Button {
            if let destination { app.navigateLexicon(destination, in: tabId) }
        } label: {
            Image(systemName: symbol)
                .frame(width: entryControlHeight, height: entryControlHeight)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .disabled(destination == nil)
        .accessibilityLabel(destination.map { "\(title), \($0)" } ?? title)
        .help(destination.map { "\(title), \($0)" } ?? title)
    }

    struct OccurrenceKey: Hashable {
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
    @Environment(\.dismiss) private var dismiss
    let bookId: String, chapter: Int, verse: Int?, textId: String
    var selectedVerses: [Int] = []
    @AppStorage("crossrefSource") private var source = "tske"
    @State private var loadedReference: String?
    @State private var groups: [ReferenceGroup] = []
    @State private var expandedVerses: Set<Int> = []
    @State private var failed = false
    @State private var chapterScopeOverride: String?

    private var selectionKey: String {
        "\(textId)|\(bookId)|\(chapter)|\(verse.map(String.init) ?? "chapter")|\(selectedVerses)"
    }

    private var hasVerseScope: Bool { verse != nil || !selectedVerses.isEmpty }
    private var showingChapter: Bool { !hasVerseScope || chapterScopeOverride == selectionKey }
    private var scopedVerse: Int? { showingChapter ? nil : verse }
    private var scopedSelection: [Int] { showingChapter ? [] : selectedVerses }

    private struct ReferenceGroup {
        let verse: Int
        let heading: String?
        let rows: [ReferenceRow]
        var unavailable = false
    }

    private struct ReferenceRow {
        let book: String
        let chapter: Int
        let verse: Int
        let end: Int?
        let text: String
        let detail: String?

        init(_ ref: CrossRef) {
            (book, chapter, verse, end, text) = (ref.bookId, ref.chapter, ref.verse, ref.endVerse, ref.text)
            detail = ref.votes > 0 ? String(ref.votes) : nil
        }

        init(_ ref: TskeRef) {
            (book, chapter, verse, end, text) = (ref.bookId, ref.chapter, ref.verse, ref.endVerse, ref.text)
            detail = ref.context
        }
    }

    var body: some View {
        let reference = "\(selectionKey)|\(showingChapter)|\(source)"
        VStack(spacing: 0) {
            HStack {
                Text(ResolvedPassage(textId: textId, bookId: bookId, chapter: chapter,
                                     verse: scopedVerse, verseGroups: consecutiveVerseRuns(Set(scopedSelection))).label)
                    .font(.subheadline.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if hasVerseScope {
                    let label = showingChapter ? "Show selected verses" : "Show whole chapter"
                    Button {
                        chapterScopeOverride = showingChapter ? nil : selectionKey
                    } label: {
                        Label(label, systemImage: showingChapter ? "list.number" : "list.bullet")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: controlHeight, minHeight: controlHeight)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                    .help(label)
                }
                Menu {
                    Button { source = "tske" } label: {
                        Label("TSKe", systemImage: source == "tske" ? "checkmark" : "book")
                    }
                    Button { source = "classic" } label: {
                        Label("Classic", systemImage: source == "classic" ? "checkmark" : "book")
                    }
                } label: {
                    Label(source == "classic" ? "Classic" : "TSKe", systemImage: "line.3.horizontal.decrease")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 8)
                        .frame(minHeight: controlHeight)
                        .contentShape(.rect)
                }
                .menuStyle(.borderlessButton).clickableCursor()
                .fixedSize()
                .menuIndicator(.hidden)
                #if os(macOS)
                .pointerStyle(.link)
                #else
                .hoverEffect(.highlight)
                #endif
            }
            .padding(.horizontal, 12)
            if loadedReference != reference {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed {
                ContentUnavailableView("Cross references unavailable", systemImage: "exclamationmark.circle",
                                       description: Text("The selected source could not be loaded."))
            } else if groups.isEmpty {
                ContentUnavailableView("No cross references", systemImage: "arrow.triangle.branch")
            } else {
                List {
                    if showingChapter || scopedSelection.count > 1 {
                        let byVerse = Dictionary(grouping: groups, by: \.verse)
                        ForEach(byVerse.keys.sorted(), id: \.self) { number in
                            verseSection(number, groups: byVerse[number] ?? [])
                        }
                    } else {
                        groupedReferenceRows(groups)
                    }
                }
                .id(reference)
            }
        }
        .task(id: reference) {
            expandedVerses = []
            await load(reference)
        }
        .onChange(of: selectionKey) { chapterScopeOverride = nil }
    }

    private var controlHeight: CGFloat {
        #if os(macOS)
        32
        #else
        44
        #endif
    }

    @ViewBuilder private func verseSection(_ number: Int, groups: [ReferenceGroup]) -> some View {
        let count = groups.reduce(0) { $0 + $1.rows.count }
        if count == 0 {
            LabeledContent("Verse \(number)",
                           value: groups.contains(where: \.unavailable) ? "Unavailable" : "No cross references")
        } else {
            let expanded = expandedVerses.contains(number)
            Button {
                if expanded { expandedVerses.remove(number) } else { expandedVerses.insert(number) }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 12)
                    Text("Verse \(number)").font(.subheadline.weight(.semibold))
                    Spacer(minLength: 0)
                    Text(count, format: .number)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: controlHeight)
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityHint("Contains \(count) cross references")
            if expanded { groupedReferenceRows(groups) }
        }
    }

    private func groupedReferenceRows(_ groups: [ReferenceGroup]) -> some View {
        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
            if let heading = group.heading {
                Section(heading) { referenceRows(group.rows) }
            } else {
                referenceRows(group.rows)
            }
        }
    }

    private func referenceRows(_ rows: [ReferenceRow]) -> some View {
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            refRow(row.book, row.chapter, row.verse, row.end, row.text, detail: row.detail)
        }
    }

    private func load(_ reference: String) async {
        let result: (groups: [ReferenceGroup], error: Bool)
        let targets = scopedSelection.isEmpty ? scopedVerse.map { [$0] } ?? [] : scopedSelection
        let classic = source == "classic"
        if !targets.isEmpty {
            var selectedGroups: [ReferenceGroup] = []
            var hadError = false
            for selected in targets {
                guard !Task.isCancelled else { return }
                let groupsForVerse: [ReferenceGroup]
                let unavailable: Bool
                if classic {
                    let data = await app.crossrefs.forVerse(bookId, chapter, selected, textId: textId)
                    groupsForVerse = data.refs.isEmpty ? [] : [
                        ReferenceGroup(verse: selected, heading: nil, rows: data.refs.map(ReferenceRow.init))
                    ]
                    unavailable = data.error
                } else {
                    let data = await app.crossrefs.tskeForVerse(bookId, chapter, selected, textId: textId)
                    groupsForVerse = tskeGroups(data.groups, verse: selected)
                    unavailable = data.error
                }
                if targets.count > 1, groupsForVerse.isEmpty {
                    selectedGroups.append(ReferenceGroup(verse: selected, heading: nil, rows: [], unavailable: unavailable))
                } else {
                    selectedGroups += groupsForVerse
                }
                hadError = hadError || unavailable
            }
            result = (selectedGroups, targets.count == 1 && hadError)
        } else if classic {
            let data = await app.crossrefs.forChapter(bookId, chapter, textId: textId)
            result = (data.verseRefs.map { ReferenceGroup(verse: $0.verseNum, heading: nil, rows: $0.refs.map(ReferenceRow.init)) }, data.error)
        } else {
            let data = await app.crossrefs.tskeForChapter(bookId, chapter, textId: textId)
            result = (data.verseRefs.flatMap { tskeGroups($0.groups, verse: $0.verseNum) }, data.error)
        }
        guard !Task.isCancelled else { return }
        groups = result.groups
        failed = result.error
        loadedReference = reference
    }

    private func tskeGroups(_ groups: [TskeGroup], verse: Int) -> [ReferenceGroup] {
        groups.filter { !$0.refs.isEmpty }.map {
            ReferenceGroup(verse: verse, heading: $0.isReciprocal ? "Reciprocal" : $0.heading, rows: $0.refs.map(ReferenceRow.init))
        }
    }

    func refRow(_ b: String, _ c: Int, _ v: Int, _ end: Int?, _ text: String, detail: String?) -> some View {
        let passage = ResolvedPassage(textId: "kjva", bookId: b, chapter: c, verse: v > 0 ? v : nil, endVerse: end)
        let preview = VerseDisplay.text(text, tagged: nil, textId: passage.textId,
                                       replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
        return HStack(alignment: .top, spacing: 4) {
            Button {
                #if os(iOS)
                dismiss()
                #endif
                app.visitScripture(passage)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(passage.label).font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                        Spacer()
                        if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    Text(preview).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                }
                .contentShape(.rect)
            }.buttonStyle(.interactivePlain)
            .contextMenu { referenceActions(passage, preview: preview) }
            VerseActionsMenu(label: "Actions for \(passage.label) KJVA") {
                referenceActions(passage, preview: preview)
            }
        }
    }

    @ViewBuilder private func referenceActions(_ passage: ResolvedPassage, preview: String) -> some View {
        let reference = referenceForCopy(passage.label, textId: passage.textId)
        Button("Copy", systemImage: "doc.on.doc") {
            Clipboard.copy(passage.textId == "lxx" && !preview.isEmpty ? "\(reference) \(preview)" : reference)
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        Button("Open in New Tab", systemImage: "plus.square") {
            #if os(iOS)
            dismiss()
            #endif
            app.visitScripture(passage, reuseTab: false)
        }
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
                        .pickerStyle(.segmented).frame(maxWidth: 280).clickableCursor()
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
    @State private var loadedTagName: String?
    @State private var tag: VerseTagSummary?
    @State private var members: [TagMemberDetail] = []
    @State private var texts: [String: String] = [:]

    var body: some View {
        let edition = app.defaultText
        List {
            if loadedTagName != tagName {
                ProgressView()
            } else if let tag {
                Section {
                    HStack { TagChip(name: tag.name, color: tag.color, slot: tag.colorSlot); Spacer()
                        Text("\(tag.verseCount) verse\(tag.verseCount == 1 ? "" : "s") · \(tag.chapterCount) chapter\(tag.chapterCount == 1 ? "" : "s")").foregroundStyle(.secondary) }
                    Text(textInfo(edition).name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(members) { m in
                    Section(m.label) {
                        ForEach(Array(m.wholeChapters.enumerated()), id: \.offset) { _, c in
                            Button { app.openScripture(bookId: c.bookId, chapter: c.chapter, textId: edition, reuseTab: true) } label: { Label(Reference.readerChapterLabel(c.bookId, c.chapter, textId: edition), systemImage: "book") }
                        }
                        ForEach(Array(m.verses.enumerated()), id: \.offset) { _, v in
                            Button { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verse, textId: edition, reuseTab: true) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verse, hermas: HermasText(textId: edition))).font(.headline)
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
        .task(id: "\(tagName)|\(app.tagsRevision)|\(app.defaultText)|\(app.wordReplacerEnabled)") {
            let replaceWords = app.wordReplacerEnabled
            texts = [:]
            tag = (try? app.verseTags?.list())?.first { $0.name.caseInsensitiveCompare(tagName) == .orderedSame }
            members = tag.flatMap { try? app.verseTags?.members([$0.id]) } ?? []
            loadedTagName = tagName
            let refs = members.flatMap { $0.verses.map { ($0.bookId, $0.chapter, $0.verse) } }
            let rows = await app.bible.queryVerses(refs.map { (bookId: $0.0, chapter: $0.1, verse: $0.2) }, textId: edition)
            guard !Task.isCancelled else { return }
            texts = Dictionary(rows.map { ($0.key, VerseDisplay.text($0.value.text, tagged: nil, textId: edition, replacerEnabled: replaceWords, rules: WordReplacer.defaultRules)) }, uniquingKeysWith: { a, _ in a })
        }
    }
}
