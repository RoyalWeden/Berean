import SwiftUI
import BereanCore

/// Original custom themes (lib/customTheme.ts): `customThemes` = [{id, name, basedOn, text,
/// background, accent?, verseNumber?, strongs?}] (#rrggbb), selected as `themePreset =
/// "custom:<id>"`. Stored objects are kept verbatim — edits rewrite only the changed fields.
struct CustomReaderTheme: Identifiable, Equatable {
    var id: String
    var name: String
    var basedOn: String
    var text: String
    var background: String
    var accent: String?

    static let prefix = "custom:"

    init(id: String, name: String, basedOn: String, text: String, background: String, accent: String?) {
        self.id = id; self.name = name; self.basedOn = basedOn; self.text = text; self.background = background; self.accent = accent
    }

    init?(_ v: JSValue) {
        guard let id = v["id"]?.stringValue?.string, let text = v["text"]?.stringValue?.string,
              let bg = v["background"]?.stringValue?.string else { return nil }
        self.init(id: id, name: v["name"]?.stringValue?.string ?? "Custom", basedOn: v["basedOn"]?.stringValue?.string ?? "",
                  text: text, background: bg, accent: v["accent"]?.stringValue?.string)
    }

    /// "#rrggbb" ⇄ "r g b".
    static func triple(_ hex: String) -> String? {
        let h = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard h.count == 6, let n = Int(h, radix: 16) else { return nil }
        return "\((n >> 16) & 255) \((n >> 8) & 255) \(n & 255)"
    }
    static func hex(_ triple: String) -> String {
        let p = triple.split(separator: " ").compactMap { Int($0) }
        guard p.count == 3 else { return "#000000" }
        return String(format: "#%02x%02x%02x", p[0], p[1], p[2])
    }
    static func hex(_ color: Color) -> String {
        #if os(macOS)
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .black
        return String(format: "#%02x%02x%02x", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
        #else
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int(round(r * 255)), Int(round(g * 255)), Int(round(b * 255)))
        #endif
    }

    /// A custom theme has one palette (the original resolves it once); used in light and dark.
    var asReaderTheme: ReaderTheme? {
        guard let bg = Self.triple(background), let text = Self.triple(text) else { return nil }
        let accent = accent.flatMap(Self.triple) ?? ReaderTheme.find(basedOn)?.light.accent ?? "80 100 200"
        let p = ReaderTheme.Palette(bg, accent, text)
        return ReaderTheme(id: Self.prefix + id, label: name, family: "Custom", dark: p, light: p)
    }
}

extension AppModel {
    var customThemesRaw: [JSValue] {
        _ = customThemesRevision
        return settingValue("customThemes")?.arrayValue ?? []
    }
    var customThemes: [CustomReaderTheme] { customThemesRaw.compactMap(CustomReaderTheme.init) }

    /// The reading theme in effect: a preset, a custom theme, or nil (Default).
    var activeReaderTheme: ReaderTheme? {
        if themePreset.hasPrefix(CustomReaderTheme.prefix) {
            let id = String(themePreset.dropFirst(CustomReaderTheme.prefix.count))
            return customThemes.first { $0.id == id }?.asReaderTheme
        }
        return ReaderTheme.find(themePreset)
    }

    private func saveCustomThemes(_ raw: [JSValue]) {
        saveSetting("customThemes", .array(raw))
        customThemesRevision += 1
    }

    /// Original "Customize": a NEW custom theme from the current preset's resolved colours.
    @discardableResult
    func createCustomTheme(from base: ReaderTheme?, dark: Bool, name: String? = nil) -> String {
        let id = AppModel.newId()
        let palette = (base ?? ReaderTheme.presets[0]).palette(dark: dark)
        var o = JSObject()
        o["id"] = .string(JSString(id))
        o["name"] = .string(JSString(name ?? "\((base?.label ?? "Default")) (custom)"))
        o["basedOn"] = .string(JSString(base.map { $0.id.hasPrefix(CustomReaderTheme.prefix) ? "" : $0.id } ?? ""))
        o["text"] = .string(JSString(CustomReaderTheme.hex(palette.text)))
        o["background"] = .string(JSString(CustomReaderTheme.hex(palette.bg)))
        o["accent"] = .string(JSString(CustomReaderTheme.hex(palette.accent)))
        saveCustomThemes(customThemesRaw.filter { $0["id"]?.stringValue?.string != id } + [.object(o)])
        themePreset = CustomReaderTheme.prefix + id
        return id
    }

