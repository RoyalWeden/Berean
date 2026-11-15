import SwiftUI
import BereanWorkspace
import BereanReference
import BereanText
import BereanCore

/// Native Settings (Mac Settings window / iPhone sheet): reading preferences stored in the settings table.
struct SettingsView: View {
    @Environment(AppModel.self) private var app

    /// Same key as the original iPhone app's haptics switch (device-local).
    @AppStorage("berean.haptics.enabled") private var hapticsEnabled = true
    @AppStorage("berean.notes.autoEmDash") private var autoEmDash = true
    @AppStorage("defaultScriptureLayout") private var defaultLayout = "standard"

    var body: some View {
        #if os(macOS)
        // macOS Settings window: a toolbar of panes, as in Apple's own apps.
        TabView {
            Tab("Reading", systemImage: "book") { pane { readingSection } }
            Tab("Appearance", systemImage: "paintbrush") { pane { appearanceSection } }
            Tab("Notes", systemImage: "note.text") { pane { notesSection } }
            Tab("Workspaces", systemImage: "square.stack") { pane { WorkspacesSettingsSection() } }
            Tab("Shortcuts", systemImage: "keyboard") { pane { shortcutsSection } }
            Tab("About", systemImage: "info.circle") { pane { aboutSections } }
        }
        .frame(width: 560)
        .frame(minHeight: 540)
        #else
        Form {
            readingSection
            appearanceSection
            notesSection
            Section {
                Toggle("Haptic Feedback", isOn: $hapticsEnabled)
            } footer: {
                Text("A light tap when you select verses or turn the chapter.")
            }
            WorkspacesSettingsSection()
            shortcutsSection
            aboutSections
        }
        .formStyle(.grouped)
        #endif
    }

