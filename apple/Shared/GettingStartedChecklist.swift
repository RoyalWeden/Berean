import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

/// "Getting Started" checklist (original TasksPanel.tsx): the same 23 tasks in 8 groups, auto-detected
/// from native state where possible, otherwise marked by hand. Progress persists as the original's
/// `completedStepIds` (`"<task>:<step>"`) so a later sync keeps both apps in agreement.
struct GettingStartedTask: Identifiable {
    let id: String, title: String, subtitle: String, steps: [String]
}

enum GettingStartedCatalog {
    static let groups: [(label: String, tasks: [GettingStartedTask])] = [
        ("First Steps", [
            .init(id: "open-welcome-note", title: "Read the Getting Started guide", subtitle: "Open the Welcome note Berean created for you on first launch.", steps: ["space", "open"]),
            .init(id: "open-passage", title: "Open a Bible passage", subtitle: "Navigate to any book, chapter, or verse using the quick-search bar.", steps: ["search", "navigate"]),
        ]),
        ("Reading Scripture", [
            .init(id: "change-translation", title: "Switch to a different translation", subtitle: "Try Brenton LXX, 1 Enoch, or Jubilees alongside the KJV.", steps: ["bible", "switch"]),
            .init(id: "enable-strongs", title: "Show Strong's numbers", subtitle: "Display Hebrew/Greek word codes inline with every verse.", steps: ["bible", "toggle"]),
            .init(id: "navigate-history", title: "Navigate with reading history", subtitle: "Jump back and forward through every passage you've visited.", steps: ["passages", "history"]),
        ]),
        ("Study Tools", [
            .init(id: "strongs-hover", title: "Look up a Strong's number", subtitle: "See the original word, transliteration, and definition instantly.", steps: ["enable", "hover"]),
            .init(id: "open-lexicon", title: "Open a full lexicon entry", subtitle: "Dive into the complete Hebrew or Greek dictionary definition.", steps: ["strongs", "click"]),
            .init(id: "compare-verse", title: "Compare a verse across translations", subtitle: "View KJV, LXX, Enoch, and more side-by-side.", steps: ["bible", "compare"]),
            .init(id: "search-text", title: "Search across all texts", subtitle: "Full-text keyword search across every enabled text.", steps: ["open", "query"]),
        ]),
        ("Annotation", [
            .init(id: "highlight-verse", title: "Highlight words or phrases", subtitle: "Color-code passages you want to revisit.", steps: ["bible", "color"]),
            .init(id: "verse-note", title: "Attach a note to a verse", subtitle: "Write a study note anchored to a specific verse.", steps: ["bible", "dot", "create"]),
            .init(id: "general-note", title: "Create a freeform study note", subtitle: "Headings, tables, callouts, verse links, and more.", steps: ["create", "write", "table"]),
        ]),
        ("YouTube", [
            .init(id: "youtube-open", title: "Open a YouTube video", subtitle: "Watch study content without leaving Berean.", steps: ["space", "url"]),
            .init(id: "youtube-pip", title: "Use Picture in Picture", subtitle: "Keep a video playing while you study.", steps: ["play", "pip"]),
        ]),
        ("Layout & Organization", [
            .init(id: "right-panel", title: "Open the study panel", subtitle: "Notes, cross-references, and lexicon beside your passage.", steps: ["bible", "panel"]),
            .init(id: "floating-tab", title: "Open a tab in a new window", subtitle: "Great for a second display (Mac).", steps: ["open", "float"]),
            .init(id: "session", title: "Create a study session", subtitle: "Separate tab groups — one for each topic or series.", steps: ["create", "switch"]),
        ]),
        ("Personalize", [
            .init(id: "open-settings", title: "Explore settings", subtitle: "Fonts, themes, texts, and more.", steps: ["settings", "nav"]),
        ]),
        ("Advanced", [
            .init(id: "adv-strongs-search", title: "Search by Strong's number", subtitle: "Find every occurrence of a Hebrew or Greek root.", steps: ["open", "query"]),
            .init(id: "adv-cross-ref", title: "Browse cross-references", subtitle: "Open cross references for the current verse in the study panel.", steps: ["bible", "crossrefs"]),
            .init(id: "adv-verse-compare-notes", title: "Compare a verse and take notes side-by-side", subtitle: "Use the study panel inside Compare to annotate while comparing.", steps: ["compare", "note"]),
            .init(id: "adv-vault-sync", title: "Connect your Octarine / Obsidian vault", subtitle: "Not yet available in this version of Berean.", steps: ["settings"]),
        ]),
    ]
    static var all: [GettingStartedTask] { groups.flatMap(\.tasks) }
    static func keys(_ task: GettingStartedTask) -> [String] { task.steps.map { "\(task.id):\($0)" } }
}

