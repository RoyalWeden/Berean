import SwiftUI
import BereanWorkspace

@main
struct BereanMacApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            MacRootView()
                .environment(app)
                .preferredColorScheme(app.colorScheme)
                .frame(minWidth: 820, minHeight: 520)
        }
        Settings {
            SettingsView().environment(app).preferredColorScheme(app.colorScheme)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("New Tab…") { app.commandPaletteShown = true }.keyboardShortcut("t")
                Button("Open Reference or Search…") { app.commandPaletteShown = true }.keyboardShortcut("k")
                Button("Close Tab") { app.closeActiveTab() }.keyboardShortcut("w")
                Button("New Note") { app.newNote() }.keyboardShortcut("n", modifiers: [.command, .shift])
                Button("New Session") { app.newSession() }.keyboardShortcut("n", modifiers: [.command, .shift, .option])
            }
            CommandGroup(replacing: .importExport) {
                Button("Import Markdown…") { app.importMarkdownFiles() }
                Button("Export Note as Markdown…") { app.exportActiveNote() }.keyboardShortcut("e", modifiers: [.command, .shift])
                    .disabled(app.activeNoteId == nil)
            }
            CommandMenu("Go") {
                Button("Back") { app.goBack() }.keyboardShortcut("[").disabled(!app.canGoBack)
                Button("Forward") { app.goForward() }.keyboardShortcut("]").disabled(!app.canGoForward)
                Divider()
                ForEach(Array(SpaceId.allCases.enumerated()), id: \.offset) { i, space in
                    Button(space.title) { app.activeSpace = space }.keyboardShortcut(KeyEquivalent(Character("\(i + 1)")))
                }
                Divider()
                Button("Next Tab") { app.selectNextTab(1) }.keyboardShortcut(.tab, modifiers: .control)
                Button("Previous Tab") { app.selectNextTab(-1) }.keyboardShortcut(.tab, modifiers: [.control, .shift])
            }
        }
    }
}