    private func pane<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Form { content() }.formStyle(.grouped).scrollContentBackground(.hidden)
    }

    @ViewBuilder private var readingSection: some View {
        @Bindable var app = app
        Section("Reading") {
            Picker("Default text", selection: $app.defaultText) { ForEach(availableTexts) { Text($0.name).tag($0.id) } }
            Picker("Shepherd of Hermas edition", selection: $app.hermasEdition) {
                Text("Charles Taylor (1903)").tag(HermasText.taylor)
                Text("Roberts–Donaldson").tag(HermasText.robertsDonaldson)
            }
            ScriptureDisplayOptions()
            Toggle("Word Replacer (Yehovah, Yeshua, …)", isOn: $app.wordReplacerEnabled)
            #if os(macOS)
            Picker("Layout for new Scripture tabs", selection: $defaultLayout) {
                ForEach(ScriptureLayout.allCases) { Text($0.title).tag($0.rawValue) }
            }
            .clickableCursor()
            #endif
        }
    }

    @ViewBuilder private var appearanceSection: some View {
        @Bindable var app = app
        Section("Appearance") {
            Picker("Theme", selection: $app.theme) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented).clickableCursor()
        }
    }

    private var notesSection: some View {
        Section {
            Toggle("Typing -- makes an em dash (—)", isOn: $autoEmDash)
        } header: { Text("Notes") }
    }

    private var shortcutsSection: some View {
        Section("Keyboard Shortcuts") {
            ForEach(Self.shortcuts, id: \.0) { k, v in LabeledContent(v) { Text(k).font(.body.monospaced()).foregroundStyle(.secondary) } }
        }
    }

    @ViewBuilder private var aboutSections: some View {
        Section("About") {
            LabeledContent("Version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "–") + " (native development build)")
            LabeledContent("Texts", value: "\(availableTexts.count) installed")
        }
        Section("Library") {
            LabeledContent("Location", value: UserLibrary.directory.path).textSelection(.enabled)
            Text("Development build — this library is separate from your Berean data and does not sync yet.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct ScriptureDisplayOptions: View {
    @Environment(AppModel.self) private var app
    @AppStorage("scriptureWidth") private var scriptureWidth = ScriptureWidth.normal
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("showRedLetters") private var showRedLetters = true

    var body: some View {
        @Bindable var app = app
        LabeledContent("Text size") {
            HStack {
                Slider(value: $app.fontSize, in: ScriptureTextSize.range, step: 1) {
                    Text("Text size")
                }
                .labelsHidden()
                Text("\(Int(app.fontSize)) pt")
                    .monospacedDigit()
                    .fixedSize()
            }
        }
        Picker("Scripture font", selection: $app.scriptureFontFamily) {
            ForEach(ScriptureFont.options, id: \.id) { Text($0.label).tag($0.id) }
        }
        Picker("Line spacing", selection: $app.lineHeight) {
            Text("Compact").tag("compact")
            Text("Comfortable").tag("comfortable")
            Text("Spacious").tag("spacious")
        }
        Picker("Text width", selection: $scriptureWidth) {
            ForEach(ScriptureWidth.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        Toggle("Verse numbers", isOn: $showVerseNumbers)
        Toggle("Words of Yeshua in red", isOn: $showRedLetters)
    }
}

/// The current reader tab's annotation key with Hide toggles (original: BiblePanel annotation key / Settings → Display).
struct ScriptureAnnotationOptions: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let tab = app.activeTab, tab.tabType == .bible {
            let state = BibleState(tab.state)
            let editions = state.compareMode ? CompareColumn.resolved(in: tab.state).map(\.text) : [state.translation]
            let annotatedEditions = Array(Set(editions)).sorted().filter { AnnotationFilters.keys[$0] != nil }
            let hidden = Set((tab.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string })
            ForEach(annotatedEditions, id: \.self) { textId in
                let keys = AnnotationFilters.keys[textId] ?? []
                Section {
                    ForEach(keys) { key in
                        Toggle(isOn: Binding(get: { !hidden.contains(key.id) }, set: { show in
                            var next = hidden
                            if show { next.remove(key.id) } else { next.insert(key.id) }
                            app.update(tab.id, recordHistory: false) {
                                $0.state["hiddenAnnotations"] = .array(next.sorted().map { .string(JSString($0)) })
                            }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(key.symbol).font(.body.monospaced())
                                Text(key.meaning).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .clickableCursor()
                    }
                } header: {
                    Text("Annotations · \(textInfo(textId).short)")
                } footer: {
                    Text("Turn a marker off to hide it in this tab.")
                }
            }
        }
    }
}

/// Saved workspaces: open, rename, delete (saving happens from the session menu).
struct WorkspacesSettingsSection: View {
    @Environment(AppModel.self) private var app
    @State private var renaming: SavedWorkspace?
    @State private var name = ""
    @State private var deleting: SavedWorkspace?

    var body: some View {
        Section("Workspaces") {
            if app.savedWorkspaces.isEmpty {
                Text("No saved workspaces yet. Use Save Snapshot… in the workspace menu at the top of the sidebar.").foregroundStyle(.secondary)
            }
            ForEach(app.savedWorkspaces) { w in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.name)
                        Text(Date(timeIntervalSince1970: Double(w.createdAt) / 1000), format: .dateTime.year().month().day())
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Open") { app.openWorkspace(w.id) }
                    Menu {
                        Button("Rename…") { name = w.name; renaming = w }
                        Button("Delete…", role: .destructive) { deleting = w }
                    } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More for \(w.name)").clickableCursor()
                }
            }
        }
        .alert("Rename Workspace", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let w = renaming { app.renameWorkspace(w.id, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Delete \(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete Workspace", role: .destructive) { if let w = deleting { app.deleteWorkspace(w.id) }; deleting = nil }
        } message: { Text("Open workspaces are not affected.") }
    }
}

extension SettingsView {
    static let shortcuts: [(String, String)] = [
        ("⌘T / ⌘K", "New tab · search Berean"), ("⌘L", "Go to passage"), ("⌘W", "Close tab"), ("⌘[  ⌘]", "Back · Forward"),
        ("⌥⌘←  ⌥⌘→", "Previous · next chapter"), ("⌘F  ⌘G", "Find in chapter · next match"), ("⌘C  ⇧⌘C", "Copy with reference · plain text"),
        ("⌥⌘C", "Compare texts"), ("⌥⌘I", "Study panel"), ("⇧⌘N", "New note"), ("⇧⌘D", "Today's note"), ("⌘Y", "History"),
        ("⇧⌘0", "New workspace"), ("⌃⌘S", "Show / hide sidebar"), ("⌘1 … ⌘5", "Spaces"), ("⌃Tab", "Next tab"),
        ("⌘B  ⌘I  ⌘U", "Bold · italic · underline (notes)"), ("⌥⇧⌘C", "Copy note text without formatting"), ("⇧⌘M", "Show Markdown source"),
    ]
}

extension AppModel {
    var colorScheme: ColorScheme? { theme == "light" ? .light : theme == "dark" ? .dark : nil }
}
