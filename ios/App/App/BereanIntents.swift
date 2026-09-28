import AppIntents
import UIKit

/// App Intents / Siri Shortcuts (docs/mobile Phase 18, R094). Every intent resolves to a Berean
/// deep link (src/lib/deepLinks.ts) opened in the app, so Shortcuts, Siri and Spotlight actions
/// all take the same route as a tapped link — one router, no duplicated navigation logic.
/// `openAppWhenRun` makes `perform()` run inside the app, where opening the URL hands it to the
/// scene → Capacitor → `appUrlOpen` (iOS 17; `OpenURLIntent` would need iOS 18).
@MainActor
private func openBereanURL(_ string: String) {
    guard let url = URL(string: string) else { return }
    UIApplication.shared.open(url)
}
@available(iOS 17.0, *)
struct OpenScriptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Scripture"
    static var description = IntentDescription("Opens a passage in Berean, e.g. “Genesis 1:1” or “Exodus 20”.")
    static var openAppWhenRun = true

    @Parameter(title: "Reference", requestValueDialog: "Which passage?")
    var reference: String

    func perform() async throws -> some IntentResult {
        let encoded = reference.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? reference
        await openBereanURL("berean://open?ref=\(encoded)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct SearchBereanIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Berean"
    static var description = IntentDescription("Searches every text in Berean for a word or phrase.")
    static var openAppWhenRun = true

    @Parameter(title: "Search for", requestValueDialog: "What do you want to find?")
    var query: String

    func perform() async throws -> some IntentResult {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        await openBereanURL("berean://search?q=\(encoded)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct OpenDailyNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Today's Daily Note"
    static var description = IntentDescription("Opens (or creates) today's daily note in Berean.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        await openBereanURL("berean://daily")
        return .result()
    }
}

@available(iOS 17.0, *)
struct StartReadAloudIntent: AppIntent {
    static var title: LocalizedStringResource = "Read Aloud"
    static var description = IntentDescription("Starts reading a passage aloud in Berean.")
    static var openAppWhenRun = true

    @Parameter(title: "Reference", requestValueDialog: "Which passage should be read?")
    var reference: String

    func perform() async throws -> some IntentResult {
        let encoded = reference.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? reference
        await openBereanURL("berean://open?ref=\(encoded)&play=1")
        return .result()
    }
}

@available(iOS 17.0, *)
struct OpenWorkspaceIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Workspace"
    static var description = IntentDescription("Opens a saved Berean workspace by name.")
    static var openAppWhenRun = true

    @Parameter(title: "Workspace", requestValueDialog: "Which workspace?")
    var name: String

    func perform() async throws -> some IntentResult {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        await openBereanURL("berean://workspace?name=\(encoded)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct BereanShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenScriptureIntent(), phrases: ["Open \(.applicationName) to a passage", "Read a passage in \(.applicationName)"], shortTitle: "Open Scripture", systemImageName: "book")
        AppShortcut(intent: SearchBereanIntent(), phrases: ["Search \(.applicationName)"], shortTitle: "Search", systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenDailyNoteIntent(), phrases: ["Open today's note in \(.applicationName)", "\(.applicationName) daily note"], shortTitle: "Daily Note", systemImageName: "calendar")
        AppShortcut(intent: StartReadAloudIntent(), phrases: ["Read aloud in \(.applicationName)"], shortTitle: "Read Aloud", systemImageName: "speaker.wave.2")
        AppShortcut(intent: OpenWorkspaceIntent(), phrases: ["Open a workspace in \(.applicationName)"], shortTitle: "Workspace", systemImageName: "square.grid.2x2")
    }
}
