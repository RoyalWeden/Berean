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
    @State private var shortcutQuery = ""
    @State private var showsWordReplacer = false

    var body: some View {
        settingsContent.sheet(isPresented: $showsWordReplacer) {
            WordReplacerSettingsView()
        }
    }

    @ViewBuilder private var settingsContent: some View {
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
            Section {
                NavigationLink {
                    Form { readingSection }.formStyle(.grouped).navigationTitle("Reading")
                } label: { Label("Reading", systemImage: "book") }
                NavigationLink {
                    Form {
                        appearanceSection
                        Section {
                            Toggle("Haptic Feedback", isOn: $hapticsEnabled)
                        } footer: {
                            Text("A light tap when you select verses or turn the chapter.")
                        }
                    }
                    .formStyle(.grouped).navigationTitle("Appearance")
                } label: { Label("Appearance", systemImage: "paintbrush") }
                NavigationLink {
                    Form { notesSection }.formStyle(.grouped).navigationTitle("Notes")
                } label: { Label("Notes", systemImage: "note.text") }
            }
            Section {
                NavigationLink {
                    Form { WorkspacesSettingsSection() }.formStyle(.grouped).navigationTitle("Workspaces")
                } label: { Label("Workspaces", systemImage: "square.stack") }
                NavigationLink {
                    Form { shortcutsSection }.formStyle(.grouped).navigationTitle("Shortcuts")
                } label: { Label("Shortcuts", systemImage: "keyboard") }
                NavigationLink {
                    Form { aboutSections }.formStyle(.grouped).navigationTitle("About")
                } label: { Label("About", systemImage: "info.circle") }
            }
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
            Toggle("Copy Verses When Highlighting", isOn: $app.autoCopyOnHighlight)
            LabeledContent("Word Replacer") {
                HStack(spacing: 12) {
                    Toggle("Word Replacer", isOn: $app.wordReplacerEnabled).labelsHidden()
                    Button("Rules…") { showsWordReplacer = true }
                        .help("Browse name replacements and Strong’s-based rules")
                }
            }
            #if os(macOS)
            Toggle("Underline Idioms in Scripture", isOn: $app.idiomHighlightEnabled)
                .help("Terms from your idiom notes get a dotted underline; hover for the meaning, click to open the note")
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
        @Bindable var app = app
        return Section {
            Picker("Notes Font", selection: $app.notesFontFamily) {
                ForEach(ScriptureFont.options, id: \.id) { Text($0.label).tag($0.id) }
                if !ScriptureFont.options.contains(where: { $0.id == app.notesFontFamily }) {
                    Text(app.notesFontFamily.capitalized).tag(app.notesFontFamily)
                }
            }
            Toggle("Detect Scripture References", isOn: $app.noteVerseRefsEnabled)
            Toggle("Detect Strong’s References", isOn: $app.noteLexiconRefsEnabled)
            Toggle("Suggest Scripture Blocks", isOn: $app.noteVerseBlockSuggest)
            Toggle("Suggest Strong’s Blocks", isOn: $app.noteStrongsBlockSuggest)
            Toggle("Format Scripture Blocks", isOn: $app.noteScriptureBlock)
                .help("Recognize pasted passages without changing their saved text")
            if app.noteScriptureBlock {
                LabeledContent("Text Match") {
                    Slider(value: $app.noteScriptureBlockThreshold, in: 0...1, step: 0.05)
                        .frame(maxWidth: 180)
                        .accessibilityLabel("Scripture block text match")
                    Text(app.noteScriptureBlockThreshold, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit().foregroundStyle(.secondary)
                        .frame(minWidth: 40, alignment: .trailing)
                }
                .help("How closely a pasted passage must match its Scripture text; 90% is the default")
            }
            Toggle("Check Spelling", isOn: $app.noteSpellCheck)
            Toggle("Confirm Before Moving Notes to Trash", isOn: $app.confirmNoteDelete)
            Toggle("Typing -- makes an em dash (—)", isOn: $autoEmDash)
            Picker("Default Status for New Notes", selection: $app.defaultNoteStatus) {
                Text("No Status").tag("none")
                ForEach(NotesHomeView.statuses, id: \.id) { status in
                    Text(status.label).tag(status.id)
                }
                if app.defaultNoteStatus != "none",
                   !NotesHomeView.statuses.contains(where: { $0.id == app.defaultNoteStatus }) {
                    Text(app.defaultNoteStatus).tag(app.defaultNoteStatus)
                }
            }
        } header: { Text("Notes") }
    }

    private var matchingShortcuts: [(String, String)] {
        let terms = shortcutQuery.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return Self.shortcuts }
        return Self.shortcuts.filter { keys, title in
            let readable = keys.replacingOccurrences(of: "⌘", with: " command cmd ")
                .replacingOccurrences(of: "⌥", with: " option alt ")
                .replacingOccurrences(of: "⌃", with: " control ctrl ")
                .replacingOccurrences(of: "⇧", with: " shift ")
            let searchable = title + " " + keys + " " + readable
            return terms.allSatisfy { searchable.localizedStandardContains($0) }
        }
    }

    @ViewBuilder private var shortcutsSection: some View {
        Section {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search shortcuts", text: $shortcutQuery)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                if !shortcutQuery.isEmpty {
                    Button("Clear Search", systemImage: "xmark.circle.fill") { shortcutQuery = "" }
                        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .contain)
        }
        Section("Keyboard Shortcuts") {
            if matchingShortcuts.isEmpty {
                ContentUnavailableView.search(text: shortcutQuery)
            } else {
                ForEach(matchingShortcuts, id: \.0) { keys, title in
                    LabeledContent(title) { Text(keys).font(.body.monospaced()).foregroundStyle(.secondary) }
                }
            }
        }
    }

    @ViewBuilder private var aboutSections: some View {
        Section("About") {
            LabeledContent("Version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "–") + " (native development build)")
            LabeledContent("Texts", value: "\(availableTexts.count) installed")
            Button("Replay Getting Started") { app.replayOnboarding() }
            Button("Getting Started Checklist…") { app.gettingStartedShown = true }
            Button("Reset Hints") {
                BereanTips.reset()
                app.userMessage = "Hints will show again the next time Berean opens."
            }
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

    @AppStorage("chapterPullNavigation") private var chapterPullNavigation = true

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
        Toggle("Pull to Change Chapters", isOn: $chapterPullNavigation)
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
        ("⌘T", "New tab"), ("⌘K", "Search Berean"), ("⌘L", "Change current tab"), ("⌘W", "Close tab"), ("⌘[  ⌘]", "Back · Forward"),
        ("⌥⌘←  ⌥⌘→", "Previous · next chapter"), ("⌘F  ⌘G", "Find in chapter · next match"), ("⌘C  ⇧⌘C", "Copy with reference · plain text"),
        ("⌥⌘C", "Compare texts"), ("⌥⌘I", "Study panel"), ("⇧⌘N", "New note"), ("⇧⌘D", "Today's note"), ("⌘Y", "History"),
        ("⇧⌘0", "New workspace"), ("⌃⌘S", "Show / hide sidebar"), ("⌘1 … ⌘5", "Spaces"), ("⌃Tab", "Next tab"),
        ("⌘B  ⌘I  ⌘U", "Bold · italic · underline (notes)"), ("⇧⌘X", "Strikethrough (notes)"), ("⇧⌘H", "Highlight (notes)"),
        ("⌥⌘1 … ⌥⌘3  ⌥⌘0", "Heading level · body text (notes)"), ("⇧⌘E", "Export note as Markdown"),
        ("⌥⇧⌘C", "Copy note text without formatting"), ("⌘=  ⌘−  ⌘0", "Scripture text size · reset"),
        ("⇧⌘B", "Presenter window"), ("⇧⌘P", "YouTube Picture in Picture"), ("⌃⌘C", "Berean Chat"), ("⌘↩", "Send chat note"), ("⇧⌃Tab", "Previous tab"),
    ]
}

extension AppModel {
    var colorScheme: ColorScheme? { theme == "light" ? .light : theme == "dark" ? .dark : nil }
}

/// A searchable reference for the reader’s current bundled substitutions.
/// Per-rule switches persist to `wordReplacerRules` (the original apps' array; unknown fields and
/// custom rules are preserved) and every reader/search/preview/copy consumer reads that one set.
private struct WordReplacerSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var matchingRules: [WordReplacerRule] {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        return app.wordReplacerRules.filter { rule in
            let searchable = ([rule.replacement, rule.strongsNum ?? ""] + rule.queries).joined(separator: " ")
            return terms.allSatisfy { searchable.localizedStandardContains($0) }
        }
    }

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Form {
                Section {
                    Toggle("Word Replacer", isOn: $app.wordReplacerEnabled)
                } footer: {
                    Text("Restore names while reading Scripture. The original text is preserved.")
                }
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Find a name or Strong’s number", text: $query)
                            .textFieldStyle(.plain).autocorrectionDisabled()
                        if !query.isEmpty {
                            Button("Clear Search", systemImage: "xmark.circle.fill") { query = "" }
                                .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                        }
                    }
                }
                let rules = matchingRules
                if rules.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    ruleSection("Divine Names", rules: rules.filter { $0.strongsNum != nil })
                    ruleSection("Names and Phrases", rules: rules.filter { $0.strongsNum == nil })
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Word Replacer")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Turn All On") { app.wordReplacerRuleSet.enableAll() }
                        .disabled(!app.wordReplacerEnabled || app.wordReplacerRules.allSatisfy(\.enabled))
                }
            }
        }
        #if os(macOS)
        .frame(width: 550, height: 620)
        #endif
    }

    @ViewBuilder private func ruleSection(_ title: String, rules: [WordReplacerRule]) -> some View {
        if !rules.isEmpty {
            Section(title) {
                ForEach(rules) { rule in
                    Toggle(isOn: Binding(get: { rule.enabled },
                                         set: { app.wordReplacerRuleSet.setEnabled(rule.id, $0) })) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(rule.strongsNum ?? rule.queries.joined(separator: " / "))
                                .foregroundStyle(.secondary)
                            Image(systemName: "arrow.right").font(.caption).foregroundStyle(.tertiary)
                            Text(rule.replacement).fontWeight(.medium)
                        }
                        if rule.strongsNum != nil {
                            Text("KJV + Apocrypha · matched by Strong’s number")
                                .font(.caption).foregroundStyle(.secondary)
                        } else if rule.wholeWord {
                            Text("Whole words").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(rule.enabled && app.wordReplacerEnabled ? 1 : 0.55)
                    }
                    .disabled(!app.wordReplacerEnabled)
                    .accessibilityLabel("\(rule.strongsNum ?? rule.queries.joined(separator: ", ")) to \(rule.replacement)")
                }
            }
        }
    }
}
