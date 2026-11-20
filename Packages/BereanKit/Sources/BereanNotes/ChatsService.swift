import Foundation
import BereanCore
import BereanSQLite

/// Berean Chat persistence — port of src/platform/services/aiChatsService.ts (the `ai_chats`
/// table: one row per conversation, `messages` a JSON array). Stored message objects are kept
/// verbatim (AI results, unknown/future fields); writes merge by message id against the row as it
/// is now, exactly like `upsertMessages`. The reserved row `berean-unfiled` holds messages written
/// to no conversation and is never listed as one.
public final class ChatsService: @unchecked Sendable {
    public static let unfiledId = "berean-unfiled"
    public static let unfiledTitle = "Unfiled"

    public enum Kind: String, Sendable { case note, aiRequest = "ai-request", aiReply = "ai-reply" }

    /// A normalized message (id/kind/createdAt always present) plus the stored object.
    public struct Message: Equatable, Sendable, Identifiable {
        public var id: String
        public var role: String
        public var kind: Kind
        public var content: String
        public var createdAt: String
        public var inReplyTo: String?
        public var editedAt: String?
        /// Plain preview (content, else AI summary / result counts).
        public var preview: String
        public var raw: JSValue
        public var time: Double { ChatsService.time(createdAt) ?? 0 }
    }

