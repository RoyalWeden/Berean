import SwiftUI

/// Reading themes: the original's colour presets (lib/themePresets.ts, generated verbatim), stored
/// under the original `themePreset` key. Natively they colour the Scripture page (background,
/// text) the way Apple Books themes do; the rest of the app keeps the system appearance.
/// "Default" (id "") means no override.
struct ReaderTheme: Identifiable, Equatable, Sendable {
    struct Palette: Equatable, Sendable {
        let bg: String, accent: String, text: String
        init(_ bg: String, _ accent: String, _ text: String) { self.bg = bg; self.accent = accent; self.text = text }
    }
    let id: String, label: String, family: String
    let dark: Palette, light: Palette

    func palette(dark isDark: Bool) -> Palette { isDark ? dark : light }

    static func color(_ triple: String) -> Color {
        let p = triple.split(separator: " ").compactMap { Double($0) }
        guard p.count == 3 else { return .primary }
        return Color(red: p[0] / 255, green: p[1] / 255, blue: p[2] / 255)
    }

    static let presets: [ReaderTheme] = [
        .init(id: "", label: "Default", family: "Classic", dark: .init("17 17 20", "100 120 220", "230 230 238"), light: .init("245 245 248", "80 100 200", "20 20 28")),
        .init(id: "theme-neon", label: "Neon", family: "Vibrant", dark: .init("8 8 14", "255 0 180", "240 240 255"), light: .init("250 248 255", "200 0 145", "18 5 35")),
        .init(id: "theme-terminal", label: "Terminal", family: "Vibrant", dark: .init("4 10 4", "0 220 80", "0 255 100"), light: .init("238 252 238", "0 155 50", "4 22 4")),
        .init(id: "theme-midnight", label: "Midnight", family: "Classic", dark: .init("6 8 22", "120 160 255", "210 220 255"), light: .init("238 242 255", "70 105 215", "12 18 55")),
        .init(id: "theme-obsidian", label: "Obsidian", family: "Classic", dark: .init("12 10 14", "140 100 220", "230 225 240"), light: .init("248 246 252", "108 72 188", "22 16 35")),
        .init(id: "theme-slate", label: "Slate", family: "Classic", dark: .init("14 16 18", "100 180 230", "220 228 235"), light: .init("238 242 246", "52 132 182", "16 26 36")),
        .init(id: "theme-forest", label: "Forest", family: "Nature", dark: .init("8 14 10", "80 195 110", "210 240 215"), light: .init("238 252 240", "38 145 62", "6 28 10")),
        .init(id: "theme-ocean", label: "Ocean", family: "Nature", dark: .init("6 14 22", "30 200 190", "200 235 240"), light: .init("232 248 252", "12 148 142", "6 28 42")),
        .init(id: "theme-arctic", label: "Arctic", family: "Nature", dark: .init("8 20 30", "28 175 198", "200 228 242"), light: .init("234 242 248", "20 160 180", "15 35 50")),
        .init(id: "theme-royal", label: "Royal", family: "Rich & Warm", dark: .init("12 8 22", "218 170 50", "240 228 200"), light: .init("252 248 235", "165 115 15", "28 18 52")),
        .init(id: "theme-ember", label: "Ember", family: "Rich & Warm", dark: .init("16 10 6", "240 140 30", "248 230 200"), light: .init("255 248 238", "195 92 8", "48 22 6")),
        .init(id: "theme-bible", label: "Bible", family: "Scripture & Parchment", dark: .init("26 18 8", "195 132 52", "228 212 182"), light: .init("240 232 210", "130 80 30", "55 35 15")),
        .init(id: "theme-sand", label: "Sand", family: "Scripture & Parchment", dark: .init("30 22 10", "205 142 48", "232 218 192"), light: .init("238 228 210", "190 110 30", "60 40 20")),
        .init(id: "theme-dawn", label: "Dawn", family: "Scripture & Parchment", dark: .init("24 12 5", "228 118 48", "250 225 205"), light: .init("255 245 238", "200 95 40", "55 30 15")),
        .init(id: "theme-rose", label: "Rose", family: "Soft Light", dark: .init("26 10 18", "215 88 128", "248 215 230"), light: .init("252 240 244", "180 60 100", "55 20 35")),
        .init(id: "theme-ivory", label: "Ivory", family: "Soft Light", dark: .init("18 16 28", "148 118 208", "232 228 245"), light: .init("250 248 245", "110 85 175", "35 30 45")),
        .init(id: "theme-sage", label: "Sage", family: "Muted & Pastel", dark: .init("24 30 24", "140 180 130", "214 226 210"), light: .init("236 241 232", "107 142 99", "40 54 38")),
        .init(id: "theme-lavender", label: "Lavender", family: "Muted & Pastel", dark: .init("26 22 34", "176 152 224", "224 214 238"), light: .init("240 236 248", "141 120 196", "45 36 60")),
        .init(id: "theme-blush", label: "Blush", family: "Muted & Pastel", dark: .init("32 20 22", "224 150 160", "240 214 216"), light: .init("250 238 238", "196 120 132", "60 32 36")),
        .init(id: "theme-fog", label: "Fog", family: "Muted & Pastel", dark: .init("20 23 26", "150 178 196", "214 222 228"), light: .init("236 239 242", "108 132 150", "34 40 46")),
        .init(id: "theme-linen", label: "Linen", family: "Muted & Pastel", dark: .init("26 23 18", "200 176 140", "232 224 208"), light: .init("245 240 230", "150 124 90", "50 42 32")),
        .init(id: "theme-mist", label: "Mist", family: "Muted & Pastel", dark: .init("16 28 26", "120 196 186", "206 232 228"), light: .init("232 244 242", "78 158 150", "24 50 46")),
        .init(id: "theme-dune", label: "Dune", family: "Muted & Pastel", dark: .init("28 22 14", "214 176 120", "236 222 196"), light: .init("244 236 220", "176 132 70", "56 42 24")),
        .init(id: "theme-powder", label: "Powder", family: "Muted & Pastel", dark: .init("16 22 32", "140 180 220", "210 222 238"), light: .init("232 240 248", "96 140 192", "26 38 54")),
        .init(id: "theme-clay-dust", label: "Clay Dust", family: "Muted & Pastel", dark: .init("30 20 16", "216 148 120", "240 220 208"), light: .init("246 234 226", "186 110 80", "58 32 24")),
        .init(id: "theme-willow", label: "Willow", family: "Muted & Pastel", dark: .init("20 24 14", "168 188 120", "220 228 198"), light: .init("238 240 224", "122 140 80", "40 44 26")),
        .init(id: "theme-periwinkle", label: "Periwinkle", family: "Muted & Pastel", dark: .init("20 20 36", "160 168 232", "216 216 244"), light: .init("236 236 250", "120 128 208", "36 36 64")),
        .init(id: "theme-oat", label: "Oat", family: "Muted & Pastel", dark: .init("26 22 16", "206 184 140", "234 224 204"), light: .init("244 238 224", "164 140 96", "52 44 30")),
        .init(id: "theme-thistle", label: "Thistle", family: "Muted & Pastel", dark: .init("28 20 24", "210 150 178", "238 216 226"), light: .init("244 234 238", "172 110 140", "54 32 42")),
        .init(id: "theme-seafoam", label: "Seafoam", family: "Muted & Pastel", dark: .init("14 28 24", "120 204 178", "202 234 222"), light: .init("228 244 238", "70 168 144", "20 50 42")),
        .init(id: "theme-chalk", label: "Chalk", family: "Muted & Pastel", dark: .init("22 22 25", "172 176 192", "220 220 228"), light: .init("240 240 242", "130 134 150", "40 40 46")),
        .init(id: "theme-apricot", label: "Apricot", family: "Muted & Pastel", dark: .init("30 22 14", "232 164 110", "244 222 200"), light: .init("248 236 222", "206 132 74", "58 36 20")),
        .init(id: "theme-wisteria", label: "Wisteria", family: "Muted & Pastel", dark: .init("24 18 30", "170 140 200", "220 208 236"), light: .init("244 238 248", "128 100 168", "46 36 58")),
        .init(id: "theme-slate-dust", label: "Slate Dust", family: "Muted & Pastel", dark: .init("18 20 24", "140 158 178", "210 216 224"), light: .init("236 238 240", "96 116 138", "34 38 44")),
        .init(id: "theme-moth", label: "Moth", family: "Muted & Pastel", dark: .init("22 20 18", "178 160 136", "220 214 204"), light: .init("240 236 228", "128 110 86", "42 36 28")),
        .init(id: "theme-dusk-rose", label: "Dusk Rose", family: "Muted & Pastel", dark: .init("26 18 20", "200 130 146", "232 210 214"), light: .init("246 236 238", "158 90 108", "52 30 34")),
        .init(id: "theme-heather", label: "Heather", family: "Muted & Pastel", dark: .init("22 20 26", "156 144 190", "218 212 232"), light: .init("240 238 246", "108 98 148", "40 36 52")),
        .init(id: "theme-ash-sage", label: "Ash Sage", family: "Muted & Pastel", dark: .init("18 22 20", "140 166 148", "210 220 212"), light: .init("236 240 236", "90 120 100", "34 42 36")),
    ]
    static var families: [String] { presets.reduce(into: [String]()) { if !$0.contains($1.family) { $0.append($1.family) } } }
    static func find(_ id: String) -> ReaderTheme? { id.isEmpty ? nil : presets.first { $0.id == id || $0.id == id.replacingOccurrences(of: "-dark", with: "").replacingOccurrences(of: "-light", with: "") } }
}
