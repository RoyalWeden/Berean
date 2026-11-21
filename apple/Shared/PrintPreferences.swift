import SwiftUI
import BereanCore

/// Original Print & Export settings (store keys `printMarginPreset`, `printCustomMargins`,
/// `printPaperSize`, `printFontSizePt`, `printFontFamily`, `printIncludeTitle`, `printColorMode`),
/// applied by `printMarkup` to every print (notes, idiom reference book).
struct PrintPreferences: Equatable, Sendable {
    var marginPreset = "normal"                  // none | narrow | normal | wide | custom
    var customMargins = (top: 1.0, right: 1.0, bottom: 1.0, left: 1.0)   // inches
    var paperSize = "letter"                     // letter | a4 | legal
    var fontSizePt = 12.0
    var fontFamily = "system"                    // system | serif | sansserif
    var includeTitle = true
    var colorMode = "color"                      // color | grayscale

    static func == (a: Self, b: Self) -> Bool {
        a.marginPreset == b.marginPreset && a.customMargins == b.customMargins && a.paperSize == b.paperSize
            && a.fontSizePt == b.fontSizePt && a.fontFamily == b.fontFamily && a.includeTitle == b.includeTitle && a.colorMode == b.colorMode
    }

    /// The original presets (PRINT_PRESETS) and margin table (MARGIN_INCHES).
    static let presets: [(id: String, label: String, detail: String, margin: String, size: Double, family: String)] = [
        ("compact", "Compact", "Narrow margins, 10pt sans — fit more per page", "narrow", 10, "sansserif"),
        ("standard", "Standard", "Normal margins, 12pt system font", "normal", 12, "system"),
        ("spacious", "Spacious", "Wide margins, 13pt — easy reading", "wide", 13, "system"),
        ("manuscript", "Manuscript", "Wide margins, 13pt serif — study printout", "wide", 13, "serif"),
    ]
    static let marginInches: [String: Double] = ["none": 0, "narrow": 0.5, "normal": 1, "wide": 1.5]

    /// Margins in points (top, right, bottom, left).
    var marginPoints: (top: Double, right: Double, bottom: Double, left: Double) {
        if marginPreset == "custom" { return (customMargins.top * 72, customMargins.right * 72, customMargins.bottom * 72, customMargins.left * 72) }
        let m = (Self.marginInches[marginPreset] ?? 1) * 72
        return (m, m, m, m)
    }
    /// Paper in points.
    var paperPoints: CGSize {
        switch paperSize { case "a4": CGSize(width: 595.28, height: 841.89); case "legal": CGSize(width: 612, height: 1008); default: CGSize(width: 612, height: 792) }
    }
    var cssFont: String {
        switch fontFamily { case "serif": "Georgia, 'Times New Roman', serif"; case "sansserif": "Helvetica, Arial, sans-serif"; default: "-apple-system, Helvetica, sans-serif" }
    }

