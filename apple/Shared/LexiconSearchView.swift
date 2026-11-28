import SwiftUI
import BereanBible
import BereanText
import BereanWorkspace
import BereanCore

/// Lexicon search / browse — port of the SearchView in src/components/lexicon/LexiconPanel.tsx. Matches Strong's
/// number, lemma, transliteration and definitions (`LexiconService.search`), filtered to Hebrew, Greek or both.
/// Shown in a Lexicon tab that has no entry yet. The live query is cached per tab;
/// settled edits use the original searchQuery/searchLang state fields for reopening.
struct LexiconSearchView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var query = ""
    @State private var lang = "all"
    struct ScrollContext: Hashable { let query: String; let lang: String }
    private struct Response {
        let context: ScrollContext
        let entries: [LexiconEntry]
        let generation = UUID()
    }
    @State private var response: Response?
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var restored = false
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var scrollOffset: CGFloat = 0
    @State private var restoredScrollContext: ScrollContext?
    @State private var restoredResponseID: UUID?
    @State private var restorationCancelled = false
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var context: ScrollContext { ScrollContext(query: trimmed, lang: lang) }
    private var results: [LexiconEntry] { response?.context == context ? response?.entries ?? [] : [] }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                field
                    .focused($focused)
                    .onSubmit { if !searching, let first = results.first { open(first.strongsNum) } }
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                Picker("Language", selection: $lang) {
                    Text("All").tag("all"); Text("Hebrew").tag("H"); Text("Greek").tag("G")
                }
                .pickerStyle(.segmented).labelsHidden().clickableCursor()
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            Divider()
            if trimmed.isEmpty {
                ContentUnavailableView("Search the Lexicon", systemImage: "character.book.closed",
                                       description: Text("Try H7225, G26, “agape”, “shalom” or “covenant”."))
                    .frame(maxHeight: .infinity)
            } else if response?.context == context, results.isEmpty, !searching {
                ContentUnavailableView.search(text: trimmed).frame(maxHeight: .infinity)
            } else if response?.context == context, !searching {
                resultList
            } else {
                ProgressView("Searching…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Lexicon")
        .onChange(of: context) { _, requested in startSearch(requested) }
        .onAppear {
            if !restored {
                let state = app.findTab(tabId)?.state
                query = app.lexiconSearches[tabId]?.query ?? state?["searchQuery"]?.stringValue?.string ?? ""
                lang = app.lexiconSearches[tabId]?.lang ?? state?["searchLang"]?.stringValue?.string ?? "all"
            }
            restored = true
            focused = true
            startSearch(context)
        }
        .onDisappear { searchTask?.cancel(); searchTask = nil }
        .onChange(of: app.lexiconSearchRequest) { _, request in
            guard let request, request.tabID == tabId else { return }
            let changesResults = trimmed != request.query.trimmingCharacters(in: .whitespacesAndNewlines) || lang != request.lang
            query = request.query
            lang = request.lang
            if changesResults {
                response = nil
                searching = !trimmed.isEmpty
            } else if let response, response.context == context {
                // A same-query request may restore history or explicitly restart at the top.
                self.response = Response(context: context, entries: response.entries)
            }
        }
    }

    private func startSearch(_ requested: ScrollContext) {
        guard restored else { return }
        searchTask?.cancel()
        app.lexiconSearches[tabId] = (requested.query, requested.lang)
        searching = !requested.query.isEmpty
        searchTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            guard context == requested else { startSearch(context); return }
            app.update(tabId, recordHistory: false) {
                let previous = Self.savedContext($0)
                $0.state["searchQuery"] = .string(JSString(requested.query))
                $0.state["searchLang"] = .string(JSString(requested.lang))
                if previous != requested { $0.state["searchScrollTop"] = .number(0) }
            }
            guard !requested.query.isEmpty else { response = nil; searching = false; return }
            var found = await app.lexicon.search(requested.query, lang: requested.lang)
            let seen = Set(found.map(\.strongsNum))
            let folded = await app.lexicon.searchFoldedTransliteration(requested.query, lang: requested.lang).filter { !seen.contains($0.strongsNum) }
            found = folded + found
            guard !Task.isCancelled else { return }
            guard context == requested else { startSearch(context); return }
            response = Response(context: requested, entries: found)
            searching = false
        }
    }

    private var resultList: some View {
        let requested = context
        let generation = response?.generation
        return ScrollView {
            // Search is bounded (30 entries per language plus folded matches).
            // Measure these rows eagerly: lazy height estimates shifted restored
            // offsets when changing between language result sets.
            VStack(spacing: 0) {
                ForEach(results, id: \.strongsNum) { e in
                    Button { open(e.strongsNum) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(e.strongsNum).font(.body.monospaced()).foregroundStyle(Color.accentColor).frame(minWidth: 64, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 8) {
                                    Text(e.lemma).font(.system(.title3, design: .serif))
                                    Text(e.transliteration).foregroundStyle(.secondary)
                                }
                                if !e.gloss.isEmpty { Text(e.gloss).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
                            }
                            Spacer(minLength: 0)
                            if e.occurrences > 0 { Text("\(e.occurrences)×").font(.caption).foregroundStyle(.tertiary).monospacedDigit() }
                        }
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                    }
                    .buttonStyle(SearchResultButtonStyle())
                    .id(e.strongsNum)
                    .contextMenu {
                        Button("Open in New Tab", systemImage: "plus.square.on.square") { app.openLexicon(e.strongsNum) }
                    }
                    Divider().padding(.leading, 84)
                }
            }
            .frame(maxWidth: 760)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .scrollTargetLayout()
        }
        .scrollPosition($scrollPosition)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, offset in
            guard context == requested, let tab = app.activeTab, tab.id == tabId, tab.tabType == .lexicon,
                  tab.state["strongsNum"]?.stringValue?.string.isEmpty != false else { return }
            scrollOffset = max(0, offset)
            if restoredScrollContext == requested, restoredResponseID == generation {
                app.lexiconSearchPositions[tabId, default: [:]][requested] = scrollOffset
            }
        }
        .onScrollPhaseChange { _, phase in
            if phase == .interacting || phase == .tracking {
                restorationCancelled = true
                restoredScrollContext = requested
                restoredResponseID = generation
            }
            if phase == .idle { savePosition(for: requested) }
        }
        .task(id: response?.generation) {
            restoredScrollContext = nil
            restoredResponseID = nil
            restorationCancelled = false
            let tab = app.findTab(tabId)
            let fallback = tab.flatMap { Self.savedContext($0) == requested ? $0.state["searchScrollTop"]?.numberValue : nil } ?? 0
            let target = app.lexiconSearchPositions[tabId]?[requested] ?? CGFloat(fallback)
            await Task.yield()
            guard !Task.isCancelled, context == requested, !restorationCancelled else { return }
            scrollPosition.scrollTo(y: max(0, target))
            try? await Task.sleep(for: .milliseconds(40))
            guard !Task.isCancelled, context == requested else { return }
            restoredScrollContext = requested
            restoredResponseID = generation
            savePosition(for: requested)
        }
        .onDisappear { savePosition(for: requested) }
    }

    private static func savedContext(_ tab: BereanWorkspace.Tab) -> ScrollContext {
        ScrollContext(query: (tab.state["searchQuery"]?.stringValue?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                      lang: tab.state["searchLang"]?.stringValue?.string ?? "all")
    }

    private func savePosition(for requested: ScrollContext) {
        guard restoredScrollContext == requested, restoredResponseID == response?.generation else { return }
        app.lexiconSearchPositions[tabId, default: [:]][requested] = scrollOffset
        guard let tab = app.findTab(tabId), tab.tabType == .lexicon,
              tab.state["strongsNum"]?.stringValue?.string.isEmpty != false,
              Self.savedContext(tab) == requested else { return }
        if tab.state["searchScrollTop"]?.numberValue != Double(scrollOffset) {
            app.update(tabId, recordHistory: false) { $0.state["searchScrollTop"] = .number(Double(scrollOffset)) }
        }
    }

    private func open(_ id: String) {
        guard !searching, results.contains(where: { $0.strongsNum == id }) else { return }
        savePosition(for: context)
        app.navigateLexicon(id, in: tabId)
    }

    @ViewBuilder private var field: some View {
        #if os(iOS)
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Strong's number, word or meaning", text: $query)
                .submitLabel(.search)
            if !query.isEmpty {
                Button("Clear", systemImage: "xmark.circle.fill") { query = ""; focused = true }
                    .labelStyle(.iconOnly).foregroundStyle(.secondary)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.leading, 12).frame(minHeight: 44)
        .background(.fill.tertiary, in: .capsule)
        #else
        TextField("Strong's number, Hebrew or Greek word, or English meaning", text: $query)
            .textFieldStyle(.roundedBorder)
        #endif
    }
}

/// A Lexicon tab: the search view until an entry is chosen, then the entry (its toolbar has ‹ › and Search).
struct LexiconTabHost: View {
    @Environment(AppModel.self) private var app
    let tab: BereanWorkspace.Tab

    var body: some View {
        let sid = tab.state["strongsNum"]?.stringValue?.string ?? ""
        if sid.isEmpty {
            LexiconSearchView(tabId: tab.id).id(tab.id)
        } else {
            LexiconEntryView(strongsId: sid, tabId: tab.id).id(tab.id)
                .navigationTitle(tab.title)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
        }
    }
}
