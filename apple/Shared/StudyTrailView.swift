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
    @State private var path: [TrailRoute] = []
    @State private var query = ""
    @State private var index: [IndexedTrailItem]?
    @State private var indexFailed = false

    private struct TrailRoute: Hashable {
        let trailID: String
        var filter = ""
    }

    private struct IndexedTrailItem {
        let trailID: String
        let title: String?
        let source: String?
        let annotation: String?
        let reason: String?
    }

    private var searchActive: Bool { !query.split(whereSeparator: \.isWhitespace).isEmpty }

    private var matchingItems: [String: IndexedTrailItem] {
        guard searchActive, let index else { return [:] }
        var result: [String: IndexedTrailItem] = [:]
        for item in index where result[item.trailID] == nil {
            if trailSearchMatches(query, fields: [item.title, item.source, item.annotation, item.reason]) {
                result[item.trailID] = item
            }
        }
        return result
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if loadFailed {
                    ContentUnavailableView("Couldn’t Load Study Trail", systemImage: "exclamationmark.circle")
                } else if trails.isEmpty {
                    ContentUnavailableView("No Study Trails", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                           description: Text("Saved trails from this library appear here."))
                } else {
                    trailList
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if !trails.isEmpty { librarySearchField }
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
            .navigationDestination(for: TrailRoute.self) { route in
                if let trail = trails.first(where: { $0.id == route.trailID }) {
                    StudyTrailStopsView(query: route.filter, trail: trail, reloadTrails: load)
                }
            }
            .alert("New Study Trail", isPresented: $showNewTrail) {
                TextField("Name", text: $newTrailName)
                Button("Cancel", role: .cancel) {}
                Button("Start") { startTrail() }
                    .disabled(newTrailName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .alert("Study Trail", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
        .task { load() }
        .onChange(of: searchActive) { _, active in
            if active && index == nil { loadSearchIndex() }
        }
    }

    private var librarySearchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Find a Study Trail", text: $query)
                .textFieldStyle(.plain)
            if !query.isEmpty {
                Button("Clear Search", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.interactivePlain)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    @ViewBuilder private var trailList: some View {
        let matches = matchingItems
        let visible = searchActive ? trails.filter {
            trailSearchMatches(query, fields: [$0.name, $0.recap]) || matches[$0.id] != nil
        } : trails
        if visible.isEmpty {
            if indexFailed { ContentUnavailableView("Couldn’t Search Trail Contents", systemImage: "exclamationmark.circle") }
            else { ContentUnavailableView.search(text: query) }
        } else {
            List(visible) { trail in
                let trailNameMatches = trailSearchMatches(query, fields: [trail.name])
                let item = matches[trail.id]
                let excerpt = trailNameMatches ? nil : item?.title ?? item?.source ?? trail.recap
                NavigationLink(value: TrailRoute(trailID: trail.id, filter: trailNameMatches ? "" : query)) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(trail.name.isEmpty ? "Untitled Trail" : trail.name)
                        Text("\(trail.stopCount) \(trail.stopCount == 1 ? "stop" : "stops") · \(trail.status.capitalized)")
                            .font(.caption).foregroundStyle(.secondary)
                        if let excerpt, !excerpt.isEmpty {
                            Text(excerpt).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                .contextMenu {
                    if !searchActive {
                        Button("Move Up", systemImage: "arrow.up") { moveTrail(trail.id, .earlier) }
                            .disabled(trail.id == trails.first?.id)
                        Button("Move Down", systemImage: "arrow.down") { moveTrail(trail.id, .later) }
                            .disabled(trail.id == trails.last?.id)
                    }
                }
            }
        }
    }

    private func moveTrail(_ id: String, _ direction: StudyTrailService.TrailMove) {
        do {
            guard let service = app.studyTrailService, try service.moveTrail(id, direction) else { return }
            load()
        } catch {
            errorMessage = "The trail order could not be saved."
        }
    }

    private func loadSearchIndex() {
        do {
            guard let service = app.studyTrailService else { indexFailed = true; return }
            index = try service.librarySearchRecords().map { record in
                let source = trailReference(record.sourceBook, chapter: record.sourceChapter, verse: record.sourceVerse,
                                            edition: record.sourceEdition)
                let destination = trailReference(record.destinationBook, chapter: record.destinationChapter,
                                                 verse: record.destinationVerse, endVerse: record.destinationEndVerse)
                return IndexedTrailItem(trailID: record.trailId, title: destination ?? record.title,
                                       source: source, annotation: record.annotation, reason: record.reason)
            }
            indexFailed = false
        } catch {
            indexFailed = true
        }
    }

    private func load() {
        do {
            guard let reader = app.studyTrailService else { loadFailed = true; return }
            trails = try reader.trails()
            index = nil
            if searchActive { loadSearchIndex() }
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
            path.append(TrailRoute(trailID: id))
        } catch {
            errorMessage = "The trail could not be saved."
        }
    }

    fileprivate static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

}

private func trailSearchMatches(_ query: String, fields: [String?]) -> Bool {
    let searchable = fields.compactMap { $0 }.joined(separator: " ")
    return query.split(whereSeparator: \.isWhitespace).allSatisfy { searchable.localizedStandardContains(String($0)) }
}

private func trailReference(_ book: String?, chapter: Int?, verse: Int?, endVerse: Int? = nil,
                            edition: String? = nil) -> String? {
    guard let book, let chapter else { return nil }
    if verse == nil, let edition { return Reference.readerChapterLabel(book, chapter, textId: edition) }
    let first = Reference.bookChapterVerseLabel(book, chapter: chapter, verse: verse, hermas: edition.map(HermasText.init(textId:)) ?? .robertsDonaldson)
    if let verse, let endVerse, endVerse > verse { return "\(first)–\(endVerse)" }
    return first
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
    @State var query: String
    @State private var renamingTrail = false
    @State private var draftTrailName = ""

    private enum Presentation { case list, map }

    private enum NoteTarget: Identifiable {
        case stop(StudyTrailService.Stop), connection(StudyTrailService.Connection), recap(StudyTrailService.Trail)

        var id: String {
            switch self {
            case .stop(let stop): "stop-\(stop.id)"
            case .connection(let connection): "connection-\(connection.id)"
            case .recap(let trail): "recap-\(trail.id)"
            }
        }

        var title: String {
            switch self {
            case .stop: "Stop Note"
            case .connection: "Connection Note"
            case .recap: "Trail Recap"
            }
        }

        var text: String {
            switch self {
            case .stop(let stop): stop.subnote ?? ""
            case .connection(let connection): connection.userNote ?? ""
            case .recap(let trail): trail.recap ?? ""
            }
        }
    }
    let trail: StudyTrailService.Trail
    let reloadTrails: () -> Void

    init(query: String, trail: StudyTrailService.Trail, reloadTrails: @escaping () -> Void) {
        _query = State(initialValue: query)
        self.trail = trail
        self.reloadTrails = reloadTrails
    }

    var body: some View {
        Group {
            if presentation == .map { mapContent }
            else { listContent }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                HStack {
                    Picker("Trail View", selection: $presentation) {
                        Text("List").tag(Presentation.list)
                        Text("Map").tag(Presentation.map)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    Spacer(minLength: 12)
                    trailActions
                }
                .frame(maxWidth: 260)
                .padding(8)
                if presentation == .list { trailControls }
            }
            .frame(maxWidth: .infinity)
            .background(.regularMaterial)
        }
        .searchable(text: $query, prompt: "Find in This Trail")
        .navigationTitle(trail.name.isEmpty ? "Untitled Trail" : trail.name)
        .alert("Rename Trail", isPresented: $renamingTrail) {
            TextField("Name", text: $draftTrailName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { renameTrail() }
                .disabled(draftTrailName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
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

    private var trailActions: some View {
        Menu {
            Button("Rename Trail", systemImage: "pencil") {
                draftTrailName = trail.name
                renamingTrail = true
            }
            Button(trail.recap?.isEmpty == false ? "Edit Recap" : "Add Recap", systemImage: "text.alignleft") {
                editTarget = .recap(trail)
            }
        } label: {
            Label("Trail Actions", systemImage: "ellipsis.circle")
                .labelStyle(.iconOnly)
        }
        .menuIndicator(.hidden)
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("Trail Actions")
    }

    private var searchActive: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func matches(_ fields: String?...) -> Bool {
        trailSearchMatches(query, fields: fields)
    }

    private var matchingStops: [StudyTrailService.Stop] {
        stops.filter { matches(stopLabel($0), $0.subnote) }
    }

    private var matchingConnections: [StudyTrailService.Connection] {
        guard searchActive else { return connections }
        let stopsByID = Dictionary(uniqueKeysWithValues: stops.map { ($0.id, $0) })
        return connections.filter { connection in
            let origin = stopsByID[connection.fromStopId].map { originLabel($0, verse: connection.originVerse) }
            return matches(connectionLabel(connection.destination), origin, connection.reason, connection.userNote)
        }
    }

    private var listContent: some View {
        let visibleStops = matchingStops
        let visibleConnections = matchingConnections
        let showConnect = !searchActive && !stops.isEmpty && currentDestination != nil
        return List {
            if let recap = trail.recap, !recap.isEmpty, matches(recap) {
                Section("Recap") {
                    MarkdownText(recap)
                        .textSelection(.enabled)
                        .environment(\.openURL, OpenURLAction { url in
                            let route = DeepLink.parse(url.absoluteString, hermas: app.hermasEdition)
                            guard route != nil || AppModel.isBereanLink(url) else { return .systemAction }
                            app.showStudyTrail = false
                            app.openBereanLink(route)
                            return .handled
                        })
                }
            }
            if loadFailed {
                Text("Couldn’t load stops.")
            } else if searchActive && visibleStops.isEmpty && visibleConnections.isEmpty && !matches(trail.recap) {
                ContentUnavailableView.search(text: query)
            } else if !searchActive && stops.isEmpty {
                Text("No stops in this trail.").foregroundStyle(.secondary)
            } else if !visibleStops.isEmpty {
                Section("Stops") {
                    ForEach(visibleStops) { stop in
                        stopRow(stop, editable: true)
                    }
                }
            }
            if !visibleConnections.isEmpty || showConnect {
                Section("Connections") {
                    if showConnect, let destination = currentDestination {
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
                    ForEach(visibleConnections) { connection in connectionRow(connection) }
                }
            }
        }
    }

    private var mapContent: some View {
        let graph = StudyTrailService.map(stops: stops, connections: connections)
        let matchedStops = Set(matchingStops.map(\.id))
        let retained = mapSearchConnectionIDs()
        let displayedStops = graph.stops.filter { matchedStops.contains($0.id) || $0.branches.contains { retained.contains($0.id) } }
        let unplaced = graph.unplaced.filter { retained.contains($0.id) }
        return List {
            if loadFailed {
                Text("Couldn’t load the trail map.")
            } else if displayedStops.isEmpty && unplaced.isEmpty {
                if searchActive { ContentUnavailableView.search(text: query) }
                else { Text("Record a stop to start the trail map.").foregroundStyle(.secondary) }
            }
            ForEach(displayedStops) { node in
                Section {
                    stopRow(node.stop, editable: false)
                    ForEach(node.branches.filter { matchedStops.contains(node.id) || retained.contains($0.id) }) { branch in
                        mapBranch(branch)
                    }
                }
            }
            if !unplaced.isEmpty {
                Section("Connections Without a Stop") {
                    ForEach(unplaced) { branch in mapBranch(branch) }
                }
            }
        }
    }

    private func mapSearchConnectionIDs() -> Set<String> {
        let byID = Dictionary(uniqueKeysWithValues: connections.map { ($0.id, $0) })
        var retained = Set<String>()
        for match in matchingConnections {
            var branch: StudyTrailService.Connection? = match
            while let current = branch, retained.insert(current.id).inserted {
                branch = current.parentId.flatMap { byID[$0] }.flatMap { parent in
                    parent.fromStopId == match.fromStopId ? parent : nil
                }
            }
        }
        return retained
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
            reloadTrails()
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
            return trailReference(book, chapter: chapter, verse: verse, endVerse: endVerse) ?? book
        case .lexicon(let id): return id
        case .note(let id): return (try? app.notes?.one(id))?.displayTitle ?? "Unavailable Note"
        case .other(let kind): return kind.capitalized
        }
    }

    private func originLabel(_ stop: StudyTrailService.Stop, verse: Int?) -> String {
        guard let verse else { return stopLabel(stop) }
        return Reference.bookChapterVerseLabel(stop.bookId, chapter: stop.chapter, verse: verse,
                                               hermas: HermasText(textId: stop.translation ?? app.defaultText))
    }

    private func connectionRow(_ connection: StudyTrailService.Connection, showOrigin: Bool = true) -> some View {
        let origin = stops.first { $0.id == connection.fromStopId }
        return VStack(alignment: .leading, spacing: 4) {
            if let origin, showOrigin || connection.originVerse != nil {
                Text("From \(originLabel(origin, verse: connection.originVerse))")
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

    private func renameTrail() {
        do {
            let name = draftTrailName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let service = app.studyTrailService,
                  try service.rename(trailId: trail.id, name: name, at: StudyTrailView.now()) else {
                actionMessage = "This trail is no longer available."
                return
            }
            reloadTrails()
        } catch {
            actionMessage = "The trail could not be renamed."
        }
    }

    private func saveNote(_ note: String, target: NoteTarget) throws {
        guard let service = app.studyTrailService else { throw TrailNoteIssue.unavailable }
        let saved: Bool
        switch target {
        case .stop(let stop): saved = try service.updateStopNote(note, stopId: stop.id, trailId: trail.id)
        case .connection(let connection):
            saved = try service.updateConnectionNote(note, connectionId: connection.id, trailId: trail.id)
        case .recap:
            saved = try service.updateRecap(note, trailId: trail.id, at: StudyTrailView.now())
        }
        guard saved else { throw TrailNoteIssue.unavailable }
        load()
        reloadTrails()
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
                .alert("Couldn’t Save Changes", isPresented: $saveFailed) { Button("OK", role: .cancel) {} }
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
