import BereanCore

/// The five sidebar Spaces (`SpaceId`).
public enum SpaceId: String, CaseIterable, Sendable, Codable, Identifiable {
    case scripture, notes, lexicon, youtube, search
    public var id: String { rawValue }
}

/// Tab types (`TabType`). Unknown types from a newer app are kept as their raw string.
public enum TabType: String, CaseIterable, Sendable {
    case bible, note, lexicon, youtube, search, pdf, tags, history, settings, calendar
}

/// One tab. `state` is the tab's JSON state object, kept as an ordered JavaScript object so fields this
/// build does not know about (from newer apps or other devices) survive a round trip unchanged.
public struct Tab: Equatable, Sendable, Identifiable {
    public var id: String
    public var spaceId: SpaceId
    public var type: String
    public var title: String
    public var state: JSObject
    public var isPinned: Bool
    public var originTabId: String?
    public var originSpaceId: SpaceId?

    public init(id: String, spaceId: SpaceId, type: String, title: String, state: JSObject = JSObject(), isPinned: Bool = false,
                originTabId: String? = nil, originSpaceId: SpaceId? = nil) {
        self.id = id; self.spaceId = spaceId; self.type = type; self.title = title; self.state = state
        self.isPinned = isPinned; self.originTabId = originTabId; self.originSpaceId = originSpaceId
    }

    public var tabType: TabType? { TabType(rawValue: type) }

    /// Redirect a copied tab to its copied origin when both belong to the workspace.
    public func remappingOrigin(using copiedIDs: [String: String]) -> Tab {
        guard let originTabId, let replacement = copiedIDs[originTabId] else { return self }
        var tab = self
        tab.originTabId = replacement
        return tab
    }
}

/// Which tab-state fields synchronise and which stay on this device — port of src/platform/sync/tabFields.ts
/// (allow-lists: a field not listed is dropped from storage, so nothing leaks to other devices by accident).
public enum TabFields {
    static let sync: [TabType: [String]] = [
        .bible: ["bookId", "chapter", "endChapter", "verse", "endVerse", "translation", "showStrongs", "compareMode", "compareColumns",
                 "compareSyncScroll", "hiddenAnnotations", "rightPanelTab", "rightPanelNoteId", "rightPanelLexiconEntry",
                 "rightPanelVerseFilter", "rightPanelSlotBTabs", "rightPanelSlotB", "rightPanelNoteIdB", "rightPanelLexiconEntryB",
                 "rightPanelVerseFilterB", "searchMode", "scriptureSearchQuery", "scriptureLayout", "searchTextId", "searchWordMode",
                 "searchTestamentFilter", "searchBookFilter", "searchSortMode", "searchTagFilter", "searchTagFilterAll",
                 "noteBack", "scriptureBack", "searchBack"],
        .note: ["noteId", "isNew", "verseRef", "homeView"],
        .lexicon: ["strongsNum", "searchQuery", "searchLang", "lexHistory"],
        .youtube: ["videoId", "playlistId", "url", "youtubeLayout", "panelA", "panelB"],
        .search: ["query"],
        .pdf: ["pdfId", "title", "page"],
        .tags: ["selectedTagId"],
        .history: ["category", "studyOnly"],
        .settings: ["section"],
        .calendar: ["month", "selected"],
    ]
    static let local: [TabType: [String]] = [
        .bible: ["nativeSelectedVerses", "scrollPosition", "rightPanelOpen", "rightPanelWidth", "bottomPanelHeight", "rightPanelNoteCursor",
                 "rightPanelNoteFocused", "rightPanelExpandAll", "rightPanelExpandAllB", "rightPanelScrollTop", "rightPanelScrollTopB",
                 "rightPanelScrollTops", "rightPanelScrollTopsB",
                 "rightPanelNoteCursorB", "rightPanelNoteFocusedB", "searchScrollTop", "searchScrollAnchor", "searchSortDirection", "searchPreview"],
        .note: ["scrollTop", "cursorPos", "listScrollTop", "continuousDailyDate"],
        .lexicon: ["scrollTop", "searchScrollTop"],
        .youtube: ["scrollTop"],
        .search: ["scrollTop", "results", "scope", "filters", "preview"],
        .pdf: ["scrollTop"],
        .tags: [], .history: [],
        .settings: ["settingsRoute"],
        .calendar: [],
    ]
    static let nestedLocal: [TabType: [String: [String]]] = [
        .bible: ["compareColumns": ["scrollPos"]],
        .note: ["homeView": ["previewNoteId", "previewFolderId"]],
    ]

    static func strip(_ o: JSObject, _ keys: [String]) -> (copy: JSObject, local: JSObject) {
        var copy = o, local = JSObject()
        for k in keys { if let v = copy[k] { local[k] = v; copy.remove(JSString(k)) } }
        return (copy, local)
    }

    /// `splitTabState`.
    public static func split(type: TabType, state: JSObject) -> (sync: JSObject, local: JSObject) {
        var sync = JSObject(), local = JSObject()
        for k in Self.sync[type] ?? [] {
            guard var v = state[k] else { continue }
            if let nl = nestedLocal[type]?[k] {
                if case .array(let items) = v {
                    let stripped = items.map { item -> (JSValue, JSObject) in
                        if case .object(let o) = item { let s = strip(o, nl); return (.object(s.copy), s.local) }
                        return (item, JSObject())
                    }
                    v = .array(stripped.map(\.0))
                    if stripped.contains(where: { !$0.1.isEmpty }) { local[k] = .array(stripped.map { .object($0.1) }) }
                } else if case .object(let o) = v {
                    let s = strip(o, nl)
                    v = .object(s.copy)
                    if !s.local.isEmpty { local[k] = .object(s.local) }
                }
            }
            sync[k] = v
        }
        for k in Self.local[type] ?? [] { if let v = state[k] { local[k] = v } }
        return (sync, local)
    }

    /// `mergeTabState`.
    public static func merge(type: TabType, sync: JSObject, local: JSObject) -> JSObject {
        var out = sync
        for (k, v) in local.entries {
            if nestedLocal[type]?[k.string] != nil, out[k] != nil, v.objectValue != nil || v.arrayValue != nil {
                let base = out[k]!
                if case .array(let b) = base, case .array(let l) = v {
                    out[k] = .array(b.enumerated().map { i, item in
                        if case .object(var o) = item, i < l.count, case .object(let lo) = l[i] { for (lk, lv) in lo.entries { o[lk] = lv }; return .object(o) }
                        return item
                    })
                } else if case .object(var o) = base, case .object(let lo) = v {
                    for (lk, lv) in lo.entries { o[lk] = lv }
                    out[k] = .object(o)
                }
                continue
            }
            out[k] = v
        }
        return out
    }
}
