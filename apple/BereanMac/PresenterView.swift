import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanNotes
import BereanWorkspace
import BereanReference

/// Presenter (original "viewer" window, ⌘⇧B): a second window that shows the active tab — a
/// Scripture chapter, a note or a lexicon entry — in large type for a projector or second screen.
/// It shares the app model, so it follows the main window live: chapter changes, the selected
/// verses (tinted) and the reading position (scrolls to the top visible verse). Pause freezes
/// what the audience sees while you browse; zoom is remembered.
struct PresenterView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("presenter.scale") private var scale = 1.6
    @State private var paused = false
    @State private var frozen: Content?
    @State private var rows: [ChapterVerseRow] = []
    @State private var entry: LexiconEntry?

    enum Content: Equatable {
        case bible(tabId: String, state: BibleState, selected: [Int])
        case note(id: String)
        case lexicon(String)
        case idle
    }

    private var live: Content {
        guard let tab = app.activeTab else { return .idle }
        switch tab.tabType {
        case .bible:
            let st = BibleState(tab.state)
            let mirrored = app.presenterSelection.flatMap { $0.tabId == tab.id && $0.edition == ChapterEdition(st) ? $0.verses.sorted() : nil }
            return .bible(tabId: tab.id, state: st, selected: mirrored ?? app.studySelectedVerses(in: tab.id, state: st))
        case .note:
            return tab.state["noteId"]?.stringValue.map { .note(id: $0.string) } ?? .idle
        case .lexicon:
            return tab.state["strongsNum"]?.stringValue.map { .lexicon($0.string) } ?? .idle
        default:
            return .idle
        }
    }

    private var content: Content { paused ? (frozen ?? live) : live }

    var body: some View {
        ZStack {
            Color(nsColor: .textBackgroundColor).ignoresSafeArea()
            switch content {
            case .bible(let tabId, let st, let selected): bible(tabId: tabId, st, selected: Set(selected))
            case .note(let id): note(id)
            case .lexicon(let id): lexicon(id)
            case .idle:
                ContentUnavailableView("Nothing to Present", systemImage: "rectangle.on.rectangle",
                                       description: Text("Open a passage, a note or a lexicon entry in the main window."))
            }
        }
        .navigationTitle(paused ? "Presenter — Paused" : "Presenter")
        .toolbar {
            ToolbarItemGroup {
                Button("Smaller", systemImage: "textformat.size.smaller") { scale = max(0.8, scale - 0.2) }
                    .keyboardShortcut("-", modifiers: .command)
                Button("Larger", systemImage: "textformat.size.larger") { scale = min(4, scale + 0.2) }
                    .keyboardShortcut("=", modifiers: .command)
                Toggle(isOn: Binding(get: { paused }, set: { on in frozen = on ? live : nil; paused = on })) {
                    Label(paused ? "Resume" : "Pause", systemImage: paused ? "play.fill" : "pause.fill")
                }
                .help(paused ? "Follow the main window again" : "Freeze what the presenter shows")
            }
        }
        .onAppear { app.presenterOpen = true }
        .onDisappear { app.presenterOpen = false }
    }

    // MARK: Scripture

    @ViewBuilder private func bible(tabId: String, _ st: BibleState, selected: Set<Int>) -> some View {
        let edition = ChapterEdition(st)
        let anchor = app.presenterAnchor.flatMap { $0.tabId == tabId && $0.edition == edition ? $0.verse : nil }
        let focus = selected.min() ?? anchor ?? st.verse
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14 * scale) {
                    Text(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation) + (st.translation == "lxx" ? " (LXX)" : ""))
                        .font(.system(size: 26 * scale, weight: .bold, design: .serif))
                        .padding(.bottom, 6 * scale)
                    ForEach(rows, id: \.verseNum) { row in
                        let on = selected.contains(row.verseNum)
                        HStack(alignment: .firstTextBaseline, spacing: 12 * scale) {
                            Text(row.readerVerseLabel)
                                .font(.system(size: 13 * scale, weight: .semibold)).foregroundStyle(.secondary)
                                .frame(minWidth: 26 * scale, alignment: .trailing)
                            Text(VerseDisplay.text(row.text, tagged: row.textTagged, textId: st.translation,
                                                   replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules))
                                .font(.system(size: 22 * scale, design: .serif))
                                .lineSpacing(6 * scale)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 4 * scale).padding(.horizontal, 10 * scale)
                        .background(on ? Color.accentColor.opacity(0.16) : .clear, in: .rect(cornerRadius: 10 * scale))
                        .id(row.verseNum)
                    }
                }
                .padding(40 * scale / 1.6)
                .frame(maxWidth: 1100 * scale / 1.6, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .task(id: "\(edition.book)|\(edition.chapter)|\(edition.text)") {
                rows = await app.readerChapter(edition).rows.filter { $0.verseNum > 0 || $0.title == nil }
                if let focus { proxy.scrollTo(focus, anchor: UnitPoint(x: 0, y: 0.1)) }
            }
            .onChange(of: focus) { _, v in
                guard let v else { return }
                withAnimation(.smooth(duration: 0.35)) { proxy.scrollTo(v, anchor: UnitPoint(x: 0, y: 0.1)) }
            }
        }
    }

    // MARK: Note / lexicon

    @ViewBuilder private func note(_ id: String) -> some View {
        let note = (try? app.notes?.one(id)) ?? nil
        ScrollView {
            VStack(alignment: .leading, spacing: 16 * scale) {
                Text(note.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Note")
                    .font(.system(size: 26 * scale, weight: .bold))
                Text(MarkdownLiveSpans.plainText(note?.content ?? ""))
                    .font(.system(size: 18 * scale)).lineSpacing(5 * scale)
            }
            .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
        }
        .id(app.notesRevision)
    }

    @ViewBuilder private func lexicon(_ id: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14 * scale) {
                if let e = entry, e.strongsNum.uppercased() == id.uppercased() {
                    HStack(alignment: .firstTextBaseline, spacing: 14 * scale) {
                        Text(e.strongsNum).font(.system(size: 18 * scale, weight: .semibold, design: .monospaced)).foregroundStyle(.tint)
                        Text(e.lemma).font(.system(size: 34 * scale))
                        Text(e.transliteration).font(.system(size: 18 * scale)).italic().foregroundStyle(.secondary)
                    }
                    if !e.gloss.isEmpty { Text(e.gloss).font(.system(size: 20 * scale, weight: .medium)) }
                    if !e.definition.isEmpty { Text(e.definition).font(.system(size: 17 * scale)).lineSpacing(4 * scale) }
                    if !e.derivation.isEmpty { Text(e.derivation).font(.system(size: 15 * scale)).italic().foregroundStyle(.secondary) }
                } else {
                    ProgressView()
                }
            }
            .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
        }
        .task(id: id) { entry = await app.lexicon.entry(id) }
    }
}

/// Window menu item that opens the presenter.
struct PresenterCommand: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Show Presenter") { openWindow(id: "presenter") }
            .keyboardShortcut("b", modifiers: [.command, .shift])
    }
}
