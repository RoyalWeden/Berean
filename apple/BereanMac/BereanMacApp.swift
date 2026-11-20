import SwiftUI
import BereanWorkspace

@main
struct BereanMacApp: App {
    @State private var app = AppModel()

    init() {
        #if DEBUG
        NativeCursorDiagnostics.installIfRequested()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            MacRootView()
                .environment(app)
                .defaultAppStorage(UserLibrary.defaults)
                .preferredColorScheme(app.colorScheme)
                .frame(minWidth: MacLayoutLimits.windowMinimum, minHeight: 520)
                .onOpenURL(perform: app.openNativeDevURL)
                .sheet(isPresented: Binding(get: { app.idiomDraft != nil }, set: { if !$0 { app.idiomDraft = nil } })) {
                    NewIdiomSheet(term: app.idiomDraft?.term ?? "", meaning: app.idiomDraft?.meaning ?? "").environment(app)
                }
                .sheet(isPresented: Binding(get: { app.eSwordImportShown }, set: { app.eSwordImportShown = $0 })) {
                    ESwordImportView().environment(app)
                }
                .sheet(isPresented: Binding(get: { app.onboardingShown }, set: { if !$0 { app.completeOnboarding() } })) {
                    OnboardingView().environment(app)
                }
        }
        .windowResizability(.contentMinSize)
        Settings {
            SettingsView().environment(app).defaultAppStorage(UserLibrary.defaults).preferredColorScheme(app.colorScheme)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("New Tab…") { app.showCommandPalette(newTab: true) }.keyboardShortcut("t")
                Button(app.commandPaletteShown ? "Search Result Actions" : "Open Reference or Search…") {
                    if app.commandPaletteShown {
                        app.commandPaletteActionsRequest += 1
                    } else {
                        app.showCommandPalette()
                    }
                }.keyboardShortcut("k")
                Button("Go to Location…") { app.showLocation() }.keyboardShortcut("l")
                Button("Close Tab") { app.closeActiveTab() }.keyboardShortcut("w")
                Button("New Note") { app.newNote() }.keyboardShortcut("n", modifiers: [.command, .shift])
                Button("Today's Note") { app.openTodayDailyNote() }.keyboardShortcut("d", modifiers: [.command, .shift])
                Button("New Workspace") { app.newWorkspace() }.keyboardShortcut("0", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .importExport) {
                Button("Import Markdown…") { app.importMarkdownFiles() }
                Button("Import from e-Sword…") { app.eSwordImportShown = true }
                Divider()
                Button("New Idiom…") { app.idiomDraft = ("", "") }
                Button("Export Idioms as PDF…") { app.exportIdioms() }
                Button("Export Note as Markdown…") { app.exportActiveNote() }.keyboardShortcut("e", modifiers: [.command, .shift])
                    .disabled(app.activeNoteId == nil)
            }
            CommandGroup(before: .toolbar) {
                Button("Increase Scripture Text Size") {
                    app.fontSize = ScriptureTextSize.clamped(app.fontSize + 1)
                }
                .keyboardShortcut("=")
                .disabled(app.fontSize >= ScriptureTextSize.range.upperBound)
                Button("Decrease Scripture Text Size") {
                    app.fontSize = ScriptureTextSize.clamped(app.fontSize - 1)
                }
                .keyboardShortcut("-")
                .disabled(app.fontSize <= ScriptureTextSize.range.lowerBound)
                Button("Reset Scripture Text Size") { app.fontSize = ScriptureTextSize.standard }
                    .keyboardShortcut("0")
                    .disabled(app.fontSize == ScriptureTextSize.standard)
                Divider()
                Button("Toggle Sidebar") { app.sidebarToggleRequest += 1 }.keyboardShortcut("s", modifiers: [.command, .control])
                Toggle("Compare Texts", isOn: Binding(get: { app.activeReaderState?.compareMode ?? false },
                                                     set: { app.setReaderCompareMode($0) }))
                    .keyboardShortcut("c", modifiers: [.command, .option])
                    .disabled(app.activeReaderState == nil)
                Toggle("Study Panel", isOn: Binding(get: { app.activeReaderState?.rightPanelOpen ?? false },
                                                   set: { app.setReaderStudyPanelOpen($0) }))
                    .keyboardShortcut("i", modifiers: [.command, .option])
                    .disabled(app.activeReaderState == nil)
            }
            CommandMenu("Go") {
                Button("History") { app.openHistory() }.keyboardShortcut("y")
                Button("Study Trail") { app.showStudyTrail = true }
                Button("Calendar") { app.openCalendar() }
                Button("Tags") { app.openTags() }
                Button("PDFs") { app.openPdfLibrary() }
                Divider()
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
