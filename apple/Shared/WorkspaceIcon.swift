import Foundation

/// Workspace icons. The stored value is the original app's Lucide icon name (`SESSION_ICONS` in
/// src/components/shell/Sidebar.tsx) so `sessions.icon` stays readable by both apps; this maps it to an SF Symbol.
enum WorkspaceIcon {
    static let all: [(name: String, symbol: String)] = [
        ("BookOpen", "book"), ("BookMarked", "book.closed"), ("FileText", "doc.text"), ("Star", "star"), ("Flame", "flame"),
        ("Leaf", "leaf"), ("Globe", "globe"), ("Compass", "safari"), ("Shield", "shield"), ("Layers", "square.3.layers.3d"),
        ("Feather", "pencil.and.scribble"), ("Anchor", "ferry"), ("Crown", "crown"), ("Zap", "bolt"), ("Heart", "heart"),
        ("Cloud", "cloud"), ("Mountain", "mountain.2"), ("Fish", "fish"), ("Key", "key"), ("Bell", "bell"), ("Clock", "clock"),
        ("Home", "house"), ("Map", "map"), ("Gem", "diamond"), ("Search", "magnifyingglass"), ("Sun", "sun.max"), ("Moon", "moon"),
    ]

    /// "BookOpen" → "Book Open" for menus.
    static func label(_ name: String) -> String {
        name.reduce(into: "") { out, c in if c.isUppercase, !out.isEmpty { out.append(" ") }; out.append(c) }
    }

    static func symbol(_ name: String?) -> String {
        guard let name else { return "square.stack" }
        return all.first { $0.name == name }?.symbol ?? "square.stack"
    }
}
