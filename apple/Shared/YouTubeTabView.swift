import SwiftUI
import TipKit
import WebKit
import BereanCore
import BereanWorkspace
import BereanNotes

/// YouTube tab (original YouTubeTab, `youtube` tab type with `{videoId, playlistId, url}` state):
/// a WebKit page — channel home (the original's allow-listed channels), browse and watch with the
/// normal YouTube site (sign-in persists in WebKit's store). The watched video is saved back to
/// the tab state with the original keys. Copy Timestamp Link / Insert into Note produce the
/// original's Markdown: `[Channel — Title — m:ss](https://youtu.be/ID?t=secs)`.
@available(iOS 26.0, macOS 26.0, *)
struct YouTubeTabView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var page: WebPage

    init(tabId: String, app: AppModel) {
        self.tabId = tabId
        if let existing = app.youtubePages[tabId] as? WebPage {
            _page = State(initialValue: existing)
            _showingHome = State(initialValue: existing.url == nil)
        } else {
            var config = WebPage.Configuration()
            #if os(iOS)
            // Play inline (the original's in-tab player), not straight into full screen.
            config.mediaPlaybackBehavior = .allowsInlinePlayback
            #endif
            let page = WebPage(configuration: config)
            app.youtubePages[tabId] = page
            _page = State(initialValue: page)
        }
    }

    @State private var showingHome = true
    @State private var lastSaved: String?
    @State private var transcriptShown = false
    @State private var playbackMs: Int?

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
        .onAppear {
            // Drop pages of closed YouTube tabs (stops their playback).
            for id in app.youtubePages.keys where app.findTab(id) == nil { app.youtubePages[id] = nil }
            if page.url == nil { restore() }
        }
        .onDisappear {
            // A closed tab's page is dropped (stops playback); an open tab keeps its page for when you return.
            if app.findTab(tabId) == nil { app.youtubePages[tabId] = nil }
        }
        .onChange(of: app.pipToggleRequest) { _, _ in Task { await togglePiP() } }
        .onChange(of: app.youtubeLoadRequest?.nonce) { _, _ in
            if let r = app.youtubeLoadRequest, r.tabId == tabId { load(r.url); app.youtubeLoadRequest = nil }
        }
        .task {
            // A request made just before this view existed (tab switched to in the same update).
            if let r = app.youtubeLoadRequest, r.tabId == tabId { load(r.url); app.youtubeLoadRequest = nil }
        }
        .onChange(of: page.url) { _, url in persist(url) }
        .onChange(of: page.title) { _, raw in
            // The title usually arrives after the URL change.
            let title = raw.replacingOccurrences(of: " - YouTube", with: "").trimmingCharacters(in: .whitespaces)
            guard !showingHome, !title.isEmpty, app.findTab(tabId)?.title != title else { return }
            app.update(tabId, recordHistory: false) { $0.title = title }
        }
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
                if let id = Self.videoId(from: page.url), let segments = try? app.transcripts?.transcript(id), !segments.isEmpty {
                    Button("Transcript", systemImage: "text.quote") { transcriptShown = true }
                        .help("Show the transcript; click a line to jump there")
                        .popover(isPresented: $transcriptShown) {
                            TranscriptList(segments: segments, currentMs: playbackMs) { ms in Task { await seek(ms) } }
                                .task {
                                    // Follow playback while the transcript is open.
                                    while !Task.isCancelled {
                                        let t = (try? await page.callJavaScript("var v=document.querySelector('video');return v?v.currentTime:null;")) as? Double
                                        playbackMs = t.map { Int($0 * 1000) }
                                        try? await Task.sleep(for: .milliseconds(500))
                                    }
                                }
                                .frame(minWidth: 340, idealWidth: 380, minHeight: 420)
                                .presentationDetents([.medium, .large])
                        }
                }
                if Self.videoId(from: page.url) != nil {
                    Button("Picture in Picture", systemImage: "pip.enter") { PiPTip().invalidate(reason: .actionPerformed); Task { await togglePiP() } }
                        .help("Picture in Picture (⇧⌘P)")
                        .popoverTip(PiPTip())
                }
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

    private func seek(_ ms: Int) async {
        _ = try? await page.callJavaScript("var v=document.querySelector('video');if(v){v.currentTime=t;v.play();}",
                                           arguments: ["t": Double(ms) / 1000])
    }

    // MARK: Picture in Picture (WebKit presentation mode on the page's <video>)

    private func setPresentation(_ mode: String) async {
        _ = try? await page.callJavaScript("""
        var v=document.querySelector('video');
        if(v&&v.webkitSupportsPresentationMode&&v.webkitPresentationMode!==mode&&!(mode==='inline'&&v.webkitPresentationMode==='inline')){v.webkitSetPresentationMode(mode);}
        return v?v.webkitPresentationMode:null;
        """, arguments: ["mode": mode])
    }

    private func togglePiP() async {
        let mode = ((try? await page.callJavaScript("var v=document.querySelector('video');return v?v.webkitPresentationMode:'';")) as? String) ?? ""
        await setPresentation(mode == "picture-in-picture" ? "inline" : "picture-in-picture")
    }

    /// The original's Markdown link text.
    private func markdown(timestamp: Bool) async -> String? {
        guard let id = Self.videoId(from: page.url) else { return nil }
        let secs = timestamp ? Int(((try? await page.callJavaScript("var v=document.querySelector('video');return v?v.currentTime:0;")) as? Double) ?? 0) : 0
        // Desktop selectors first; the iPhone loads m.youtube.com, whose owner markup differs (A13),
        // so fall back to schema.org author metadata, the mobile owner name, then player data for
        // this same video id.
        let channel = ((try? await page.callJavaScript("""
        var a=document.querySelector('#owner #channel-name a, ytd-channel-name a');
        if(a&&a.textContent.trim()){return a.textContent.trim();}
        var m=document.querySelector('span[itemprop="author"] link[itemprop="name"]');
        if(m&&m.getAttribute('content')){return m.getAttribute('content').trim();}
        var s=document.querySelector('.slim-owner-channel-name, ytm-slim-owner-renderer .slim-owner-title');
        if(s&&s.textContent.trim()){return s.textContent.trim();}
        var d=window.ytInitialPlayerResponse&&window.ytInitialPlayerResponse.videoDetails;
        if(d&&d.videoId===vid&&d.author){return d.author;}
        return '';
        """, arguments: ["vid": id])) as? String) ?? ""
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



/// Searchable transcript lines with timestamps (original TranscriptViewer); a tap seeks the video.
struct TranscriptList: View {
    let segments: [TranscriptService.Segment]
    var currentMs: Int? = nil
    let seek: (Int) -> Void
    @State private var query = ""
    private var shown: [TranscriptService.Segment] {
        query.isEmpty ? segments : segments.filter { $0.text.localizedCaseInsensitiveContains(query) }
    }
    /// The segment being spoken: the last one starting at or before the playback time.
    private var currentStart: Int? {
        guard let currentMs else { return nil }
        return segments.last { $0.startMs <= currentMs }?.startMs
    }
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List(shown, id: \.startMs) { seg in
                    let current = seg.startMs == currentStart
                    Button { seek(seg.startMs) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(TranscriptService.clock(seg.startMs)).font(.caption.monospacedDigit()).foregroundStyle(.tint)
                            Text(seg.text).foregroundStyle(.primary).fontWeight(current ? .semibold : .regular)
                        }
                    }
                    .buttonStyle(.interactivePlain)
                    .listRowBackground(current ? Color.accentColor.opacity(0.14) : nil)
                    .accessibilityAddTraits(current ? .isSelected : [])
                    .id(seg.startMs)
                }
                .onChange(of: currentStart) { _, start in
                    guard query.isEmpty, let start else { return }
                    withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(start, anchor: .center) }
                }
            }
            .overlay { if shown.isEmpty { ContentUnavailableView.search(text: query) } }
            .searchable(text: $query, prompt: "Search transcript")
            .navigationTitle("Transcript")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
    }
}
