import Foundation

/// Read-only bundled corpora copied into the app by the "Bundle corpora" build phase.
enum Corpora {
    /// textId → database file, as the existing app maps them (electron/db/bible.ts TEXT_DB_FILES):
    /// the `lxx` text is Brenton's Septuagint. Other ids (lexicons, cross references) are their own file names.
    static let files: [String: String] = ["lxx": "lxx_brenton"]

    static func path(_ textId: String) -> String? {
        Bundle.main.url(forResource: files[textId] ?? textId, withExtension: "db", subdirectory: "Corpora")?.path
    }
}
