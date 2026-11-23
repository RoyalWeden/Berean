import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes

@MainActor
private final class SearchHighlightCache {
    private var revision: Int?
    private var chapters: [ChapterEdition: [Int: [Highlight]]] = [:]

    func marks(book: String, chapter: Int, text: String, verse: Int, revision: Int,
               load: () throws -> [Int: [Highlight]]) -> [Highlight] {
        if self.revision != revision {
            chapters.removeAll(keepingCapacity: true)
            self.revision = revision
        }
        let key = ChapterEdition(book: book, chapter: chapter, text: text)
        if let cached = chapters[key] { return cached[verse] ?? [] }
        guard let loaded = try? load() else { return [] }
        chapters[key] = loaded
        return loaded[verse] ?? []
    }
}

private func wholeVerseColor(in marks: [Highlight]) -> String? {
    marks.last { $0.startChar == nil && $0.startWord == nil }?.color
}

private struct SearchResultHighlights<Content: View>: View {
    @Environment(AppModel.self) private var app
    let hit: ScriptureHit
    let cache: SearchHighlightCache
    @ViewBuilder let content: ([Highlight]) -> Content
    @State private var marks: [Highlight] = []

    var body: some View {
        content(marks)
            .task(id: app.highlightsRevision) {
                guard let highlights = app.highlights else { marks = []; return }
                marks = cache.marks(book: hit.bookId, chapter: hit.chapter, text: hit.textId,
                                    verse: hit.verseNum, revision: app.highlightsRevision) {
                    try highlights.chapter(hit.bookId, hit.chapter, textId: hit.textId)
                }
            }
    }
}

private struct TaggedSearchResult {
    let passage: ResolvedPassage

    var id: String {
        "\(passage.textId)|\(passage.bookId)|\(passage.chapter)|\(passage.verse.map(String.init) ?? "chapter")"
    }
}

private struct TaggedSearchResultRow: View {
    @Environment(AppModel.self) private var app
    let passage: ResolvedPassage
    let open: () -> Void
    @State private var preview: String?

    var body: some View {
        let replaceWords = app.wordReplacerEnabled
        Button(action: open) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: passage.verse == nil ? "book" : "text.quote")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(passage.label).font(.subheadline.weight(.semibold))
                    Text(textInfo(passage.textId).name).font(.caption).foregroundStyle(.secondary)
                    if let preview {
                        Text(preview).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
        .buttonStyle(SearchResultButtonStyle())
        .task(id: app.wordReplacerKey) {
            guard let verse = passage.verse else { return }
            let row = await app.bible.queryVerse(passage.bookId, passage.chapter, verse, textId: passage.textId)
            guard !Task.isCancelled else { return }
            preview = row.map {
                VerseDisplay.text($0.text, tagged: $0.textTagged, textId: passage.textId,
                                  replacerEnabled: replaceWords, rules: app.wordReplacerRules)
            }
        }
    }
}

private struct SearchResultScrollRestoration: ViewModifier {
    @Environment(AppModel.self) private var app
    @State private var position = ScrollPosition(idType: String.self)
    let tabId: String
    let context: ScriptureSearchScrollContext?
    let containsRow: (String) -> Bool

    func body(content: Content) -> some View {
        content
            .scrollPosition($position, anchor: .top)
            .task(id: context) {
                guard let context else { return }
                await Task.yield()
                guard !Task.isCancelled, app.activeTab?.id == tabId else { return }
                let pending = app.searchResultAnchors[tabId]?[context]
                if let pending, containsRow(pending) {
                    position.scrollTo(id: pending, anchor: .center)
                } else {
                    if pending != nil { app.searchResultAnchors[tabId]?.removeValue(forKey: context) }
                    if let remembered = app.searchVisibleRows[tabId]?[context], containsRow(remembered) {
                        position.scrollTo(id: remembered, anchor: .top)
                    }
                }
            }
            .onScrollPhaseChange { old, new in
                guard old != .idle, new == .idle, old != .animating || position.isPositionedByUser,
                      app.activeTab?.id == tabId,
                      let visibleRow = position.viewID(type: String.self), let context,
                      containsRow(visibleRow) else { return }
                // A manual scroll replaces the return anchor; Forward/Back alone does not.
                app.searchResultAnchors[tabId]?.removeValue(forKey: context)
                app.searchVisibleRows[tabId, default: [:]][context] = visibleRow
            }
    }
}

struct ScriptureSearchRequest: Hashable {
    let query: String
    let texts: [String]
    let mode: WordMode
    let books: [String]
    let testament: String
    let replacer: Bool
    let rules: [WordReplacerRule]
    let tagIDs: [String]
    let matchAllTags: Bool
    let tagRevision: Int?
    let tagMembershipReady: Bool
}

private struct ScriptureTagSelection: Hashable {
    let ids: [String]
    let all: Bool
}

private struct ScriptureTagMembership: Sendable {
    struct Chapter: Hashable, Sendable { let book: String; let number: Int }
    struct Verse: Hashable, Sendable { let chapter: Chapter; let number: Int }

    var chapters: Set<Chapter> = []
    var verses: Set<Verse> = []

    func contains(_ chapter: Chapter, verse: Int?) -> Bool {
        chapters.contains(chapter) || verse.map { verses.contains(Verse(chapter: chapter, number: $0)) } == true
    }
}

struct ScriptureSearchScrollContext: Hashable {
    let request: ScriptureSearchRequest
    let testament: String
    let edition: String?
    let sort: String
    let grouping: String
}

