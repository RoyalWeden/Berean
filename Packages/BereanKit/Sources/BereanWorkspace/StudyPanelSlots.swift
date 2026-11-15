import BereanCore

public enum InspectorTool: String, CaseIterable, Identifiable, Sendable {
    case notes, lexicon, crossrefs

    public var id: Self { self }
}

/// Restores and updates the legacy Scripture inspector assignments.
public struct StudyPanelSlots {
    public private(set) var primary: InspectorTool
    public private(set) var secondary: InspectorTool?
    public private(set) var secondaryTabs: [InspectorTool]

    public var primaryTabs: [InspectorTool] { InspectorTool.allCases.filter { !secondaryTabs.contains($0) } }

    public init(_ state: JSObject) {
        let savedPrimary = state["rightPanelTab"]?.stringValue?.string.flatMapPanel ?? .lexicon
        let savedSecondary = state["rightPanelSlotB"]?.stringValue?.string.flatMapPanel
        let assigned = state["rightPanelSlotBTabs"]?.arrayValue?.compactMap { $0.stringValue?.string.flatMapPanel }
            ?? savedSecondary.map { [$0] } ?? []
        var seen = Set<InspectorTool>()
        let unique = assigned.filter { seen.insert($0).inserted }
        let tabs = unique.count < InspectorTool.allCases.count ? unique : []
        secondaryTabs = tabs
        primary = tabs.contains(savedPrimary)
            ? InspectorTool.allCases.first { !tabs.contains($0) } ?? .lexicon : savedPrimary
        secondary = savedSecondary.flatMap { tabs.contains($0) ? $0 : nil } ?? tabs.first
    }

    public mutating func move(_ panel: InspectorTool, toSecondary: Bool) {
        if toSecondary {
            guard !secondaryTabs.contains(panel), primaryTabs.count > 1 else { return }
            secondaryTabs.append(panel)
            secondary = panel
            if primary == panel, let first = primaryTabs.first { primary = first }
        } else {
            secondaryTabs.removeAll { $0 == panel }
            if secondary == panel { secondary = secondaryTabs.first }
            primary = panel
        }
    }

    public mutating func closeSecondary() {
        secondaryTabs = []
        secondary = nil
    }

    public mutating func focusSecondary(_ tool: InspectorTool) {
        if secondaryTabs.contains(tool) { secondary = tool }
    }

    public func write(to state: inout JSObject) {
        state["rightPanelTab"] = .string(JSString(primary.rawValue))
        state["rightPanelSlotBTabs"] = .array(secondaryTabs.map { .string(JSString($0.rawValue)) })
        state["rightPanelSlotB"] = secondary.map { .string(JSString($0.rawValue)) } ?? .null
    }

}

private extension String {
    var flatMapPanel: InspectorTool? { InspectorTool(rawValue: self) }
}
