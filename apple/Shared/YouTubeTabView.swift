import SwiftUI
import WebKit
import BereanCore
import BereanWorkspace

/// YouTube tab (original YouTubeTab, `youtube` tab type with `{videoId, playlistId, url}` state):
/// a WebKit page — channel home (the original's allow-listed channels), browse and watch with the
/// normal YouTube site (sign-in persists in WebKit's store). The watched video is saved back to
/// the tab state with the original keys. Copy Timestamp Link / Insert into Note produce the
/// original's Markdown: `[Channel — Title — m:ss](https://youtu.be/ID?t=secs)`.
@available(iOS 26.0, macOS 26.0, *)
struct YouTubeTabView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var page: WebPage = {
        var config = WebPage.Configuration()
        #if os(iOS)
        // Play inline (the original's in-tab player), not straight into full screen.
        config.mediaPlaybackBehavior = .allowsInlinePlayback
        #endif
        return WebPage(configuration: config)
    }()
    @State private var showingHome = true
    @State private var lastSaved: String?

    /// electron/ipc/youtube.ts CHANNELS (hard-coded allow-list in the original).
    static let channels = ["@matthewforyeshua", "@andrewrepent", "@SpiritofTruth.Remnant", "@matthew953", "@antonio-praiseyah3137",
        "@matthewg44yehovah", "@marinaforyehovah", "@TheNarrowWay_144", "@a.k.a.watchmenwakeup", "@TheWrathOfGodIsComing", "@joseph_amoz",
        "@meg__yeshua", "@Tee4Yahovah", "@kathiholmes144", "@s2milne", "@Chefsammysosa", "@Dub4Yah", "@sandrakluey1856",
        "@yahsavesthroughyeshua", "@Brittneyapeculiarwoman", "@seekhimearly", "@aWatchmanInEphraim144", "@Lookingforlostsheep",
        "@vladimirputin1519", "@Help.Gather.Yahs.People", "@MikePhillips-g4o", "@kaylapsalm684", "@Lylah-h5l", "@OutofTheMouthofBabe144",
        "@JacobTheServant98", "@tishacobb2810", "@YahovasSling", "@Yeshua_1s_King", "@Vinny-h1v", "@Keepthe10CommandmentsEatClean",
        "@KeyofDavid-kz5jn", "@womenrepent"]

    private var state: JSObject { app.findTab(tabId)?.state ?? JSObject() }

    static func videoId(from url: URL?) -> String? {
        guard let url, let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        if comps.host?.contains("youtu.be") == true { return url.pathComponents.dropFirst().first }
        if url.path == "/watch" { return comps.queryItems?.first { $0.name == "v" }?.value }
        if url.path.hasPrefix("/shorts/") { return url.pathComponents.dropFirst(2).first }
        return nil
    }

    var body: some View {
        Group {
            if showingHome { home } else { WebView(page).webViewBackForwardNavigationGestures(.enabled) }
        }
        .navigationTitle(showingHome ? "YouTube" : (page.title.isEmpty ? "YouTube" : page.title.replacingOccurrences(of: " - YouTube", with: "")))
        .toolbar { toolbar }
        .onAppear(perform: restore)
        .onChange(of: page.url) { _, url in persist(url) }
    }

    private func restore() {
        if let s = state["url"]?.stringValue?.string, let url = URL(string: s) { load(url) }
        else if let v = state["videoId"]?.stringValue?.string, let url = URL(string: "https://www.youtube.com/watch?v=\(v)") { load(url) }
    }

    private func load(_ url: URL) {
        showingHome = false
        page.load(URLRequest(url: url))
    }

    private func persist(_ url: URL?) {
        guard let url, url.absoluteString != lastSaved, url.host?.contains("youtube") == true else { return }
        lastSaved = url.absoluteString
        let video = Self.videoId(from: url)
        app.update(tabId, recordHistory: false) { tab in
            tab.state["url"] = .string(JSString(url.absoluteString))
            tab.state["videoId"] = video.map { .string(JSString($0)) } ?? .null
            let title = page.title.replacingOccurrences(of: " - YouTube", with: "")
            if !title.isEmpty { tab.title = title }
        }
    }

    private var home: some View {
        List {
            Section {
                Button { load(URL(string: "https://www.youtube.com")!) } label: { Label("YouTube Home", systemImage: "play.rectangle") }
                    .buttonStyle(.interactivePlain)
            } footer: { Text("Sign in on YouTube to see your subscriptions; it stays signed in.") }
            Section("Channels") {
                ForEach(Self.channels, id: \.self) { handle in
                    Button { load(URL(string: "https://www.youtube.com/\(handle)/videos")!) } label: {
                        Label(handle, systemImage: "person.crop.square")
                    }
                    .buttonStyle(.interactivePlain)
                }
            }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup {
            if !showingHome {
                Button("Back", systemImage: "chevron.backward") { if let item = page.backForwardList.backList.last { page.load(item) } }
                    .disabled(page.backForwardList.backList.isEmpty)
                Button("Channels", systemImage: "list.bullet") { showingHome = true }
                if Self.videoId(from: page.url) != nil {
                    Menu("Timestamp", systemImage: "link.badge.plus") {
                        Button("Copy Timestamp Link", systemImage: "clock") { Task { await copyLink(timestamp: true) } }
                        Button("Copy Video Link", systemImage: "link") { Task { await copyLink(timestamp: false) } }
                        let notes = app.session.allTabs.filter { $0.tabType == .note && $0.state["noteId"]?.stringValue != nil }
                        if !notes.isEmpty {
                            Divider()
                            ForEach(notes, id: \.id) { t in
                                Button("Insert into “\(t.title)”", systemImage: "note.text.badge.plus") {
                                    Task { await insert(into: t.state["noteId"]!.stringValue!.string) }
                                }
                            }
                        }
                    }
                    .menuIndicator(.hidden)
                    .help("Link to this moment of the video")
                }
            }
        }
    }

    /// The original's Markdown link text.
    private func markdown(timestamp: Bool) async -> String? {
        guard let id = Self.videoId(from: page.url) else { return nil }
        let secs = timestamp ? Int(((try? await page.callJavaScript("var v=document.querySelector('video');return v?v.currentTime:0;")) as? Double) ?? 0) : 0
        let channel = ((try? await page.callJavaScript("var a=document.querySelector('#owner #channel-name a, ytd-channel-name a');return a?a.textContent.trim():'';")) as? String) ?? ""
        let title = page.title.replacingOccurrences(of: " - YouTube", with: "").trimmingCharacters(in: .whitespaces)
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        let time = h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
        let base = [channel, title].filter { !$0.isEmpty }.joined(separator: " — ")
        if timestamp {
            let label = base.isEmpty ? time : "\(base) — \(time)"
            return "[\(label)](https://youtu.be/\(id)?t=\(secs))"
        }
        return "[\(base.isEmpty ? id : base)](https://youtu.be/\(id))"
    }

    private func copyLink(timestamp: Bool) async {
        guard let text = await markdown(timestamp: timestamp) else { return }
        Clipboard.copy(text)
        app.userMessage = timestamp ? "Timestamp link copied." : "Video link copied."
    }

    private func insert(into noteId: String) async {
        guard let text = await markdown(timestamp: true), let notes = app.notes, let note = try? notes.one(noteId) else { return }
        let sep = note.content.isEmpty || note.content.hasSuffix("\n") ? "" : "\n"
        try? notes.update(noteId, .init(content: note.content + sep + text + "\n"))
        app.notesRevision += 1
        app.userMessage = "Timestamp added to “\(note.title.isEmpty ? "Untitled" : note.title)”."
    }
}
