import SwiftUI
import BereanReference
import BereanStore
import BereanWorkspace

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
    let trail: StudyTrailService.Trail
    let reloadTrails: () -> Void

    var body: some View {
        List {
            if let recap = trail.recap, !recap.isEmpty { Section("Recap") { Text(recap) } }
            if loadFailed {
                Text("Couldn’t load stops.")
            } else if stops.isEmpty {
                Text("No stops in this trail.").foregroundStyle(.secondary)
            } else {
                Section("Stops") {
                    ForEach(stops) { stop in
                        Button {
                            app.showStudyTrail = false
                            let textId = stop.translation ?? app.bookCatalog.first {
                                $0.book.id == stop.bookId
                            }?.textId
                            app.openScripture(bookId: stop.bookId, chapter: stop.chapter,
                                              textId: textId, reuseTab: true)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(Reference.bookChapterLabel(stop.bookId, chapter: Double(stop.chapter)))
                                if let subnote = stop.subnote, !subnote.isEmpty {
                                    Text(subnote).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                    }
                }
            }
            if !connections.isEmpty {
                Section("Connections") {
                    ForEach(connections) { connection in connectionRow(connection) }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { trailControls }
        .navigationTitle(trail.name.isEmpty ? "Untitled Trail" : trail.name)
        .task(id: trail.id) { load() }
        .confirmationDialog("Finish this trail?", isPresented: $confirmFinish, titleVisibility: .visible) {
            Button("Finish Trail") { transition(.finish) }
        }
        .alert("Study Trail", isPresented: Binding(
            get: { actionMessage != nil }, set: { if !$0 { actionMessage = nil } }
        )) {
            Button("OK") { actionMessage = nil }
        } message: { Text(actionMessage ?? "") }
    }

    private var currentPassage: BibleState? {
        guard let tab = app.activeTab, tab.tabType == .bible else { return nil }
        return BibleState(tab.state)
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

    private func connectionRow(_ connection: StudyTrailService.Connection) -> some View {
        let origin = stops.first { $0.id == connection.fromStopId }
        return VStack(alignment: .leading, spacing: 4) {
            if let origin {
                Text("From \(Reference.bookChapterLabel(origin.bookId, chapter: Double(origin.chapter)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            switch connection.destination {
            case let .scripture(book, chapter, verse):
                Button(Reference.bookChapterVerseLabel(book, chapter: chapter, verse: verse), systemImage: "book") {
                    app.showStudyTrail = false
                    let translation = origin?.translation
                    let textId = app.bookCatalog.first {
                        $0.book.id == book && $0.textId == translation
                    }?.textId ?? app.bookCatalog.first { $0.book.id == book }?.textId
                    app.openScripture(bookId: book, chapter: chapter, verse: verse, textId: textId, reuseTab: true)
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
        }
    }

}

extension View {
    func studyTrailSheet(app: AppModel) -> some View {
        sheet(isPresented: Binding(get: { app.showStudyTrail }, set: { app.showStudyTrail = $0 })) {
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
