import BereanCore

/// Saved-workspace state (the `workspaces.state_json` column) — port of src/lib/workspaceSnapshot.ts.
///
/// v2 is `{v:2, tabs:{space:[Tab]}, activeTabId:{space:id|null}, displayOrder:[id], icon?}`. Every
/// reader goes through `parse`, which accepts v2, v1 (`{tabs, activeTabId}`) and pre-v9 NULL rows
/// (layout-only workspaces), and never throws, so no stored record is lost or rejected.
/// Tabs are kept as JavaScript objects so unknown fields written by other clients survive a round trip.
public enum WorkspaceSnapshot {
    public static let spaces: [SpaceId] = [.scripture, .notes, .lexicon, .youtube, .search]
    static let tabTypes: Set<String> = ["bible", "note", "lexicon", "youtube", "search", "pdf", "tags"]

    public struct Parsed: Equatable, Sendable {
        public var tabs: [SpaceId: [JSObject]]
        public var activeTabId: [SpaceId: String?]
        public var displayOrder: [String]
        public var icon: String?
        public var preferredSpace: SpaceId? = nil
        /// 0 = empty / unreadable, 1 = v1 (or any non-v2 object), 2 = v2.
        public var version: Int

        public func tabs(in space: SpaceId) -> [JSObject] { tabs[space] ?? [] }

        /// `JSON.stringify(parseWorkspaceState(...))` key order — for conformance tests.
        public var jsValue: JSValue {
            var o = JSObject()
            o["tabs"] = .object(spaceObject { .array(tabs(in: $0).map(JSValue.object)) })
            o["activeTabId"] = .object(spaceObject { (activeTabId[$0] ?? nil).map { .string(JSString($0)) } ?? .null })
            o["displayOrder"] = .array(displayOrder.map { .string(JSString($0)) })
            o["version"] = .number(Double(version))
            if let icon { o["icon"] = .string(JSString(icon)) }
            return .object(o)
        }
    }

    static func spaceObject(_ f: (SpaceId) -> JSValue) -> JSObject {
        var o = JSObject()
        for sp in spaces { o[sp.rawValue] = f(sp) }
        return o
    }

    static func isTabLike(_ v: JSValue) -> Bool {
        guard let t = v.objectValue,
              let id = t["id"], id.stringValue != nil,
              let sp = t["spaceId"]?.stringValue, SpaceId(rawValue: sp.string) != nil,
              let ty = t["type"]?.stringValue, tabTypes.contains(ty.string),
              t["title"]?.stringValue != nil else { return false }
        switch t["state"] { case .object?, .array?: return true; default: return false }
    }

    static func unifiedOrder(_ tabs: [SpaceId: [JSObject]], stored: [String]) -> [String] {
        let all = spaces.flatMap { (tabs[$0] ?? []).compactMap { $0["id"]?.stringValue?.string } }
        let present = Set(all)
        let kept = stored.filter { present.contains($0) }
        let seen = Set(kept)
        return kept + all.filter { !seen.contains($0) }
    }

    /// `buildWorkspaceState` — `activeTabId` is the store's object (extra keys are kept, as the spread does).
    public static func build(tabs input: [SpaceId: [JSValue]], activeTabId: JSObject, displayOrder: [String]?, icon: String?) -> JSValue {
        var tabs: [SpaceId: [JSObject]] = [:]
        for sp in spaces { tabs[sp] = (input[sp] ?? []).filter(isTabLike).map { $0.objectValue! } }
        var active = spaceObject { _ in .null }
        for (k, v) in activeTabId.entries { active[k] = v }
        var o = JSObject()
        o["v"] = 2
        o["tabs"] = .object(spaceObject { .array(tabs[$0]!.map(JSValue.object)) })
        o["activeTabId"] = .object(active)
        o["displayOrder"] = .array(unifiedOrder(tabs, stored: displayOrder ?? []).map { .string(JSString($0)) })
        if let icon, !icon.isEmpty { o["icon"] = .string(JSString(icon)) }
        return .object(o)
    }

    /// Builds the v2 state JSON for a native session (what the Mac/iPhone "Save Workspace" writes).
    public static func stateJSON(for session: Session, displayOrder: [String]?, preferredSpace: SpaceId? = nil) -> String {
        var input: [SpaceId: [JSValue]] = [:]
        var active = JSObject()
        for sp in spaces {
            input[sp] = session.tabs(in: sp).map { .object($0.jsObject) }
            active[sp.rawValue] = ((session.activeTabId[sp] ?? nil).map { .string(JSString($0)) }) ?? .null
        }
        let snapshot = build(tabs: input, activeTabId: active, displayOrder: displayOrder, icon: session.icon)
        guard let preferredSpace, !session.tabs(in: preferredSpace).isEmpty,
              var state = snapshot.objectValue else { return JSON.stringifyString(snapshot) }
        state["nativePreferredSpace"] = .string(JSString(preferredSpace.rawValue))
        return JSON.stringifyString(.object(state))
    }

