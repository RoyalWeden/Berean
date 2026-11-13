import SwiftUI
import BereanReference
import BereanStore

struct StudyTrailView: View {
    @Environment(AppModel.self) private var app
    @State private var trails: [StudyTrailReader.Trail] = []
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            Group {
                if loadFailed {
                    ContentUnavailableView("Couldn’t Load Study Trail", systemImage: "exclamationmark.circle")
                } else if trails.isEmpty {
                    ContentUnavailableView("No Study Trails", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                           description: Text("Saved trails from this library appear here."))
                } else {
                    List(trails) { trail in
                        NavigationLink {
                            StudyTrailStopsView(trail: trail)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(trail.name.isEmpty ? "Untitled Trail" : trail.name)
                                Text("\(trail.stopCount) stops · \(trail.status.capitalized)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Study Trail")
        }
        .task {
            do {
                guard let reader = app.studyTrailReader else { loadFailed = true; return }
                trails = try reader.trails()
                loadFailed = false
            } catch {
                loadFailed = true
            }
        }
    }
}

private struct StudyTrailStopsView: View {
    @Environment(AppModel.self) private var app
    @State private var stops: [StudyTrailReader.Stop] = []
    @State private var loadFailed = false
    let trail: StudyTrailReader.Trail

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
        }
        .navigationTitle(trail.name.isEmpty ? "Untitled Trail" : trail.name)
        .task(id: trail.id) {
            do {
                guard let reader = app.studyTrailReader else { loadFailed = true; return }
                stops = try reader.stops(in: trail.id)
                loadFailed = false
            } catch {
                loadFailed = true
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
