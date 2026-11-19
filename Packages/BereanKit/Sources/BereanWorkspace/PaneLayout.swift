import Foundation

/// In-memory document composition. This deliberately does not encode the legacy
/// panelLayout field, synchronise layouts, or own/mutate any Tab records.
public struct PaneLayout: Equatable, Sendable {
    public enum Axis: Equatable, Sendable { case horizontal, vertical }
    public enum Edge: CaseIterable, Equatable, Sendable { case left, right, top, bottom }
    public indirect enum Node: Equatable, Sendable {
        case leaf(id: String, tabID: String)
        case split(id: String, axis: Axis, fraction: Double, first: Node, second: Node)
    }
    public struct Size: Equatable, Sendable {
        public var width: Double
        public var height: Double
        public init(width: Double, height: Double) { self.width = width; self.height = height }
        fileprivate var valid: Bool { width.isFinite && height.isFinite && width > 0 && height > 0 }
    }
    public struct Frame: Equatable, Sendable {
        public let paneID: String
        public let tabID: String
        public let x: Double
        public let y: Double
        public let size: Size
    }
    public enum Edit: Sendable {
        case insert(tabID: String, paneID: String, splitID: String, beside: String, edge: Edge, fraction: Double = 0.5)
        case move(paneID: String, splitID: String, beside: String, edge: Edge, fraction: Double = 0.5)
        case remove(paneID: String)
        case resize(splitID: String, fraction: Double)
        case focus(paneID: String)
    }
    public enum Failure: Error, Equatable {
        case invalidIdentity, duplicateIdentity, duplicateTab, invalidFraction, tooDeep
        case missingPane, missingSplit, samePane, staleTab, invalidSize, missingMinimum, insufficientSpace
    }

    public private(set) var root: Node?
    public private(set) var focusedPaneID: String?

    public init(root: Node? = nil, focusedPaneID: String? = nil) throws {
        self.root = root
        self.focusedPaneID = focusedPaneID
        try check(liveTabIDs: nil, checkFocus: false)
        self.focusedPaneID = focusedPaneID ?? root?.leaves.first?.id
        try validate()
    }

    public var panes: [(id: String, tabID: String)] { root?.leaves ?? [] }

    /// Return a fully validated candidate. Callers may use it for a preview, then
    /// revalidate against CURRENT live tabs/geometry at drop before committing.
    public func applying(_ edit: Edit, liveTabIDs: Set<String>, in viewport: Size,
                         minimums: [String: Size], divider: Double = 8) throws -> PaneLayout {
        try validate(liveTabIDs: liveTabIDs)
        var next = self
        switch edit {
        case let .insert(tabID, paneID, splitID, target, edge, fraction):
            guard liveTabIDs.contains(tabID) else { throw Failure.staleTab }
            guard !panes.contains(where: { $0.tabID == tabID }) else { throw Failure.duplicateTab }
            next.root = try root?.inserting(.leaf(id: paneID, tabID: tabID), splitID: splitID, beside: target, edge: edge, fraction: fraction)
            guard next.root != nil else { throw Failure.missingPane }
            next.focusedPaneID = paneID
        case let .move(paneID, splitID, target, edge, fraction):
            guard paneID != target else { throw Failure.samePane }
            guard let source = panes.first(where: { $0.id == paneID }), panes.contains(where: { $0.id == target }) else { throw Failure.missingPane }
            let pruned = root?.removing(paneID)
            next.root = try pruned?.inserting(.leaf(id: source.id, tabID: source.tabID), splitID: splitID, beside: target, edge: edge, fraction: fraction)
        case let .remove(paneID):
            guard panes.contains(where: { $0.id == paneID }) else { throw Failure.missingPane }
            next.root = root?.removing(paneID)
            if focusedPaneID == paneID { next.focusedPaneID = next.root?.leaves.first?.id }
        case let .resize(splitID, fraction):
            guard let root else { throw Failure.missingSplit }
            var found = false
            next.root = root.resizing(splitID, fraction: fraction, found: &found)
            guard found else { throw Failure.missingSplit }
        case let .focus(paneID):
            guard panes.contains(where: { $0.id == paneID }) else { throw Failure.missingPane }
            next.focusedPaneID = paneID
        }
        try next.validate(liveTabIDs: liveTabIDs)
        _ = try next.frames(in: viewport, minimums: minimums, divider: divider)
        return next
    }

