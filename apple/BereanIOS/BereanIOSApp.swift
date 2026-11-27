import SwiftUI
import CoreSpotlight

@main
struct BereanIOSApp: App {
    init() { BereanTips.configure() }
    @State private var app = AppModel()

    private struct IndexedWorkspace: Equatable {
        let id: String
        let name: String
        let tabTitles: [String]
    }
    private var indexedWorkspaces: [IndexedWorkspace] {
        app.sessions.map { IndexedWorkspace(id: $0.id, name: $0.name, tabTitles: $0.allTabs.map(\.title)) }
    }

    var body: some Scene {
        WindowGroup {
            IOSRootView().environment(app).preferredColorScheme(app.colorScheme)
                .onOpenURL { url in
                    // Close whatever sheet is up first, so the destination isn't left behind it.
                    NotificationCenter.default.post(name: .bereanExternalRoute, object: nil)
                    app.openNativeDevURL(url)
                }
                // Spotlight result → its deep link (SpotlightIndex).
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, let url = URL(string: id) {
                        NotificationCenter.default.post(name: .bereanExternalRoute, object: nil)
                        app.openNativeDevURL(url)
                    }
                }
                .task {
                    SpotlightIndex.refresh(app)
                    #if DEBUG
                    SpotlightIndex.selfTestIfRequested()
                    #endif
                }
                .onChange(of: app.notesRevision) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: app.savedWorkspaces.count) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: app.defaultText) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: indexedWorkspaces) { SpotlightIndex.scheduleRefresh(app) }
        }
    }
}


extension Notification.Name {
    /// An external link (URL, Spotlight) is about to route; presented sheets should close first.
    static let bereanExternalRoute = Notification.Name("berean.externalRoute")
}
