import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes

private struct LexiconEntryGuide: View {
    let close: () -> Void

    private static let fields: [(title: String, description: String)] = [
        ("Strong’s number", "Identifies a dictionary entry. H denotes Hebrew or Aramaic and G denotes Greek."),
        ("Original word", "The dictionary headword in the original script. Hebrew reads right to left."),
        ("Transliteration and pronunciation", "The headword written in Latin letters, followed by a pronunciation guide when available."),
        ("Gloss", "A short English summary. Compare the definition and verse context for the range of meanings."),
        ("Definition", "A fuller explanation of the word’s meanings and uses."),
        ("Derivation", "The word’s origin or root. Select a linked Strong’s number to read that entry."),
        ("BDB Notes and Extended", "Additional dictionary material. BDB stands for Brown–Driver–Briggs, a Hebrew lexicon. An occurrence count in these notes refers to usage, separate from the entry number."),
        ("Derived Terms", "Related dictionary entries. Select one to explore its meaning and usage."),
        ("Occurrences", "Passages indexed for this entry. Filter by edition, book, or translated word to narrow the list.")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("How to Read a Lexicon Entry")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Done", action: close)
                    .keyboardShortcut(.cancelAction)
            }
            .padding()
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Self.fields, id: \.title) { field in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(field.title).font(.subheadline.weight(.semibold))
                                .accessibilityAddTraits(.isHeader)
                            Text(field.description).foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
        }
        #if os(macOS)
        .frame(width: 380, height: 450)
        #endif
    }
}

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
    @State private var occurrencesTruncated = false
    @State private var previews: [OccurrenceKey: OccurrencePreview] = [:]
    @State private var adjacent: (previous: String?, next: String?) = (nil, nil)
    @State private var loaded = false
    @State private var occurrencesLoading = false
    @State private var scrollPosition = ScrollPosition()
    @State private var restoredScrollEntry: String?
    @State private var restoredWithChangedWordReplacement = false
    @State private var showsOccurrenceFilters = false
    @State private var occurrenceFilterList: OccurrenceFilterList?
    @FocusState private var occurrenceFilterSearchFocused: Bool
    @State private var occurrenceFilterQuery = ""
    private enum OccurrenceFilterList { case books, words }

    @State private var occurrenceEdition: String?
    @State private var occurrenceBook: String?
    @State private var visibleOccurrences = 40
    /// ⌘F find inside the entry (original LexiconPanel find bar); highlights matches in the entry's prose.
    @State private var findShown = false
    @State private var showsEntryGuide = false
    @State private var findSection = 0
    @State private var pendingFindOccurrence: OccurrenceKey?
    private enum FindSection: Hashable {
        case headword, gloss, definition, derivation, extended
        case related(String), occurrence(OccurrenceKey)
    }
    @State private var findQuery = ""
    @FocusState private var findFocused: Bool
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
    /// Case- and diacritic-insensitive find highlights.
    private func markFind(_ text: AttributedString) -> AttributedString {
        let q = findQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard findShown, q.count >= 2 else { return text }
        var out = text
        var start = out.startIndex
        while start < out.endIndex, let r = out[start...].range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) {
            out[r].backgroundColor = Color.yellow.opacity(0.45)
            start = r.upperBound
        }
        return out
    }

    private func findMatches(_ e: LexiconEntry, occurrenceRows: [IndexedOccurrence]) -> (sections: [FindSection], count: Int) {
        let query = findQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard findShown, query.count >= 2 else { return ([], 0) }
        let pronunciation = [e.transliteration, e.pronunciation].filter { !$0.isEmpty }.joined(separator: " · ")
        let extended = e.strongsNum.hasPrefix("H") ? BdbNotes.tokens(replaced(e.extendedDef)).map { token in
            switch token {
            case .text(let text), .number(let text), .abbr(let text, _): text
            }
        }.joined() : replaced(e.extendedDef)
        var fields: [(FindSection, String)] = [
            (.headword, e.lemma), (.headword, pronunciation), (.gloss, displayGloss(e)),
            (.definition, replaced(e.definition)), (.derivation, replaced(e.derivation)), (.extended, extended)
        ]
        for row in related {
            fields += [row.strongsNum, row.lemma, row.gloss].map { (.related(row.strongsNum), $0) }
        }
        for (_, occurrence, _, preview, key) in occurrenceRows {
            let passage = ResolvedPassage(textId: occurrence.textId, bookId: occurrence.bookId,
                                          chapter: occurrence.chapter, verse: occurrence.verseNum)
            fields += [passage.label, textInfo(occurrence.textId).short, preview.words.joined(separator: " ")]
                .map { (.occurrence(key), $0) }
        }
        var sections: [FindSection] = []
        var count = 0
        for (section, text) in fields {
            var start = text.startIndex
            while let match = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], range: start..<text.endIndex) {
                count += 1
                if sections.last != section { sections.append(section) }
                start = match.upperBound
            }
        }
        return (sections, count)
    }

    private func moveFind(_ direction: Int, in sections: [FindSection], rows: [IndexedOccurrence], proxy: ScrollViewProxy) {
        guard !sections.isEmpty else { return }
        findSection = (min(findSection, sections.count - 1) + direction + sections.count) % sections.count
        scrollToFind(sections[findSection], rows: rows, proxy: proxy)
    }

    private func scrollToFind(_ section: FindSection, rows: [IndexedOccurrence], proxy: ScrollViewProxy) {
        pendingFindOccurrence = nil
        if case .occurrence(let key) = section {
            guard let index = rows.firstIndex(where: { $0.4 == key }) else { return }
            if index >= visibleOccurrences {
                visibleOccurrences = min(rows.count, (index / 40 + 1) * 40)
                pendingFindOccurrence = key
            } else {
                proxy.scrollTo(key, anchor: .top)
            }
        } else {
            proxy.scrollTo(section, anchor: .top)
        }
    }

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
        return Text(markFind(out))
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
        return Text(markFind(out))
    }

    /// Context menu for a Strong's number (original StrongsContextMenu.tsx).
    @ViewBuilder private func strongsMenu(_ id: String, gloss: String) -> some View {
        Button("Open", systemImage: "character.book.closed") { app.navigateLexicon(id, in: tabId) }
        Button("Open in New Tab", systemImage: "plus.square.on.square") {
            leaveInspector()
            app.openLexicon(id, from: app.findTab(tabId))
            app.recordTabReturn(to: tabId)
        }
        Divider()
        Button("Copy \(id)", systemImage: "doc.on.doc") { copyToPasteboard(id) }
        Button("Copy Reference", systemImage: "number") { copyToPasteboard("Strong's \(id)") }
        if !gloss.isEmpty { Button("Copy \(id) with Gloss", systemImage: "doc.on.doc") { copyToPasteboard("Strong's \(id) — \(gloss)") } }
    }

    /// Short form for Copy with Gloss.
    private func entrySummary(_ e: LexiconEntry) -> String {
        let translit = e.transliteration.isEmpty ? "" : " (\(e.transliteration))"
        let gloss = displayGloss(e)
        return "\(e.strongsNum) \(e.lemma)\(translit)" + (gloss.isEmpty ? "" : " — \(gloss)")
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
        let books = Dictionary(grouping: editionOccurrences, by: \.bookId)
        let scoped = occurrenceBook.map { books[$0] ?? [] } ?? editionOccurrences
        let indexed = indexedOccurrences(scoped)
        let occurrenceMatches = matchingOccurrences(indexed)
        let visibleRows = Array(occurrenceMatches.prefix(visibleOccurrences))
        let matches = (entry?.strongsNum == strongsId.uppercased() ? entry : nil)
            .map { findMatches($0, occurrenceRows: occurrenceMatches) } ?? (sections: [], count: 0)
        let sections = matches.sections
        let matchingDestinations = Set(sections)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let e = entry, e.strongsNum == strongsId.uppercased() {
                        VStack(alignment: .leading, spacing: 4) {
                            if compact {
                                HStack {
                                    Text(e.strongsNum).font(.caption.monospaced()).foregroundStyle(.secondary)
                                    Spacer()
                                    copyEntryButton(e)
                                        .labelStyle(.iconOnly)
                                        .buttonStyle(.interactivePlain)
                                    entryGuideButton
                                        .buttonStyle(.interactivePlain)
                                    entryNavigation
                                }
                            }
                            Text(markFind(AttributedString(e.lemma))).font(.system(size: compact ? 28 : 36, weight: .regular, design: .serif))
                            Text(markFind(AttributedString([e.transliteration, e.pronunciation].filter { !$0.isEmpty }.joined(separator: " · ")))).foregroundStyle(.secondary)
                        }
                        .id(FindSection.headword)
                        .contextMenu {
                            copyEntryButton(e)
                            Button("Copy \(e.strongsNum)", systemImage: "number") { copyToPasteboard(e.strongsNum) }
                            Button("Copy \(e.strongsNum) with Gloss", systemImage: "doc.on.doc") { copyToPasteboard(entrySummary(e)) }
                            Button("Copy \(e.lemma)", systemImage: "character") { copyToPasteboard(e.lemma) }
                        }
                        if !e.gloss.isEmpty { linkedText(displayGloss(e), lang: e.strongsNum.first ?? "H").font(.headline).textSelection(.enabled).environment(\.openURL, lexiconLinkAction).id(FindSection.gloss) }
                        if !e.definition.isEmpty { section("Definition") { linkedText(replaced(e.definition), lang: e.strongsNum.first ?? "H").textSelection(.enabled).environment(\.openURL, lexiconLinkAction) }.id(FindSection.definition) }
                        if !e.derivation.isEmpty { section("Derivation") { linkedText(replaced(e.derivation), lang: e.strongsNum.first ?? "H").textSelection(.enabled).environment(\.openURL, lexiconLinkAction) }.id(FindSection.derivation) }
                        if !e.extendedDef.isEmpty, !compact {
                            if e.strongsNum.hasPrefix("H") {
                                section("BDB Notes") { bdbText(replaced(e.extendedDef)).textSelection(.enabled) }.id(FindSection.extended)
                            } else {
                                section("Extended") { Text(markFind(AttributedString(replaced(e.extendedDef)))).textSelection(.enabled) }.id(FindSection.extended)
                            }
                        }
                        if !related.isEmpty {
                            section("Derived Terms") {
                                ForEach(related, id: \.strongsNum) { r in
                                    Button { app.navigateLexicon(r.strongsNum, in: tabId) } label: {
                                        HStack(spacing: 8) {
                                            Text(markFind(AttributedString(r.strongsNum))).monospaced().foregroundStyle(Color.accentColor)
                                            Text(markFind(AttributedString(r.lemma)))
                                            Text(markFind(AttributedString(r.gloss))).foregroundStyle(.secondary)
                                                .lineLimit(matchingDestinations.contains(.related(r.strongsNum)) ? nil : 1)
                                            Spacer(minLength: 0)
                                            Image(systemName: "chevron.forward")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                                .accessibilityHidden(true)
                                        }
                                        .frame(minHeight: entryControlHeight)
                                        .contentShape(.rect)
                                    }.buttonStyle(OptionButtonStyle())
                                    .contextMenu { strongsMenu(r.strongsNum, gloss: r.gloss) }
                                    .id(FindSection.related(r.strongsNum))
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Occurrences")
                                .font(.headline)
                                .accessibilityAddTraits(.isHeader)
                                .id("occurrences-heading")
                            if occurrencesLoading {
                                ProgressView().accessibilityLabel("Loading occurrences")
                            } else if occurrences.isEmpty {
                                Text("No occurrences found").foregroundStyle(.secondary)
                            } else {
                                let forms = indexed.reduce(into: [String: Int]()) { counts, row in
                                    for word in row.2 { counts[word, default: 0] += 1 }
                                }
                                Text(occurrenceCountLabel(occurrenceMatches.count))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                if occurrencesTruncated {
                                    Text("This preview shows a sample. Open the full entry to see all occurrences.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                FlowLayout(spacing: 6) {
                                    occurrenceFilters(books: books, forms: forms, canSort: scoped.count > 1 || sortByMatches)
                                    Button("Search Scripture", systemImage: "magnifyingglass") {
                                        leaveInspector()
                                        app.openSearch(e.strongsNum, reuseTab: true, returningTo: tabId)
                                    }
                                    .buttonStyle(OptionButtonStyle())
                                    .accessibilityHint("Search all texts for \(e.strongsNum)")
                                    .help("Search Scripture for \(e.strongsNum)")
                                    if compact {
                                        Button("Open Full Lexicon", systemImage: "arrow.up.right.square", action: openFullLexicon)
                                        .buttonStyle(OptionButtonStyle())
                                    }
                                }
                                if hasOccurrenceOptions { activeOccurrenceOptions }
                                if occurrenceMatches.isEmpty {
                                    Text(occurrencesTruncated
                                         ? "No loaded occurrences match these filters."
                                         : "No occurrences match these filters.")
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                    if hasOccurrenceOptions {
                                        Button("Reset Filters", systemImage: "arrow.counterclockwise", action: resetOccurrenceFilters)
                                            .buttonStyle(OptionButtonStyle())
                                    }
                                }
                            }
                            LazyVStack(alignment: .leading, spacing: 8) {
                                ForEach(visibleRows, id: \.4) { _, o, _, preview, key in
                                    occurrenceRow(o, preview: preview, key: key,
                                                  expanded: matchingDestinations.contains(.occurrence(key)))
                                }
                            }
                            FlowLayout(spacing: 8) {
                                if occurrenceMatches.count > visibleOccurrences {
                                    Button("Show More", systemImage: "chevron.down") {
                                        visibleOccurrences = min(visibleOccurrences + 40, occurrenceMatches.count)
                                    }
                                    .help("Show the next page of occurrences")
                                    Button(occurrencesTruncated ? "Show All Loaded" : "Show All \(occurrenceMatches.count.formatted())") {
                                        visibleOccurrences = occurrenceMatches.count
                                    }
                                }
                                if visibleRows.count > 40 {
                                    Button("Show Fewer", systemImage: "chevron.up") {
                                        visibleOccurrences = 40
                                        proxy.scrollTo("occurrences-heading", anchor: .top)
                                    }
                                }
                            }
                            .buttonStyle(OptionButtonStyle())
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
                let pendingReturn = app.lexiconOccurrenceReturns[tabId]?[strongsId]
                if let key = pendingReturn,
                   let index = matchingOccurrences(indexedOccurrences(
                       editionOccurrences.filter { occurrenceBook == nil || $0.bookId == occurrenceBook }
                   )).firstIndex(where: { $0.4 == key }) {
                    let requiredLimit = (index / 40 + 1) * 40
                    visibleOccurrences = max(visibleOccurrences, requiredLimit)
                    await Task.yield()
                    guard !Task.isCancelled, app.activeTab?.id == tabId,
                          app.lexiconOccurrenceReturns[tabId]?[strongsId] == key else { return }
                    proxy.scrollTo(key, anchor: .center)
                    app.lexiconOccurrenceReturns[tabId]?.removeValue(forKey: strongsId)
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
                if let pendingReturn, !Task.isCancelled, app.activeTab?.id == tabId,
                   app.lexiconOccurrenceReturns[tabId]?[strongsId] == pendingReturn {
                    // The matching occurrence may have been filtered out while away.
                    app.lexiconOccurrenceReturns[tabId]?.removeValue(forKey: strongsId)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if findShown, !compact {
                    HStack(spacing: 8) {
                        TextField("Find in Entry", text: $findQuery).textFieldStyle(.plain).focused($findFocused)
                            .onSubmit { moveFind(1, in: sections, rows: occurrenceMatches, proxy: proxy) }
                            .onKeyPress(.escape) { findShown = false; findQuery = ""; return .handled }
                        if findQuery.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 {
                            Text(sections.count > 1
                                 ? "\(min(findSection + 1, sections.count))/\(sections.count) results"
                                 : matches.count == 1 ? "1 match" : "\(matches.count) matches")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Button("Previous Matching Section", systemImage: "chevron.up") {
                            moveFind(-1, in: sections, rows: occurrenceMatches, proxy: proxy)
                        }
                            .disabled(sections.count < 2)
                        Button("Next Matching Section", systemImage: "chevron.down") {
                            moveFind(1, in: sections, rows: occurrenceMatches, proxy: proxy)
                        }
                            .disabled(sections.count < 2)
                        Button("Close Find", systemImage: "xmark") { findShown = false; findQuery = "" }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.interactivePlain)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .glassEffectCompat(interactive: true)
                    .padding(.horizontal, 16).padding(.vertical, 6)
                }
            }
            .onChange(of: sections) { _, updated in
                findSection = 0
                if let first = updated.first {
                    scrollToFind(first, rows: occurrenceMatches, proxy: proxy)
                } else {
                    pendingFindOccurrence = nil
                }
            }
            .task(id: pendingFindOccurrence) {
                guard let key = pendingFindOccurrence, matchingDestinations.contains(.occurrence(key)),
                      visibleRows.contains(where: { $0.4 == key }) else { return }
                await Task.yield()
                guard !Task.isCancelled, pendingFindOccurrence == key else { return }
                proxy.scrollTo(key, anchor: .top)
                pendingFindOccurrence = nil
            }
        }
        .toolbar {
            // Full Lexicon tab: previous / next entry and search live in the window toolbar (top right).
            if !compact {
                ToolbarItemGroup(placement: .primaryAction) {
                    toolbarAdjacentButton(adjacent.previous, title: "Previous Entry", symbol: "chevron.backward")
                    toolbarAdjacentButton(adjacent.next, title: "Next Entry", symbol: "chevron.forward")
                }
                #if os(macOS)
                if #available(macOS 26.0, *) { ToolbarSpacer(.fixed, placement: .primaryAction) }
                #endif
                ToolbarItemGroup(placement: .primaryAction) {
                    #if os(iOS)
                    Menu {
                        entryTools
                    } label: {
                        Label("Entry Tools", systemImage: "ellipsis.circle")
                    }
                    .menuIndicator(.hidden)
                    #else
                    entryTools
                    #endif
                    entryGuideButton
                        .clickableCursor()
                }
            }
        }
        .id(strongsId)
        .onChange(of: app.wordReplacerEnabled) {
            selectedRenderings = []
            visibleOccurrences = 40
        }
        .task(id: "\(strongsId)|\(app.wordReplacerEnabled)") {
            guard !occurrencesLoading, !occurrences.isEmpty,
                  entry?.strongsNum == strongsId.uppercased() else { return }
            let enabled = app.wordReplacerEnabled
            let updated = await Self.preparePreviews(occurrences, strongsId: strongsId, replacerEnabled: enabled)
            guard !Task.isCancelled, !occurrencesLoading, app.wordReplacerEnabled == enabled,
                  entry?.strongsNum == strongsId.uppercased() else { return }
            previews = updated
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
            occurrencesTruncated = false
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
            let newOccurrences: (rows: [LexiconOccurrence], truncated: Bool)
            if compact {
                newOccurrences = await app.lexicon.occurrenceBatch(strongsId, quickLimit: 60)
            } else {
                newOccurrences = (await app.lexicon.allOccurrences(strongsId), false)
            }
            guard !Task.isCancelled else { return }
            var enabled: Bool
            var updated: [OccurrenceKey: OccurrencePreview]
            repeat {
                enabled = app.wordReplacerEnabled
                updated = await Self.preparePreviews(newOccurrences.rows, strongsId: strongsId, replacerEnabled: enabled)
                guard !Task.isCancelled else { return }
            } while app.wordReplacerEnabled != enabled
            previews = updated
            occurrences = newOccurrences.rows
            occurrencesTruncated = newOccurrences.truncated
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

    private func occurrenceRow(_ occurrence: LexiconOccurrence, preview: OccurrencePreview,
                               key: OccurrenceKey, expanded: Bool) -> some View {
        let passage = ResolvedPassage(textId: occurrence.textId, bookId: occurrence.bookId,
                                      chapter: occurrence.chapter, verse: occurrence.verseNum)
        let reference = passage.label + (passage.textId == "lxx" ? " LXX" : "")
        return Button {
            openOccurrence(passage, key: key)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(markFind(AttributedString(passage.label))).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                    Text(markFind(AttributedString(textInfo(passage.textId).short)))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.forward")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                Text(markFind(highlighted(preview))).font(.callout).foregroundStyle(.secondary)
                    .lineLimit(expanded ? nil : 3)
            }
            .frame(maxWidth: .infinity, minHeight: entryControlHeight, alignment: .leading)
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(OptionButtonStyle())
        .contextMenu {
            Button("Open Verse", systemImage: "book") { openOccurrence(passage, key: key) }
            Button("Open in New Tab", systemImage: "plus.square") { openOccurrence(passage, key: key, newTab: true) }
            Divider()
            if !preview.words.isEmpty {
                Button("Copy Verse", systemImage: "doc.on.doc") {
                    Clipboard.copy(reference + " " + preview.words.joined(separator: " "))
                    AccessibilityNotification.Announcement("Verse copied").post()
                }
            }
            Button("Copy Reference", systemImage: "number") {
                Clipboard.copy(reference)
                AccessibilityNotification.Announcement("Reference copied").post()
            }
        }
        .id(key)
    }

    private func openOccurrence(_ passage: ResolvedPassage, key: OccurrenceKey, newTab: Bool = false) {
        if !compact { app.lexiconOccurrenceReturns[tabId, default: [:]][strongsId] = key }
        leaveInspector()
        app.visitScripture(passage, reuseTab: !newTab, returningTo: tabId)
    }

    private func leaveInspector() {
        #if os(iOS)
        if compact { dismiss() }
        #endif
    }

    private var hasOccurrenceOptions: Bool {
        occurrenceEdition != nil || occurrenceBook != nil || !selectedRenderings.isEmpty || sortByMatches
    }

    private func openFullLexicon() {
        let transfer = hasOccurrenceOptions
            ? OccurrenceOptions(pageLimit: 40, edition: occurrenceEdition, book: occurrenceBook,
                                renderings: selectedRenderings, sortByMatches: sortByMatches,
                                wordReplacerEnabled: app.wordReplacerEnabled)
            : nil
        leaveInspector()
        app.openLexicon(strongsId, reuseTab: true)
        guard let transfer, let destination = app.activeTab,
              destination.tabType == .lexicon,
              destination.state["strongsNum"]?.stringValue?.string == strongsId else { return }
        if app.lexiconOccurrenceOptions[destination.id]?[strongsId] != transfer {
            app.lexiconScrollOffsets[destination.id]?.removeValue(forKey: strongsId)
            app.lexiconOccurrenceOptions[destination.id, default: [:]][strongsId] = transfer
        }
    }

    private func resetOccurrenceFilters() {
        occurrenceEdition = nil
        occurrenceBook = nil
        selectedRenderings = []
        sortByMatches = false
        visibleOccurrences = 40
        occurrenceFilterList = nil
        occurrenceFilterQuery = ""
    }

    private var activeOccurrenceOptions: some View {
        FlowLayout(spacing: 6) {
            if let occurrenceEdition {
                occurrenceOptionChip(textInfo(occurrenceEdition).short, kind: "edition") { self.occurrenceEdition = nil }
            }
            if let occurrenceBook {
                occurrenceOptionChip(Reference.bookName(occurrenceBook), kind: "book") { self.occurrenceBook = nil }
            }
            if !selectedRenderings.isEmpty {
                let title = selectedRenderings.count == 1
                    ? selectedRenderings.first ?? ""
                    : "\(selectedRenderings.count) translated words"
                occurrenceOptionChip(title, kind: "translated words") { selectedRenderings = [] }
            }
            if sortByMatches {
                occurrenceOptionChip("Most Matches", kind: "sort") { sortByMatches = false }
            }
        }
    }

    private func occurrenceOptionChip(_ title: String, kind: String, clear: @escaping () -> Void) -> some View {
        Button {
            clear()
            visibleOccurrences = 40
        } label: {
            HStack(spacing: 5) {
                Text(title).lineLimit(1)
                Image(systemName: "xmark").font(.caption2.weight(.semibold))
            }
            .font(.caption)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(.quaternary, in: .capsule)
            .frame(minHeight: entryControlHeight)
            .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel("Clear \(kind): \(title)")
        .help("Clear \(kind)")
    }

    private func occurrenceCountLabel(_ matches: Int) -> String {
        let total = occurrences.count.formatted()
        if occurrencesTruncated {
            return matches == occurrences.count ? "\(total) passages in preview" : "\(matches.formatted()) of \(total) preview passages"
        }
        if matches == occurrences.count { return matches == 1 ? "1 passage" : "\(total) passages" }
        return "\(matches.formatted()) of \(total) passages"
    }

    private func occurrenceFilters(books: [String: [LexiconOccurrence]], forms: [String: Int], canSort: Bool) -> some View {
        Button("Filters", systemImage: hasOccurrenceOptions ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle") {
            occurrenceFilterList = nil
            occurrenceFilterQuery = ""
            showsOccurrenceFilters = true
        }
        .buttonStyle(OptionButtonStyle(active: hasOccurrenceOptions || showsOccurrenceFilters))
        .accessibilityHint(hasOccurrenceOptions ? "Occurrence filters are active" : "Filter and sort occurrences")
        .popover(isPresented: $showsOccurrenceFilters, arrowEdge: .bottom) {
            #if os(macOS)
            occurrenceFilterPanel(books: books, forms: forms, canSort: canSort)
                .padding(16)
                .frame(width: 320)
            #else
            ScrollView {
                occurrenceFilterPanel(books: books, forms: forms, canSort: canSort)
                    .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .presentationCompactAdaptation(.sheet)
            #endif
        }
    }

    private func occurrenceFilterPanel(books: [String: [LexiconOccurrence]], forms: [String: Int], canSort: Bool) -> some View {
        let bookOptions = Set(books.keys).union(occurrenceBook.map { [$0] } ?? [])
        let wordOptions = Set(forms.keys).union(selectedRenderings)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Occurrence Filters").font(.headline)
                Spacer()
                Button("Done") { showsOccurrenceFilters = false }
                    .buttonStyle(OptionButtonStyle())
            }
            Text("Narrow results").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if editions.count > 1 {
                Picker("Edition", selection: $occurrenceEdition) {
                    Text("All Editions").tag(nil as String?)
                    ForEach(editions, id: \.self) { edition in
                        Text(textInfo(edition).short).tag(Optional(edition))
                    }
                }
                .pickerStyle(.menu).clickableCursor().optionHover()
            }
            if !bookOptions.isEmpty {
                occurrenceFilterDisclosure(.books, title: "Book", value: occurrenceBook.map { Reference.bookName($0) } ?? "All Books") {
                    Button {
                        occurrenceBook = nil
                        occurrenceFilterList = nil
                    } label: { occurrenceChoice("All Books", selected: occurrenceBook == nil) }
                    .buttonStyle(OptionButtonStyle())
                    let matching = bookOptions.filter { matchesOccurrenceFilter(Reference.bookName($0)) }
                        .sorted { (Reference.bookOrder($0), $0) < (Reference.bookOrder($1), $1) }
                    if matching.isEmpty { occurrenceFilterEmpty("No matching books") }
                    ForEach(matching, id: \.self) { book in
                        Button {
                            occurrenceBook = book
                            occurrenceFilterList = nil
                        } label: {
                            occurrenceChoice(Reference.bookName(book), count: books[book]?.count ?? 0,
                                             selected: occurrenceBook == book)
                        }
                        .buttonStyle(OptionButtonStyle())
                    }
                }
            }
            if !wordOptions.isEmpty {
                occurrenceFilterDisclosure(.words, title: "Translated Words",
                                           value: selectedRenderings.isEmpty ? "Any" : "\(selectedRenderings.count) selected") {
                    if !selectedRenderings.isEmpty {
                        Button("Clear Selected Words", systemImage: "xmark") { selectedRenderings.removeAll() }
                            .buttonStyle(OptionButtonStyle())
                    }
                    let ordered = wordOptions.filter(matchesOccurrenceFilter).sorted {
                        (-(forms[$0] ?? 0), $0) < (-(forms[$1] ?? 0), $1)
                    }
                    if ordered.isEmpty { occurrenceFilterEmpty("No matching translated words") }
                    ForEach(ordered, id: \.self) { word in
                        Button {
                            if selectedRenderings.contains(word) { selectedRenderings.remove(word) }
                            else { selectedRenderings.insert(word) }
                        } label: {
                            occurrenceChoice(word, count: forms[word] ?? 0, selected: selectedRenderings.contains(word))
                        }
                        .buttonStyle(OptionButtonStyle())
                    }
                }
            }
            if canSort {
                Divider()
                Picker("Order", selection: $sortByMatches) {
                    Text(compact ? "Default Order" : "Scripture Order").tag(false)
                    Text("Most Matches").tag(true)
                }
                .pickerStyle(.menu).clickableCursor().optionHover()
            }
            if hasOccurrenceOptions {
                Button("Reset Filters", action: resetOccurrenceFilters)
                    .buttonStyle(OptionButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: occurrenceEdition) { visibleOccurrences = 40 }
        .onChange(of: occurrenceBook) { visibleOccurrences = 40 }
        .onChange(of: selectedRenderings) { visibleOccurrences = 40 }
        .onChange(of: sortByMatches) { visibleOccurrences = 40 }
    }

    private func occurrenceFilterDisclosure<Choices: View>(_ list: OccurrenceFilterList, title: String, value: String,
                                                            @ViewBuilder choices: () -> Choices) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                occurrenceFilterList = occurrenceFilterList == list ? nil : list
                occurrenceFilterQuery = ""
            } label: {
                HStack {
                    Text(title)
                    Spacer()
                    Text(value).foregroundStyle(.secondary).lineLimit(1)
                    Image(systemName: occurrenceFilterList == list ? "chevron.up" : "chevron.down")
                        .font(.caption)
                }
            }
            .buttonStyle(OptionButtonStyle(active: occurrenceFilterList == list))
            if occurrenceFilterList == list {
                HStack(spacing: 4) {
                    TextField(list == .books ? "Find a book" : "Find a translated word", text: $occurrenceFilterQuery)
                        .textFieldStyle(.roundedBorder)
                        .focused($occurrenceFilterSearchFocused)
                        #if os(macOS)
                        .onAppear { occurrenceFilterSearchFocused = true }
                        #endif
                    if !occurrenceFilterQuery.isEmpty {
                        Button("Clear filter search", systemImage: "xmark.circle.fill") { occurrenceFilterQuery = "" }
                            .labelStyle(.iconOnly)
                            .buttonStyle(OptionButtonStyle())
                    }
                }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) { choices() }
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 144)
                .accessibilityLabel(list == .books ? "Books" : "Translated Words")
            }
        }
    }

    private func matchesOccurrenceFilter(_ value: String) -> Bool {
        let query = occurrenceFilterQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty || value.localizedStandardContains(query)
    }

    private func occurrenceFilterEmpty(_ title: String) -> some View {
        Text(title)
            .font(.callout)
            .foregroundStyle(.secondary)
            .padding(8)
    }

    private func occurrenceChoice(_ title: String, count: Int? = nil, selected: Bool) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 4)
            if let count {
                Text(count, format: .number).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Image(systemName: "checkmark").opacity(selected ? 1 : 0).accessibilityHidden(true)
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var entryTools: some View {
        Button("Find in Entry", systemImage: "text.magnifyingglass") {
            findShown = true
            findFocused = true
        }
        .keyboardShortcut("f")
        .clickableCursor()
        .help("Find in this entry (⌘F)")
        Button("Search Lexicon", systemImage: "magnifyingglass") { app.openLexiconSearch() }
            .clickableCursor()
            .help("Search the Lexicon")
        if let entry, entry.strongsNum == strongsId.uppercased() {
            copyEntryButton(entry)
                .clickableCursor()
        }
    }

    private func copyEntryButton(_ entry: LexiconEntry) -> some View {
        Button {
            copyToPasteboard(entry.dictionaryCopyText)
        } label: {
            Label("Copy Strong’s Number and Definition", systemImage: "doc.on.doc")
                .frame(minWidth: compact ? entryControlHeight : nil, minHeight: compact ? entryControlHeight : nil)
                .contentShape(.rect)
        }
        .help("Copy Strong’s number and definition")
    }

    private var entryGuideButton: some View {
        Button { showsEntryGuide = true } label: {
            Label("How to Read a Lexicon Entry", systemImage: "info.circle")
                .labelStyle(.iconOnly)
                .font(.body)
                .frame(width: entryControlHeight, height: entryControlHeight)
                .contentShape(.rect)
                .popover(isPresented: $showsEntryGuide, content: entryGuide)
        }
        .help("How to read a lexicon entry")
    }

    private func entryGuide() -> some View {
        LexiconEntryGuide { showsEntryGuide = false }
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
            .clickableCursor(destination != nil)
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

    struct OccurrenceKey: Hashable, Sendable {
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

    private struct OccurrencePreview: Sendable {
        let words: [Substring]
        let matches: Set<Int>
        let renderings: Set<String>
    }

    @concurrent private static func preparePreviews(
        _ occurrences: [LexiconOccurrence], strongsId: String, replacerEnabled: Bool
    ) async -> [OccurrenceKey: OccurrencePreview] {
        var result: [OccurrenceKey: OccurrencePreview] = [:]
        result.reserveCapacity(occurrences.count)
        for occurrence in occurrences {
            guard !Task.isCancelled else { return [:] }
            result[OccurrenceKey(occurrence)] = occurrencePreview(occurrence, strongsId: strongsId, replacerEnabled: replacerEnabled)
        }
        return result
    }

    nonisolated private static func occurrencePreview(_ occurrence: LexiconOccurrence, strongsId: String, replacerEnabled: Bool) -> OccurrencePreview {
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
    let sourceTabID: String
    var performDestination: ((@escaping () -> Void) -> Void)?
    @AppStorage("crossrefSource") private var source = "tske"
    @State private var loadedReference: String?
    @State private var groups: [ReferenceGroup] = []
    @State private var expandedVerses: Set<Int> = []
    @State private var failed = false
    @State private var indirectNotes: [Note] = []
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
        var textId = "kjva"
        var noteID: String?

        init(_ link: NoteCrossReferences.Link) {
            (book, chapter, verse, end, text) = (link.bookId, link.chapter, link.verse ?? 0, link.endVerse, link.context)
            textId = link.textId
            detail = link.note.title.isEmpty ? "Untitled" : link.note.title
            noteID = link.note.id
        }

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
        let scope = "\(selectionKey)|\(showingChapter)"
        let reference = "\(scope)|\(source)|\(source == "notes" ? app.notesRevision : 0)"
        let usesVerseGroups = showingChapter || scopedSelection.count > 1
        let byVerse = usesVerseGroups ? Dictionary(grouping: groups, by: \.verse) : [:]
        let expandable = Set(byVerse.compactMap { number, groups in
            groups.contains { !$0.rows.isEmpty } ? number : nil
        })
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
                    Button { source = "notes" } label: {
                        Label("My Notes", systemImage: source == "notes" ? "checkmark" : "note.text")
                    }
                } label: {
                    Label(source == "notes" ? "My Notes" : source == "classic" ? "Classic" : "TSKe", systemImage: "line.3.horizontal.decrease")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 8)
                        .frame(minHeight: controlHeight)
                        .contentShape(.rect)
                }
                .menuStyle(.borderlessButton).clickableCursor()
                .fixedSize()
                .menuIndicator(.hidden)
                #if os(iOS)
                .hoverEffect(.highlight)
                #endif
            }
            .padding(.horizontal, 12)
            if loadedReference != reference {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed {
                ContentUnavailableView("Cross references unavailable", systemImage: "exclamationmark.circle",
                                       description: Text("The selected source could not be loaded."))
            } else if groups.isEmpty && indirectNotes.isEmpty {
                ContentUnavailableView("No cross references", systemImage: "arrow.triangle.branch")
            } else {
                if expandable.count > 1 {
                    verseGroupControls(expandable)
                }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if usesVerseGroups {
                            ForEach(byVerse.keys.sorted(), id: \.self) { number in
                                verseSection(number, groups: byVerse[number] ?? [])
                            }
                        } else {
                            groupedReferenceRows(groups)
                        }
                        if !indirectNotes.isEmpty {
                            referenceHeading("Indirect Mentions")
                            ForEach(indirectNotes) { note in
                                Button {
                                    openSourceNote(note.id)
                                } label: {
                                    Label(note.title.isEmpty ? "Untitled" : note.title, systemImage: "note.text")
                                        .frame(maxWidth: .infinity, minHeight: controlHeight, alignment: .leading)
                                        .contentShape(.rect)
                                }
                                .buttonStyle(.interactivePlain)
                                Divider()
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }
                .id(reference)
            }
        }
        .task(id: reference) { await load(reference) }
        .onChange(of: scope) { expandedVerses.removeAll() }
        .onChange(of: selectionKey) { chapterScopeOverride = nil }
    }

    private var controlHeight: CGFloat {
        #if os(macOS)
        32
        #else
        44
        #endif
    }

    private func verseGroupControls(_ expandable: Set<Int>) -> some View {
        let allExpanded = expandable.isSubset(of: expandedVerses)
        let title = allExpanded ? "Collapse All" : "Expand All"
        return HStack {
            Text("By Verse")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Button {
                if allExpanded { expandedVerses.subtract(expandable) }
                else { expandedVerses.formUnion(expandable) }
            } label: {
                Text(title)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .frame(minHeight: controlHeight)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .help(allExpanded ? "Collapse all verse groups" : "Expand all verse groups")
        }
        .padding(.horizontal, 12)
    }

    @ViewBuilder private func verseSection(_ number: Int, groups: [ReferenceGroup]) -> some View {
        let count = groups.reduce(0) { $0 + $1.rows.count }
        let displayed = PsalmSuperscription.readerVerseLabel(number, bookId: bookId, chapter: chapter, textId: textId)
        if count == 0 {
            LabeledContent("Verse \(displayed)",
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
                    Text(number == 0 ? "Chapter" : "Verse \(displayed)").font(.subheadline.weight(.semibold))
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
                referenceHeading(heading)
                referenceRows(group.rows, fromVerse: group.verse)
            } else {
                referenceRows(group.rows, fromVerse: group.verse)
            }
        }
    }

    private func referenceHeading(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 12)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }

    private func referenceRows(_ rows: [ReferenceRow], fromVerse: Int) -> some View {
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            refRow(row, fromVerse: fromVerse)
                .padding(.vertical, 6)
            Divider()
        }
    }

    private func load(_ reference: String) async {
        let result: (groups: [ReferenceGroup], error: Bool)
        let targets = scopedSelection.isEmpty ? scopedVerse.map { [$0] } ?? [] : scopedSelection
        let classic = source == "classic"
        var indirect: [Note] = []
        if source == "notes" {
            if let data = try? app.notes?.crossReferences(bookId: bookId, chapter: chapter, textId: textId, selected: Set(targets)) {
                indirect = data.indirect
                result = (data.byVerse.keys.sorted().map { number in
                    ReferenceGroup(verse: number, heading: nil, rows: (data.byVerse[number] ?? []).map(ReferenceRow.init))
                }, false)
            } else {
                result = ([], true)
            }
        } else if !targets.isEmpty {
            var selectedGroups: [ReferenceGroup] = []
            var hadError = false
            for selected in targets {
                guard !Task.isCancelled else { return }
                let groupsForVerse: [ReferenceGroup]
                let unavailable: Bool
                if classic {
                    let data = await app.crossrefs.forReaderVerse(bookId, chapter, selected, textId: textId)
                    groupsForVerse = data.refs.isEmpty ? [] : [
                        ReferenceGroup(verse: selected, heading: nil, rows: data.refs.map(ReferenceRow.init))
                    ]
                    unavailable = data.error
                } else {
                    let data = await app.crossrefs.tskeForReaderVerse(bookId, chapter, selected, textId: textId)
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
            let reader = await app.readerChapter(.init(book: bookId, chapter: chapter, text: textId))
            guard !Task.isCancelled else { return }
            let data = await app.crossrefs.forReaderChapter(bookId, chapter, verseNumbers: reader.rows.map(\.verseNum), textId: textId)
            result = (data.verseRefs.map { ReferenceGroup(verse: $0.verseNum, heading: nil, rows: $0.refs.map(ReferenceRow.init)) }, data.error)
        } else {
            let reader = await app.readerChapter(.init(book: bookId, chapter: chapter, text: textId))
            guard !Task.isCancelled else { return }
            let data = await app.crossrefs.tskeForReaderChapter(bookId, chapter, verseNumbers: reader.rows.map(\.verseNum), textId: textId)
            result = (data.verseRefs.flatMap { tskeGroups($0.groups, verse: $0.verseNum) }, data.error)
        }
        guard !Task.isCancelled else { return }
        groups = result.groups
        indirectNotes = indirect
        failed = result.error
        loadedReference = reference
    }

    private func tskeGroups(_ groups: [TskeGroup], verse: Int) -> [ReferenceGroup] {
        groups.filter { !$0.refs.isEmpty }.map {
            ReferenceGroup(verse: verse, heading: $0.isReciprocal ? "Reciprocal" : $0.heading, rows: $0.refs.map(ReferenceRow.init))
        }
    }

    private func refRow(_ row: ReferenceRow, fromVerse: Int) -> some View {
        let passage = ResolvedPassage(textId: row.textId, bookId: row.book, chapter: row.chapter,
                                      verse: row.verse > 0 ? row.verse : nil, endVerse: row.end)
        let preview = row.noteID != nil ? row.text : VerseDisplay.text(
            row.text, tagged: nil, textId: passage.textId, replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules
        )
        return HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    openReference(passage, fromVerse: fromVerse)
                } label: {
                    HStack {
                        Text(passage.textId == "kjva" ? passage.label : referenceForCopy(passage.label, textId: passage.textId))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                        Spacer(minLength: 4)
                        if row.noteID == nil, let detail = row.detail {
                            Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                let range = row.noteID == nil && row.verse > 0 && (row.end ?? row.verse) > row.verse ? passage : nil
                if !preview.isEmpty || range != nil {
                    CrossReferencePreview(text: preview, range: range)
                }
                if let noteID = row.noteID, let title = row.detail {
                    Button {
                        openSourceNote(noteID)
                    } label: {
                        Label(title, systemImage: "note.text")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .frame(minHeight: controlHeight, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                    .accessibilityLabel("Open source note, \(title)")
                    .help("Open source note")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contextMenu { referenceActions(passage, fromVerse: fromVerse, sourceNote: row.noteID) }
            VerseActionsMenu(label: "Actions for \(passage.label), \(textInfo(passage.textId).short)") {
                referenceActions(passage, fromVerse: fromVerse, sourceNote: row.noteID)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func openReference(_ passage: ResolvedPassage, fromVerse: Int, newTab: Bool = false) {
        openDestination {
            app.recordStudyCrossReference(passage, sourceBook: bookId, chapter: chapter,
                                          edition: textId, verse: fromVerse > 0 ? fromVerse : nil)
            app.visitScripture(passage, reuseTab: !newTab, returningTo: sourceTabID)
        }
    }

    private func openSourceNote(_ id: String) {
        openDestination { app.openNote(id, fromList: sourceTabID) }
    }

    private func openDestination(_ action: @escaping () -> Void) {
        if let performDestination {
            performDestination(action)
            return
        }
        #if os(iOS)
        dismiss()
        #endif
        action()
    }

    @ViewBuilder private func referenceActions(_ passage: ResolvedPassage, fromVerse: Int, sourceNote: String?) -> some View {
        Button("Open", systemImage: "arrow.up.right") {
            openReference(passage, fromVerse: fromVerse)
        }
        let reference = referenceForCopy(passage.label, textId: passage.textId)
        Button("Copy", systemImage: "doc.on.doc") {
            Task {
                var copied = reference
                if passage.textId == "lxx", let first = passage.verse {
                    let rows = await app.bible.queryChapter(passage.bookId, passage.chapter, textId: passage.textId)
                    let text = rows.filter { (first...max(first, passage.endVerse ?? first)).contains($0.verseNum) }
                        .map { VerseDisplay.text($0.text, tagged: nil, textId: passage.textId,
                                                 replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules) }
                        .joined(separator: " ")
                    if !text.isEmpty { copied += " " + text }
                }
                Clipboard.copy(copied)
                AccessibilityNotification.Announcement("Reference copied").post()
            }
        }
        if let sourceNote {
            Button("Open Source Note", systemImage: "note.text") { openSourceNote(sourceNote) }
        }
        Button("Open in New Tab", systemImage: "plus.square") {
            openReference(passage, fromVerse: fromVerse, newTab: true)
        }
    }
}

private struct CrossReferencePreview: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let text: String
    let range: ResolvedPassage?
    @State private var expanded = false
    @State private var rangeRows: [ChapterVerseRow]?
    @State private var collapsedHeight: CGFloat = 0
    @State private var fullHeight: CGFloat = 0

    private func preview(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var displayedText: String {
        guard expanded, let range, let rangeRows, !rangeRows.isEmpty else { return text }
        return rangeRows.map {
            VerseDisplay.text($0.text, tagged: nil, textId: range.textId,
                              replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
        }.joined(separator: " ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            preview(displayedText)
                .lineLimit(expanded ? nil : 3)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    preview(text).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { collapsedHeight = $0 }
                        .hidden().accessibilityHidden(true)
                }
                .background {
                    preview(text).lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { fullHeight = $0 }
                        .hidden().accessibilityHidden(true)
                }
            if expanded, range != nil, rangeRows == nil {
                ProgressView().controlSize(.small).accessibilityLabel("Loading verses")
            }
            if range != nil || expanded || fullHeight > collapsedHeight + 1 {
                Button {
                    withAnimation(reduceMotion ? nil : .snappy) { expanded.toggle() }
                } label: {
                    Label(expanded ? "Show Less" : "Show More", systemImage: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .padding(.vertical, 5)
                        .contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            }
        }
        .task(id: expanded) {
            guard expanded, rangeRows == nil,
                  let range, let start = range.verse, let end = range.endVerse, end > start else { return }
            let rows = await app.bible.queryChapter(range.bookId, range.chapter, textId: range.textId)
            guard !Task.isCancelled else { return }
            rangeRows = rows.filter { (start...end).contains($0.verseNum) }
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
                                Text(ResolvedPassage(textId: textId, bookId: r.bookId, chapter: r.chapter, verse: r.verseNum).label).font(.subheadline.weight(.semibold))
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
                                    Text(ResolvedPassage(textId: edition, bookId: v.bookId, chapter: v.chapter, verse: v.verse).label).font(.headline)
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
