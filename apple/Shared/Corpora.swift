import Foundation

/// Read-only bundled corpora copied into the app by the "Bundle corpora" build phase.
enum Corpora {
    static func path(_ textId: String) -> String? {
        Bundle.main.url(forResource: textId, withExtension: "db", subdirectory: "Corpora")?.path
    }
}