    public struct Chat: Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var createdAt: String
        public var updatedAt: String
        public var pinnedAt: String?
        public var folder: String?
        public var messages: [Message]
        public var isUnfiled: Bool { id == ChatsService.unfiledId }
    }

    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    let onChange: @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void

    public init(db: SQLiteConnection,
                now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
                onChange: @escaping @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void = { _, _, _ in }) {
        self.db = db; self.now = now; self.uuid = uuid; self.onChange = onChange
    }

    // MARK: time (JavaScript `toISOString`)

    nonisolated(unsafe) static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    nonisolated(unsafe) static let isoPlain = ISO8601DateFormatter()

    public static func iso(_ ms: Int64) -> String { isoFractional.string(from: Date(timeIntervalSince1970: Double(ms) / 1000)) }
    public static func time(_ s: String?) -> Double? {
        guard let s, !s.isEmpty else { return nil }
        let d = isoFractional.date(from: s) ?? isoPlain.date(from: s)
        return d.map { $0.timeIntervalSince1970 * 1000 }
    }

    // MARK: pure helpers (ported)

    public static func kind(role: String, stored: String?) -> Kind {
        if let k = stored.flatMap(Kind.init(rawValue:)) { return k }
        return role == "assistant" ? .aiReply : .aiRequest
    }

    public static func normalize(_ raw: [JSValue], chatId: String, createdAt: String, updatedAt: String?) -> [Message] {
        var prev = time(createdAt) ?? time(updatedAt) ?? 0
        var seen = Set<String>()
        var out: [Message] = []
        for (i, m) in raw.enumerated() {
            guard m.objectValue != nil else { continue }
            let role = m["role"]?.stringValue?.string == "assistant" ? "assistant" : "user"
            let stored = m["createdAt"]?.stringValue?.string
            let t = time(stored)
            let at = t ?? prev
            prev = max(prev, at)
            var id = m["id"]?.stringValue?.string ?? ""
            if id.isEmpty { id = "\(chatId):\(i)" }
            if seen.contains(id) { id = "\(id):\(i)" }
            seen.insert(id)
            let content = m["content"]?.stringValue?.string ?? ""
            out.append(Message(id: id, role: role, kind: kind(role: role, stored: m["kind"]?.stringValue?.string), content: content,
                               createdAt: t != nil ? stored! : iso(Int64(at)), inReplyTo: m["inReplyTo"]?.stringValue?.string,
                               editedAt: m["editedAt"]?.stringValue?.string, preview: previewText(m), raw: m))
        }
        return out
    }

    /// `plainChatText` — markdown markers removed for titles and previews.
    public static func plainText(_ text: String) -> String {
        var s = text
        func re(_ p: String, _ t: String, _ o: NSRegularExpression.Options = [.anchorsMatchLines]) {
            s = (try? NSRegularExpression(pattern: p, options: o))?.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: t) ?? s
        }
        re(#"^[ \t]*(?:```|~~~).*$"#, "")
        re(#"^[ \t]*#{1,6}[ \t]+"#, "")
        re(#"^[ \t]*(?:[-*•]|\d{1,3}[.)]|>)[ \t]+"#, "")
        re(#"</?u>"#, "")
        re(#"\[([^\]\n]+)\]\((https?://[^\s)]+)\)"#, "$1")
        re(#"(\*\*|~~|==|`)(?=\S)([\s\S]*?\S)\1"#, "$2")
        re(#"(^|[^\w*])\*(?=[^\s*])([^*\n]*?\S)\*(?!\w)"#, "$1$2")
        return s
    }

    static func previewText(_ m: JSValue) -> String {
        // JavaScript `m.content || m.summary`: an empty content falls back to the AI summary.
        let content = m["content"]?.stringValue?.string ?? ""
        let text = plainText(content.isEmpty ? (m["summary"]?.stringValue?.string ?? "") : content)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { return text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
        if let n = m["results"]?.arrayValue?.count, n > 0 { return "\(n) passage\(n == 1 ? "" : "s")" }
        if let s = m["strongsCard"]?["strongsNum"]?.stringValue?.string { return s }
        if let n = m["notes"]?.arrayValue?.count, n > 0 { return "\(n) note\(n == 1 ? "" : "s")" }
        return ""
    }

    public static func deriveTitle(_ messages: [Message]) -> String {
        let first = messages.first { $0.role == "user" && !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let text = plainText(first?.content ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if text.isEmpty { return "New Conversation" }
        return text.count > 60 ? String(text.prefix(57)).trimmingCharacters(in: .whitespaces) + "…" : text
    }

    public static func cleanFolder(_ name: String?) -> String? {
        let t = String((name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(60))
        return t.isEmpty ? nil : t
    }

    // MARK: reads

    static func row(_ r: SQLiteRow) -> Chat {
        let id = r["id"]?.string ?? ""
        let createdAt = r["created_at"]?.string ?? "", updatedAt = r["updated_at"]?.string ?? ""
        let raw = (try? JSON.parse(r["messages"]?.string ?? "[]"))?.arrayValue ?? []
        return Chat(id: id, title: id == unfiledId ? unfiledTitle : (r["title"]?.string ?? ""), createdAt: createdAt, updatedAt: updatedAt,
                    pinnedAt: r["pinned_at"]?.string, folder: r["folder"]?.string,
                    messages: normalize(raw, chatId: id, createdAt: createdAt, updatedAt: updatedAt))
    }

    /// Every row, the unfiled one included (newest update first).
    public func all() throws -> [Chat] { try db.query("SELECT * FROM ai_chats ORDER BY updated_at DESC").map(Self.row) }

    /// Conversations as listed (the unfiled row excluded).
    public func conversations() throws -> [Chat] { try all().filter { !$0.isUnfiled } }

    public func chat(_ id: String) throws -> Chat? { try db.query("SELECT * FROM ai_chats WHERE id = ?", [.text(id)]).first.map(Self.row) }

    // MARK: writes

    /// A new note message object as the original writes it (additive fields only).
    public func noteMessage(_ text: String, inReplyTo: String? = nil) -> JSValue {
        var o = JSObject()
        o["role"] = "user"; o["content"] = .string(JSString(text)); o["createdAt"] = .string(JSString(Self.iso(now())))
        o["id"] = .string(JSString(uuid())); o["kind"] = "note"
        if let inReplyTo { o["inReplyTo"] = .string(JSString(inReplyTo)) }
        return .object(o)
    }

    /// `upsertMessages`: merge by id into the row as it is now; nil chatId (or a deleted one) creates a conversation.
    @discardableResult
    public func upsert(chatId: String?, title: String? = nil, messages incoming: [JSValue], removeIds: Set<String> = []) throws -> Chat {
        let existing = try chatId.flatMap { try chat($0) }
        let unfiled = chatId == Self.unfiledId
        var stored = (existing?.messages ?? []).filter { !removeIds.contains($0.id) }
        var index = Dictionary(stored.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        let normalizedIncoming = Self.normalize(incoming, chatId: existing?.id ?? "new", createdAt: Self.iso(now()), updatedAt: nil)
        for m in normalizedIncoming where !removeIds.contains(m.id) {
            // Freeze the normalized id/createdAt into the stored object (as the original's spread does).
            var o = m.raw.objectValue ?? JSObject()
            o["id"] = .string(JSString(m.id)); o["createdAt"] = .string(JSString(m.createdAt))
            var fixed = m; fixed.raw = .object(o)
            if let at = index[m.id] { stored[at] = fixed } else { index[m.id] = stored.count; stored.append(fixed) }
        }
        let rawOut = JSValue.array(stored.map { m -> JSValue in
            var o = m.raw.objectValue ?? JSObject()
            if o["id"] == nil { o["id"] = .string(JSString(m.id)) }
            if o["createdAt"] == nil { o["createdAt"] = .string(JSString(m.createdAt)) }
            return .object(o)
        })
        // An empty placeholder conversation (created before its first message) takes its title from
        // that message, as the original — which only creates the row on the first send — would.
        let placeholder = existing.map { $0.messages.isEmpty && $0.title == "New Conversation" } ?? false
        let finalTitle = unfiled ? Self.unfiledTitle : (title?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 }
            ?? (placeholder ? nil : existing?.title) ?? Self.deriveTitle(stored)
        let t = Self.iso(now())
        let json = JSON.stringifyString(rawOut)
        let id: String
        if let existing {
            id = existing.id
            try db.run("UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ?", [.text(finalTitle), .text(json), .text(t), .text(id)])
        } else {
            id = unfiled ? Self.unfiledId : uuid()
            try db.run("INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                       [.text(id), .text(finalTitle), .text(json), .text(t), .text(t)])
        }
        onChange("ai_chat", id, "upsert")
        return try chat(id)!
    }

    /// Edits a note message's text in place (sets `editedAt`).
    public func editMessage(chatId: String, messageId: String, text: String) throws {
        guard let c = try chat(chatId), let m = c.messages.first(where: { $0.id == messageId }) else { return }
        var o = m.raw.objectValue ?? JSObject()
        o["content"] = .string(JSString(text)); o["editedAt"] = .string(JSString(Self.iso(now()))); o["id"] = .string(JSString(m.id))
        try upsert(chatId: chatId, messages: [.object(o)])
    }

    public func deleteMessage(chatId: String, messageId: String) throws {
        try upsert(chatId: chatId, messages: [], removeIds: [messageId])
    }

    @discardableResult
    public func rename(_ id: String, _ title: String) throws -> Bool {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return false }
        try db.run("UPDATE ai_chats SET title = ?, updated_at = ? WHERE id = ?", [.text(clean), .text(Self.iso(now())), .text(id)])
        onChange("ai_chat", id, "upsert"); return true
    }

    /// Pin / unpin (`pinned`) and file / unfile (`folder`: `.some(nil)` unfiles).
    @discardableResult
    public func organize(_ id: String, pinned: Bool? = nil, folder: String?? = nil) throws -> Bool {
        guard id != Self.unfiledId else { return false }
        var sets: [String] = [], args: [SQLiteValue] = []
        if let pinned { sets.append("pinned_at = ?"); args.append(pinned ? .text(Self.iso(now())) : .null) }
        if let folder { sets.append("folder = ?"); args.append(Self.cleanFolder(folder).map { .text($0) } ?? .null) }
        guard !sets.isEmpty else { return false }
        try db.run("UPDATE ai_chats SET \(sets.joined(separator: ", ")), updated_at = ? WHERE id = ?", args + [.text(Self.iso(now())), .text(id)])
        onChange("ai_chat", id, "upsert"); return true
    }

    public func delete(_ id: String) throws {
        try db.run("DELETE FROM ai_chats WHERE id = ?", [.text(id)])
        onChange("ai_chat", id, "delete")
    }

    /// All messages across conversations (oldest → newest), optional substring search.
    public func stream(search: String? = nil) throws -> [(chat: Chat, message: Message)] {
        let needle = search?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        var items: [(Chat, Message)] = []
        for c in try all() {
            for m in c.messages where needle.isEmpty || (m.content + "\n" + (m.raw["summary"]?.stringValue?.string ?? "")).lowercased().contains(needle) {
                items.append((c, m))
            }
        }
        return items.sorted { ($0.1.time, $0.0.id, $0.1.id) < ($1.1.time, $1.0.id, $1.1.id) }
    }
}
