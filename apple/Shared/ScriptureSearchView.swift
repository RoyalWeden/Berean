import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference

/// The Search tab: one field, an obvious scope (All Texts by default — every installed text), readable results.
/// Everything else (match mode, testament and book filters, ordering, grouping) is one click away in Options.
/// Search state lives in the tab (query, scope, options) so it survives navigation and relaunch.
struct ScriptureSearchView: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    @State private var field = ""
    @State private var result = ScriptureSearchResult(hits: [], truncatedTexts: [])
    @State private var loading = false
    @State private var showOptions = false
    @State private var focusText: String?          // a per-text count chip narrows the list to one text
    @FocusState private var fieldFocused: Bool

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

    func set(_ key: String, _ v: JSValue?) {
        app.update(tabId, recordHistory: false) { t in t.state[key] = v }
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
            if query.isEmpty { historyView } else { resultsView }
        }
        .navigationTitle(query.isEmpty ? "Search" : "Search: \(query)")
        .onAppear { field = query; if query.isEmpty { fieldFocused = true } }
        .onChange(of: query) { _, newQuery in field = newQuery; focusText = nil }
        .task(id: "\(query)|\(targets)|\(mode.rawValue)|\(bookFilter)|\(app.wordReplacerEnabled)") { await runSearch() }
    }

    // MARK: header — field, scope, options

    var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Words, “exact phrase”, or Strong's number", text: $field)
                        .textFieldStyle(.plain)
                        .focused($fieldFocused)
                        .onSubmit(submit)
                        .autocorrectionDisabled()
                    if !field.isEmpty {
                        Button { field = ""; fieldFocused = true } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                            .buttonStyle(.interactivePlain).accessibilityLabel("Clear search")
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 9))
                scopeMenu
                Button { showOptions.toggle() } label: { Label("Options", systemImage: "line.3.horizontal.decrease.circle") }
                    .labelStyle(.iconOnly)
                    .help("Match, testament, books, order")
                    .popover(isPresented: $showOptions, arrowEdge: .bottom) { options.padding(14).frame(width: 300) }
                    .foregroundStyle(hasActiveOptions ? Color.accentColor : .secondary)
            }
            if !query.isEmpty { summaryRow }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    var hasActiveOptions: Bool { mode != .all || testament != "all" || !bookFilter.isEmpty }

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
        } label: { Label(scopeLabel, systemImage: "books.vertical") }
        .fixedSize()
        .help("Which texts to search — All Texts searches every installed text")
    }

    @ViewBuilder func check(_ on: Bool, _ title: String) -> some View { if on { Label(title, systemImage: "checkmark") } else { Text(title) } }

    func setScope(_ ids: [String]) {
        set("scopeTexts", Set(ids) == Set(availableTexts.map(\.id)) ? nil : .array(ids.map { .string(JSString($0)) }))
    }

    var currentText: String? {
        app.orderedTabs.first { $0.tabType == .bible }.map { BibleState($0.state).translation }
    }

    var options: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Match").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Picker("Match", selection: Binding(get: { mode }, set: { set("wordMode", .string(JSString($0.rawValue))) })) {
                Text("All words").tag(WordMode.all); Text("Any word").tag(WordMode.any); Text("Exact phrase").tag(WordMode.phrase)
            }.pickerStyle(.segmented).labelsHidden()
            Text("Testament").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Picker("Testament", selection: Binding(get: { testament }, set: { set("testament", .string(JSString($0))) })) {
                Text("All").tag("all"); Text("Old Testament").tag("OT"); Text("New Testament").tag("NT"); Text("Apocrypha").tag("Apocrypha"); Text("Other writings").tag("Pseudepigrapha")
            }.labelsHidden()
            Text("Books").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            BookFilterField(selected: bookFilter) { ids in set("bookIds", ids.isEmpty ? nil : .array(ids.map { .string(JSString($0)) })) }
            Text("Results").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Picker("Order", selection: Binding(get: { sort }, set: { set("sort", .string(JSString($0))) })) {
                Text("Scripture order").tag("bookOrder"); Text("Best match first").tag("relevance")
            }.pickerStyle(.segmented).labelsHidden()
            Picker("Group by", selection: Binding(get: { grouping }, set: { set("grouping", .string(JSString($0))) })) {
                Text("By text").tag("text"); Text("By book").tag("book"); Text("No groups").tag("none")
            }.pickerStyle(.segmented).labelsHidden()
            if hasActiveOptions {
                Button("Reset Options") { set("wordMode", nil); set("testament", nil); set("bookIds", nil) }
            }
        }
    }

    // MARK: running

    func submit() {
        let q = field.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        // A plain reference in the search field goes to the passage, as everywhere else.
        if StrongsId.normalize(q) == nil, Reference.parse(q) != nil || app.resolvePassage(q) != nil, !q.hasPrefix("\"") {
            app.openQuery(q, newTab: false); return
        }
        SearchHistory.record(q)
        focusText = nil
        app.update(tabId) { t in t.state["query"] = .string(JSString(q)); t.title = "Search: \(q)" }
    }

    func runSearch() async {
        let q = query
        guard q.utf16.count >= 2 else {
            loading = false
            result = ScriptureSearchResult(hits: [], truncatedTexts: [])
            return
        }
        loading = true
        defer { if !Task.isCancelled { loading = false } }
        let targetTexts = Set(targets)
        let books = Set(bookFilter)
        if let strongs = await ScriptureSearch.strongs(q, lexicon: app.lexicon) {
            guard !Task.isCancelled else { return }
            let hits = strongs.filter { targetTexts.contains($0.textId) && (books.isEmpty || books.contains($0.bookId)) }
            result = ScriptureSearchResult(hits: hits, truncatedTexts: [])
            return
        }
        var text = q, m = mode
        if text.hasPrefix("\""), text.hasSuffix("\""), text.count > 2 { text = String(text.dropFirst().dropLast()); m = .phrase }
        guard !Task.isCancelled else { return }
        let found = await ScriptureSearch.run(text, in: targets, mode: m, bookIds: bookFilter.isEmpty ? nil : bookFilter,
                                              replacer: app.wordReplacerEnabled, bible: app.bible, lexicon: app.lexicon)
        guard !Task.isCancelled else { return }
        result = found
    }

    // MARK: results

    var testamentFiltered: [ScriptureHit] {
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

    var summaryRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                Text(loading ? "Searching…" : "\(testamentFiltered.count) result\(testamentFiltered.count == 1 ? "" : "s")")
                    .font(.callout.weight(.semibold)).foregroundStyle(.secondary)
                if counts.count > 1 {
                    ForEach(counts, id: \.0) { id, n in
                        Button { focusText = focusText == id ? nil : id } label: {
                            Text("\(textInfo(id).short) \(n)").font(.caption.weight(.medium))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(focusText == id ? Color.accentColor.opacity(0.25) : Color.secondary.opacity(0.12), in: .capsule)
                        }
                        .buttonStyle(.interactivePlain)
                        .help(focusText == id ? "Show all texts again" : "Show only \(textInfo(id).name)")
                    }
                }
            }
        }
        .scrollIndicators(.never)
    }

    @ViewBuilder var resultsView: some View {
        if !loading && shown.isEmpty {
            ContentUnavailableView {
                Label("No results", systemImage: "magnifyingglass")
            } description: {
                Text(scope == nil ? "Nothing in any text matches “\(query)”." : "Nothing in \(scopeLabel) matches “\(query)”.")
            } actions: {
                if scope != nil { Button("Search All Texts") { set("scopeTexts", nil) } }
                if hasActiveOptions { Button("Reset Options") { set("wordMode", nil); set("testament", nil); set("bookIds", nil) } }
            }
        } else {
            List {
                if !result.truncatedTexts.isEmpty {
                    Label("Showing the first \(ScriptureSearch.perTextLimit) matches in \(result.truncatedTexts.map { textInfo($0).short }.sorted().joined(separator: ", ")). Narrow the search with more words, a phrase, or a book filter.",
                          systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(groups, id: \.title) { g in
                    if grouping == "none" { ForEach(g.hits, id: \.self) { row($0) } }
                    else { Section("\(g.title) — \(g.hits.count)") { ForEach(g.hits, id: \.self) { row($0) } } }
                }
            }
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

    func row(_ h: ScriptureHit) -> some View {
        let passage = ResolvedPassage(textId: h.textId, bookId: h.bookId, chapter: h.chapter, verse: h.verseNum)
        let edition = textInfo(h.textId)
        return HStack(alignment: .top, spacing: 8) {
            Button {
                app.visitScripture(passage)
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
                        Spacer()
                    }
                    Text(highlighted(h)).font(.callout).foregroundStyle(.secondary).lineLimit(4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .contextMenu {
                resultActions(h, passage: passage)
            }
            VerseActionsMenu(label: "Actions for \(passage.label), \(edition.name)") {
                resultActions(h, passage: passage)
            }
        }
    }

    @ViewBuilder private func resultActions(_ hit: ScriptureHit, passage: ResolvedPassage) -> some View {
        let reference = referenceForCopy(passage.label, textId: hit.textId)
        Button("Open in New Tab", systemImage: "plus.square") { app.visitScripture(passage, reuseTab: false) }
        Button("Copy Verse", systemImage: "doc.on.doc") {
            Clipboard.copy("\(reference) \(displayText(hit))")
            AccessibilityNotification.Announcement("Verse copied").post()
        }
        Button("Copy Reference", systemImage: "number") {
            Clipboard.copy(reference)
            AccessibilityNotification.Announcement("Reference copied").post()
        }
    }

    func displayText(_ h: ScriptureHit) -> String {
        VerseDisplay.text(h.text, tagged: h.textTagged, textId: h.textId, replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
    }

    /// Mark Strong's matches and any plain query words in the same snippet.
    func highlighted(_ hit: ScriptureHit) -> AttributedString {
        let snippet = hit.strongsSnippet(replacerEnabled: app.wordReplacerEnabled)
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
        let variants = app.wordReplacerEnabled ? WordReplacer.searchVariants(q, rules: WordReplacer.defaultRules) : [q]
        let words = Set(variants.flatMap { $0.split(separator: " ").map(String.init) })
            .filter { $0.count >= 2 && StrongsId.normalize($0) == nil }
        for w in words {
            var from = s.startIndex
            while let r = s.range(of: w, options: .caseInsensitive, range: from..<s.endIndex) {
                let before = r.lowerBound == s.startIndex ? nil : s[s.index(before: r.lowerBound)]
                let after = r.upperBound == s.endIndex ? nil : s[r.upperBound]
                if !(before?.isLetter ?? false), !(after?.isLetter ?? false) { mark(r, in: &a) }
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
                        Button { field = q; submit() } label: { Label(q, systemImage: "clock.arrow.circlepath").frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect) }
                            .buttonStyle(.interactivePlain)
                    }
                    Button("Clear Recent Searches", role: .destructive) { SearchHistory.clear(); field = field + "" }
                }
            }
        }
    }
}

/// Recent search queries (per device, newest first) — the existing app's `recentSearchQueries` idea.
enum SearchHistory {
    static let key = "nativeRecentSearches"
    static var all: [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }
    static func record(_ q: String) {
        var list = all.filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        list.insert(q, at: 0)
        UserDefaults.standard.set(Array(list.prefix(30)), forKey: key)
    }
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

/// Book filter: type to add books (any text); chosen books show as removable chips.
struct BookFilterField: View {
    @Environment(AppModel.self) private var app
    let selected: [String]
    let onChange: ([String]) -> Void
    @State private var text = ""

    var matches: [String] {
        let q = text.lowercased()
        guard !q.isEmpty else { return [] }
        var seen = Set<String>(), out: [String] = []
        for c in app.bookCatalog where c.book.name.lowercased().hasPrefix(q) || c.book.shortName.lowercased().hasPrefix(q) {
            if seen.insert(c.book.id).inserted, !selected.contains(c.book.id) { out.append(c.book.id) }
        }
        return Array(out.prefix(6))
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
                    }
                }
            }
            TextField(selected.isEmpty ? "All books — type to choose" : "Add a book", text: $text)
                .textFieldStyle(.roundedBorder)
                .onSubmit { if let f = matches.first { onChange(selected + [f]); text = "" } }
            ForEach(matches, id: \.self) { id in
                Button { onChange(selected + [id]); text = "" } label: { Text(Reference.bookName(id)).frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect) }
                    .buttonStyle(.interactivePlain)
            }
        }
    }
}
