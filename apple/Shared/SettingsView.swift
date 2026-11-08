import SwiftUI

/// Native Settings (Mac Settings window / iPhone sheet): reading preferences stored in the settings table.
struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        Form {
            Section("Reading") {
                Picker("Default text", selection: $app.defaultText) { ForEach(availableTexts) { Text($0.name).tag($0.id) } }
                LabeledContent("Text size") {
                    HStack { Slider(value: $app.fontSize, in: 12...30, step: 1).frame(minWidth: 160); Text("\(Int(app.fontSize)) pt").monospacedDigit().frame(width: 48, alignment: .trailing) }
                }
                Picker("Line spacing", selection: $app.lineHeight) { Text("Compact").tag("compact"); Text("Comfortable").tag("comfortable"); Text("Spacious").tag("spacious") }
                Toggle("Word Replacer (Yehovah, Yeshua, …)", isOn: $app.wordReplacerEnabled)
            }
            Section("Appearance") {
                Picker("Theme", selection: $app.theme) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented)
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

extension AppModel {
    var colorScheme: ColorScheme? { theme == "light" ? .light : theme == "dark" ? .dark : nil }
}
