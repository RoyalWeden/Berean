import Foundation
import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes
import BereanWorkspace

@Suite("berean chat") struct ChatsServiceTests {
    func setup() throws -> (SQLiteConnection, ChatsService, EventLog) {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 1_800_000_000_000
        let ids = FakeClock(); ids.t = 0
        let log = EventLog()
        let svc = ChatsService(db: db, now: { clock.t += 1000; return clock.t }, uuid: { ids.t += 1; return "id\(ids.t)" },
                               onChange: { e, id, op in log.items.append(DataChange(entity: e, id: id ?? "", op: op)) })
        return (db, svc, log)
    }

    @Test func legacyRowsNormalizeAndKeepUnknownFields() throws {
        let (db, svc, _) = try setup()
        try db.run("INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES ('c1', 'Old', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                   [.text(#"[{"role":"user","content":"What is grace?","createdAt":"2026-01-01T00:00:05.000Z"},{"role":"assistant","content":"","summary":"Divine influence","results":[{"x":1}],"createdAt":"bad"}]"#)])
        let c = try svc.chat("c1")!
        #expect(c.messages.map(\.id) == ["c1:0", "c1:1"])
        #expect(c.messages.map(\.kind) == [.aiRequest, .aiReply])
        #expect(c.messages[1].createdAt == "2026-01-01T00:00:05.000Z")   // falls back to the previous time
        #expect(c.messages[1].preview == "Divine influence")
        // Appending a note keeps the AI reply object intact (results survive) and freezes legacy ids.
        try svc.upsert(chatId: "c1", messages: [svc.noteMessage("Titus 2:11")])
        let stored = try db.query("SELECT messages FROM ai_chats WHERE id = 'c1'").first!["messages"]!.string!
        #expect(stored.contains(#""results":[{"x":1}]"#) && stored.contains(#""id":"c1:1""#) && stored.contains(#""kind":"note""#))
        #expect(try svc.chat("c1")!.messages.count == 3)
    }

    @Test func renameAndRemoveFolderMoveEveryConversation() throws {
        let (_, svc, log) = try setup()
        let a = try svc.upsert(chatId: nil, messages: [svc.noteMessage("one")])
        let b = try svc.upsert(chatId: nil, messages: [svc.noteMessage("two")])
        let c = try svc.upsert(chatId: nil, messages: [svc.noteMessage("three")])
        try svc.organize(a.id, folder: .some("Torah")); try svc.organize(b.id, folder: .some("Torah")); try svc.organize(c.id, folder: .some("Feasts"))
        let before = try svc.chat(a.id)!.updatedAt
        // A blank new name is refused and changes nothing.
        #expect(try svc.renameFolder("Torah", to: "   ") == nil)
        #expect(try svc.chat(a.id)!.folder == "Torah")
        log.items.removeAll()
        #expect(try svc.renameFolder("Torah", to: "  Torah   Study ") == 2)
        #expect(try svc.chat(a.id)!.folder == "Torah Study" && svc.chat(b.id)!.folder == "Torah Study")
        #expect(try svc.chat(c.id)!.folder == "Feasts")                       // other folders untouched
        #expect(try svc.chat(a.id)!.updatedAt > before)
        #expect(Set(log.items.map(\.id)) == [a.id, b.id] && log.items.allSatisfy { $0.op == "upsert" })
        // Removing a folder keeps its conversations, unfiled.
        #expect(try svc.renameFolder("Torah Study", to: nil) == 2)
        #expect(try svc.chat(a.id)!.folder == nil && svc.chat(b.id)!.folder == nil)
        #expect(try svc.chat(a.id) != nil && svc.chat(b.id) != nil)
        #expect(try svc.renameFolder("Missing", to: "X") == 0)
    }

    @Test func conversationsUnfiledOrganizeAndEdits() throws {
        let (_, svc, log) = try setup()
        let a = try svc.upsert(chatId: nil, messages: [svc.noteMessage("**Grace** teaches us to deny ungodliness")])
        #expect(a.title == "Grace teaches us to deny ungodliness")
        let note = a.messages[0]
        try svc.upsert(chatId: ChatsService.unfiledId, messages: [svc.noteMessage("quick thought")])
        #expect(try svc.conversations().map(\.id) == [a.id])
        #expect(try svc.chat(ChatsService.unfiledId)?.title == "Unfiled")
        #expect(try svc.organize(a.id, pinned: true, folder: .some("  Torah   studies ")))
        let c = try svc.chat(a.id)!
        #expect(c.pinnedAt != nil && c.folder == "Torah studies")
        #expect(try svc.organize(ChatsService.unfiledId, pinned: true) == false)
        let reply = svc.noteMessage("see Titus 2:11-14", inReplyTo: note.id)
        try svc.upsert(chatId: a.id, messages: [reply])
        try svc.editMessage(chatId: a.id, messageId: note.id, text: "edited")
        var m = try svc.chat(a.id)!.messages
        #expect(m[0].content == "edited" && m[0].editedAt != nil && m[1].inReplyTo == note.id)
        try svc.deleteMessage(chatId: a.id, messageId: note.id)
        m = try svc.chat(a.id)!.messages
        #expect(m.count == 1)
        #expect(try svc.rename(a.id, "Grace study"))
        #expect(try svc.stream(search: "quick").count == 1)
        try svc.delete(a.id)
        #expect(try svc.chat(a.id) == nil)
        #expect(log.items.allSatisfy { $0.entity == "ai_chat" })
        let empty = try svc.upsert(chatId: nil, title: "New Conversation", messages: [])
        #expect(try svc.upsert(chatId: empty.id, messages: [svc.noteMessage("Feasts of Yehovah")]).title == "Feasts of Yehovah")
        #expect(try svc.upsert(chatId: empty.id, messages: [svc.noteMessage("second")]).title == "Feasts of Yehovah")
    }

    @Test func allMessagesKeepsConversationScopedIdentityAndReplyTarget() throws {
        let (db, svc, _) = try setup()
        var created: [String: String] = [:]
        for id in ["first", "second"] {
            var message = JSObject()
            message["id"] = "shared-legacy-id"
            message["role"] = "user"
            message["kind"] = "note"
            message["content"] = .string(JSString("A thought in " + id))
            created[id] = try svc.upsert(chatId: nil, title: id, messages: [.object(message)]).id
        }
        let items = try svc.stream()
        #expect(items.count == 2)
        #expect(Set(items.map(\.id)).count == 2)
        let target = try #require(items.first { $0.chat.id == created["second"] })
        try svc.upsert(chatId: target.id.chatID,
                       messages: [svc.noteMessage("A reply in the second conversation", inReplyTo: target.id.messageID)])
        #expect(try svc.chat(created["first"]!)?.messages.count == 1)
        #expect(try svc.chat(created["second"]!)?.messages.last?.inReplyTo == "shared-legacy-id")
        #expect(try svc.stream(search: "thought").count == 2)
        try svc.editMessage(chatId: target.id.chatID, messageId: target.id.messageID, text: "Edited only in second")
        #expect(try svc.chat(created["first"]!)?.messages.first?.content == "A thought in first")
        #expect(try svc.chat(created["second"]!)?.messages.first?.content == "Edited only in second")
        let raw = try #require(try db.query("SELECT messages FROM ai_chats WHERE id = ?", [.text(created["first"]!)]).first?["messages"]?.string)
        #expect(raw.contains("shared-legacy-id"))
    }

    @Test func askExchangeMatchesOriginalShape() throws {
        let (_, svc, _) = try setup()
        var fields = JSObject()
        fields["errorCode"] = "NO_MODEL_INSTALLED"; fields["partial"] = .bool(true)
        fields["keywords"] = .array(["sabbath"])
        let pair = svc.aiExchange(question: "Sabbath rest", replyFields: fields)
        let chat = try svc.upsert(chatId: nil, title: "Sabbath rest", messages: pair)
        let raw = try #require(try svc.chat(chat.id))
        #expect(raw.title == "Sabbath rest")
        #expect(raw.messages.count == 2)
        let req = pair[0], rep = pair[1]
        #expect(req["kind"]?.stringValue?.string == "ai-request" && req["role"]?.stringValue?.string == "user")
        #expect(req["aiMode"]?["deepSearch"]?.boolValue == false)
        #expect(rep["kind"]?.stringValue?.string == "ai-reply" && rep["role"]?.stringValue?.string == "assistant")
        #expect(rep["replyTo"] == req["id"])
        #expect(rep["errorCode"]?.stringValue?.string == "NO_MODEL_INSTALLED" && rep["content"]?.stringValue?.string == "")
        #expect((rep["createdAt"]?.stringValue?.string ?? "") > (req["createdAt"]?.stringValue?.string ?? ""))
    }
}
