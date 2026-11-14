import SwiftUI
import BereanCore

/// The legacy `ScriptureLayout` presets (src/types `ScriptureLayout`, synced as `scriptureLayout`) rendered with
/// native resizable split views. Every preset the existing app offers is supported; panels are the same
/// study panels (tabbed, Notes, Lexicon, Cross References).
enum ScriptureLayout: String, CaseIterable, Identifiable {
    case standard, panelBottom = "panel-bottom", notesBottom = "notes-bottom", lexiconCrossref = "lexicon-crossref", reading,
         panelLeft = "panel-left", notesWide = "notes-wide", scriptureWide = "scripture-wide", compareNotes = "compare-notes",
         studyGrid = "study-grid", scriptureFocus = "scripture-focus", notesRight = "notes-right", notesTop = "notes-top",
         tripleCol = "triple-col", commentary, splitBottom = "split-bottom"
    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: "Scripture · Panel"
        case .panelBottom: "Scripture over Panel"
        case .notesBottom: "Scripture over Notes"
        case .lexiconCrossref: "Scripture & Notes · Lexicon & Cross Refs"
        case .reading: "Reading"
        case .panelLeft: "Panel · Scripture"
        case .notesWide: "Slim Scripture · Wide Panel"
        case .scriptureWide: "Wide Scripture · Slim Panel"
        case .compareNotes: "Compare over Notes"
        case .studyGrid: "Scripture · Lexicon over Cross Refs"
        case .scriptureFocus: "Focus"
        case .notesRight: "Scripture · Notes"
        case .notesTop: "Notes over Scripture"
        case .tripleCol: "Notes · Scripture · Lexicon"
        case .commentary: "Commentary (Notes · Scripture)"
        case .splitBottom: "Scripture over Notes · Lexicon"
        }
    }
    var symbol: String {
        switch self {
        case .reading, .scriptureFocus: "doc.plaintext"
        case .panelBottom, .notesBottom, .compareNotes, .notesTop, .splitBottom: "rectangle.split.1x2"
        case .lexiconCrossref, .studyGrid: "rectangle.split.2x2"
        case .tripleCol: "rectangle.split.3x1"
        default: "rectangle.split.2x1"
        }
    }
    var showsNotes: Bool {
        switch self {
        case .reading, .scriptureFocus, .studyGrid: false
        default: true
        }
    }

    /// The standard layout uses the window's native inspector; everything else is laid out here.
    var usesInspector: Bool { self == .standard }
}

enum StudyPanelKind { case tabbed, notes, lexicon, crossrefs }

struct StudyPanel: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    let kind: StudyPanelKind
    var body: some View {
        let st = BibleState(app.findTab(tabId)?.state ?? JSObject())
        Group {
            switch kind {
            case .tabbed: StudyInspector(tabId: tabId)
            case .notes: VerseNotesView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st), textId: st.translation)
            case .lexicon:
                if let id = st.rightPanelLexiconEntry { LexiconEntryView(strongsId: id, tabId: tabId, compact: true) }
                else { ContentUnavailableView("No word selected", systemImage: "character.book.closed", description: Text("Click a Strong's number.")) }
            case .crossrefs: CrossRefsView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st),
                              textId: st.translation, selectedVerses: app.studySelectedVerses(in: tabId, state: st))
            }
        }
        .frame(minWidth: 220, minHeight: 160)
        .background(.background.secondary)
    }
}

/// Scripture tab content arranged by preset.
struct ScriptureLayoutView: View {
    let tabId: String
    let layout: ScriptureLayout

    var scripture: some View { ScriptureView(tabId: tabId).frame(minWidth: 320, minHeight: 200) }
    func panel(_ k: StudyPanelKind) -> some View { StudyPanel(tabId: tabId, kind: k) }

    var body: some View {
        switch layout {
        case .standard, .reading: scripture
        case .scriptureFocus: scripture
        case .panelBottom: VSplitView { scripture; panel(.tabbed) }
        case .notesBottom, .compareNotes: VSplitView { scripture; panel(.notes) }
        case .notesTop: VSplitView { panel(.notes); scripture }
        case .panelLeft: HSplitView { panel(.tabbed).frame(idealWidth: 340); scripture }
        case .notesWide: HSplitView { scripture.frame(idealWidth: 420); panel(.tabbed).frame(idealWidth: 640) }
        case .scriptureWide: HSplitView { scripture.frame(idealWidth: 780); panel(.tabbed).frame(idealWidth: 300) }
        case .notesRight: HSplitView { scripture; panel(.notes).frame(idealWidth: 360) }
        case .commentary: HSplitView { panel(.notes).frame(idealWidth: 520); scripture.frame(idealWidth: 520) }
        case .tripleCol: HSplitView { panel(.notes); scripture; panel(.lexicon) }
        case .studyGrid: HSplitView { scripture; VSplitView { panel(.lexicon); panel(.crossrefs) }.frame(idealWidth: 360) }
        case .lexiconCrossref: HSplitView { VSplitView { scripture; panel(.notes) }; VSplitView { panel(.lexicon); panel(.crossrefs) }.frame(idealWidth: 360) }
        case .splitBottom: VSplitView { scripture; HSplitView { panel(.notes); panel(.lexicon) } }
        }
    }
}
