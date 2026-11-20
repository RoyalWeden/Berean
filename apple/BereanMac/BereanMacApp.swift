import SwiftUI
import AppKit
import BereanWorkspace

@main
struct BereanMacApp: App {
    @State private var app = AppModel()
    @FocusedValue(\.bereanStudyWindow) private var isStudyWindow

    init() {
        BereanTips.configure()
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
                .focusedSceneValue(\.bereanStudyWindow, true)
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
        Window("Berean Chat", id: "chat") {
            ChatView().environment(app).defaultAppStorage(UserLibrary.defaults).preferredColorScheme(app.colorScheme)
                .focusedSceneValue(\.bereanStudyWindow, false)
                .frame(minWidth: 620, minHeight: 420)
        }
        .defaultSize(width: 900, height: 640)
        .commandsRemoved() // listed once, with its shortcut, by PresenterCommand
        Window("Presenter", id: "presenter") {
            PresenterView().environment(app).defaultAppStorage(UserLibrary.defaults).preferredColorScheme(app.colorScheme)
                .focusedSceneValue(\.bereanStudyWindow, false)
                .frame(minWidth: 480, minHeight: 320)
        }
        .defaultSize(width: 1000, height: 700)
        .commandsRemoved()
        Settings {
            SettingsView().environment(app).defaultAppStorage(UserLibrary.defaults).preferredColorScheme(app.colorScheme)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Group {
                    Button("New Tab…") { app.showCommandPalette(newTab: true) }.keyboardShortcut("t")
                    Button(app.commandPaletteShown ? "Search Result Actions" : "Open Reference or Search…") {
                        if app.commandPaletteShown {
                            app.commandPaletteActionsRequest += 1
                        } else {
                            app.showCommandPalette()
                        }
                    }.keyboardShortcut("k")
                    Button("Go to Location…") { app.showLocation() }.keyboardShortcut("l")
                    Button("New Note") { app.newNote() }.keyboardShortcut("n", modifiers: [.command, .shift])
                    Button("Today's Note") { app.openTodayDailyNote() }.keyboardShortcut("d", modifiers: [.command, .shift])
                    Button("New Workspace") { app.newWorkspace() }.keyboardShortcut("0", modifiers: [.command, .shift])
                }.disabled(isStudyWindow != true)
            }
            // Close belongs to saveItem. Replace the default command rather than
            // registering a second ⌘W that competes with AppKit's Close Window.
            CommandGroup(replacing: .saveItem) {
                Button(isStudyWindow == true ? "Close Tab" : "Close") {
                    if isStudyWindow == true { app.closeActiveTab() }
                    else { NSApp.keyWindow?.performClose(nil) }
                }.keyboardShortcut("w")
                Button("Close Window") { NSApp.keyWindow?.performClose(nil) }
                    .keyboardShortcut("w", modifiers: [.command, .shift])
            }
            CommandGroup(before: .windowList) {
                PresenterCommand().environment(app)
                Divider()
            }
            CommandGroup(replacing: .importExport) {
                Group {
                    Button("Import Markdown…") { app.importMarkdownFiles() }
                    Button("Import from e-Sword…") { app.eSwordImportShown = true }
                    Divider()
                    Button("New Idiom…") { app.idiomDraft = ("", "") }
                    Button("Export Idioms as PDF…") { app.exportIdioms() }
                    Button("Export Note as Markdown…") { app.exportActiveNote() }.keyboardShortcut("e", modifiers: [.command, .shift])
                        .disabled(app.activeNoteId == nil)
                }.disabled(isStudyWindow != true)
            }
            CommandGroup(before: .toolbar) {
                Group {
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
                }.disabled(isStudyWindow != true)
            }
            CommandMenu("Go") {
                Group {
                    Button("History") { app.openHistory() }.keyboardShortcut("y")
                    Button("Study Trail") { app.showStudyTrail = true }
                    Button("Getting Started Checklist") { app.gettingStartedShown = true }
                    Button("Ask Berean…") { app.askBereanShown = true }
                    Button("Calendar") { app.openCalendar() }
                    Button("Tags") { app.openTags() }
                    Button("PDFs") { app.openPdfLibrary() }
                    Button("YouTube") { app.openYouTube() }
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
                }.disabled(isStudyWindow != true)
            }
        }
    }
}

private struct StudyWindowFocusKey: FocusedValueKey { typealias Value = Bool }
extension FocusedValues {
    var bereanStudyWindow: Bool? {
        get { self[StudyWindowFocusKey.self] }
        set { self[StudyWindowFocusKey.self] = newValue }
    }
}
