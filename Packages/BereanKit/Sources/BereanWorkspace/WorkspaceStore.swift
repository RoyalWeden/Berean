import Observation
import OSLog
import BereanCore

/// The canonical live workspace and its one durable writer. Window navigation
/// facades must share this object rather than hydrate and save competing copies.
/// Per-window projections must never replace these arrays with stale snapshots.
@MainActor @Observable
public final class WorkspaceStore {
    public var sessions: [Session]
    public var displayOrders: [String: [String]]
    public var archivedGroups: [ArchivedGroup]
    public private(set) var orderKeys: TabPersistence.OrderKeyMaps
    @ObservationIgnored private let service: SessionsService?
    @ObservationIgnored private let signposter = OSSignposter(subsystem: "com.berean.native", category: "WorkspacePersistence")

    public init(service: SessionsService? = nil, sessions: [Session] = [],
                displayOrders: [String: [String]] = [:], archivedGroups: [ArchivedGroup] = [],
                orderKeys: TabPersistence.OrderKeyMaps = .init()) {
        self.service = service
        self.sessions = sessions
        self.displayOrders = displayOrders
        self.archivedGroups = archivedGroups
        self.orderKeys = orderKeys
    }

    public var canPersist: Bool { service != nil }

    /// One synchronous actor turn: construct from current canonical state,
    /// commit rows and device-local selection together, then accept new keys.
    /// A failed commit leaves the edited live state available for retry.
    @discardableResult public func save() throws -> Bool {
        guard let service else { return false }
        let built = stage("Build workspace snapshot") {
            TabPersistence.buildSnapshot(sessions: sessions, displayOrders: displayOrders,
                                         archivedGroups: archivedGroups, previous: orderKeys)
        }
        var local: [String: JSObject] = [:]
        for (sessionID, active) in built.localState {
            var object = JSObject()
            for space in SpaceId.allCases {
                if let value = active[space] {
                    object[JSString(space.rawValue)] = value.map { .string(JSString($0)) } ?? .null
                }
            }
            local[sessionID] = object
        }
        _ = try stage("Apply workspace snapshot") {
            try service.applySnapshot(built.snapshot, localState: local)
        }
        orderKeys = built.keys
        return true
    }

    private func stage<T>(_ name: StaticString, _ action: () throws -> T) rethrows -> T {
        let interval = signposter.beginInterval(name)
        defer { signposter.endInterval(name, interval) }
        return try action()
    }
}
