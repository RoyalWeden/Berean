import SwiftUI
import BereanReference
import BereanStore
import BereanWorkspace

struct StudyTrailRecording: Equatable {
    let trailID: String
    var isPaused: Bool
}

struct StudyTrailView: View {
    @Environment(AppModel.self) private var app
    @State private var trails: [StudyTrailService.Trail] = []
    @State private var loadFailed = false
    @State private var showNewTrail = false
    @State private var newTrailName = ""
    @State private var errorMessage: String?
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if loadFailed {
                    ContentUnavailableView("Couldn’t Load Study Trail", systemImage: "exclamationmark.circle")
                } else if trails.isEmpty {
                    ContentUnavailableView("No Study Trails", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                           description: Text("Saved trails from this library appear here."))
                } else {
                    List(trails) { trail in
                        NavigationLink(value: trail.id) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(trail.name.isEmpty ? "Untitled Trail" : trail.name)
                                Text("\(trail.stopCount) \(trail.stopCount == 1 ? "stop" : "stops") · \(trail.status.capitalized)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Study Trail")
            .safeAreaInset(edge: .bottom) {
                Button("New Trail", systemImage: "plus") {
                    newTrailName = ""
                    showNewTrail = true
                }
                .buttonStyle(.borderedProminent)
                .padding(8)
            }
            .navigationDestination(for: String.self) { trailId in
                if let trail = trails.first(where: { $0.id == trailId }) {
                    StudyTrailStopsView(trail: trail, reloadTrails: load)
                }
            }
            .alert("New Study Trail", isPresented: $showNewTrail) {
                TextField("Name", text: $newTrailName)
                Button("Cancel", role: .cancel) {}
                Button("Start") { startTrail() }
                    .disabled(newTrailName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .alert("Couldn’t Start Trail", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
        .task { load() }
    }

    private func load() {
        do {
            guard let reader = app.studyTrailService else { loadFailed = true; return }
            trails = try reader.trails()
            loadFailed = false
        } catch {
            loadFailed = true
        }
    }

    private func startTrail() {
        guard let service = app.studyTrailService else {
            errorMessage = "The library is unavailable."
            return
        }
        do {
            let name = newTrailName.trimmingCharacters(in: .whitespacesAndNewlines)
            let id = try service.start(name: name, id: AppModel.newId(), at: Self.now())
            load()
            path.append(id)
        } catch {
            errorMessage = "The trail could not be saved."
        }
    }

    fileprivate static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

}

private struct StudyTrailStopsView: View {
    @Environment(AppModel.self) private var app
    @State private var stops: [StudyTrailService.Stop] = []
    @State private var connections: [StudyTrailService.Connection] = []
    @State private var loadFailed = false
    @State private var status: String?
    @State private var actionMessage: String?
    @State private var confirmFinish = false
    @State private var editTarget: NoteTarget?
    @State private var presentation: Presentation = .list

    private enum Presentation { case list, map }

    private enum NoteTarget: Identifiable {
        case stop(StudyTrailService.Stop), connection(StudyTrailService.Connection)

        var id: String {
            switch self {
            case .stop(let stop): "stop-\(stop.id)"
            case .connection(let connection): "connection-\(connection.id)"
            }
        }

        var title: String {
            switch self {
            case .stop: "Stop Note"
            case .connection: "Connection Note"
            }
        }

        var text: String {
            switch self {
            case .stop(let stop): stop.subnote ?? ""
            case .connection(let connection): connection.userNote ?? ""
            }
        }
    }
    let trail: StudyTrailService.Trail
    let reloadTrails: () -> Void

    var body: some View {
        Group {
            if presentation == .map { mapContent }
            else { listContent }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                Picker("Trail View", selection: $presentation) {
                    Text("List").tag(Presentation.list)
                    Text("Map").tag(Presentation.map)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 260)
                .padding(8)
                if presentation == .list { trailControls }
            }
            .frame(maxWidth: .infinity)
            .background(.regularMaterial)
        }
        .navigationTitle(trail.name.isEmpty ? "Untitled Trail" : trail.name)
        .task(id: trail.id) { load() }
        .sheet(item: $editTarget) { target in
            StudyTrailNoteEditor(title: target.title, text: target.text) { try saveNote($0, target: target) }
        }
        .confirmationDialog("Finish this trail?", isPresented: $confirmFinish, titleVisibility: .visible) {
            Button("Finish Trail") { transition(.finish) }
        }
        .alert("Study Trail", isPresented: Binding(
            get: { actionMessage != nil }, set: { if !$0 { actionMessage = nil } }
        )) {
            Button("OK") { actionMessage = nil }
        } message: { Text(actionMessage ?? "") }
    }

    private var listContent: some View {
        List {
            if let recap = trail.recap, !recap.isEmpty { Section("Recap") { Text(recap) } }
            if loadFailed {
                Text("Couldn’t load stops.")
            } else if stops.isEmpty {
                Text("No stops in this trail.").foregroundStyle(.secondary)
            } else {
                Section("Stops") {
                    ForEach(stops) { stop in
                        stopRow(stop, editable: true)
                    }
                }
            }
            if !connections.isEmpty || (!stops.isEmpty && currentDestination != nil) {
                Section("Connections") {
                    if let destination = currentDestination, !stops.isEmpty {
                        Menu {
                            Section("From a Stop") {
                                ForEach(stops) { stop in
                                    Button(stopLabel(stop)) { addConnection(destination.value, from: stop.id) }
                                }
                            }
                            if !connections.isEmpty {
                                Menu("Continue from a Connection") {
                                    ForEach(connections) { parent in
                                        let title = connectionLabel(parent.destination)
                                        let origin = stops.first { $0.id == parent.fromStopId }
                                        Button(origin.map { "\(title) · \(stopLabel($0))" } ?? title) {
                                            addConnection(destination.value, from: parent.fromStopId, after: parent.id)
                                        }
                                    }
                                }
                            }
                        } label: {
                            Label("Connect \(destination.label)", systemImage: "link.badge.plus")
                        }
                    }
                    ForEach(connections) { connection in connectionRow(connection) }
                }
            }
        }
    }

    private var mapContent: some View {
        let graph = StudyTrailService.map(stops: stops, connections: connections)
        return List {
            if loadFailed {
                Text("Couldn’t load the trail map.")
            } else if graph.stops.isEmpty && graph.unplaced.isEmpty {
                Text("Record a stop to start the trail map.").foregroundStyle(.secondary)
            }
            ForEach(graph.stops) { node in
                Section {
                    stopRow(node.stop, editable: false)
                    ForEach(node.branches) { branch in mapBranch(branch) }
                }
            }
            if !graph.unplaced.isEmpty {
                Section("Connections Without a Stop") {
                    ForEach(graph.unplaced) { branch in mapBranch(branch) }
                }
            }
        }
    }

    private func mapBranch(_ branch: StudyTrailService.MapConnection) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            connectionRow(branch.connection, showOrigin: false)
        }
        .padding(.leading, CGFloat(min(branch.depth, 4)) * 18)
    }

    private func stopRow(_ stop: StudyTrailService.Stop, editable: Bool) -> some View {
        HStack {
            Button {
                app.showStudyTrail = false
                let textId = stop.translation ?? app.bookCatalog.first { $0.book.id == stop.bookId }?.textId
                app.openScripture(bookId: stop.bookId, chapter: stop.chapter, textId: textId, reuseTab: true)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(stopLabel(stop)).fontWeight(editable ? .regular : .semibold)
                    if let subnote = stop.subnote, !subnote.isEmpty {
                        Text(subnote).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
            .buttonStyle(.borderless)
            Spacer()
            if editable { editNoteButton(.stop(stop)) }
        }
    }

    private var currentPassage: BibleState? {
        guard let tab = app.activeTab, tab.tabType == .bible else { return nil }
        return BibleState(tab.state)
    }

    private var currentDestination: (value: StudyTrailService.Connection.Destination, label: String)? {
        guard let tab = app.activeTab else { return nil }
        switch tab.tabType {
        case .bible:
            let passage = BibleState(tab.state)
            guard !passage.compareMode else { return nil }
            return (.scripture(bookId: passage.bookId, chapter: passage.chapter,
                               verse: passage.verse, endVerse: passage.endVerse), tab.navigationLabel)
        case .lexicon:
            guard let id = tab.state["strongsNum"]?.stringValue?.string, !id.isEmpty else { return nil }
            return (.lexicon(id), id)
        case .note:
            guard let id = tab.state["noteId"]?.stringValue?.string else { return nil }
            return (.note(id), tab.navigationLabel)
        default: return nil
        }
    }

    private func stopLabel(_ stop: StudyTrailService.Stop) -> String {
        Reference.readerChapterLabel(stop.bookId, stop.chapter, textId: stop.translation ?? app.defaultText)
    }

    private func addConnection(_ destination: StudyTrailService.Connection.Destination, from stopId: String,
                               after parentId: String? = nil) {
        guard let service = app.studyTrailService else { return }
        do {
            guard try service.addConnection(destination, id: AppModel.newId(), fromStopId: stopId,
                                            trailId: trail.id, after: parentId, at: StudyTrailView.now()) else {
                actionMessage = "This connection already exists or the stop is unavailable."
                return
            }
            load()
        } catch {
            actionMessage = "The connection could not be saved."
        }
    }

    @ViewBuilder private var trailControls: some View {
        let currentStatus = status ?? trail.status
        if currentStatus == "live" || currentStatus == "paused" {
            VStack(alignment: .leading, spacing: 8) {
                if currentStatus == "live" {
                    if let passage = currentPassage {
                        let reference = Reference.bookChapterLabel(passage.bookId, chapter: Double(passage.chapter))
                        Button("Record \(reference)", systemImage: "plus.circle") { record(passage) }
                    }
                    Button("Pause Trail", systemImage: "pause.circle") { transition(.pause) }
                } else {
                    Button("Resume Trail", systemImage: "play.circle") { transition(.resume) }
                }
                Toggle("Record Chapters Automatically", isOn: Binding(
                    get: { app.studyTrailRecording?.trailID == trail.id },
                    set: { enabled in
                        if enabled {
                            app.studyTrailRecording = StudyTrailRecording(trailID: trail.id, isPaused: currentStatus == "paused")
                        } else if app.studyTrailRecording?.trailID == trail.id {
                            app.studyTrailRecording = nil
                        }
                    }
                ))
                .toggleStyle(.switch)
                .help("Record chapters you keep open during this app session")
                Button("Finish Trail", systemImage: "stop.circle") { confirmFinish = true }
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.regularMaterial)
        }
    }

    private func load() {
        do {
            guard let service = app.studyTrailService else { loadFailed = true; return }
            let loadedStops = try service.stops(in: trail.id)
            connections = try service.connections(in: trail.id)
            stops = loadedStops
            loadFailed = false
        } catch {
            loadFailed = true
        }
    }

    private func transition(_ transition: StudyTrailService.Transition) {
        guard let service = app.studyTrailService else { return }
        do {
            guard try service.transition(transition, trailId: trail.id, at: StudyTrailView.now(),
                                         intervalId: AppModel.newId()) else { return }
            switch transition {
            case .pause: status = "paused"
            case .resume: status = "live"
            case .finish: status = "ended"
            }
            if app.studyTrailRecording?.trailID == trail.id {
                switch transition {
                case .pause: app.studyTrailRecording?.isPaused = true
                case .resume: app.studyTrailRecording?.isPaused = false
                case .finish: app.studyTrailRecording = nil
                }
            }
            reloadTrails()
        } catch {
            actionMessage = "The trail could not be updated."
        }
    }

    private func record(_ passage: BibleState) {
        guard let service = app.studyTrailService else { return }
        do {
            if try service.recordStop(trailId: trail.id, id: AppModel.newId(), bookId: passage.bookId,
                                      chapter: passage.chapter, translation: passage.translation,
                                      at: StudyTrailView.now()) {
                load()
                reloadTrails()
            } else {
                actionMessage = "This chapter is already the active stop."
            }
        } catch {
            actionMessage = "The stop could not be saved."
        }
    }

    private func connectionLabel(_ destination: StudyTrailService.Connection.Destination) -> String {
        switch destination {
        case .scripture(let book, let chapter, let verse, let endVerse):
            let first = Reference.bookChapterVerseLabel(book, chapter: chapter, verse: verse)
            if let verse, let endVerse, endVerse > verse { return "\(first)–\(endVerse)" }
            return first
        case .lexicon(let id): return id
        case .note(let id): return (try? app.notes?.one(id))?.displayTitle ?? "Unavailable Note"
        case .other(let kind): return kind.capitalized
        }
    }

    private func connectionRow(_ connection: StudyTrailService.Connection, showOrigin: Bool = true) -> some View {
        let origin = stops.first { $0.id == connection.fromStopId }
        return VStack(alignment: .leading, spacing: 4) {
            if showOrigin, let origin {
                Text("From \(Reference.bookChapterLabel(origin.bookId, chapter: Double(origin.chapter)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let parent = connections.first(where: { $0.id == connection.parentId }) {
                Label("Via \(connectionLabel(parent.destination))", systemImage: "arrow.turn.down.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            switch connection.destination {
            case let .scripture(book, chapter, verse, endVerse):
                Button(connectionLabel(connection.destination), systemImage: "book") {
                    app.showStudyTrail = false
                    let translation = origin?.translation
                    let textId = app.bookCatalog.first {
                        $0.book.id == book && $0.textId == translation
                    }?.textId ?? app.bookCatalog.first { $0.book.id == book }?.textId
                    app.openScripture(bookId: book, chapter: chapter, verse: verse, endVerse: endVerse, textId: textId, reuseTab: true)
                }
            case let .lexicon(id):
                Button(id, systemImage: "character.book.closed") {
                    app.showStudyTrail = false
                    app.openLexicon(id, reuseTab: true)
                }
            case let .note(id):
                if let note = try? app.notes?.one(id) {
                    Button(note.displayTitle, systemImage: "note.text") {
                        app.showStudyTrail = false
                        app.openNote(id)
                    }
                } else {
                    Label("Unavailable Note", systemImage: "note.text").foregroundStyle(.secondary)
                }
            case let .other(kind):
                Label(kind.capitalized, systemImage: "link").foregroundStyle(.secondary)
            }
            if let reason = connection.reason, !reason.isEmpty {
                Text(reason).font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                if let note = connection.userNote, !note.isEmpty { Text(note).font(.callout) }
                Spacer()
                editNoteButton(.connection(connection))
            }
        }
    }

    private func editNoteButton(_ target: NoteTarget) -> some View {
        Button(target.text.isEmpty ? "Add \(target.title)" : "Edit \(target.title)", systemImage: "square.and.pencil") {
            editTarget = target
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .help(target.text.isEmpty ? "Add \(target.title)" : "Edit \(target.title)")
    }

    private func saveNote(_ note: String, target: NoteTarget) throws {
        guard let service = app.studyTrailService else { throw TrailNoteIssue.unavailable }
        let saved: Bool
        switch target {
        case .stop(let stop): saved = try service.updateStopNote(note, stopId: stop.id, trailId: trail.id)
        case .connection(let connection):
            saved = try service.updateConnectionNote(note, connectionId: connection.id, trailId: trail.id)
        }
        guard saved else { throw TrailNoteIssue.unavailable }
        load()
    }

    private enum TrailNoteIssue: Error { case unavailable }
}

private struct StudyTrailNoteEditor: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    @State var text: String
    let save: (String) throws -> Void
    @State private var saveFailed = false

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .accessibilityLabel(title)
                .padding()
                .navigationTitle(title)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            do {
                                try save(text.trimmingCharacters(in: .whitespacesAndNewlines))
                                dismiss()
                            } catch {
                                saveFailed = true
                            }
                        }
                    }
                }
                .alert("Couldn’t Save Note", isPresented: $saveFailed) { Button("OK", role: .cancel) {} }
        }
        #if os(macOS)
        .frame(minWidth: 360, minHeight: 220)
        #endif
    }
}