    /// Updates fields of one stored theme (unknown fields kept).
    func updateCustomTheme(_ id: String, _ patch: [String: String]) {
        let raw = customThemesRaw.map { v -> JSValue in
            guard var o = v.objectValue, o["id"]?.stringValue?.string == id else { return v }
            for (k, value) in patch { o[k] = .string(JSString(value)) }
            return .object(o)
        }
        saveCustomThemes(raw)
    }

    func duplicateCustomTheme(_ id: String) {
        guard let source = customThemes.first(where: { $0.id == id }), let theme = source.asReaderTheme else { return }
        let newId = createCustomTheme(from: theme, dark: false, name: source.name + " copy")
        updateCustomTheme(newId, ["basedOn": source.basedOn])
    }

    /// Original rule: deleting the active custom theme falls back to the preset it was based on.
    func deleteCustomTheme(_ id: String) {
        let gone = customThemes.first { $0.id == id }
        saveCustomThemes(customThemesRaw.filter { $0["id"]?.stringValue?.string != id })
        if themePreset == CustomReaderTheme.prefix + id { themePreset = gone?.basedOn ?? "" }
    }
}

/// Settings → Appearance → Custom Themes (original CustomThemesSection).
struct CustomThemesSection: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var scheme
    @State private var editing: String?

    var body: some View {
        Section {
            ForEach(app.customThemes) { theme in
                let active = app.themePreset == CustomReaderTheme.prefix + theme.id
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        if let rt = theme.asReaderTheme { ThemeChip(theme: rt) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(theme.name)
                            Text("Based on \(ReaderTheme.find(theme.basedOn)?.label ?? "Default")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if active { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        Menu("Actions", systemImage: "ellipsis.circle") {
                            Button("Use", systemImage: "checkmark.circle") { app.themePreset = CustomReaderTheme.prefix + theme.id }
                            Button(editing == theme.id ? "Done Editing" : "Edit", systemImage: "slider.horizontal.3") { editing = editing == theme.id ? nil : theme.id }
                            Button("Duplicate", systemImage: "plus.square.on.square") { app.duplicateCustomTheme(theme.id) }
                            Divider()
                            Button("Delete", systemImage: "trash", role: .destructive) { app.deleteCustomTheme(theme.id) }
                        }
                        .labelStyle(.iconOnly).menuIndicator(.hidden).fixedSize()
                    }
                    if editing == theme.id {
                        ThemeNameField(id: theme.id, name: theme.name)
                        ColorPicker("Text", selection: colorBinding(theme, \.text, key: "text"), supportsOpacity: false)
                        ColorPicker("Background", selection: colorBinding(theme, \.background, key: "background"), supportsOpacity: false)
                        ColorPicker("Verse Numbers", selection: Binding(
                            get: { ReaderTheme.color(theme.accent.flatMap(CustomReaderTheme.triple) ?? "80 100 200") },
                            set: { app.updateCustomTheme(theme.id, ["accent": CustomReaderTheme.hex($0)]) }), supportsOpacity: false)
                    }
                }
            }
            Button("New Custom Theme", systemImage: "plus") {
                let id = app.createCustomTheme(from: app.activeReaderTheme, dark: scheme == .dark)
                editing = id
            }
        } header: { Text("Custom Themes") } footer: {
            Text("Starts from the reading theme you're using. Custom themes stay on this device.")
        }
    }

    private func colorBinding(_ theme: CustomReaderTheme, _ key: KeyPath<CustomReaderTheme, String>, key field: String) -> Binding<Color> {
        Binding(get: { ReaderTheme.color(CustomReaderTheme.triple(theme[keyPath: key]) ?? "0 0 0") },
                set: { app.updateCustomTheme(theme.id, [field: CustomReaderTheme.hex($0)]) })
    }
}

/// Small page swatch (background + "Aa" in the text colour).
struct ThemeChip: View {
    @Environment(\.colorScheme) private var scheme
    let theme: ReaderTheme
    var body: some View {
        let p = theme.palette(dark: scheme == .dark)
        RoundedRectangle(cornerRadius: 4)
            .fill(ReaderTheme.color(p.bg))
            .overlay { Text("Aa").font(.system(size: 9, weight: .semibold)).foregroundStyle(ReaderTheme.color(p.text)) }
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(.secondary.opacity(0.4)) }
            .frame(width: 22, height: 16)
    }
}

/// The name field keeps its own draft and saves on Return / end of editing — saving every
/// keystroke redrew the list and dropped focus after one character.
private struct ThemeNameField: View {
    @Environment(AppModel.self) private var app
    let id: String
    let name: String
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("Name", text: $draft)
            .focused($focused)
            .onAppear { draft = name }
            .onSubmit(commit)
            .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
            .onDisappear(perform: commit)
    }

    private func commit() {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != name else { return }
        app.updateCustomTheme(id, ["name": trimmed])
    }
}
