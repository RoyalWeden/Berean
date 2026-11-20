import SwiftUI
import BereanNotes

/// Berean Chat (notes side of the original Messages-style chat): conversations plus the reserved
/// Unfiled stream, pins, folders, replies, edit/delete. AI requests and replies already stored in a
/// conversation are shown read-only; sending to Ask Berean is not part of the native build yet.
struct ChatView: View {
    @Environment(AppModel.self) private var app
    /// iPhone sheet: a Done button in the list's toolbar.
    var onDone: (() -> Void)? = nil
    enum Selection: Hashable { case all, chat(String) }
    @State private var selection: Selection? = .all
    @State private var chats: [ChatsService.Chat] = []
    @State private var search = ""
    @State private var renaming: ChatsService.Chat?
    @State private var newTitle = ""
    @State private var foldering: ChatsService.Chat?
    @State private var folderName = ""
    @State private var deleting: ChatsService.Chat?

    private var conversations: [ChatsService.Chat] { chats.filter { !$0.isUnfiled } }
    private var pinned: [ChatsService.Chat] { conversations.filter { $0.pinnedAt != nil }.sorted { ($0.pinnedAt ?? "") > ($1.pinnedAt ?? "") } }
    private var folders: [String] { Array(Set(conversations.compactMap { $0.pinnedAt == nil ? $0.folder : nil })).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending } }
    private var loose: [ChatsService.Chat] { conversations.filter { $0.pinnedAt == nil && $0.folder == nil } }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("All Messages", systemImage: "tray.full").tag(Selection.all)
                if !pinned.isEmpty { Section("Pinned") { ForEach(pinned) { row($0) } } }
                ForEach(folders, id: \.self) { f in
                    Section(f) { ForEach(conversations.filter { $0.pinnedAt == nil && $0.folder == f }) { row($0) } }
                }
                Section("Conversations") {
                    if loose.isEmpty && pinned.isEmpty && folders.isEmpty {
                        Text("No conversations yet").foregroundStyle(.secondary)
                    }
                    ForEach(loose) { row($0) }
                }
            }
            .navigationTitle("Berean Chat")
            .toolbar {
                if let onDone {
                    ToolbarItem(placement: .cancellationAction) { Button("Done", action: onDone) }
                }
                ToolbarItem {
                    Button("New Conversation", systemImage: "square.and.pencil") { newConversation() }
                        .help("Start a conversation")
                }
            }
            #if os(macOS)
            .navigationSplitViewColumnWidth(min: 200, ideal: 240)
            #endif
        } detail: {
            switch selection {
            case .chat(let id): ChatThreadView(chatId: id).id(id)
            default: ChatThreadView(chatId: nil)
            }
        }
        .task(id: app.chatsRevision) { chats = (try? app.chats?.all()) ?? [] }
        .alert("Rename Conversation", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Rename") { if let c = renaming { try? app.chats?.rename(c.id, newTitle) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Move to Folder", isPresented: Binding(get: { foldering != nil }, set: { if !$0 { foldering = nil } })) {
            TextField("Folder name", text: $folderName)
            Button("Move") { if let c = foldering { try? app.chats?.organize(c.id, folder: .some(folderName)) }; foldering = nil }
            Button("Cancel", role: .cancel) { foldering = nil }
        }
        .confirmationDialog("Delete “\(deleting?.title ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Delete Conversation", role: .destructive) {
                if let c = deleting { try? app.chats?.delete(c.id); if selection == .chat(c.id) { selection = .all } }
                deleting = nil
            }
        } message: { Text("Its messages are deleted too.") }
    }

    private func row(_ c: ChatsService.Chat) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(c.title).lineLimit(1)
            Text(c.messages.last?.preview ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .tag(Selection.chat(c.id))
        .contextMenu {
            Button(c.pinnedAt == nil ? "Pin" : "Unpin", systemImage: c.pinnedAt == nil ? "pin" : "pin.slash") { try? app.chats?.organize(c.id, pinned: c.pinnedAt == nil) }
            Button("Rename…", systemImage: "pencil") { newTitle = c.title; renaming = c }
            Menu("Folder") {
                ForEach(folders.filter { $0 != c.folder }, id: \.self) { f in Button(f) { try? app.chats?.organize(c.id, folder: .some(f)) } }
                Button("New Folder…") { folderName = ""; foldering = c }
                if c.folder != nil { Divider(); Button("Remove from Folder") { try? app.chats?.organize(c.id, folder: .some(nil)) } }
            }
            Divider()
            Button("Delete…", systemImage: "trash", role: .destructive) { deleting = c }
        }
    }

    private func newConversation() {
        guard let created = try? app.chats?.upsert(chatId: nil, title: "New Conversation", messages: []) else { return }
        selection = .chat(created.id)
    }
}