extension AppModel {
    func recordStudyStrongsLookup(_ id: String, from chapter: ChapterEdition, verse: Int?) {
        guard let recording = studyTrailRecording, !recording.isPaused,
              let service = studyTrailService else { return }
        do {
            try service.recordStrongsLookup(id, id: AppModel.newId(), trailId: recording.trailID,
                                          fromBook: chapter.book, chapter: chapter.chapter,
                                          translation: chapter.text, verse: verse, at: StudyTrailView.now())
        } catch {
            userMessage = "Study Trail could not save this Strong’s lookup."
        }
    }

    func recordStudyCrossReference(_ passage: ResolvedPassage, sourceBook: String, chapter: Int,
                                   edition: String, verse: Int?) {
        guard let recording = studyTrailRecording, !recording.isPaused,
              let service = studyTrailService else { return }
        do {
            try service.recordCrossReference(
                .scripture(bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse, endVerse: passage.endVerse),
                id: AppModel.newId(), trailId: recording.trailID, fromBook: sourceBook, chapter: chapter,
                translation: edition, verse: verse, at: StudyTrailView.now()
            )
        } catch {
            userMessage = "Study Trail could not save this cross reference."
        }
    }
}

private struct StudyTrailRecorder: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let app: AppModel

    private struct Target: Equatable {
        let trailID: String
        let chapter: ChapterEdition
    }

    private var target: Target? {
        guard scenePhase == .active, !app.showStudyTrail,
              let recording = app.studyTrailRecording, !recording.isPaused,
              let tab = app.activeTab, tab.tabType == .bible else { return nil }
        let state = BibleState(tab.state)
        guard !state.compareMode else { return nil }
        return Target(trailID: recording.trailID, chapter: ChapterEdition(state))
    }

    func body(content: Content) -> some View {
        let pending = target
        content.task(id: pending) {
            guard let pending else { return }
            let arrival = StudyTrailView.now()
            // Use the original recorder's dwell so rapid chapter browsing does not create stops.
            do { try await Task.sleep(for: .milliseconds(1200)) }
            catch { return }
            guard !Task.isCancelled, target == pending, let service = app.studyTrailService else { return }
            do {
                let chapter = pending.chapter
                try service.recordStop(trailId: pending.trailID, id: AppModel.newId(), bookId: chapter.book,
                                       chapter: chapter.chapter, translation: chapter.text, at: arrival)
            } catch {
                app.studyTrailRecording = nil
                app.userMessage = "Automatic Study Trail recording stopped because the chapter could not be saved."
            }
        }
    }
}

extension View {
    func studyTrailSheet(app: AppModel) -> some View {
        modifier(StudyTrailRecorder(app: app))
        .sheet(isPresented: Binding(get: { app.showStudyTrail }, set: { app.showStudyTrail = $0 })) {
            StudyTrailView()
                .environment(app)
                .safeAreaInset(edge: .bottom) {
                    Button("Done") { app.showStudyTrail = false }
                        .buttonStyle(.bordered)
                        .padding(8)
                }
                #if os(macOS)
                .frame(minWidth: 460, minHeight: 440)
                #endif
        }
    }
}