    /// Applies font, title and colour settings to a prepared HTML document.
    func apply(to markup: String, title: String) -> String {
        var html = markup
        if !includeTitle, let r = html.range(of: #"<h1>[\s\S]*?</h1>"#, options: .regularExpression) { html.removeSubrange(r) }
        var css = "body { font-family: \(cssFont) !important; font-size: \(Int(fontSizePt))pt !important; }"
        if colorMode == "grayscale" { css += " * { color: #000 !important; background: transparent !important; } mark { background: #ddd !important; }" }
        if let r = html.range(of: "</style>") { html.replaceSubrange(r, with: css + "</style>") }
        else { html = "<style>\(css)</style>" + html }
        return html
    }

    init() {}
    init(settings all: [String: JSValue]) {
        if let v = all["printMarginPreset"]?.stringValue?.string { marginPreset = v }
        if let m = all["printCustomMargins"] {
            customMargins = (m["top"]?.numberValue ?? 1, m["right"]?.numberValue ?? 1, m["bottom"]?.numberValue ?? 1, m["left"]?.numberValue ?? 1)
        }
        if let v = all["printPaperSize"]?.stringValue?.string { paperSize = v }
        if let v = all["printFontSizePt"]?.numberValue { fontSizePt = min(18, max(8, v)) }
        if let v = all["printFontFamily"]?.stringValue?.string { fontFamily = v }
        if let v = all["printIncludeTitle"]?.boolValue { includeTitle = v }
        if let v = all["printColorMode"]?.stringValue?.string { colorMode = v }
    }

    /// The settings `printMarkup` reads (kept current by AppModel).
    @MainActor static var current = PrintPreferences()
}

extension AppModel {
    var printPreferences: PrintPreferences {
        get { _ = printSettingsRevision; return PrintPreferences(settings: (try? settingsService?.all()) ?? [:]) }
        set {
            saveSetting("printMarginPreset", .string(JSString(newValue.marginPreset)))
            var m = JSObject()
            m["top"] = .number(newValue.customMargins.top); m["right"] = .number(newValue.customMargins.right)
            m["bottom"] = .number(newValue.customMargins.bottom); m["left"] = .number(newValue.customMargins.left)
            saveSetting("printCustomMargins", .object(m))
            saveSetting("printPaperSize", .string(JSString(newValue.paperSize)))
            saveSetting("printFontSizePt", .number(newValue.fontSizePt))
            saveSetting("printFontFamily", .string(JSString(newValue.fontFamily)))
            saveSetting("printIncludeTitle", .bool(newValue.includeTitle))
            saveSetting("printColorMode", .string(JSString(newValue.colorMode)))
            PrintPreferences.current = newValue
            printSettingsRevision += 1
        }
    }
}

/// Settings → Print & Export (original PrintExportSection, minus the PDF download location).
struct PrintSettingsSection: View {
    @Environment(AppModel.self) private var app

    private func bind<T>(_ key: WritableKeyPath<PrintPreferences, T>) -> Binding<T> {
        Binding(get: { app.printPreferences[keyPath: key] }, set: { var p = app.printPreferences; p[keyPath: key] = $0; app.printPreferences = p })
    }

    var body: some View {
        let prefs = app.printPreferences
        Section("Presets") {
            ForEach(PrintPreferences.presets, id: \.id) { preset in
                let active = prefs.marginPreset == preset.margin && prefs.fontSizePt == preset.size && prefs.fontFamily == preset.family
                Button {
                    var p = app.printPreferences
                    p.marginPreset = preset.margin; p.fontSizePt = preset.size; p.fontFamily = preset.family
                    app.printPreferences = p
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(preset.label).foregroundStyle(.primary)
                            Text(preset.detail).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if active { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                .buttonStyle(.interactivePlain)
            }
        }
        Section {
            Picker("Margins", selection: bind(\.marginPreset)) {
                Text("None").tag("none"); Text("Narrow").tag("narrow"); Text("Normal").tag("normal"); Text("Wide").tag("wide")
                if prefs.marginPreset == "custom" { Text("Custom").tag("custom") }
            }
            Stepper(value: bind(\.fontSizePt), in: 8...18, step: 1) { LabeledContent("Font Size", value: "\(Int(prefs.fontSizePt)) pt") }
            Picker("Font", selection: bind(\.fontFamily)) {
                Text("System").tag("system"); Text("Serif").tag("serif"); Text("Sans-serif").tag("sansserif")
            }
            #if os(macOS)
            Picker("Paper Size", selection: bind(\.paperSize)) {
                Text("Letter").tag("letter"); Text("A4").tag("a4"); Text("Legal").tag("legal")
            }
            #endif
            Toggle("Include Title", isOn: bind(\.includeTitle))
            Picker("Color", selection: bind(\.colorMode)) { Text("Color").tag("color"); Text("Grayscale").tag("grayscale") }
        } header: { Text("Page") } footer: {
            #if os(iOS)
            Text("Applies to printed notes and the idiom reference book. Paper size is chosen in the print panel.")
            #else
            Text("Applies to printed notes and the idiom reference book.")
            #endif
        }
    }
}