    /// `parseWorkspaceState` — never throws.
    public static func parse(_ stateJSON: String?) -> Parsed {
        let empty = Parsed(tabs: Dictionary(uniqueKeysWithValues: spaces.map { ($0, []) }),
                           activeTabId: Dictionary(uniqueKeysWithValues: spaces.map { ($0, nil) }), displayOrder: [], icon: nil, version: 0)
        guard let stateJSON, !stateJSON.isEmpty, let raw = try? JSON.parse(stateJSON) else { return empty }
        let r: JSObject
        switch raw {
        case .object(let o): r = o
        case .array: r = JSObject()   // typeof [] === 'object'; every field reads undefined
        default: return empty
        }
        let src = r["tabs"]?.objectValue ?? JSObject()
        var tabs: [SpaceId: [JSObject]] = [:]
        for sp in spaces {
            let list = src[sp.rawValue]?.arrayValue ?? []
            tabs[sp] = list.filter(isTabLike).map { v in var t = v.objectValue!; t["spaceId"] = .string(JSString(sp.rawValue)); return t }
        }
        let act = r["activeTabId"]?.objectValue ?? JSObject()
        var activeTabId: [SpaceId: String?] = [:]
        for sp in spaces {
            let id = act[sp.rawValue]?.stringValue?.string
            let ids = tabs[sp]!.compactMap { $0["id"]?.stringValue?.string }
            if let id, !id.isEmpty, ids.contains(id) { activeTabId[sp] = id } else { activeTabId[sp] = ids.first }
        }
        let stored = (r["displayOrder"]?.arrayValue ?? []).compactMap { $0.stringValue?.string }
        let order = unifiedOrder(tabs, stored: stored)
        let version = r["v"]?.numberValue == 2 ? 2 : 1
        return Parsed(tabs: tabs, activeTabId: activeTabId, displayOrder: order, icon: r["icon"]?.stringValue?.string,
                      preferredSpace: r["nativePreferredSpace"]?.stringValue.flatMap { SpaceId(rawValue: $0.string) }, version: version)
    }

    /// The session id a saved workspace opens as (stable, so re-opening switches rather than duplicates).
    public static func sessionId(_ workspaceId: String) -> String { "ws:\(workspaceId)" }
}

public extension Tab {
    /// The tab as the TypeScript store holds it (optional fields only when set).
    var jsObject: JSObject {
        var o = JSObject()
        o["id"] = .string(JSString(id)); o["spaceId"] = .string(JSString(spaceId.rawValue))
        o["type"] = .string(JSString(type)); o["title"] = .string(JSString(title)); o["state"] = .object(state)
        if isPinned { o["isPinned"] = true }
        if let originTabId { o["originTabId"] = .string(JSString(originTabId)) }
        if let originSpaceId { o["originSpaceId"] = .string(JSString(originSpaceId.rawValue)) }
        return o
    }

    /// From a store-shaped object (already validated by `WorkspaceSnapshot.parse`). Array states become `{}`.
    init?(jsObject o: JSObject) {
        guard let id = o["id"]?.stringValue?.string, let sp = o["spaceId"]?.stringValue.flatMap({ SpaceId(rawValue: $0.string) }),
              let type = o["type"]?.stringValue?.string, let title = o["title"]?.stringValue?.string else { return nil }
        self.init(id: id, spaceId: sp, type: type, title: title, state: o["state"]?.objectValue ?? JSObject(),
                  isPinned: o["isPinned"]?.boolValue ?? false, originTabId: o["originTabId"]?.stringValue?.string,
                  originSpaceId: o["originSpaceId"]?.stringValue.flatMap { SpaceId(rawValue: $0.string) })
    }
}

extension WorkspaceSnapshot.Parsed {
    /// Open a snapshot alongside live workspaces without sharing tab identities.
    public func restoreSession(id: String, name: String, reservedIDs: Set<String>,
                               makeID: () -> String) -> (session: Session, displayOrder: [String]) {
        var usedIDs = reservedIDs
        var firstIDByOriginal: [String: String] = [:]
        var idsBySpace: [SpaceId: [String: String]] = [:]
        var restoredTabs: [SpaceId: [Tab]] = [:]
        var active: [SpaceId: String?] = [:]
        for space in WorkspaceSnapshot.spaces {
            var firstIDInSpace: [String: String] = [:]
            restoredTabs[space] = tabs(in: space).compactMap(Tab.init(jsObject:)).map { original in
                var tab = original
                while !usedIDs.insert(tab.id).inserted { tab.id = makeID() }
                if firstIDByOriginal[original.id] == nil { firstIDByOriginal[original.id] = tab.id }
                if firstIDInSpace[original.id] == nil { firstIDInSpace[original.id] = tab.id }
                return tab
            }
            idsBySpace[space] = firstIDInSpace
            active[space] = (activeTabId[space] ?? nil).flatMap { firstIDInSpace[$0] } ?? restoredTabs[space]?.first?.id
        }
        restoredTabs = restoredTabs.mapValues { list in
            list.map { tab in
                let origins = tab.originSpaceId.map { idsBySpace[$0] ?? [:] } ?? firstIDByOriginal
                return tab.remappingOrigin(using: origins)
            }
        }
        let session = Session(id: id, name: name, icon: icon, tabs: restoredTabs, activeTabId: active)
        let preferred = displayOrder.compactMap { firstIDByOriginal[$0] }
        var orderedIDs = Set<String>()
        let order = (preferred + session.allTabs.map(\.id)).filter { orderedIDs.insert($0).inserted }
        return (session, order)
    }
}
