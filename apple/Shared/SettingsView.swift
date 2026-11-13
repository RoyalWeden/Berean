import SwiftUI
import BereanWorkspace

/// Native Settings (Mac Settings window / iPhone sheet): reading preferences stored in the settings table.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    // Device-local reading preferences (the existing apps keep these per device too).
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("showRedLetters") private var showRedLetters = true

    var body: some View {
        @Bindable var app = app
        Form {
            Section("Reading") {
                Picker("Default text", selection: $app.defaultText) { ForEach(availableTexts) { Text($0.name).tag($0.id) } }
                LabeledContent("Text size") {
                    HStack { Slider(value: $app.fontSize, in: 12...30, step: 1).frame(minWidth: 160); Text("\(Int(app.fontSize)) pt").monospacedDigit().frame(width: 48, alignment: .trailing) }
                }
                Picker("Scripture font", selection: $app.scriptureFontFamily) { ForEach(ScriptureFont.options, id: \.id) { Text($0.label).tag($0.id) } }
                Picker("Line spacing", selection: $app.lineHeight) { Text("Compact").tag("compact"); Text("Comfortable").tag("comfortable"); Text("Spacious").tag("spacious") }
                Toggle("Word Replacer (Yehovah, Yeshua, …)", isOn: $app.wordReplacerEnabled)
                Toggle("Verse numbers", isOn: $showVerseNumbers)
                Toggle("Words of Yeshua in red", isOn: $showRedLetters)
            }
            Section("Appearance") {
                Picker("Theme", selection: $app.theme) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented)
            }
            WorkspacesSettingsSection()
            Section("Keyboard Shortcuts") {
                ForEach(Self.shortcuts, id: \.0) { k, v in LabeledContent(v) { Text(k).font(.body.monospaced()).foregroundStyle(.secondary) } }
            }
            Section("About") {
                LabeledContent("Version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "–") + " (native development build)")
                LabeledContent("Texts", value: "\(availableTexts.count) installed")
            }
            Section("Library") {
                LabeledContent("Location", value: UserLibrary.directory.path).textSelection(.enabled)
                Text("Development build — this library is separate from your Berean data and does not sync yet.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 460, minHeight: 360)
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
                Text("No saved workspaces yet. Use Save Session as Workspace… in the session menu.").foregroundStyle(.secondary)
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
                        .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More for \(w.name)")
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
        } message: { Text("Open sessions are not affected.") }
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