/// The Search tab: one field, an obvious scope (All Texts by default — every installed text), readable results.
/// Everything else (match mode, testament and book filters, ordering, grouping) is one click away in Options.
/// Search state lives in the tab (query, scope, options) so it survives navigation and relaunch.
struct ScriptureSearchView: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    @State private var field = ""
    /// Verses of context shown around each result (original Compact / ±1 / ±2 modes); a local display preference.
    @AppStorage("searchResultContext") private var resultContext = 0
    /// Queries that read as a verse reference show that verse's cross references (original search "auto" mode);
    /// this per-view override switches back to a word search for the same text.
    @State private var wordsInsteadOf: String?

    /// The verse a reference-shaped query names, when cross-reference mode applies.
    private var crossRefTarget: ResolvedPassage? {
        let passageQuery = scope?.count == 1 && app.editionQualifiedQuery(query) == nil
            ? scope.map { "\($0[0]): \(query)" } ?? query : query
        guard wordsInsteadOf != query, let p = app.resolvePassage(passageQuery), p.verse != nil, p.verseGroups.count <= 1 else { return nil }
        return p
    }
    @State private var highlightCache = SearchHighlightCache()
    @State private var result = ScriptureSearchResult(hits: [], truncatedTexts: [])
    @State private var loading = false
    @State private var showOptions = false
    @FocusState private var fieldFocused: Bool

    @State private var completedRequest: ScriptureSearchRequest?

    @State private var verseTags: [VerseTagSummary] = []
    @State private var loadedTagIDs: [String] = []
    @State private var loadedTagRevision = 0
    @State private var tagMembership: [String: ScriptureTagMembership] = [:]

    private var tagSelection: ScriptureTagSelection {
        ScriptureTagSelection(
            ids: state["tagFilter"]?.stringValue?.string.split(separator: ",").map(String.init) ?? [],
            all: state["tagFilterAll"]?.boolValue == true
        )
    }

    private func matchesTags(book: String, chapter: Int, verse: Int?, filter: ScriptureTagSelection) -> Bool {
        guard !filter.ids.isEmpty else { return true }
        guard loadedTagIDs == filter.ids else { return false }
        let key = ScriptureTagMembership.Chapter(book: book, number: chapter)
        func matches(_ id: String) -> Bool { tagMembership[id]?.contains(key, verse: verse) == true }
        return filter.all ? filter.ids.allSatisfy(matches) : filter.ids.contains(where: matches)
    }

    private func refreshTags() {
        let ids = tagSelection.ids
        verseTags = (try? app.verseTags?.list()) ?? []
        let tagMembers = ids.isEmpty ? [] : ((try? app.verseTags?.members(ids)) ?? [])
        var membership: [String: ScriptureTagMembership] = [:]
        for member in tagMembers {
            membership[member.tagId, default: .init()].chapters.formUnion(
                member.wholeChapters.map { .init(book: $0.bookId, number: $0.chapter) })
            membership[member.tagId, default: .init()].verses.formUnion(
                member.verses.map { .init(chapter: .init(book: $0.bookId, number: $0.chapter), number: $0.verse) })
        }
        tagMembership = membership
        loadedTagIDs = ids
        loadedTagRevision = app.tagsRevision
    }

    private var request: ScriptureSearchRequest {
        let filter = tagSelection
        return ScriptureSearchRequest(query: query, texts: targets, mode: mode, books: bookFilter, testament: testament,
                                     replacer: app.wordReplacerEnabled, rules: app.wordReplacerRules, tagIDs: filter.ids, matchAllTags: filter.all,
                                     tagRevision: filter.ids.isEmpty ? nil : app.tagsRevision,
                                     tagMembershipReady: filter.ids.isEmpty || (loadedTagIDs == filter.ids && loadedTagRevision == app.tagsRevision))
    }

    // MARK: tab state

    var state: JSObject { app.findTab(tabId)?.state ?? JSObject() }
    var query: String { state["query"]?.stringValue?.string ?? "" }
    /// nil = All Texts; otherwise the chosen text ids.
    var scope: [String]? { state["scopeTexts"]?.arrayValue?.compactMap { $0.stringValue?.string } }
    var mode: WordMode { WordMode(rawValue: state["wordMode"]?.stringValue?.string ?? "all") ?? .all }
    var testament: String { state["testament"]?.stringValue?.string ?? "all" }
    var sort: String { state["sort"]?.stringValue?.string ?? "bookOrder" }        // bookOrder | relevance
    var grouping: String { state["grouping"]?.stringValue?.string ?? "text" }     // text | book | none
    var bookFilter: [String] { state["bookIds"]?.arrayValue?.compactMap { $0.stringValue?.string } ?? [] }

    private var focusText: String? { state["nativeSearchFocusText"]?.stringValue?.string }

    func set(_ key: String, _ v: JSValue?) {
        app.update(tabId, recordHistory: false) { tab in
            tab.state[key] = v
            if key == "scopeTexts", let focusText,
               let editions = v?.arrayValue, !editions.contains(.string(JSString(focusText))) {
                tab.state.remove("nativeSearchFocusText")
            }
        }
    }

    var targets: [String] { scope ?? availableTexts.map(\.id) }

    var scopeLabel: String {
        guard let s = scope else { return "All Texts" }
        if s.count == 1 { return textInfo(s[0]).name }
        if Set(s) == Set(availableTexts.filter { $0.section == "Bible" }.map(\.id)) { return "Bible (KJVA + LXX)" }
        if Set(s) == Set(availableTexts.filter { $0.section != "Bible" }.map(\.id)) { return "Other Writings" }
        return "\(s.count) Texts"
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            SwiftUI.Group {
                if let target = crossRefTarget {
                    crossRefMode(target)
                } else if query.utf16.count < 2, !tagSelection.ids.isEmpty {
                    taggedResults
                } else if query.isEmpty {
                    historyView
                } else {
                    resultsView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .navigationTitle(query.isEmpty ? "Search" : "Search: \(query)")
        #if os(iOS)
        .sheet(isPresented: $showOptions) {
            NavigationStack {
                ScrollView {
                    options.frame(maxWidth: 520, alignment: .leading)
                        .padding(20)
                        .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .navigationTitle("Search Options")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { showOptions = false } }
                }
            }
            .presentationDetents([.large])
        }
        #endif
        .onAppear { field = query; if query.isEmpty { fieldFocused = true } }
        .onChange(of: query) { _, newQuery in field = newQuery }
        .task(id: request) { [request] in await runSearch(request) }
        .task(id: tagSelection.ids) { refreshTags() }
        .onChange(of: app.tagsRevision) { refreshTags() }
    }

    // MARK: header — field, scope, options

    private var headerControlSize: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Words, “exact phrase”, or Strong's number", text: $field)
                    .textFieldStyle(.plain)
                    .focused($fieldFocused)
                    .onSubmit(submit)
                    .autocorrectionDisabled()
                    .frame(minWidth: 80)
                if !field.isEmpty || !query.isEmpty {
                    Button(action: clearQuery) { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                        .buttonStyle(.interactivePlain).accessibilityLabel("Clear search")
                }
                Divider().frame(height: 20).padding(.horizontal, 2)
                scopeMenu
                searchOptionsButton
            }
            .padding(.leading, 10).padding(.trailing, 4).padding(.vertical, 3)
            .frame(minHeight: headerControlSize + 6)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 10))
            FlowLayout(spacing: 6) { activeSearchFilters }
            if query.utf16.count >= 2 { summaryRow }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var searchOptionsButton: some View {
        Button {
            #if os(iOS)
            fieldFocused = false
            #endif
            showOptions.toggle()
        } label: {
            Image(systemName: hasActiveOptions ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .foregroundStyle(hasActiveOptions ? Color.accentColor : Color.primary)
                .frame(width: headerControlSize, height: headerControlSize)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .optionHover(active: showOptions || hasActiveOptions)
        .accessibilityLabel("Search Options")
        .accessibilityHint(hasActiveOptions ? "Filters are active" : "Match, testament, books, and order")
        .help(hasActiveOptions ? "Search options · filters active" : "Search options")
        #if os(macOS)
        .popover(isPresented: $showOptions, arrowEdge: .bottom) {
            ScrollView { options.frame(maxWidth: .infinity, alignment: .leading).padding(16) }
                .frame(width: 380, height: 500)
        }
        #endif
    }

    @ViewBuilder private var activeSearchFilters: some View {
        if mode != .all {
            searchFilterChip(mode == .phrase ? "Exact phrase" : "Any word", kind: "match mode", symbol: "text.magnifyingglass") {
                set("wordMode", nil)
            }
        }
        if let name = testamentFilterName {
            searchFilterChip(name, kind: "testament", symbol: "book.closed") { set("testament", nil) }
        }
        if !bookFilter.isEmpty {
            let title = bookFilter.count == 1 ? Reference.bookName(bookFilter[0]) : "\(bookFilter.count) books"
            searchFilterChip(title, kind: "books", symbol: "books.vertical") { set("bookIds", nil) }
        }
        let selection = tagSelection
        if !selection.ids.isEmpty {
            let count = selection.ids.count
            let name = verseTags.first { count == 1 && $0.id == selection.ids.first }?.name
            let title = name ?? (count == 1 ? "1 tag" : "\(selection.all ? "All" : "Any of") \(count) tags")
            searchFilterChip(title, kind: "verse tags", symbol: "tag") { setTagIDs([]) }
        }
    }

    private var testamentFilterName: String? {
        switch testament {
        case "OT": "Old Testament"
        case "NT": "New Testament"
        case "Apocrypha": "Apocrypha"
        case "Pseudepigrapha": "Other writings"
        default: nil
        }
    }

    private func searchFilterChip(_ title: String, kind: String, symbol: String, clear: @escaping () -> Void) -> some View {
        Button(action: clear) {
            HStack(spacing: 6) {
                Label(title, systemImage: symbol).lineLimit(1)
                Image(systemName: "xmark").font(.caption2.weight(.semibold))
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .frame(maxWidth: 180)
            .background(.quaternary, in: .capsule)
        }
        .buttonStyle(OptionButtonStyle())
        .accessibilityLabel("Clear \(kind) filter")
        .accessibilityValue(title)
        .help("Clear \(kind) filter")
    }

    var hasActiveOptions: Bool {
        mode != .all || testament != "all" || !bookFilter.isEmpty || !tagSelection.ids.isEmpty
            || sort != "bookOrder" || grouping != "text" || resultContext != 0
    }

    var scopeMenu: some View {
        Menu {
            Button { set("scopeTexts", nil) } label: { check(scope == nil, "All Texts") }
            if let cur = currentText, cur != "kjv" {
                Button { set("scopeTexts", .array([.string(JSString(cur))])) } label: { check(scope == [cur], "Current Text (\(textInfo(cur).short))") }
            }
            Button { setScope(availableTexts.filter { $0.section == "Bible" }.map(\.id)) } label: { check(scopeLabel == "Bible (KJVA + LXX)", "Bible (KJVA + LXX)") }
            Button { setScope(availableTexts.filter { $0.section != "Bible" }.map(\.id)) } label: { check(scopeLabel == "Other Writings", "Other Writings") }
            Divider()
            Section("Choose texts") {
                ForEach(availableTexts) { t in
                    Toggle(t.name, isOn: Binding(get: { targets.contains(t.id) }, set: { on in
                        var s = targets
                        if on { s.append(t.id) } else { s.removeAll { $0 == t.id } }
                        if s.isEmpty { return }
                        setScope(availableTexts.map(\.id).filter { s.contains($0) })
                    }))
                }
            }
        } label: {
            Label(scopeLabel, systemImage: "books.vertical")
                .foregroundStyle(scope == nil ? Color.primary : Color.accentColor)
                .lineLimit(1)
                #if os(iOS)
                .labelStyle(.iconOnly)
                .frame(width: headerControlSize, height: headerControlSize)
                #else
                .frame(maxWidth: 150)
                .padding(.horizontal, 6)
                .frame(height: headerControlSize)
                #endif
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).clickableCursor()
        .fixedSize(horizontal: true, vertical: false)
        .optionHover(active: scope != nil)
        .accessibilityLabel("Search Scope")
        .accessibilityValue(scopeLabel)
        .help("Search scope: \(scopeLabel)")
    }

    @ViewBuilder func check(_ on: Bool, _ title: String) -> some View { if on { Label(title, systemImage: "checkmark") } else { Text(title) } }

    func setScope(_ ids: [String]) {
        set("scopeTexts", Set(ids) == Set(availableTexts.map(\.id)) ? nil : .array(ids.map { .string(JSString($0)) }))
    }

    var currentText: String? {
        app.orderedTabs.first { $0.tabType == .bible }.map { BibleState($0.state).translation }
    }

    var options: some View {
        VStack(alignment: .leading, spacing: 16) {
            optionsGroup("Matching", symbol: "text.magnifyingglass") {
            Picker("Match", selection: Binding(get: { mode }, set: { set("wordMode", .string(JSString($0.rawValue))) })) {
                Text("All words").tag(WordMode.all); Text("Any word").tag(WordMode.any); Text("Exact phrase").tag(WordMode.phrase)
            }.modifier(SearchOptionsPickerStyle(title: "Match"))
            }
            optionsGroup("Where to Search", symbol: "books.vertical") {
            Picker("Testament", selection: Binding(get: { testament }, set: { set("testament", .string(JSString($0))) })) {
                Text("All").tag("all"); Text("Old Testament").tag("OT"); Text("New Testament").tag("NT"); Text("Apocrypha").tag("Apocrypha"); Text("Other writings").tag("Pseudepigrapha")
            }.modifier(SearchOptionsPickerStyle(title: "Testament"))
            Text("Books").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            BookFilterField(selected: bookFilter, editions: Set(targets), testament: testament) { ids in
                set("bookIds", ids.isEmpty ? nil : .array(ids.map { .string(JSString($0)) }))
            }
            Text("Verse Tags").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Menu {
                ForEach(verseTags) { tag in
                    Button {
                        var ids = tagSelection.ids
                        if ids.contains(tag.id) { ids.removeAll { $0 == tag.id } } else { ids.append(tag.id) }
                        setTagIDs(ids)
                    } label: {
                        check(tagSelection.ids.contains(tag.id), tag.name)
                    }
                }
                if !tagSelection.ids.isEmpty {
                    Button("Clear Tags") { setTagIDs([]) }
                }
            } label: {
                let selected = verseTags.filter { tagSelection.ids.contains($0.id) }
                Label(selected.isEmpty ? "Choose Tags" : selected.map(\.name).joined(separator: ", "), systemImage: "tag")
                    .lineLimit(1)
            }
            .disabled(verseTags.isEmpty && tagSelection.ids.isEmpty)
            .clickableCursor().optionHover()
            if tagSelection.ids.count > 1 {
                Picker("Match Tags", selection: Binding(get: { tagSelection.all }, set: { set("tagFilterAll", $0 ? .bool(true) : nil) })) {
                    Text("Any selected tag").tag(false)
                    Text("All selected tags").tag(true)
                }.modifier(SearchOptionsPickerStyle(title: "Match Tags"))
            }
            }
            optionsGroup("Results", symbol: "list.bullet") {
            Picker("Order", selection: Binding(get: { sort }, set: { set("sort", .string(JSString($0))) })) {
                Text("Scripture order").tag("bookOrder"); Text("Best match first").tag("relevance")
            }.modifier(SearchOptionsPickerStyle(title: "Order"))
            Picker("Group by", selection: Binding(get: { grouping }, set: { set("grouping", .string(JSString($0))) })) {
                Text("By text").tag("text"); Text("By book").tag("book"); Text("No groups").tag("none")
            }.modifier(SearchOptionsPickerStyle(title: "Group by"))
            Picker("Context", selection: $resultContext) {
                Text("Verse only").tag(0); Text("±1 verse").tag(1); Text("±2 verses").tag(2)
            }.modifier(SearchOptionsPickerStyle(title: "Context"))
            }
            if hasActiveOptions {
                Button("Reset Options", action: resetOptions)
                    .buttonStyle(OptionButtonStyle())
            }
        }
    }

    private func optionsGroup<Content: View>(_ title: String, symbol: String,
                                            @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 10, content: content)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.quaternary.opacity(0.45), in: .rect(cornerRadius: 10))
        }
    }

    private func setTagIDs(_ ids: [String]) {
        app.update(tabId, recordHistory: false) { tab in
            tab.state["tagFilter"] = ids.isEmpty ? nil : .string(JSString(ids.joined(separator: ",")))
            if ids.isEmpty { tab.state.remove("tagFilterAll") }
        }
    }

    private func resetOptions() {
        app.update(tabId, recordHistory: false) { tab in
            for key in ["wordMode", "testament", "bookIds", "tagFilter", "tagFilterAll", "sort", "grouping"] {
                tab.state.remove(JSString(key))
            }
        }
        resultContext = 0
    }

    private var taggedResults: some View {
        let filter = tagSelection
        let editions = focusText.map { [$0] } ?? targets
        let preferredEditions = editions.contains(app.defaultText)
            ? [app.defaultText] + editions.filter { $0 != app.defaultText } : editions
        let allowedBooks = Set(bookFilter)
        let catalog = Dictionary(grouping: app.bookCatalog.filter {
            (testament == "all" || $0.book.testament == testament)
                && (allowedBooks.isEmpty || allowedBooks.contains($0.book.id))
        }, by: { $0.book.id })
        let chapters = Set(tagMembership.values.flatMap(\.chapters).filter {
            matchesTags(book: $0.book, chapter: $0.number, verse: nil, filter: filter)
        })
        let verses = Set(tagMembership.values.flatMap(\.verses).filter {
            !chapters.contains($0.chapter) && matchesTags(book: $0.chapter.book, chapter: $0.chapter.number, verse: $0.number, filter: filter)
        })
        let rows = (chapters.map { ($0, nil as Int?) } + verses.map { ($0.chapter, Optional($0.number)) }).sorted {
            (Reference.bookOrder($0.0.book), $0.0.book, $0.0.number, $0.1 ?? 0)
                < (Reference.bookOrder($1.0.book), $1.0.book, $1.0.number, $1.1 ?? 0)
        }
        let passages: [ResolvedPassage] = rows.compactMap { chapter, verse in
            let installed = Set(catalog[chapter.book, default: []].map(\.textId))
            guard let edition = preferredEditions.first(where: { installed.contains($0) }) else { return nil }
            return ResolvedPassage(textId: edition, bookId: chapter.book, chapter: chapter.number, verse: verse)
        }
        let rowsToShow = passages.map { TaggedSearchResult(passage: $0) }
        let context = app.activeTab?.id == tabId && loadedTagIDs == filter.ids && !rowsToShow.isEmpty
            ? scrollContext : nil
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if loadedTagIDs != filter.ids {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else if rowsToShow.isEmpty {
                    ContentUnavailableView("No tagged passages", systemImage: "tag")
                }
                ForEach(rowsToShow, id: \.id) { result in
                    TaggedSearchResultRow(passage: result.passage) {
                        app.searchResultAnchors[tabId, default: [:]][scrollContext] = result.id
                        app.visitScripture(result.passage, returningTo: tabId)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .overlay(alignment: .bottom) { Divider().padding(.leading, 16) }
                    .id(result.id)
                }
            }
            .scrollTargetLayout()
        }
        .modifier(SearchResultScrollRestoration(tabId: tabId, context: context,
                                                containsRow: { id in rowsToShow.contains { $0.id == id } }))
        .id(scrollContext)
    }

    // MARK: running

    func submit() {
        let q = field.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            clearQuery()
            return
        }
        // A chapter reference in the search field goes to the passage, as everywhere else. A single-verse reference
        // stays here and shows that verse's cross references (the original Search tab's auto cross-reference mode),
        // with an Open button for the passage itself.
        if !q.hasPrefix("\""), StrongsId.normalize(q) == nil, let passage = app.resolvePassage(q, preferring: currentText),
           passage.verse == nil || passage.verseGroups.count > 1 {
            app.visitScripture(passage, returningTo: tabId)
            return
        }
        let qualified = app.editionQualifiedQuery(q)
        let historyQuery: String
        if qualified == nil, let scope, scope.count == 1, let edition = scope.first {
            historyQuery = "\(edition): \(q)"
        } else {
            historyQuery = q
        }
        let historyBook = (qualified != nil || scope?.count == 1) && bookFilter.count == 1 ? bookFilter.first : nil
        if let qualified { field = qualified.query }
        commitQuery(qualified?.query ?? q, edition: qualified?.text)
        app.recordScriptureSearch(historyQuery, bookId: historyBook, tabState: app.findTab(tabId)?.state)
    }

    private func clearQuery() {
        field = ""
        fieldFocused = true
        if !query.isEmpty { commitQuery("") }
    }

    private func commitQuery(_ q: String, edition: String? = nil) {
        app.update(tabId) { tab in
            tab.state["query"] = .string(JSString(q))
            tab.state.remove("nativeSearchFocusText")
            if let edition { tab.state["scopeTexts"] = .array([.string(JSString(edition))]) }
            tab.title = q.isEmpty ? "Search" : "Search: \(q)"
        }
    }

    private func runSearch(_ request: ScriptureSearchRequest) async {
        let q = request.query
        guard q.utf16.count >= 2 else {
            loading = false
            result = ScriptureSearchResult(hits: [], truncatedTexts: [])
            completedRequest = request
            return
        }
        guard request.tagMembershipReady else { return }
        let passageFilter: ScriptureSearch.PassageFilter?
        if request.tagIDs.isEmpty {
            passageFilter = nil
        } else {
            let memberships = request.tagIDs.map { tagMembership[$0, default: .init()] }
            passageFilter = { book, chapter, verse in
                let key = ScriptureTagMembership.Chapter(book: book, number: chapter)
                if request.matchAllTags { return memberships.allSatisfy { $0.contains(key, verse: verse) } }
                return memberships.contains { $0.contains(key, verse: verse) }
            }
        }
        loading = true
        defer { if !Task.isCancelled { loading = false } }
        let targetTexts = Set(request.texts)
        let books = Set(request.books)
        if let strongs = await ScriptureSearch.strongs(q, lexicon: app.lexicon) {
            guard !Task.isCancelled else { return }
            let hits = strongs.filter {
                targetTexts.contains($0.textId) && (books.isEmpty || books.contains($0.bookId))
                    && (passageFilter?($0.bookId, $0.chapter, $0.verseNum) ?? true)
            }
            result = ScriptureSearchResult(hits: hits, truncatedTexts: [])
            completedRequest = request
            return
        }
        var text = q, m = request.mode
        if text.hasPrefix("\""), text.hasSuffix("\""), text.count > 2 { text = String(text.dropFirst().dropLast()); m = .phrase }
        guard !Task.isCancelled else { return }
        let found = await ScriptureSearch.run(text, in: request.texts, mode: m, bookIds: request.books.isEmpty ? nil : request.books,
                                              testament: request.testament == "all" ? nil : request.testament,
                                              replacer: request.replacer, rules: request.rules, bible: app.bible, lexicon: app.lexicon, matching: passageFilter)
        guard !Task.isCancelled else { return }
        result = found
        completedRequest = request
    }

    // MARK: results

    var testamentFiltered: [ScriptureHit] {
        guard completedRequest == request else { return [] }
        guard testament != "all" else { return result.hits }
        let ids = Set(app.bookCatalog.filter { $0.book.testament == testament }.map { "\($0.textId)|\($0.book.id)" })
        return result.hits.filter { ids.contains("\($0.textId)|\($0.bookId)") }
    }

    var shown: [ScriptureHit] {
        var hits = testamentFiltered
        if let f = focusText { hits = hits.filter { $0.textId == f } }
        if sort == "bookOrder" {
            let textOrder = Dictionary(uniqueKeysWithValues: availableTexts.enumerated().map { ($1.id, $0) })
            hits.sort { (textOrder[$0.textId] ?? 99, Reference.bookOrder($0.bookId), $0.chapter, $0.verseNum) < (textOrder[$1.textId] ?? 99, Reference.bookOrder($1.bookId), $1.chapter, $1.verseNum) }
        }
        return hits
    }

    var counts: [(String, Int)] {
        var c: [String: Int] = [:]
        for h in testamentFiltered { c[h.textId, default: 0] += 1 }
        return availableTexts.compactMap { t in c[t.id].map { (t.id, $0) } }
    }

    private var limitedEditions: Set<String> {
        guard !searchPending else { return [] }
        guard let focusText else { return result.truncatedTexts }
        return result.truncatedTexts.intersection([focusText])
    }

    var summaryRow: some View {
        let editionCounts = counts
        let resultCount = focusText.map { edition in
            editionCounts.first { $0.0 == edition }?.1 ?? 0
        } ?? testamentFiltered.count
        return ScrollView(.horizontal) {
            HStack(spacing: 6) {
                Text(searchPending ? "Searching…" : limitedEditions.isEmpty
                     ? "\(resultCount.formatted()) result\(resultCount == 1 ? "" : "s")"
                     : "\(resultCount.formatted()) loaded")
                    .font(.callout.weight(.semibold)).foregroundStyle(.secondary)
                if let focusText {
                    Button { set("nativeSearchFocusText", nil) } label: {
                        Label(textInfo(focusText).short, systemImage: "xmark")
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.accentColor.opacity(0.25), in: .capsule)
                    }
                    .buttonStyle(.interactivePlain)
                    .optionHover(active: true)
                    .accessibilityLabel("Clear \(textInfo(focusText).name) result filter")
                    .help("Show results from all editions in scope")
                }
                if editionCounts.count > 1 || focusText != nil {
                    ForEach(editionCounts.filter { $0.0 != focusText }, id: \.0) { id, n in
                        Button { set("nativeSearchFocusText", .string(JSString(id))) } label: {
                            Text("\(textInfo(id).short) \(n.formatted())\(result.truncatedTexts.contains(id) ? "+" : "")").font(.caption.weight(.medium))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color.secondary.opacity(0.12), in: .capsule)
                        }
                        .buttonStyle(.interactivePlain)
                        .optionHover()
                        .help("Show only \(textInfo(id).name)")
                    }
                }
            }
        }
        .scrollIndicators(.never)
    }

    private var searchPending: Bool { loading || completedRequest != request || loadedTagIDs != tagSelection.ids }

    @ViewBuilder private func crossRefMode(_ target: ResolvedPassage) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Cross references for \(target.label)", systemImage: "arrow.triangle.branch")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("Search Words Instead") { wordsInsteadOf = query }
                    .buttonStyle(.borderless).clickableCursor()
                Button("Open \(target.label)") { app.visitScripture(target, reuseTab: false, returningTo: tabId) }
                    .buttonStyle(.borderless).clickableCursor()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            CrossRefsView(bookId: target.bookId, chapter: target.chapter, verse: target.verse, textId: target.textId, sourceTabID: tabId)
        }
    }

    private var hasIncompatibleBookFilters: Bool {
        guard !bookFilter.isEmpty, !app.bookCatalog.isEmpty else { return false }
        let editions = Set(focusText.map { [$0] } ?? targets)
        let books = Set(bookFilter)
        return !app.bookCatalog.contains { entry in
            editions.contains(entry.textId) && books.contains(entry.book.id)
                && (testament == "all" || entry.book.testament == testament)
        }
    }

    @ViewBuilder var resultsView: some View {
        if !searchPending && shown.isEmpty {
            let incompatibleBooks = hasIncompatibleBookFilters
            ContentUnavailableView {
                Label("No results", systemImage: "magnifyingglass")
            } description: {
                if incompatibleBooks {
                    Text("None of the selected books are in the current text or testament scope.")
                } else if !limitedEditions.isEmpty {
                    Text("No matches in the loaded results. Narrow the search to check for more.")
                } else if let focusText {
                    Text("Nothing in \(textInfo(focusText).name) matches “\(query)” with the current filters.")
                } else if testament != "all" || !bookFilter.isEmpty || !tagSelection.ids.isEmpty {
                    Text("Nothing matches “\(query)” with the current filters.")
                } else {
                    Text(scope == nil ? "Nothing in any text matches “\(query)”." : "Nothing in \(scopeLabel) matches “\(query)”.")
                }
            } actions: {
                if incompatibleBooks { Button("Clear Book Filter") { set("bookIds", nil) } }
                if focusText != nil { Button("Clear Edition Filter") { set("nativeSearchFocusText", nil) } }
                if scope != nil { Button("Search All Texts") { set("scopeTexts", nil) } }
                if hasActiveOptions { Button("Reset Options", action: resetOptions) }
            }
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if !limitedEditions.isEmpty {
                            Label("Result limit reached in \(limitedEditions.map { textInfo($0).short }.sorted().joined(separator: ", ")). Narrow the search with more words, a phrase, or a book filter.",
                                  systemImage: "info.circle")
                                .font(.caption).foregroundStyle(.secondary)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                        }
                        ForEach(groups, id: \.title) { group in
                            if grouping != "none" {
                                Text("\(group.title) — \(group.hits.count)")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 16).padding(.vertical, 8)
                                    .accessibilityAddTraits(.isHeader)
                                    .id("group:" + group.title)
                            }
                            ForEach(group.hits, id: \.self) { hit in
                                row(hit)
                                    .padding(.horizontal, 16).padding(.vertical, 6)
                                    .overlay(alignment: .bottom) { Divider().padding(.leading, 16) }
                                    .id(resultID(hit))
                            }
                        }
                    }
                    .scrollTargetLayout()
                }
                // Jump to a book (or text) in long grouped results — original jump-to-book popover.
                .overlay(alignment: .bottomTrailing) {
                    let list = groups
                    if grouping != "none", list.count > 3 {
                        Menu {
                            ForEach(list, id: \.title) { group in
                                Button("\(group.title) — \(group.hits.count)") {
                                    let id = "group:" + group.title
                                    app.searchResultAnchors[tabId]?.removeValue(forKey: scrollContext)
                                    app.searchVisibleRows[tabId, default: [:]][scrollContext] = id
                                    withAnimation(.snappy) { proxy.scrollTo(id, anchor: .top) }
                                }
                            }
                        } label: {
                            Label("Jump to", systemImage: "list.bullet.indent")
                                .font(.callout.weight(.medium))
                                .padding(.horizontal, 14).padding(.vertical, 9)
                        }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).clickableCursor()
                        .glassEffectCompat(interactive: true)
                        .fixedSize()
                        .padding(16)
                        #if os(iOS)
                        .padding(.bottom, 56)
                        #endif
                        .help("Jump to a \(grouping == "book" ? "book" : "text") in the results")
                    }
                }
                .modifier(SearchResultScrollRestoration(tabId: tabId, context: restorationContext,
                                                        containsRow: { id in
                                                            if id.hasPrefix("group:") {
                                                                return grouping != "none" && groups.contains { "group:" + $0.title == id }
                                                            }
                                                            return shown.contains { resultID($0) == id }
                                                        }))
            }
            .id(scrollContext)
        }
    }

    struct Group { var title: String; var hits: [ScriptureHit] }

    var groups: [Group] {
        let hits = shown
        switch grouping {
        case "book":
            var order: [String] = [], map: [String: [ScriptureHit]] = [:]
            for h in hits { let k = Reference.bookName(h.bookId); if map[k] == nil { order.append(k) }; map[k, default: []].append(h) }
            return order.map { Group(title: $0, hits: map[$0]!) }
        case "none": return [Group(title: "", hits: hits)]
        default:
            var order: [String] = [], map: [String: [ScriptureHit]] = [:]
            for h in hits { if map[h.textId] == nil { order.append(h.textId) }; map[h.textId, default: []].append(h) }
            return order.map { Group(title: textInfo($0).name, hits: map[$0]!) }
        }
    }

    private var scrollContext: ScriptureSearchScrollContext {
        ScriptureSearchScrollContext(request: request, testament: testament, edition: focusText,
                                     sort: sort, grouping: grouping)
    }

    private var restorationContext: ScriptureSearchScrollContext? {
        guard app.activeTab?.id == tabId, !searchPending, !shown.isEmpty else { return nil }
        return scrollContext
    }

    private func resultID(_ hit: ScriptureHit) -> String {
        "\(hit.textId)|\(hit.bookId)|\(hit.chapter)|\(hit.verseNum)"
    }

    private func openResult(_ hit: ScriptureHit, passage: ResolvedPassage, reuseTab: Bool = true) {
        app.searchResultAnchors[tabId, default: [:]][scrollContext] = resultID(hit)
        app.visitScripture(passage, reuseTab: reuseTab, returningTo: tabId)
    }

    func row(_ h: ScriptureHit) -> some View {
        let passage = ResolvedPassage(textId: h.textId, bookId: h.bookId, chapter: h.chapter, verse: h.verseNum)
        let edition = textInfo(h.textId)
        return SearchResultHighlights(hit: h, cache: highlightCache) { marks in
            HStack(alignment: .top, spacing: 8) {
                Button {
                    openResult(h, passage: passage)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(passage.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
                            if grouping != "text" || scope == nil {
                                Text(edition.short).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                                    .padding(.horizontal, 5).padding(.vertical, 1).background(Color.secondary.opacity(0.12), in: .capsule)
                            }
                            if !marks.isEmpty {
                                let color = wholeVerseColor(in: marks)
                                Image(systemName: "highlighter")
                                    .font(.caption)
                                    .foregroundStyle(color.map(Color.highlight) ?? .secondary)
                                    .accessibilityLabel("Highlighted")
                            }
                            Spacer()
                        }
                        if resultContext > 0 {
                            SearchResultContext(hit: h, span: resultContext, edge: .before)
                        }
                        Text(highlighted(h)).font(.callout).foregroundStyle(.secondary).lineLimit(resultContext > 0 ? nil : 4)
                        if resultContext > 0 {
                            SearchResultContext(hit: h, span: resultContext, edge: .after)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                }
                .buttonStyle(SearchResultButtonStyle())
                .contextMenu {
                    resultActions(h, passage: passage, marks: marks)
                }
                VerseActionsMenu(label: "Actions for \(passage.label), \(edition.name)") {
                    resultActions(h, passage: passage, marks: marks)
                }
            }
        }
    }

    @ViewBuilder private func resultActions(_ hit: ScriptureHit, passage: ResolvedPassage, marks: [Highlight]) -> some View {
        let verse = SharedScriptureVerse(passage: passage, text: hit.text, tagged: hit.textTagged,
                                         bible: app.bible, clipboard: app.verseClipboard(textId: hit.textId))
        Button("Open Verse", systemImage: "book") { openResult(hit, passage: passage) }
        Button("Open in New Tab", systemImage: "plus.square") { openResult(hit, passage: passage, reuseTab: false) }
        Button("Copy Verse", systemImage: "doc.on.doc") {
            Task {
                Clipboard.copy(await verse.formattedText())
                AccessibilityNotification.Announcement("Verse copied").post()
            }
        }
        Button("Copy Reference", systemImage: "number") {
            Clipboard.copy(verse.reference)
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        // Original ResultActionSheet: share the verse and start a note on it without leaving the results.
        ShareLink(item: verse, preview: SharePreview(verse.reference)) { Label("Share Verse…", systemImage: "square.and.arrow.up") }
        Divider()
        Button("Add Note", systemImage: "square.and.pencil") {
            _ = app.newNote(verseRef: "\(hit.bookId).\(hit.chapter).\(hit.verseNum)", textId: hit.textId)
        }
        if let highlights = app.highlights {
            Menu("Highlight", systemImage: "highlighter") {
                let current = wholeVerseColor(in: marks)
                ForEach(highlightColors, id: \.self) { color in
                    Button(color.capitalized, systemImage: current == color ? "checkmark" : "circle.fill") {
                        app.attempt("Couldn’t highlight the verse") {
                            try highlights.setVerseColor(bookId: hit.bookId, chapter: hit.chapter, verse: hit.verseNum,
                                                         color: color, textId: hit.textId)
                        }
                    }
                }
                Divider()
                Button("Remove Highlights", systemImage: "eraser") {
                    app.attempt("Couldn’t remove the verse highlights") {
                        try highlights.remove(bookId: hit.bookId, chapter: hit.chapter, verse: hit.verseNum, textId: hit.textId)
                    }
                }
                .disabled(marks.isEmpty)
            }
        }
    }

    func displayText(_ h: ScriptureHit) -> String {
        VerseDisplay.text(h.text, tagged: h.textTagged, textId: h.textId, replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules)
    }

    /// Mark Strong's matches and any plain query words in the same snippet.
    func highlighted(_ hit: ScriptureHit) -> AttributedString {
        let snippet = hit.strongsSnippet(replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules)
        let window = snippet.flatMap { VerseDisplay.wordWindow($0.text, matchIndices: $0.indices) }
        let s = window?.text ?? snippet?.text ?? displayText(hit)
        let indices = Set(window?.indices ?? snippet?.indices ?? [])
        var a = AttributedString(s)
        if !indices.isEmpty {
            for (index, word) in s.split(separator: " ").enumerated() where indices.contains(index) {
                mark(word.startIndex..<word.endIndex, in: &a)
            }
        }
        var q = query
        if q.hasPrefix("\""), q.hasSuffix("\"") { q = String(q.dropFirst().dropLast()) }
        if StrongsId.normalize(q) != nil { return a }
        let variants = app.wordReplacerEnabled ? WordReplacer.searchVariants(q, rules: app.wordReplacerRules) : [q]
        let words = Set(variants.flatMap { $0.split(separator: " ").map(String.init) })
            .filter { $0.count >= 2 && StrongsId.normalize($0) == nil }
        for w in words {
            var from = s.startIndex
            while from < s.endIndex,
                  let r = s.range(of: w, options: [.caseInsensitive, .diacriticInsensitive], range: from..<s.endIndex) {
                // Search can match part of a word; paint that exact displayed span too.
                mark(r, in: &a)
                from = r.upperBound
            }
        }
        return a
    }

    private func mark(_ range: Range<String.Index>, in text: inout AttributedString) {
        guard let start = AttributedString.Index(range.lowerBound, within: text),
              let end = AttributedString.Index(range.upperBound, within: text) else { return }
        text[start..<end].backgroundColor = Color.yellow.opacity(0.35)
        text[start..<end].foregroundColor = .primary
    }

    // MARK: history

    var historyView: some View {
        List {
            let recent = SearchHistory.all
            if recent.isEmpty {
                Text("Type words, an exact phrase in quotes, or a Strong's number (H430, G5485). Searches cover every text unless you choose otherwise.")
                    .foregroundStyle(.secondary)
            } else {
                Section("Recent searches") {
                    ForEach(recent, id: \.self) { q in
                        Button { field = q; submit() } label: {
                            Label(q, systemImage: "clock.arrow.circlepath")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 4)
                        }
                        .buttonStyle(SearchResultButtonStyle())
                    }
                    Button("Clear Recent Searches", role: .destructive) { SearchHistory.clear(); field = field + "" }
                }
            }
        }
    }
}