    /// Prune views whose tabs were closed/archived elsewhere; never deletes tabs.
    /// The surviving leaf IDs and relative order remain stable.
    public func reconciling(liveTabIDs: Set<String>) throws -> PaneLayout {
        var next = self
        for pane in panes where !liveTabIDs.contains(pane.tabID) { next.root = next.root?.removing(pane.id) }
        if !next.panes.contains(where: { $0.id == next.focusedPaneID }) { next.focusedPaneID = next.panes.first?.id }
        try next.validate(liveTabIDs: liveTabIDs)
        return next
    }

    public func validate(liveTabIDs: Set<String>? = nil) throws {
        try check(liveTabIDs: liveTabIDs, checkFocus: true)
    }

    private func check(liveTabIDs: Set<String>?, checkFocus: Bool) throws {
        var identities = Set<String>(), tabs = Set<String>()
        func walk(_ node: Node, depth: Int) throws {
            guard depth < 64 else { throw Failure.tooDeep }
            guard !node.id.isEmpty else { throw Failure.invalidIdentity }
            guard identities.insert(node.id).inserted else { throw Failure.duplicateIdentity }
            switch node {
            case let .leaf(_, tabID):
                guard !tabID.isEmpty else { throw Failure.invalidIdentity }
                guard tabs.insert(tabID).inserted else { throw Failure.duplicateTab }
                if let liveTabIDs, !liveTabIDs.contains(tabID) { throw Failure.staleTab }
            case let .split(_, _, fraction, first, second):
                guard fraction.isFinite && fraction > 0 && fraction < 1 else { throw Failure.invalidFraction }
                try walk(first, depth: depth + 1); try walk(second, depth: depth + 1)
            }
        }
        if let root { try walk(root, depth: 0) }
        if checkFocus {
            guard (root == nil && focusedPaneID == nil) || panes.contains(where: { $0.id == focusedPaneID }) else { throw Failure.missingPane }
        }
    }

    /// Origin is top-left on both platforms. Fractions divide usable space after
    /// the divider. Every leaf needs an explicit minimum; no clipped fallback.
    public func frames(in viewport: Size, minimums: [String: Size], divider: Double = 8) throws -> [Frame] {
        guard viewport.valid, divider.isFinite, divider >= 0 else { throw Failure.invalidSize }
        var result: [Frame] = []
        func walk(_ node: Node, x: Double, y: Double, size: Size) throws {
            guard size.valid else { throw Failure.insufficientSpace }
            switch node {
            case let .leaf(id, tabID):
                guard let minimum = minimums[id] else { throw Failure.missingMinimum }
                guard minimum.valid else { throw Failure.invalidSize }
                guard size.width >= minimum.width, size.height >= minimum.height else { throw Failure.insufficientSpace }
                result.append(Frame(paneID: id, tabID: tabID, x: x, y: y, size: size))
            case let .split(_, axis, fraction, first, second):
                if axis == .horizontal {
                    let available = size.width - divider, firstWidth = available * fraction
                    try walk(first, x: x, y: y, size: Size(width: firstWidth, height: size.height))
                    try walk(second, x: x + firstWidth + divider, y: y, size: Size(width: available - firstWidth, height: size.height))
                } else {
                    let available = size.height - divider, firstHeight = available * fraction
                    try walk(first, x: x, y: y, size: Size(width: size.width, height: firstHeight))
                    try walk(second, x: x, y: y + firstHeight + divider, size: Size(width: size.width, height: available - firstHeight))
                }
            }
        }
        if let root { try walk(root, x: 0, y: 0, size: viewport) }
        return result
    }
}

