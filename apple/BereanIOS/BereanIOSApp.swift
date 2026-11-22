import SwiftUI
import CoreSpotlight

@main
struct BereanIOSApp: App {
    init() { BereanTips.configure() }
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            IOSRootView().environment(app).preferredColorScheme(app.colorScheme)
                .onOpenURL(perform: app.openNativeDevURL)
                // Spotlight result → its deep link (SpotlightIndex).
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, let url = URL(string: id) {
                        app.openNativeDevURL(url)
                    }
                }
                .task { SpotlightIndex.refresh(app) }
                .onChange(of: app.notesRevision) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: app.savedWorkspaces.count) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: app.defaultText) { SpotlightIndex.scheduleRefresh(app) }
                .onChange(of: app.sessions.map(\.name)) { SpotlightIndex.scheduleRefresh(app) }
        }
    }
}