/// Recent search queries (per device, newest first) — the existing app's `recentSearchQueries` idea.
@MainActor enum SearchHistory {
    static let key = "nativeRecentSearches"
    static var all: [String] { UserLibrary.defaults.stringArray(forKey: key) ?? [] }
    static func record(_ q: String) {
        var list = all.filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        list.insert(q, at: 0)
        UserLibrary.defaults.set(Array(list.prefix(30)), forKey: key)
    }
    static func clear() { UserLibrary.defaults.removeObject(forKey: key) }
}

/// Book filter: type to add books (any text); chosen books show as removable chips.
/// Neighbouring verses shown dimmed around a search result.
private struct SearchResultContext: View {
    enum Edge { case before, after }
    @Environment(AppModel.self) private var app
    let hit: ScriptureHit
    let span: Int
    let edge: Edge
    @State private var lines: [(Int, String)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(lines, id: \.0) { verse, text in
                (Text("\(verse) ").font(.caption2.monospacedDigit()).foregroundStyle(.tertiary) + Text(text))
                    .font(.footnote).foregroundStyle(.tertiary)
            }
        }
        .task(id: "\(hit.textId)|\(hit.bookId)|\(hit.chapter)|\(hit.verseNum)|\(span)|\(edge)") {
            let range = edge == .before ? Array((hit.verseNum - span)..<hit.verseNum) : Array((hit.verseNum + 1)...(hit.verseNum + span))
            var found: [(Int, String)] = []
            for v in range where v > 0 {
                if let row = await app.bible.queryVerse(hit.bookId, hit.chapter, v, textId: hit.textId) {
                    found.append((v, VerseDisplay.text(row.text, tagged: row.textTagged, textId: hit.textId,
                                                       replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules)))
                }
            }
            lines = found
        }
    }
}

