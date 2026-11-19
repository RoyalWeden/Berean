import Foundation
import Testing
import BereanCore
import BereanWorkspace

@Suite("device-local document pane composition")
struct PaneLayoutTests {
    private let viewport = PaneLayout.Size(width: 1_600, height: 1_000)
    private let minimum = PaneLayout.Size(width: 200, height: 160)
    private var minimums: [String: PaneLayout.Size] { ["a": minimum, "b": minimum, "c": minimum] }
    private let live: Set<String> = ["one", "two", "three"]

    private func single() throws -> PaneLayout { try PaneLayout(root: .leaf(id: "a", tabID: "one")) }
    private func pair() throws -> PaneLayout {
        try single().applying(.insert(tabID: "two", paneID: "b", splitID: "ab", beside: "a", edge: .right), liveTabIDs: live, in: viewport, minimums: minimums)
    }

    @Test func allOrderedTabFamiliesUseTheSameIdentityPreservingComposition() throws {
        let types = TabType.allCases.map(\.rawValue) + ["future-tab-kind"]
        var firstState = JSObject(), secondState = JSObject()
        firstState["unknown"] = .string("retained")
        secondState["unknown"] = .string("also retained")
        for first in types {
            for second in types {
                let tabs = [Tab(id: "one", spaceId: .scripture, type: first, title: "Untitled", state: firstState),
                            Tab(id: "two", spaceId: .notes, type: second, title: "Untitled", state: secondState)]
                let available = Set(tabs.map(\.id))
                for edge in PaneLayout.Edge.allCases {
                    let result = try single().applying(.insert(tabID: tabs[1].id, paneID: "b", splitID: "ab", beside: "a", edge: edge), liveTabIDs: available, in: viewport, minimums: minimums)
                    #expect(Set(result.panes.map(\.tabID)) == available)
                    #expect(result.focusedPaneID == "b")
                    let frames = try result.frames(in: viewport, minimums: minimums)
                    #expect(frames.count == 2)
                    let new = try #require(frames.first { $0.paneID == "b" })
                    let old = try #require(frames.first { $0.paneID == "a" })
                    switch edge {
                    case .left: #expect(new.x < old.x)
                    case .right: #expect(new.x > old.x)
                    case .top: #expect(new.y < old.y)
                    case .bottom: #expect(new.y > old.y)
                    }
                }
            }
        }
    }