private extension PaneLayout.Node {
    var id: String {
        switch self { case let .leaf(id, _), let .split(id, _, _, _, _): return id }
    }
    var leaves: [(id: String, tabID: String)] {
        switch self {
        case let .leaf(id, tabID): return [(id, tabID)]
        case let .split(_, _, _, first, second): return first.leaves + second.leaves
        }
    }
    func inserting(_ leaf: Self, splitID: String, beside target: String, edge: PaneLayout.Edge, fraction: Double) throws -> Self {
        if case .leaf = self, id == target {
            let leading = edge == .left || edge == .top
            return .split(id: splitID, axis: edge == .left || edge == .right ? .horizontal : .vertical,
                          fraction: fraction, first: leading ? leaf : self, second: leading ? self : leaf)
        }
        guard case let .split(id, axis, value, first, second) = self else { throw PaneLayout.Failure.missingPane }
        if first.leaves.contains(where: { $0.id == target }) {
            return .split(id: id, axis: axis, fraction: value, first: try first.inserting(leaf, splitID: splitID, beside: target, edge: edge, fraction: fraction), second: second)
        }
        return .split(id: id, axis: axis, fraction: value, first: first, second: try second.inserting(leaf, splitID: splitID, beside: target, edge: edge, fraction: fraction))
    }
    func removing(_ target: String) -> Self? {
        switch self {
        case .leaf: return id == target ? nil : self
        case let .split(id, axis, fraction, first, second):
            let a = first.removing(target), b = second.removing(target)
            if let a, let b { return .split(id: id, axis: axis, fraction: fraction, first: a, second: b) }
            return a ?? b
        }
    }
    func resizing(_ target: String, fraction: Double, found: inout Bool) -> Self {
        guard case let .split(id, axis, old, first, second) = self else { return self }
        if id == target { found = true; return .split(id: id, axis: axis, fraction: fraction, first: first, second: second) }
        return .split(id: id, axis: axis, fraction: old, first: first.resizing(target, fraction: fraction, found: &found), second: second.resizing(target, fraction: fraction, found: &found))
    }
}

/// Separate from document UndoManager. A rejected edit/restore leaves all stacks
/// intact, and undo cannot resurrect a closed tab or an arrangement that no longer fits.
public struct PaneLayoutHistory: Sendable {
    public private(set) var current: PaneLayout
    public private(set) var undoCount = 0
    public private(set) var redoCount = 0
    private var past: [PaneLayout] = [], future: [PaneLayout] = []
    private let capacity: Int
    public init(_ layout: PaneLayout, capacity: Int = 100) { current = layout; self.capacity = max(1, min(capacity, 1_000)) }
    public mutating func perform(_ edit: PaneLayout.Edit, liveTabIDs: Set<String>, in viewport: PaneLayout.Size, minimums: [String: PaneLayout.Size], divider: Double = 8) throws {
        let next = try current.applying(edit, liveTabIDs: liveTabIDs, in: viewport, minimums: minimums, divider: divider)
        guard next != current else { return }
        if case .focus = edit { current = next; return }
        past.append(current); if past.count > capacity { past.removeFirst() }
        current = next; future.removeAll(); refreshCounts()
    }
    @discardableResult public mutating func undo(liveTabIDs: Set<String>, in viewport: PaneLayout.Size, minimums: [String: PaneLayout.Size], divider: Double = 8) throws -> Bool {
        guard let previous = past.last else { return false }
        try previous.validate(liveTabIDs: liveTabIDs)
        _ = try previous.frames(in: viewport, minimums: minimums, divider: divider)
        future.append(current); current = past.removeLast(); refreshCounts(); return true
    }
    @discardableResult public mutating func redo(liveTabIDs: Set<String>, in viewport: PaneLayout.Size, minimums: [String: PaneLayout.Size], divider: Double = 8) throws -> Bool {
        guard let next = future.last else { return false }
        try next.validate(liveTabIDs: liveTabIDs)
        _ = try next.frames(in: viewport, minimums: minimums, divider: divider)
        past.append(current); current = future.removeLast(); refreshCounts(); return true
    }
    private mutating func refreshCounts() { undoCount = past.count; redoCount = future.count }
}

/// Only the future dedicated tab-drag content type should carry this payload;
/// accepting plain reference text or files as this payload is not supported.
public struct PaneTabDragPayload: Codable, Equatable, Sendable {
    public let version: Int
    public let windowID: String
    public let workspaceID: String
    public let tabID: String
    public init(version: Int = 1, windowID: String, workspaceID: String, tabID: String) {
        self.version = version; self.windowID = windowID; self.workspaceID = workspaceID; self.tabID = tabID
    }
    public func isValid(windowID: String, workspaceID: String, liveTabIDs: Set<String>) -> Bool {
        version == 1 && !self.windowID.isEmpty && !self.workspaceID.isEmpty && !tabID.isEmpty
            && self.windowID == windowID && self.workspaceID == workspaceID && liveTabIDs.contains(tabID)
    }
}
