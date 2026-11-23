import SwiftUI
import BereanNotes
import BereanReference
#if os(iOS)
import UIKit
#endif

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

    private var filteredConversations: [ChatsService.Chat] {
        chats.filter { chat in
            !chat.isUnfiled && (search.isEmpty || chat.title.localizedCaseInsensitiveContains(search)
                || chat.messages.contains { $0.displayPreview.localizedCaseInsensitiveContains(search) })
        }
    }

    var body: some View {
        let conversations = filteredConversations
        let pinned = conversations.filter { $0.pinnedAt != nil }.sorted { ($0.pinnedAt ?? "") > ($1.pinnedAt ?? "") }
        let unpinned = conversations.filter { $0.pinnedAt == nil }
        let folders = Set(unpinned.compactMap(\.folder)).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        let loose = unpinned.filter { $0.folder == nil }
        NavigationSplitView {
            List(selection: $selection) {
                Label("All Messages", systemImage: "tray.full")
                    .font(.body.weight(.medium)).padding(.vertical, 6).tag(Selection.all)
                if !pinned.isEmpty { Section("Pinned") { ForEach(pinned) { row($0, folders: folders) } } }
                ForEach(folders, id: \.self) { f in
                    Section(f) { ForEach(unpinned.filter { $0.folder == f }) { row($0, folders: folders) } }
                }
                Section("Conversations") {
                    if loose.isEmpty && pinned.isEmpty && folders.isEmpty {
                        Text(search.isEmpty ? "No conversations yet" : "No conversations match").foregroundStyle(.secondary)
                    }
                    ForEach(loose) { row($0, folders: folders) }
                }
            }
            .navigationTitle("Berean Chat")
            #if os(iOS)
            .searchable(text: $search, prompt: "Find a conversation")
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            #else
            .listStyle(.sidebar)
            // Only the thread owns a search toolbar item. Two .searchable
            // columns can create duplicate NSToolbar search identifiers.
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Find conversation", text: $search).textFieldStyle(.plain)
                    if !search.isEmpty {
                        Button("Clear conversation search", systemImage: "xmark.circle.fill") { search = "" }
                            .labelStyle(.iconOnly).buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                }
                .font(.callout).padding(.horizontal, 10).frame(minHeight: 34)
                .glassEffectCompat(interactive: true)
                .padding(10)
            }
            #endif
            .toolbar {
                if let onDone {
                    ToolbarItem(id: "chat-done", placement: .cancellationAction) { Button("Done", action: onDone) }
                }
                ToolbarItem(id: "chat-new-conversation", placement: .primaryAction) {
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

    private func row(_ c: ChatsService.Chat, folders: [String]) -> some View {
        HStack(spacing: 12) {
            Image(systemName: c.pinnedAt == nil ? "bubble.left.and.text.bubble.right" : "pin.fill")
                .font(.body.weight(.medium)).foregroundStyle(.tint)
                .frame(width: 36, height: 36)
                .background(Color.accentColor.opacity(0.10), in: .rect(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(c.title).font(.body.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    if let date = ChatsService.time(c.updatedAt) {
                        let updated = Date(timeIntervalSince1970: date / 1000)
                        Text(updated.formatted(Calendar.current.isDateInToday(updated)
                                               ? .dateTime.hour().minute() : .dateTime.month(.abbreviated).day()))
                            .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                            .accessibilityLabel(updated.formatted(date: .complete, time: .shortened))
                    }
                }
                Text(c.messages.last?.displayPreview ?? "Start the conversation")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        .contentShape(.rect)
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
    #if os(macOS)
    @Environment(\.dismissWindow) private var dismissWindow
    #endif
    let chatId: String?
    @State private var items: [ChatsService.StreamItem] = []
    @State private var scrollTarget: ChatsService.MessageAddress?
    @State private var title = "All Messages"
    @SceneStorage private var draft: String
    @State private var replyTo: ChatsService.StreamItem?
    @State private var destinationID = ChatsService.unfiledId
    @State private var destinations: [ChatsService.Chat] = []
    @State private var saveError: String?
    @State private var editing: ChatsService.StreamItem?
    @State private var editText = ""
    @State private var search = ""
    @State private var showingSearch = false
    @FocusState private var searchFocused: Bool
    #if os(iOS)
    @State private var composerFocused = false
    #else
    @FocusState private var composerFocused: Bool
    #endif

    init(chatId: String?) {
        self.chatId = chatId
        _draft = SceneStorage(wrappedValue: "", "berean.chat.draft." + (chatId ?? "all"))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        VStack(alignment: .leading, spacing: 16) {
                            if index == 0 || !Calendar.current.isDate(Date(timeIntervalSince1970: item.message.time / 1000),
                                                                      inSameDayAs: Date(timeIntervalSince1970: items[index - 1].message.time / 1000)) {
                                Text(Date(timeIntervalSince1970: item.message.time / 1000).formatted(date: .complete, time: .omitted))
                                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity).padding(.top, 8)
                            }
                            bubble(item.chat, item.message)
                        }
                        .id(item.id)
                    }
                }
                .scrollTargetLayout()
                .padding(16)
                .frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            // A bound target survives the first lazy layout after the asynchronous load.
            // An imperative scrollTo can run before the message has a laid-out frame.
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .scrollPosition(id: $scrollTarget, anchor: .bottom)
            .overlay {
                if items.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "No Messages" : "No Results", systemImage: "bubble.left.and.text.bubble.right",
                                           description: Text(search.isEmpty ? "Keep quick thoughts, references and questions together." : "Try another word."))
                }
            }
            .onChange(of: items.last?.id) { previous, id in
                if previous == nil { scrollTarget = id }
                else { withAnimation(.smooth) { scrollTarget = id } }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer.padding(.horizontal, 16).padding(.vertical, 8)
        }
        .navigationTitle(title)
        #if os(iOS)
        .safeAreaInset(edge: .top, spacing: 0) {
            if showingSearch {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search messages", text: $search).textFieldStyle(.plain).focused($searchFocused)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button("Close message search", systemImage: "xmark.circle.fill") {
                        showingSearch = false; search = ""; searchFocused = false
                    }
                    .labelStyle(.iconOnly).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16).frame(minHeight: 48)
                .glassEffectCompat(interactive: true)
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Search messages", systemImage: "magnifyingglass") {
                    showingSearch = true; searchFocused = true
                }
            }
        }
        #else
        .searchable(text: $search, prompt: "Search messages")
        #endif
        .task(id: "\(app.chatsRevision)|\(search)") { reload() }
        .alert(saveError?.hasPrefix("The message wasn’t deleted") == true ? "Message Couldn’t Be Deleted" : "Message Couldn’t Be Saved", isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("OK") { saveError = nil }
        } message: { Text(saveError ?? "Your message is still in the composer. Try again.") }
    }

    private func reload() {
        guard let svc = app.chats else { return }
        destinations = ((try? svc.all()) ?? []).filter { !$0.isUnfiled }
        if destinationID != ChatsService.unfiledId && !destinations.contains(where: { $0.id == destinationID }) {
            destinationID = ChatsService.unfiledId
        }
        if let chatId, let c = try? svc.chat(chatId) {
            title = c.title
            let needle = search.lowercased()
            items = c.messages.filter { needle.isEmpty || $0.content.lowercased().contains(needle) || $0.preview.lowercased().contains(needle) }.map { .init(chat: c, message: $0) }
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
                Label(parent.map { String($0.displayPreview.prefix(80)) } ?? "Original message deleted", systemImage: "arrowshape.turn.up.left")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if editing?.id == ChatsService.MessageAddress(chatID: chat.id, messageID: m.id) {
                TextField("Message", text: $editText, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...8)
                    .onSubmit { saveEdit(chat) }
                HStack {
                    Button("Cancel") { editing = nil }
                    Button("Save") { saveEdit(chat) }.buttonStyle(.borderedProminent)
                }.controlSize(.small)
            } else {
                MarkdownText(ChatReferenceLinks.markdown(m.content.isEmpty ? m.preview : m.content, hermas: app.hermasEdition), expands: false)
                    .font(.body).textSelection(.enabled)
                    .environment(\.openURL, messageLinkAction)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .foregroundStyle(.primary)
                    .background(mine ? Color.accentColor.opacity(0.13) : Color.secondary.opacity(0.09), in: .rect(cornerRadius: 22))
                    .frame(maxWidth: 560, alignment: mine ? .trailing : .leading)
                    .accessibilitySortPriority(1)
                    // VoiceOver: the long-press menu's actions, without the long press.
                    .accessibilityAction(named: "Reply") { replyTo = .init(chat: chat, message: m); composerFocused = true }
                    .accessibilityAction(named: "Copy") { Clipboard.copy(m.content.isEmpty ? m.preview : m.content) }
                    .accessibilityAction(named: "Delete") { deleteMessage(chat, m) }
            }
            if m.kind == .aiReply, let verses = m.raw["results"]?.arrayValue, !verses.isEmpty {
                // Verses the answer found (original results / visibleCount), as tappable references.
                let shown = verses.prefix(max(1, Int(m.raw["visibleCount"]?.numberValue ?? 6)))
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, r in
                        if let book = r["bookId"]?.stringValue?.string, let ch = r["chapter"]?.numberValue, let v = r["verse"]?.numberValue {
                            Button {
                                app.openBereanLink(.verse(bookId: book, chapter: Int(ch), verse: Int(v), textId: r["textId"]?.stringValue?.string))
                                revealMainDocument()
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
            // Read who/when first, as one phrase, then the message (was three loose fragments after it).
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(messageMetaLabel(m, note: note))
            .accessibilitySortPriority(2)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .contain)
        .contextMenu {
            Button("Reply", systemImage: "arrowshape.turn.up.left") { replyTo = .init(chat: chat, message: m); composerFocused = true }
            Button("Copy", systemImage: "doc.on.doc") { Clipboard.copy(m.content.isEmpty ? m.preview : m.content) }
            if note {
                Button("Edit", systemImage: "pencil") { editText = m.content; editing = .init(chat: chat, message: m) }
            }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { deleteMessage(chat, m) }
        }
    }

    private func messageMetaLabel(_ m: ChatsService.Message, note: Bool) -> String {
        let who = note ? "You" : (m.kind == .aiReply ? "Berean" : "You asked Berean")
        let time = Date(timeIntervalSince1970: m.time / 1000).formatted(date: .omitted, time: .shortened)
        return [who, time, m.editedAt != nil ? "edited" : nil].compactMap { $0 }.joined(separator: ", ")
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if chatId == nil, replyTo == nil {
                Menu {
                    Button("Unfiled") { destinationID = ChatsService.unfiledId }
                    ForEach(destinations) { chat in
                        Button(chat.title) { destinationID = chat.id }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Text("To:").foregroundStyle(.secondary)
                        Text(destinations.first { $0.id == destinationID }?.title ?? "Unfiled").lineLimit(1)
                        Image(systemName: "arrow.up.arrow.down").font(.caption2)
                    }
                    .font(.subheadline).padding(.horizontal, 10).padding(.vertical, 5)
                    .contentShape(.rect)
                }
                .buttonStyle(.bordered).controlSize(.small).menuIndicator(.hidden)
                .accessibilityLabel("Choose message conversation")
            }
            if let replyTo {
                HStack {
                    Label("Replying to: \(String(replyTo.message.displayPreview.prefix(60)))", systemImage: "arrowshape.turn.up.left").font(.caption).lineLimit(1)
                    Spacer()
                    Button("Cancel Reply", systemImage: "xmark.circle.fill") { self.replyTo = nil }.labelStyle(.iconOnly).buttonStyle(.plain)
                }
                .foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 8) {
                composerInput
                    .padding(.horizontal, 12)
                    .background(.quaternary.opacity(0.45), in: .rect(cornerRadius: 20))
                Button("Send", systemImage: "arrow.up.circle.fill") { send() }
                    .labelStyle(.iconOnly).font(.system(size: 30)).buttonStyle(.plain).foregroundStyle(.tint)
                    .frame(width: 44, height: 44).contentShape(.circle)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding(12)
        .modifier(ChatComposerSurface())
    }

    @ViewBuilder private var composerInput: some View {
        #if os(iOS)
        ChatMessageEditor(text: $draft, focused: $composerFocused)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .topLeading) {
                if draft.isEmpty {
                    Text("Message").foregroundStyle(.tertiary)
                        .padding(.horizontal, 5).padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
            }
            .font(.body)
        #else
        TextField("Message", text: $draft, axis: .vertical)
            .textFieldStyle(.plain).lineLimit(1...8).focused($composerFocused)
            .padding(.vertical, 8)
            .onSubmit(send)
        #endif
    }

    private var messageLinkAction: OpenURLAction {
        OpenURLAction { url in
            if let route = DeepLink.parse(url.absoluteString, hermas: app.hermasEdition) {
                app.openBereanLink(route)
                if case .chat = route { return .handled }
                revealMainDocument()
                return .handled
            }
            if let video = YouTubeLink.parse(url.absoluteString) {
                app.openYouTubeVideo(video.videoId, startMs: video.startMs)
                revealMainDocument()
                return .handled
            }
            // Match the original Chat renderer's external-link policy. Custom
            // and file schemes do not leave Chat through the system opener.
            return ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
        }
    }

    private func revealMainDocument() {
        #if os(macOS)
        dismissWindow(id: "chat")
        #else
        app.chatShown = false
        #endif
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let svc = app.chats else { return }
        let target = replyTo?.id.chatID ?? chatId ?? destinationID
        do {
            try svc.upsert(chatId: target, messages: [svc.noteMessage(text, inReplyTo: replyTo?.id.messageID)])
            draft = ""; replyTo = nil
            reload()
        } catch {
            saveError = "Your message is still in the composer. " + error.localizedDescription
        }
    }

    /// Deleting used to ignore failures; now a failed delete says so and the message stays.
    private func deleteMessage(_ chat: ChatsService.Chat, _ m: ChatsService.Message) {
        do {
            try app.chats?.deleteMessage(chatId: chat.id, messageId: m.id)
            reload()
        } catch {
            saveError = "The message wasn’t deleted. " + error.localizedDescription
        }
    }

    private func saveEdit(_ chat: ChatsService.Chat) {
        guard let item = editing, item.chat.id == chat.id else { return }
        let text = editText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let service = app.chats else { return }
        do {
            try service.editMessage(chatId: item.id.chatID, messageId: item.id.messageID, text: text)
            editing = nil
            reload()
        } catch { saveError = "Your edit is still open. " + error.localizedDescription }
    }
}

/// A single quiet glass group, with an opaque accessibility fallback.
private struct ChatComposerSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.background, in: .rect(cornerRadius: 24))
                .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(.secondary.opacity(0.2)).allowsHitTesting(false) }
        } else if #available(macOS 26.0, iOS 26.0, *) {
            content.glassEffect(.regular, in: .rect(cornerRadius: 24))
        } else {
            content.background(.regularMaterial, in: .rect(cornerRadius: 24))
        }
    }
}

#if os(iOS)
/// A compact native message input. Smart punctuation must not rewrite Markdown
/// table separators or code while the user is composing a message.
private struct ChatMessageEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.accessibilityLabel = "Message"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
            view.invalidateIntrinsicContentSize()
        }
        if focused, !view.isFirstResponder { view.becomeFirstResponder() }
        else if !focused, view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        let line = uiView.font?.lineHeight ?? 20
        let height = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        return CGSize(width: width, height: min(line * 8 + 16, max(line + 16, height)))
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ChatMessageEditor
        init(_ parent: ChatMessageEditor) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            textView.invalidateIntrinsicContentSize()
        }
        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.focused { parent.focused = true }
        }
        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.focused { parent.focused = false }
        }
    }
}
#endif


private extension ChatsService.Message {
    /// A presentation-only excerpt. Keep the legacy service preview/title grammar
    /// and saved source intact, while hiding image payloads and link destinations.
    var displayPreview: String {
        let source = content.isEmpty ? preview : content
        let plain = MarkdownLiveSpans.plainText(source).split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if !plain.isEmpty { return plain }
        if source.contains("![") && !NoteImages.find(in: source).isEmpty { return "Image" }
        return preview
    }
}
