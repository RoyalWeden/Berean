import Foundation

/// Visible tool names and the older vocabulary people may still search for.
/// Aliases affect discovery only; command actions and stored routes stay unchanged.
enum CommandSearch {
    private static func names(for title: String) -> [String] {
        switch title {
        case "Messages": [title, "Berean Chat", "Chat", "Messaging", "Conversations"]
        case "Study Trail": [title, "Study Trails", "Trail", "Trails"]
        default: [title]
        }
    }

    static func matches(_ query: String, title: String) -> Bool {
        query.isEmpty || names(for: title).contains { $0.localizedCaseInsensitiveContains(query) }
    }

    static func isPreferred(_ query: String, title: String) -> Bool {
        guard !query.isEmpty else { return false }
        return names(for: title).contains {
            let name = $0.lowercased(), query = query.lowercased()
            return name == query || (query.count >= 3 && name.hasPrefix(query))
        }
    }
}