    @Test func moveCollapsesOldBranchAndRetainsLeafFocusAndSiblingIdentity() throws {
        let three = try pair().applying(.insert(tabID: "three", paneID: "c", splitID: "bc", beside: "b", edge: .bottom), liveTabIDs: live, in: viewport, minimums: minimums)
        let moved = try three.applying(.move(paneID: "a", splitID: "ca", beside: "c", edge: .right), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(moved.focusedPaneID == "c")
        #expect(moved.root == .split(id: "bc", axis: .vertical, fraction: 0.5, first: .leaf(id: "b", tabID: "two"),
                                    second: .split(id: "ca", axis: .horizontal, fraction: 0.5, first: .leaf(id: "c", tabID: "three"), second: .leaf(id: "a", tabID: "one"))))
        #expect(Set(moved.panes.map(\.id)) == ["a", "b", "c"])
        #expect(throws: PaneLayout.Failure.samePane) { try three.applying(.move(paneID: "a", splitID: "x", beside: "a", edge: .left), liveTabIDs: live, in: viewport, minimums: minimums) }
    }

    @Test func removingViewsDoesNotCloseTabsAndLastBranchCollapses() throws {
        let start = try pair()
        let remaining = try start.applying(.remove(paneID: "b"), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(remaining == (try single()))
        let empty = try remaining.applying(.remove(paneID: "a"), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(empty.root == nil && empty.focusedPaneID == nil)
        #expect(try empty.frames(in: viewport, minimums: [:]).isEmpty)
        let reconciled = try start.reconciling(liveTabIDs: ["one"])
        #expect(reconciled == remaining)
    }

    @Test func invalidIdentityGeometryAndStaleCandidatesAreRejected() throws {
        #expect(throws: PaneLayout.Failure.duplicateTab) { try PaneLayout(root: .split(id: "s", axis: .horizontal, fraction: 0.5, first: .leaf(id: "a", tabID: "one"), second: .leaf(id: "b", tabID: "one"))) }
        #expect(throws: PaneLayout.Failure.duplicateIdentity) { try PaneLayout(root: .split(id: "a", axis: .horizontal, fraction: 0.5, first: .leaf(id: "a", tabID: "one"), second: .leaf(id: "b", tabID: "two"))) }
        #expect(throws: PaneLayout.Failure.invalidIdentity) { try PaneLayout(root: .leaf(id: "", tabID: "one")) }
        #expect(throws: PaneLayout.Failure.missingPane) { try PaneLayout(root: .leaf(id: "a", tabID: "one"), focusedPaneID: "missing") }
        for fraction in [0, 1, -1, Double.nan, Double.infinity] {
            #expect(throws: PaneLayout.Failure.invalidFraction) { try pair().applying(.resize(splitID: "ab", fraction: fraction), liveTabIDs: live, in: viewport, minimums: minimums) }
        }
        #expect(throws: PaneLayout.Failure.insufficientSpace) { try pair().applying(.resize(splitID: "ab", fraction: 0.01), liveTabIDs: live, in: viewport, minimums: minimums) }
        #expect(throws: PaneLayout.Failure.staleTab) { try pair().applying(.focus(paneID: "a"), liveTabIDs: ["one"], in: viewport, minimums: minimums) }
        #expect(throws: PaneLayout.Failure.missingMinimum) { try pair().frames(in: viewport, minimums: ["a": minimum]) }
        #expect(throws: PaneLayout.Failure.invalidSize) { try pair().frames(in: .init(width: .infinity, height: 1_000), minimums: minimums) }
    }

    @Test func layoutUndoIsExactAndRejectedEditsLeaveHistoryIntact() throws {
        var history = PaneLayoutHistory(try single())
        try history.perform(.insert(tabID: "two", paneID: "b", splitID: "ab", beside: "a", edge: .right), liveTabIDs: live, in: viewport, minimums: minimums)
        let two = history.current
        try history.perform(.resize(splitID: "ab", fraction: 0.6), liveTabIDs: live, in: viewport, minimums: minimums)
        let resized = history.current
        #expect(try history.undo(liveTabIDs: live, in: viewport, minimums: minimums))
        #expect(history.current == two && history.undoCount == 1 && history.redoCount == 1)
        #expect(throws: PaneLayout.Failure.insufficientSpace) { try history.redo(liveTabIDs: live, in: .init(width: 300, height: 300), minimums: minimums) }
        #expect(history.current == two && history.redoCount == 1)
        #expect(try history.redo(liveTabIDs: live, in: viewport, minimums: minimums))
        #expect(history.current == resized)
        #expect(throws: PaneLayout.Failure.duplicateTab) { try history.perform(.insert(tabID: "one", paneID: "c", splitID: "ac", beside: "a", edge: .left), liveTabIDs: live, in: viewport, minimums: minimums) }
        #expect(history.current == resized && history.undoCount == 2 && history.redoCount == 0)
        #expect(throws: PaneLayout.Failure.staleTab) { try history.undo(liveTabIDs: ["one"], in: viewport, minimums: minimums) }
        #expect(history.current == resized && history.undoCount == 2)
        #expect(throws: PaneLayout.Failure.insufficientSpace) { try history.perform(.move(paneID: "a", splitID: "moved", beside: "b", edge: .top, fraction: 0.99), liveTabIDs: live, in: viewport, minimums: minimums) }
        #expect(history.current == resized && history.undoCount == 2)
        #expect(throws: PaneLayout.Failure.duplicateIdentity) { try history.perform(.insert(tabID: "three", paneID: "a", splitID: "new", beside: "b", edge: .left), liveTabIDs: live, in: viewport, minimums: minimums) }
        #expect(history.current == resized && history.undoCount == 2)
        #expect(try history.undo(liveTabIDs: live, in: viewport, minimums: minimums))
        try history.perform(.resize(splitID: "ab", fraction: 0.7), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(history.redoCount == 0)
    }

    @Test func typedDragPayloadRejectsForeignStaleAndFutureMessages() throws {
        let payload = PaneTabDragPayload(windowID: "window", workspaceID: "workspace", tabID: "one")
        let decoded = try JSONDecoder().decode(PaneTabDragPayload.self, from: JSONEncoder().encode(payload))
        #expect(decoded == payload)
        #expect(decoded.isValid(windowID: "window", workspaceID: "workspace", liveTabIDs: live))
        #expect(!decoded.isValid(windowID: "other", workspaceID: "workspace", liveTabIDs: live))
        #expect(!decoded.isValid(windowID: "window", workspaceID: "other", liveTabIDs: live))
        #expect(!decoded.isValid(windowID: "window", workspaceID: "workspace", liveTabIDs: ["two"]))
        #expect(!PaneTabDragPayload(version: 2, windowID: "window", workspaceID: "workspace", tabID: "one").isValid(windowID: "window", workspaceID: "workspace", liveTabIDs: live))
        #expect(throws: (any Error).self) { try JSONDecoder().decode(PaneTabDragPayload.self, from: Data("John 3:16".utf8)) }
    }

    @Test func focusDoesNotCreateLayoutUndoOrClearRedo() throws {
        var history = PaneLayoutHistory(try pair())
        try history.perform(.resize(splitID: "ab", fraction: 0.6), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(try history.undo(liveTabIDs: live, in: viewport, minimums: minimums))
        try history.perform(.focus(paneID: "a"), liveTabIDs: live, in: viewport, minimums: minimums)
        #expect(history.current.focusedPaneID == "a" && history.undoCount == 0 && history.redoCount == 1)
        #expect(try history.redo(liveTabIDs: live, in: viewport, minimums: minimums))
    }

    @Test func deeplyNestedAndMissingDropTargetsCannotChangeTheLayout() throws {
        var node = PaneLayout.Node.leaf(id: "a", tabID: "one")
        for index in 0..<64 {
            node = .split(id: "s\(index)", axis: .horizontal, fraction: 0.5, first: node, second: .leaf(id: "p\(index)", tabID: "t\(index)"))
        }
        #expect(throws: PaneLayout.Failure.tooDeep) { try PaneLayout(root: node) }
        var history = PaneLayoutHistory(try pair())
        let original = history.current
        #expect(throws: PaneLayout.Failure.missingPane) { try history.perform(.move(paneID: "a", splitID: "x", beside: "gone", edge: .left), liveTabIDs: live, in: viewport, minimums: minimums) }
        #expect(history.current == original && history.undoCount == 0)
    }
}