/// One conversation (or All Messages across conversations) with a composer.
struct ChatThreadView: View {
    @Environment(AppModel.self) private var app
    let chatId: String?
    @State private var items: [(chat: ChatsService.Chat, message: ChatsService.Message)] = []
    @State private var title = "All Messages"
    @State private var draft = ""
    @State private var replyTo: ChatsService.Message?
    @State private var editing: ChatsService.Message?
    @State private var editText = ""
    @State private var search = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if items.isEmpty {
                            ContentUnavailableView(search.isEmpty ? "No Messages" : "No Results", systemImage: "bubble.left.and.text.bubble.right",
                                                   description: Text(search.isEmpty ? "Write a note below — quick thoughts, references, questions." : "Try another word."))
                                .padding(.top, 60)
                        }
                        ForEach(Array(items.enumerated()), id: \.element.message.id) { index, item in
                            if index == 0 || !Calendar.current.isDate(Date(timeIntervalSince1970: item.message.time / 1000),
                                                                      inSameDayAs: Date(timeIntervalSince1970: items[index - 1].message.time / 1000)) {
                                Text(Date(timeIntervalSince1970: item.message.time / 1000).formatted(date: .complete, time: .omitted))
                                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity).padding(.top, 8)
                            }
                            bubble(item.chat, item.message).id(item.message.id)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 760).frame(maxWidth: .infinity)
                }
                .onChange(of: items.last?.message.id) { _, id in
                    if let id { withAnimation(.smooth) { proxy.scrollTo(id, anchor: .bottom) } }
                }
                .onAppear { if let id = items.last?.message.id { proxy.scrollTo(id, anchor: .bottom) } }
            }
            composer
        }
        .navigationTitle(title)
        .searchable(text: $search, prompt: "Search messages")
        .task(id: "\(app.chatsRevision)|\(search)") { reload() }
    }

    private func reload() {
        guard let svc = app.chats else { return }
        if let chatId, let c = try? svc.chat(chatId) {
            title = c.title
            let needle = search.lowercased()
            items = c.messages.filter { needle.isEmpty || $0.content.lowercased().contains(needle) || $0.preview.lowercased().contains(needle) }.map { (c, $0) }
        } else {
            title = "All Messages"
            items = (try? svc.stream(search: search)) ?? []
        }
    }

    @ViewBuilder private func bubble(_ chat: ChatsService.Chat, _ m: ChatsService.Message) -> some View {
        let note = m.kind == .note
        let mine = m.role == "user"
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if chatId == nil, !chat.isUnfiled {
                Text(chat.title).font(.caption2).foregroundStyle(.secondary)
            }
            if let parentId = m.inReplyTo {
                let parent = chat.messages.first { $0.id == parentId }
                Label(parent.map { String($0.preview.prefix(80)) } ?? "Original message deleted", systemImage: "arrowshape.turn.up.left")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if editing?.id == m.id {
                TextField("Message", text: $editText, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...8)
                    .onSubmit { saveEdit(chat) }
                HStack {
                    Button("Cancel") { editing = nil }
                    Button("Save") { saveEdit(chat) }.buttonStyle(.borderedProminent)
                }.controlSize(.small)
            } else {
                Text(m.content.isEmpty ? m.preview : m.content)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .foregroundStyle(note ? Color.white : Color.primary)
                    .background(note ? Color.accentColor : Color.secondary.opacity(0.14), in: .rect(cornerRadius: 16))
                    .frame(maxWidth: 560, alignment: mine ? .trailing : .leading)
            }
            if m.kind == .aiReply, let verses = m.raw["results"]?.arrayValue, !verses.isEmpty {
                // Verses the answer found (original results / visibleCount), as tappable references.
                let shown = verses.prefix(max(1, Int(m.raw["visibleCount"]?.numberValue ?? 6)))
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, r in
                        if let book = r["bookId"]?.stringValue?.string, let ch = r["chapter"]?.numberValue, let v = r["verse"]?.numberValue {
                            Button {
                                app.openScripture(bookId: book, chapter: Int(ch), verse: Int(v), textId: r["textId"]?.stringValue?.string, reuseTab: false)
                                #if os(iOS)
                                app.chatShown = false   // the passage opens behind the full-screen chat
                                #endif
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(r["bookName"]?.stringValue?.string ?? book) \(Int(ch)):\(Int(v))").font(.caption.weight(.semibold)).foregroundStyle(.tint)
                                    Text(r["text"]?.stringValue?.string ?? "").font(.callout).foregroundStyle(.primary).lineLimit(3)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.interactivePlain)
                        }
                    }
                }
                .padding(10)
                .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                .frame(maxWidth: 560, alignment: .leading)
            }
            HStack(spacing: 6) {
                if !note { Label(m.kind == .aiReply ? "Berean" : "Asked Berean", systemImage: "sparkles").labelStyle(.titleAndIcon) }
                Text(Date(timeIntervalSince1970: m.time / 1000).formatted(date: .omitted, time: .shortened))
                if m.editedAt != nil { Text("Edited") }
            }
            .font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .contextMenu {
            Button("Reply", systemImage: "arrowshape.turn.up.left") { replyTo = m; composerFocused = true }
            Button("Copy", systemImage: "doc.on.doc") { Clipboard.copy(m.content.isEmpty ? m.preview : m.content) }
            if note {
                Button("Edit", systemImage: "pencil") { editText = m.content; editing = m }
            }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { try? app.chats?.deleteMessage(chatId: chat.id, messageId: m.id); reload() }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let replyTo {
                HStack {
                    Label("Replying to: \(String(replyTo.preview.prefix(60)))", systemImage: "arrowshape.turn.up.left").font(.caption).lineLimit(1)
                    Spacer()
                    Button("Cancel Reply", systemImage: "xmark.circle.fill") { self.replyTo = nil }.labelStyle(.iconOnly).buttonStyle(.plain)
                }
                .foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(chatId == nil ? "Write a note (Unfiled)" : "Write a note", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...8).focused($composerFocused)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.quaternary.opacity(0.6), in: .rect(cornerRadius: 18))
                    .onSubmit(send)
                Button("Send", systemImage: "arrow.up.circle.fill") { send() }
                    .labelStyle(.iconOnly).font(.title2).buttonStyle(.plain).foregroundStyle(.tint)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding(12)
        .background(.bar)
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let svc = app.chats else { return }
        let target = chatId ?? ChatsService.unfiledId
        // A reply stays in the replied-to message's conversation.
        let replyChat = replyTo.flatMap { r in items.first { $0.message.id == r.id }?.chat.id } ?? target
        try? svc.upsert(chatId: replyChat, messages: [svc.noteMessage(text, inReplyTo: replyTo?.id)])
        draft = ""; replyTo = nil
        reload()
    }

    private func saveEdit(_ chat: ChatsService.Chat) {
        guard let m = editing else { return }
        let text = editText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { try? app.chats?.editMessage(chatId: chat.id, messageId: m.id, text: text) }
        editing = nil
        reload()
    }
}