/// Menus keep the full choice labels available in the iPhone sheet at large text sizes.
private struct SearchOptionsPickerStyle: ViewModifier {
    let title: String

    func body(content: Content) -> some View {
        #if os(iOS)
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            content.pickerStyle(.menu)
                .labelsHidden()
                .frame(minHeight: 44, alignment: .leading)
        }
        #else
        content.pickerStyle(.menu).clickableCursor().optionHover()
        #endif
    }
}

struct BookFilterField: View {
    @Environment(AppModel.self) private var app
    let selected: [String]
    let editions: Set<String>
    let testament: String
    let onChange: ([String]) -> Void
    @State private var text = ""
    @State private var browsing = false

    private var matches: [String] {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard browsing || !query.isEmpty else { return [] }
        let excluded = Set(selected)
        var seen = Set<String>()
        return app.bookCatalog.compactMap { entry in
            let book = entry.book
            guard editions.contains(entry.textId), testament == "all" || book.testament == testament,
                  !excluded.contains(book.id), query.isEmpty
                    || book.name.localizedStandardContains(query)
                    || book.shortName.localizedStandardContains(query),
                  seen.insert(book.id).inserted else { return nil }
            return book.id
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !selected.isEmpty {
                FlowLayout(spacing: 4) {
                    ForEach(selected, id: \.self) { id in
                        Button { onChange(selected.filter { $0 != id }) } label: {
                            Label(Reference.bookName(id), systemImage: "xmark").font(.caption).labelStyle(.titleAndIcon)
                                .padding(.horizontal, 7).padding(.vertical, 3).background(Color.accentColor.opacity(0.18), in: .capsule)
                        }.buttonStyle(.interactivePlain)
                            .optionHover()
                    }
                }
            }
            Button(browsing ? "Hide Book List" : "Browse Books", systemImage: "list.bullet") {
                browsing.toggle()
            }
            .buttonStyle(OptionButtonStyle(active: browsing))
            .accessibilityValue(browsing ? "Expanded" : "Collapsed")
            let available = matches
            TextField("Find a book", text: $text)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Find a book")
                .onSubmit {
                    if let id = available.first {
                        onChange(selected + [id])
                        text = ""
                    }
                }
            if available.isEmpty, browsing || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("No matching books").font(.caption).foregroundStyle(.secondary)
            }
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(browsing ? available : Array(available.prefix(6)), id: \.self) { id in
                    Button {
                        onChange(selected + [id])
                        text = ""
                    } label: {
                        Text(Reference.bookName(id))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(OptionButtonStyle())
                }
            }
        }
    }
}

