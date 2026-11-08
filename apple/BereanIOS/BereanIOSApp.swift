import SwiftUI

@main
struct BereanIOSApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            IOSRootView().environment(app)
        }
    }
}
