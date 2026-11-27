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
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("presenter.scale") private var scale = 1.6
    @State private var paused = false
    @State private var frozenFocus: Int?
    @State private var snapshot: Snapshot = .idle
    @State private var loadedSource: Source = .idle
    @State private var loading = false
    @State private var followedVerse: Int?
    @State private var renderedAppearance = Appearance.standard

    private struct Appearance: Equatable {
        var family = "system"
        var spacing = 5.0
        var numbers = true
        var palette: ReaderTheme.Palette?
        var scheme: ColorScheme?
        static let standard = Appearance()
    }

    private enum Source: Equatable {
        case scripture(tabID: String, edition: ChapterEdition)
        case comparison(tabID: String, columnID: Int, edition: ChapterEdition)
        case comparisonUnavailable
        case note(String)
        case lexicon(String)
        case idle

        var edition: ChapterEdition? {
            switch self {
            case .scripture(_, let edition), .comparison(_, _, let edition): return edition
            default: return nil
            }
        }
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
        let appearance: Appearance
    }

    private var comparison: AppModel.ComparePresentation? {
        guard let tab = app.activeTab, tab.tabType == .bible, BibleState(tab.state).compareMode,
              let comparison = app.comparePresentation, comparison.tabID == tab.id else { return nil }
        let columns = CompareColumn.resolved(in: tab.state)
        guard comparison.configuration == ComparePresentationConfiguration(state: tab.state, columns: columns),
              columns.contains(where: { $0.id == comparison.columnID && $0.historyKey == comparison.columnDestination }) else { return nil }
        return comparison
    }

    private var source: Source {
        guard let tab = app.activeTab else { return .idle }
        switch tab.tabType {
        case .bible:
            let reader = BibleState(tab.state)
            if reader.compareMode {
                guard let comparison else { return .comparisonUnavailable }
                return .comparison(tabID: tab.id, columnID: comparison.columnID, edition: comparison.edition)
            }
            return .scripture(tabID: tab.id, edition: ChapterEdition(reader))
        case .note: return tab.state["noteId"]?.stringValue.map { .note($0.string) } ?? .idle
        case .lexicon: return tab.state["strongsNum"]?.stringValue.map { .lexicon($0.string) } ?? .idle
        default: return .idle
        }
    }
    private var selected: Set<Int> {
        if let comparison { return comparison.verses }
        guard case .scripture(let tabID, let edition) = source, let tab = app.activeTab else { return [] }
        if let mirror = app.presenterSelection, mirror.tabId == tabID, mirror.edition == edition { return mirror.verses }
        return Set(app.studySelectedVerses(in: tabID, state: BibleState(tab.state)))
    }
    private var readerAnchor: Int? {
        // Viewport caches are observation-ignored; the live mirror invalidates
        // this calculation even when a viewport publication does not write a tab.
        _ = app.presenterAnchor
        guard case .scripture(let tabID, let edition) = source, let tab = app.activeTab else { return nil }
        // The reader retains a newer viewport while Presenter is closed. A jump
        // clears these stores; never revive an older mirror after that clearing.
        if let position = app.scriptureReadingPositions[tabID]?[edition.key] { return position.verse }
        if let position = ReaderViewports.position(in: tab.state, chapter: edition.key) { return position.verse }
        return nil
    }
    private var liveFocus: Int? {
        if let comparison { return comparison.focus }
        guard case .scripture = source else { return nil }
        return followedVerse ?? selected.min() ?? readerAnchor ?? app.activeTab.map { BibleState($0.state).verse } ?? nil
    }
    @State private var frozenSelection: Set<Int> = []
    @State private var notePosition = ScrollPosition(edge: .top)
    /// width = visible height, height = content height of the presented note.
    @State private var noteMetrics = CGSize.zero

    private func followNote(_ id: String) {
        guard !paused, let viewport = app.presenterNoteViewport, viewport.noteId == id else { return }
        let range = max(0, noteMetrics.height - noteMetrics.width)
        notePosition.scrollTo(y: viewport.fraction * range)
    }
    private var request: Request {
        Request(source: source, notesRevision: { if case .note = source { return app.notesRevision }; return 0 }(),
                replacer: source.edition != nil && app.wordReplacerEnabled,
                rules: source.edition == nil ? [] : app.wordReplacerRules,
                hiddenAnnotations: Set((app.activeTab?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string }),
                paused: paused,
                appearance: {
                    guard source.edition != nil else { return Appearance(scheme: colorScheme) }
                    return Appearance(family: app.scriptureFontFamily, spacing: Double(app.lineSpacing), numbers: showVerseNumbers,
                                      palette: app.activeReaderTheme?.palette(dark: colorScheme == .dark), scheme: colorScheme)
                }())
    }

    var body: some View {
        ZStack {
            pageBackground.ignoresSafeArea()
            if !paused && loadedSource != source {
                ProgressView().controlSize(.small)
            } else {
                audienceContent
            }
        }
        .environment(\.colorScheme, renderedAppearance.scheme ?? colorScheme)
        .navigationTitle(paused ? "Presenter — Paused" : "Presenter")
        .toolbar {
            ToolbarItem(placement: .status) {
                Image(systemName: paused ? "pause.circle" : "dot.radiowaves.left.and.right")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(paused ? "Paused" : "Following main window")
                    .help(paused ? "The audience view is frozen" : "Following the main window")
            }
            ToolbarItem {
                HStack(spacing: 6) {
                    Button("Smaller", systemImage: "textformat.size.smaller") { setScale(scale - 0.2) }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Decrease text size")
                        .disabled(scale <= PresenterZoom.range.lowerBound)
                        .help("Smaller text (⌘−)")
                    Button { setScale(PresenterZoom.standard) } label: {
                        Text("\(Int((scale * 100).rounded()))%")
                            .font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                            .frame(minWidth: 42)
                    }
                    .accessibilityLabel("Reset text size")
                    .accessibilityValue("\(Int((scale * 100).rounded())) percent")
                    .help("Reset text size (⌘0)")
                    Button("Larger", systemImage: "textformat.size.larger") { setScale(scale + 0.2) }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Increase text size")
                        .disabled(scale >= PresenterZoom.range.upperBound)
                        .help("Larger text (⌘+)")
                }
                .buttonStyle(.borderless)
                .padding(.horizontal, 6).frame(minHeight: 32)
                .glassEffectCompat(interactive: true)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Presenter text size")
            }
            ToolbarItem {
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
            followedVerse = readerAnchor ?? selected.min()
            app.presenterOpen = true
        }
        .onDisappear {
            app.presenterOpen = false
            app.presenterNoteViewport = nil
        }
        .task(id: request) { await load(request) }
        // Follow the latest interaction: selection focuses its first verse;
        // subsequent reader scrolling must still move the audience view.
        .onChange(of: source) { _, _ in followedVerse = readerAnchor ?? selected.min() }
        .onChange(of: app.presenterSelection) { _, selection in
            guard let selection, selection.requestsFocus,
                  case .scripture(let tabID, let edition) = source,
                  selection.tabId == tabID, selection.edition == edition else { return }
            followedVerse = selection.verses.min() ?? readerAnchor
        }
        .onChange(of: readerAnchor) { _, verse in followedVerse = verse }
        // The menu calls this outside the view graph: write through the $scale binding (a
        // captured struct copy didn't update the view, nor did a raw UserDefaults write).
        .focusedSceneValue(\.presenterZoom, PresenterZoom(scale: scale, set: { [binding = $scale] v in
            binding.wrappedValue = PresenterZoom.clamped(v)
        }))
    }

    private var pageBackground: Color {
        renderedAppearance.palette.map { ReaderTheme.color($0.bg) } ?? Color(nsColor: .textBackgroundColor)
    }
    private var pageText: Color { renderedAppearance.palette.map { ReaderTheme.color($0.text) } ?? .primary }
    private var pageAccent: Color { renderedAppearance.palette.map { ReaderTheme.color($0.accent) } ?? .accentColor }

    private func setScale(_ value: Double) { scale = PresenterZoom.clamped(value) }

    @ViewBuilder private var audienceContent: some View {
        switch snapshot {
        case .scripture(let edition, let verses):
            scripture(edition, verses: verses)
        case .note(let note):
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(note.title.isEmpty ? "Untitled" : note.title)
                        .font(.system(size: 22 * scale, weight: .semibold))
                    MarkdownText(note.content).font(.system(size: 18 * scale)).lineSpacing(5 * scale)
                        .textSelection(.enabled)
                }
                .padding(40).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
            // CC-05: follow the main window's note scroll proportionally (frozen while paused).
            .scrollPosition($notePosition)
            .onScrollGeometryChange(for: CGSize.self) { CGSize(width: $0.containerSize.height, height: $0.contentSize.height) } action: { _, metrics in
                noteMetrics = metrics
                followNote(note.id)
            }
            .onChange(of: app.presenterNoteViewport) { _, _ in followNote(note.id) }
            // A different note starts at its top (or its own published position) — never the
            // previous note's offset.
            .onChange(of: note.id, initial: true) { _, id in
                notePosition = ScrollPosition(edge: .top)
                followNote(id)
            }
            .onChange(of: paused) { _, nowPaused in if !nowPaused { followNote(note.id) } }
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
                VStack(alignment: .leading, spacing: 7 * scale) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(Reference.readerChapterLabel(edition.book, edition.chapter, textId: edition.text))
                            .font(.system(size: 18 * scale, weight: .medium))
                        if edition.text == "lxx" { Text("LXX").font(.system(size: 12 * scale, weight: .medium)).foregroundStyle(.secondary) }
                    }
                    .padding(.leading, renderedAppearance.numbers ? 34 * scale : 10 * scale)
                    .padding(.bottom, 14 * scale)
                    .id("presenter-chapter-heading")
                    ForEach(verses, id: \.id) { verse in
                        HStack(alignment: .firstTextBaseline, spacing: 12 * scale) {
                            if renderedAppearance.numbers {
                                Text(verse.number).font(.system(size: 10 * scale, weight: .medium))
                                    .foregroundStyle(pageText.opacity(0.45)).frame(minWidth: 22 * scale, alignment: .trailing)
                            }
                            VStack(alignment: .leading, spacing: 6 * scale) {
                                if let title = verse.title, !title.isEmpty {
                                    Text(title).font(ScriptureFont.font(renderedAppearance.family, size: 15 * scale)).italic().foregroundStyle(.secondary)
                                }
                                Text(verse.text).font(ScriptureFont.font(renderedAppearance.family, size: 20 * scale))
                                    .lineSpacing(CGFloat(renderedAppearance.spacing) * scale).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.vertical, 4 * scale).padding(.horizontal, 10 * scale)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(highlights.contains(verse.id) ? pageAccent.opacity(0.07) : .clear,
                                    in: .rect(cornerRadius: 12 * scale))
                        .id(verse.id)
                    }
                }
                .foregroundStyle(pageText)
                .padding(.horizontal, 36).padding(.vertical, 28)
                .frame(maxWidth: 1040, alignment: .leading).frame(maxWidth: .infinity)
            }
            // A35: keep scroll targets below the transparent title bar (scrollTo honours content margins),
            // so following verse 1 / the chapter heading never parks them under the bar.
            .contentMargins(.top, 44, for: .scrollContent)
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
        case .scripture(_, let edition), .comparison(_, _, let edition):
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
        case .comparisonUnavailable: result = .missing("Choose an available passage in Compare.")
        case .idle: result = .idle
        }
        guard !Task.isCancelled, self.request == request else { return }
        snapshot = result
        renderedAppearance = request.appearance
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
        Button("Messages") { openWindow(id: "chat") }
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
