# YouTube tab (M01) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED (partial); iPhone VERIFIED (sim); Mac built** (no Mac clicks — HANDOFF incident rule).

- `apple/Shared/YouTubeTabView.swift` (SwiftUI `WebPage`/`WebView`, iOS 26+/macOS 26+; iOS 18–25 shows "YouTube Needs iOS 26"). `youtube` tab in the YouTube space, original state keys `{videoId, playlistId, url}`; the tab title follows the page title.
- Home: YouTube Home + the original's 37 hard-coded channel handles (`electron/ipc/youtube.ts` CHANNELS) → `/@handle/videos`. Sign-in uses the WebKit default store, so it persists.
- iOS plays inline (`mediaPlaybackBehavior = .allowsInlinePlayback`) — without it the first tap went straight to full screen.
- Toolbar: Back, Channels, Timestamp menu → Copy Timestamp Link, Copy Video Link, Insert into “<open note>”. Format matches the original: `[Channel — Title — m:ss](https://youtu.be/ID?t=secs)`.
- Mac sandbox: `ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES` added to BereanMac.xcconfig.
- Entry points: Mac Go → YouTube, ⌘K palette, Go sheet, iPhone More → Study Tools → YouTube.
- Verified on sim: channel list → @matthewforyeshua videos → video plays inline; DB tab row `{"playlistId":null,"url":"https://m.youtube.com/watch?v=…","videoId":"…"}`.
- Known: YouTube's mobile bottom bar sits just under Berean's floating dock (usable, slightly crowded). NOT ported: scraped feed/grid of new videos, two-panel layout, transcripts (Q10/M04), auto PiP (M02), add-channel allow-list prompt (the original never had it either).

## Mac check (click-free, isolated QA library `claude-20261120`)
- Go → YouTube (menu by PID) shows the channel home; the signed app has `com.apple.security.network.client`.
- Tab state seeded with `@matthewforyeshua/videos` → relaunch restores and loads the channel page (desktop YouTube) in the sandbox.
- Fixed: sidebar tab title stayed "YouTube" because the page title arrives after the URL change — the tab title now follows `page.title`.

## Picture in Picture (M02) and page lifetime
- Each YouTube tab's `WebPage` now lives in `AppModel.youtubePages` while the tab is open: switching tabs and back keeps the page, scroll and playback position (verified: comments sheet still open, no reload). Closing the tab drops the page.
- PiP button in the toolbar (on watch pages) and **⇧⌘P** on Mac (original Cmd+Shift+P) toggle WebKit's `webkitSetPresentationMode` — verified on iPhone sim (floating player + "playing in picture in picture"). PiP keeps playing while you scroll the page or leave the app.
- **Not achieved: auto-PiP when switching Berean tabs** (original `autoPiP`). Tried and reverted, with evidence:
  1. Calling PiP from `onDisappear` → WebKit stayed `inline` (the view was already out of the window).
  2. Parking the page in a hidden 2×2 host first → WebKit reported `picture-in-picture` and `paused=false`, but iOS never showed the PiP window (system PiP needs a user gesture).
  3. Parking an already-PiP page in the host during the switch → the app process ended ("Scene client is invalid") — the same page briefly in two web views.
  A manual PiP also ends when you switch Berean tabs. A real fix needs one WebView kept mounted across tabs (e.g., an always-present YouTube layer in the root that the tab only positions), which is a larger layout change — queued.
