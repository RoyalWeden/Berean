import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanNotes
import BereanWorkspace
import BereanReference

/// A calm audience view. Pausing retains the rendered document as well as its
/// focus, so subsequent edits/navigation never leak onto a paused display.
struct PresenterView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("presenter.scale") private var scale = 1.6
    @State private var paused = false
    @State private var frozenFocus: Int?
    @State private var snapshot: Snapshot = .idle
    @State private var loadedSource: Source = .idle
    @State private var loading = false

    private enum Source: Equatable {
        case scripture(tabID: String, edition: ChapterEdition)
        case note(String)
        case lexicon(String)
        case idle
    }
    private struct PresentedVerse {
        let id: Int
        let number: String
        let title: String?
        let text: String
    }
    private enum Snapshot {
        case scripture(ChapterEdition, [PresentedVerse])
        case note(Note)
        case lexicon(LexiconEntry)
        case missing(String)
        case idle
    }
    private struct Request: Equatable {
        let source: Source
        let notesRevision: Int
        let replacer: Bool
        let rules: [WordReplacerRule]
        let hiddenAnnotations: Set<String>
        let paused: Bool
    }

    private var source: Source {
        guard let tab = app.activeTab else { return .idle }
        switch tab.tabType {
        case .bible: return .scripture(tabID: tab.id, edition: ChapterEdition(BibleState(tab.state)))
        case .note: return tab.state["noteId"]?.stringValue.map { .note($0.string) } ?? .idle
        case .lexicon: return tab.state["strongsNum"]?.stringValue.map { .lexicon($0.string) } ?? .idle
        default: return .idle
        }
    }
    private var selected: Set<Int> {
        guard case .scripture(let tabID, let edition) = source, let tab = app.activeTab else { return [] }
        if let mirror = app.presenterSelection, mirror.tabId == tabID, mirror.edition == edition { return mirror.verses }
        return Set(app.studySelectedVerses(in: tabID, state: BibleState(tab.state)))
    }
    private var liveFocus: Int? {
        guard case .scripture(let tabID, let edition) = source else { return nil }
        let anchor = app.presenterAnchor.flatMap { $0.tabId == tabID && $0.edition == edition ? $0.verse : nil }
        return selected.min() ?? anchor ?? app.activeTab.map { BibleState($0.state).verse } ?? nil
    }
    @State private var frozenSelection: Set<Int> = []
    private var request: Request {
        Request(source: source, notesRevision: { if case .note = source { return app.notesRevision }; return 0 }(),
                replacer: { if case .scripture = source { return app.wordReplacerEnabled }; return false }(),
                rules: { if case .scripture = source { return app.wordReplacerRules }; return [] }(),
                hiddenAnnotations: Set((app.activeTab?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string }),
                paused: paused)
    }

    var body: some View {
        ZStack {
            Color(nsColor: .textBackgroundColor).ignoresSafeArea()
            if !paused && loadedSource != source {
                ProgressView().controlSize(.small)
            } else {
                audienceContent
            }
        }
        .navigationTitle(paused ? "Presenter — Paused" : "Presenter")
        .toolbar {
            ToolbarItem(placement: .status) {
                Label(paused ? "Paused" : "Live", systemImage: paused ? "pause.circle" : "dot.radiowaves.left.and.right")
                    .labelStyle(.titleAndIcon)
                    .font(.callout).foregroundStyle(.secondary)
                    .help(paused ? "The audience view is frozen" : "Following the active document in the main window")
            }
            ToolbarItemGroup {
                ControlGroup {
                    // ⌘- / ⌘= / ⌘0 live in View (presenterZoom focused value): the main menu's
                    // Scripture text-size items owned those keys before the toolbar buttons.
                    Button("Smaller", systemImage: "textformat.size.smaller") { setScale(scale - 0.2) }
                        .disabled(scale <= PresenterZoom.range.lowerBound)
                    Text("\(Int((scale * 100).rounded()))%")
                        .font(.callout.monospacedDigit()).frame(minWidth: 42).accessibilityLabel("Text size")
                    Button("Larger", systemImage: "textformat.size.larger") { setScale(scale + 0.2) }
                        .disabled(scale >= PresenterZoom.range.upperBound)
                }
                .controlGroupStyle(.navigation)
                Button(paused ? "Resume" : "Pause", systemImage: paused ? "play.fill" : "pause.fill") {
                    if !paused { frozenFocus = liveFocus; frozenSelection = selected }
                    paused.toggle()
                }
                .disabled(!paused && (loading || loadedSource != source))
                .help(paused ? "Follow the main window again" : "Keep this document and reading position on screen")
            }
        }
        .onAppear {
            scale = scale.isFinite ? min(4, max(0.8, scale)) : 1.6
            app.presenterOpen = true
        }
        .onDisappear { app.presenterOpen = false }
        .task(id: request) { await load(request) }
        // The menu calls this outside the view graph: write through the $scale binding (a
        // captured struct copy didn't update the view, nor did a raw UserDefaults write).
        .focusedSceneValue(\.presenterZoom, PresenterZoom(scale: scale, set: { [binding = $scale] v in
            binding.wrappedValue = PresenterZoom.clamped(v)
        }))
    }

    private func setScale(_ value: Double) { scale = PresenterZoom.clamped(value) }

    @ViewBuilder private var audienceContent: some View {
        switch snapshot {
        case .scripture(let edition, let verses):
            scripture(edition, verses: verses)
        case .note(let note):
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(note.title.isEmpty ? "Untitled" : note.title)
                        .font(.system(size: 26 * scale, weight: .semibold))
                    MarkdownText(note.content).font(.system(size: 18 * scale)).lineSpacing(5 * scale)
                        .textSelection(.enabled)
                }
                .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
        case .lexicon(let entry):
            ScrollView {
                VStack(alignment: .leading, spacing: 18 * scale) {
                    Text(entry.strongsNum).font(.system(size: 13 * scale, weight: .medium)).foregroundStyle(.secondary)
                    Text(entry.lemma).font(.system(size: 34 * scale))
                    if !entry.transliteration.isEmpty {
                        Text(entry.transliteration).font(.system(size: 18 * scale)).italic().foregroundStyle(.secondary)
                    }
                    if !entry.gloss.isEmpty { Text(entry.gloss).font(.system(size: 20 * scale, weight: .medium)) }
                    if !entry.definition.isEmpty { Text(entry.definition).font(.system(size: 17 * scale)).lineSpacing(4 * scale) }
                    if !entry.derivation.isEmpty { Text(entry.derivation).font(.system(size: 15 * scale)).foregroundStyle(.secondary) }
                }
                .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
        case .missing(let message):
            ContentUnavailableView("Nothing to Present", systemImage: "rectangle.on.rectangle", description: Text(message))
        case .idle:
            ContentUnavailableView("Ready to Present", systemImage: "rectangle.on.rectangle",
                                   description: Text("Choose Scripture, a note or a lexicon entry in the main window."))
        }
    }

    private func scripture(_ edition: ChapterEdition, verses: [PresentedVerse]) -> some View {
        let focused = paused ? frozenFocus : liveFocus
        let highlights = paused ? frozenSelection : selected
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12 * scale) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(Reference.readerChapterLabel(edition.book, edition.chapter, textId: edition.text))
                            .font(.system(size: 26 * scale, weight: .semibold, design: .serif))
                        if edition.text == "lxx" { Text("LXX").font(.system(size: 12 * scale, weight: .medium)).foregroundStyle(.secondary) }
                    }
                    .padding(.bottom, 12 * scale)
                    .id("presenter-chapter-heading")
                    ForEach(verses, id: \.id) { verse in
                        HStack(alignment: .firstTextBaseline, spacing: 12 * scale) {
                            Text(verse.number).font(.system(size: 12 * scale, weight: .medium))
                                .foregroundStyle(.secondary).frame(minWidth: 26 * scale, alignment: .trailing)
                            VStack(alignment: .leading, spacing: 6 * scale) {
                                if let title = verse.title, !title.isEmpty {
                                    Text(title).font(.system(size: 16 * scale, design: .serif)).italic().foregroundStyle(.secondary)
                                }
                                Text(verse.text).font(.system(size: 22 * scale, design: .serif))
                                    .lineSpacing(6 * scale).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.vertical, 6 * scale).padding(.horizontal, 12 * scale)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(highlights.contains(verse.id) ? Color.accentColor.opacity(0.10) : .clear,
                                    in: .rect(cornerRadius: 12 * scale))
                        .id(verse.id)
                    }
                }
                .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
            .onAppear {
                if focused == verses.first?.id { proxy.scrollTo("presenter-chapter-heading", anchor: .top) }
                else if let focused { proxy.scrollTo(focused, anchor: UnitPoint(x: 0, y: 0.12)) }
            }
            .onChange(of: focused) { _, value in
                guard let value, !paused else { return }
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                    if value == verses.first?.id { proxy.scrollTo("presenter-chapter-heading", anchor: .top) }
                    else { proxy.scrollTo(value, anchor: UnitPoint(x: 0, y: 0.12)) }
                }
            }
        }
        .id(edition)
    }

    @MainActor private func load(_ request: Request) async {
        guard !request.paused else { return }
        loading = true
        let result: Snapshot
        switch request.source {
        case .scripture(_, let edition):
            let chapter = await app.readerChapter(edition)
            result = .scripture(edition, chapter.rows.filter { $0.verseNum > 0 || $0.title == nil }.map { row in
                let visible = row.hidingTextAnnotations(request.hiddenAnnotations, textId: edition.text)
                return PresentedVerse(id: row.verseNum, number: row.readerVerseLabel, title: visible.title,
                               text: VerseDisplay.text(visible.text, tagged: visible.textTagged, textId: edition.text,
                                   replacerEnabled: request.replacer, rules: request.rules,
                                   hideSuppliedWords: request.hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords)))
            })
        case .note(let id):
            result = ((try? app.notes?.one(id)) ?? nil).map(Snapshot.note) ?? .missing("This note is no longer available.")
        case .lexicon(let id):
            result = await app.lexicon.entry(id).map(Snapshot.lexicon) ?? .missing("This lexicon entry is not available.")
        case .idle: result = .idle
        }
        guard !Task.isCancelled, self.request == request else { return }
        snapshot = result
        loadedSource = request.source
        loading = false
    }
}

/// Window menu item that opens the presenter.
struct PresenterCommand: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Show Presenter") { openWindow(id: "presenter") }
            .keyboardShortcut("b", modifiers: [.command, .shift])
        Button("Berean Chat") { openWindow(id: "chat") }
            .keyboardShortcut("c", modifiers: [.command, .control])
        PiPCommand()
    }
}


/// ⇧⌘P — original "Toggle YouTube Picture-in-Picture".
private struct PiPCommand: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        Button("Toggle Picture in Picture") { app.pipToggleRequest += 1 }
            .keyboardShortcut("p", modifiers: [.command, .shift])
            .disabled(app.activeTab?.tabType != .youtube)
    }
}
