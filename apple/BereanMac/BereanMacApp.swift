import SwiftUI

@main
struct BereanMacApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack { ReaderView() }
                .frame(minWidth: 480, minHeight: 320)
        }
    }
}
