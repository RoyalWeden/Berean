import SwiftUI
import BereanBible
import BereanText
import BereanWorkspace

/// Lexicon search / browse — port of the SearchView in src/components/lexicon/LexiconPanel.tsx. Matches Strong's
/// number, lemma, transliteration and definitions (`LexiconService.search`), filtered to Hebrew, Greek or both.
/// Shown in a Lexicon tab that has no entry yet; the query lives in `AppModel.lexiconSearches` (per tab, not
/// persisted, so no new tab-state keys are written for other clients).
struct LexiconSearchView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var query = ""
    @State private var lang = "all"
    @State private var results: [LexiconEntry] = []
    @State private var searching = false
    @State private var restored = false
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                field
                    .focused($focused)
                    .onSubmit { if let first = results.first { open(first.strongsNum) } }
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
            } else if results.isEmpty, !searching {
                ContentUnavailableView.search(text: trimmed).frame(maxHeight: .infinity)
            } else {
                List(results, id: \.strongsNum) { e in
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
                        .padding(.vertical, 3)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                    .contextMenu {
                        Button("Open in New Tab", systemImage: "plus.square.on.square") { app.openLexicon(e.strongsNum) }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Lexicon")
        .task(id: "\(trimmed)|\(lang)") {
            guard restored else { return }
            app.lexiconSearches[tabId] = (query, lang)
            guard !trimmed.isEmpty else { results = []; return }
            searching = true
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            var found = await app.lexicon.search(trimmed, lang: lang)
            // Accent-free spellings ("shalom", "chesed") also match Strong's transliterations (shâlôwm, cheçed).
            let seen = Set(found.map(\.strongsNum))
            let folded = await app.lexicon.searchFoldedTransliteration(trimmed, lang: lang).filter { !seen.contains($0.strongsNum) }
            found = folded + found
            guard !Task.isCancelled else { return }
            results = found; searching = false
        }
        .onAppear {
            if !restored, let saved = app.lexiconSearches[tabId] { query = saved.query; lang = saved.lang }
            restored = true
            focused = true
        }
    }

    private func open(_ id: String) { app.navigateLexicon(id, in: tabId) }

    @ViewBuilder private var field: some View {
        #if os(iOS)
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Strong's number, word or meaning", text: $query)
                .submitLabel(.search)
            if !query.isEmpty {
                Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
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
        }
    }
}