extension AppModel {
    var completedStepIds: Set<String> {
        Set((settingValue("completedStepIds")?.arrayValue ?? []).compactMap { $0.stringValue?.string })
    }

    func setTask(_ task: GettingStartedTask, done: Bool) {
        var ids = completedStepIds
        let keys = GettingStartedCatalog.keys(task)
        if done { ids.formUnion(keys) } else { ids.subtract(keys) }
        saveSetting("completedStepIds", .array(ids.sorted().map { .string(JSString($0)) }))
        gettingStartedRevision += 1
    }

    func isTaskDone(_ task: GettingStartedTask) -> Bool {
        GettingStartedCatalog.keys(task).allSatisfy(completedStepIds.contains)
    }

    /// Native detection (the original used per-step detectors on its store).
    func detectCompletedTasks() {
        let tabs = session.allTabs
        let bibles = tabs.filter { $0.tabType == .bible }.map { BibleState($0.state) }
        var done: Set<String> = []
        if !bibles.isEmpty { done.insert("open-passage") }
        if bibles.contains(where: { $0.translation != "kjva" }) { done.insert("change-translation") }
        if bibles.contains(where: \.showStrongs) { done.insert("enable-strongs") }
        if canGoBack { done.insert("navigate-history") }
        if tabs.contains(where: { $0.tabType == .lexicon }) { done.formUnion(["open-lexicon", "strongs-hover"]) }
        if bibles.contains(where: \.compareMode) { done.insert("compare-verse") }
        if bibles.contains(where: { $0.compareMode && $0.rightPanelOpen }) { done.insert("adv-verse-compare-notes") }
        if bibles.contains(where: \.rightPanelOpen) { done.insert("right-panel") }
        let searches = tabs.filter { $0.tabType == .search }
        if !searches.isEmpty { done.insert("search-text") }
        if searches.contains(where: { StrongsId.normalize($0.title.replacingOccurrences(of: "Search: ", with: "")) != nil }) { done.insert("adv-strongs-search") }
        if tabs.contains(where: { $0.tabType == .youtube && $0.state["videoId"]?.stringValue != nil }) { done.insert("youtube-open") }
        if sessions.count > 1 { done.insert("session") }
        let notes = (try? notes?.all(limit: 500)) ?? []
        if notes.contains(where: { $0.verseRef != nil }) { done.insert("verse-note") }
        if notes.contains(where: { $0.verseRef == nil && !$0.content.isEmpty && $0.type != "daily" }) { done.insert("general-note") }
        if notes.contains(where: { $0.title.localizedCaseInsensitiveContains("Welcome") }) && tabs.contains(where: { $0.tabType == .note }) {
            done.insert("open-welcome-note")
        }
        if let db = database?.connection, let n = try? db.query("SELECT 1 FROM highlights LIMIT 1"), !n.isEmpty { done.insert("highlight-verse") }
        let newly = GettingStartedCatalog.all.filter { done.contains($0.id) && !isTaskDone($0) }
        guard !newly.isEmpty else { return }
        var ids = completedStepIds
        for task in newly { ids.formUnion(GettingStartedCatalog.keys(task)) }
        saveSetting("completedStepIds", .array(ids.sorted().map { .string(JSString($0)) }))
        gettingStartedRevision += 1
    }
}

struct GettingStartedChecklist: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let _ = app.gettingStartedRevision
        let completed = app.completedStepIds
        let isDoneTask: (GettingStartedTask) -> Bool = { GettingStartedCatalog.keys($0).allSatisfy(completed.contains) }
        let total = GettingStartedCatalog.all.count
        let done = GettingStartedCatalog.all.filter(isDoneTask).count
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(done == total ? "All done!" : "\(done) of \(total) complete").font(.headline)
                        ProgressView(value: Double(done), total: Double(total))
                    }
                    .padding(.vertical, 4)
                } footer: {
                    Text("Steps tick themselves off as you use Berean. Swipe or right-click a step to mark it yourself.")
                }
                ForEach(GettingStartedCatalog.groups, id: \.label) { group in
                    Section(group.label) {
                        ForEach(group.tasks) { task in
                            let isDone = isDoneTask(task)
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isDone ? Color.green : Color.secondary)
                                    .imageScale(.large)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(task.title).strikethrough(isDone, color: .secondary)
                                    Text(task.subtitle).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(isDone ? .isSelected : [])
                            .contextMenu {
                                Button(isDone ? "Mark as Not Done" : "Mark as Done", systemImage: isDone ? "circle" : "checkmark.circle") {
                                    app.setTask(task, done: !isDone)
                                }
                            }
                            .swipeActions {
                                Button(isDone ? "Not Done" : "Done") { app.setTask(task, done: !isDone) }.tint(isDone ? .gray : .green)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Getting Started")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { app.detectCompletedTasks() }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 520)
        #endif
    }
}
