import AppIntents
import BereanReference
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// App Intents / Siri Shortcuts — the original iPhone set (ios/App/App/BereanIntents.swift):
/// each intent opens a Berean deep link in this app, so Shortcuts, Siri and Spotlight take the
/// same route as a tapped link. The native build uses its own scheme (`berean-native-dev`), so an
/// intent never launches the existing Berean apps. Read Aloud is omitted until native speech exists.
@MainActor
func openNativeBereanRoute(_ route: String) {
    guard let url = URL(string: "\(DeepLink.nativeDevScheme)://\(route)") else { return }
    #if os(macOS)
    NSWorkspace.shared.open(url)
    #else
    UIApplication.shared.open(url)
    #endif
}

private func encoded(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s }

struct OpenScriptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Scripture"
    static let description = IntentDescription("Opens a passage in Berean, e.g. “Genesis 1:1” or “Exodus 20”.")
    static let openAppWhenRun = true
    @Parameter(title: "Reference", requestValueDialog: "Which passage?") var reference: String
    @MainActor func perform() async throws -> some IntentResult {
        openNativeBereanRoute("open?ref=\(encoded(reference))")
        return .result()
    }
}

struct SearchBereanIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Berean"
    static let description = IntentDescription("Searches every text in Berean for a word or phrase.")
    static let openAppWhenRun = true
    @Parameter(title: "Search for", requestValueDialog: "What do you want to find?") var query: String
    @MainActor func perform() async throws -> some IntentResult {
        openNativeBereanRoute("search?q=\(encoded(query))")
        return .result()
    }
}

struct OpenDailyNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Today's Daily Note"
    static let description = IntentDescription("Opens (or creates) today's daily note in Berean.")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        openNativeBereanRoute("daily")
        return .result()
    }
}

struct OpenWorkspaceIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Workspace"
    static let description = IntentDescription("Opens one of your saved Berean workspaces by name.")
    static let openAppWhenRun = true
    @Parameter(title: "Workspace", requestValueDialog: "Which workspace?") var name: String
    @MainActor func perform() async throws -> some IntentResult {
        openNativeBereanRoute("workspace?name=\(encoded(name))")
        return .result()
    }
}

struct BereanShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenScriptureIntent(), phrases: ["Open \(.applicationName) to a passage", "Read a passage in \(.applicationName)"],
                    shortTitle: "Open Scripture", systemImageName: "book")
        AppShortcut(intent: SearchBereanIntent(), phrases: ["Search \(.applicationName)"], shortTitle: "Search", systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenDailyNoteIntent(), phrases: ["Open today's note in \(.applicationName)", "\(.applicationName) daily note"],
                    shortTitle: "Daily Note", systemImageName: "calendar")
        AppShortcut(intent: OpenWorkspaceIntent(), phrases: ["Open a workspace in \(.applicationName)"], shortTitle: "Workspace", systemImageName: "square.grid.2x2")
    }
}