struct SearchResultButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    #if os(macOS)
    @State private var hovered = false
    #endif

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 7)
        configuration.label
            .opacity(enabled ? 1 : 0.45)
            .background(Color.primary.opacity(backgroundOpacity(pressed: configuration.isPressed)), in: shape)
            .contentShape(.interaction, .rect)
            #if os(macOS)
            .onHover { hovered = $0 }
            #else
            .contentShape(.hoverEffect, shape)
            .hoverEffect(.highlight, isEnabled: enabled)
            #endif
    }

    private func backgroundOpacity(pressed: Bool) -> Double {
        guard enabled else { return 0 }
        if pressed { return 0.15 }
        #if os(macOS)
        if hovered { return 0.09 }
        #endif
        return 0
    }
}

struct OptionButtonStyle: ButtonStyle {
    var active = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            #if os(iOS)
            .frame(minHeight: 44)
            #endif
            .opacity(enabled ? (configuration.isPressed ? 0.65 : 1) : 0.45)
            .optionHover(active: active)
            #if os(macOS)
            .clickableCursor()
            #endif
    }
}

/// Visible pointer feedback for otherwise plain option controls.
private struct OptionHover: ViewModifier {
    let active: Bool
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false

    func body(content: Content) -> some View {
        content
            .background(Color.primary.opacity((active ? 0.10 : 0) + (enabled && hovered ? 0.14 : 0)),
                        in: .rect(cornerRadius: 7))
            .contentShape(.rect)
            #if os(macOS)
            .onHover { hovered = $0 }
            #else
            .hoverEffect(.highlight, isEnabled: enabled)
            #endif
    }
}

extension View {
    func optionHover(active: Bool = false) -> some View {
        modifier(OptionHover(active: active))
    }
}
