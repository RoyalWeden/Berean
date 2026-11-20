// Run from the repository root with swiftc -parse-as-library, alongside NativeDividerCursorRegions.swift.
import AppKit

@MainActor final class WiderDividerDelegate: NSObject, NSSplitViewDelegate {
    var disabled = false
    func splitView(_ splitView: NSSplitView, effectiveRect proposedEffectiveRect: NSRect,
                   forDrawnRect drawnRect: NSRect, ofDividerAt dividerIndex: Int) -> NSRect {
        disabled ? .zero : drawnRect.insetBy(dx: -12, dy: 0)
    }
    func splitView(_ splitView: NSSplitView, additionalEffectiveRectOfDividerAt dividerIndex: Int) -> NSRect {
        disabled ? .zero : NSRect(x: 353, y: 0, width: 12, height: 600)
    }
}

@main struct DividerGeometryRegression {
@MainActor static func main() {
    let split = NSSplitView(frame: NSRect(x: 0, y: 0, width: 1000, height: 600))
    split.isVertical = true
    split.dividerStyle = .thin
    split.arrangesAllSubviews = false
    let left = NSView(frame: NSRect(x: 0, y: 0, width: 350, height: 600))
    let right = NSView(frame: NSRect(x: 351, y: 0, width: 649, height: 600))
    split.addArrangedSubview(left)
    split.addArrangedSubview(right)
    let decoration = NSView(frame: NSRect(x: 12, y: 0, width: 976, height: 600))
    split.addSubview(decoration)
    let rects = NativeSplitDividerGeometry.rects(in: split)
    precondition(rects.count == 1, "decorations must not become split panes")
    precondition(rects[0].width <= 7 && rects[0].contains(NSPoint(x: 350, y: 300)))
    precondition(!rects[0].contains(NSPoint(x: 600, y: 300)), "reader must keep its text cursor")
    let delegate = WiderDividerDelegate()
    split.delegate = delegate
    let effective = NativeSplitDividerGeometry.rects(in: split)
    precondition(effective.count == 1 && effective[0].contains(NSPoint(x: 360, y: 300)), "honor the native wider grab target")
    precondition(effective[0].contains(NSPoint(x: 364, y: 300)), "include connected native gutter handles")
    delegate.disabled = true
    precondition(NativeSplitDividerGeometry.rects(in: split).isEmpty, "honor disabled native grab targets")
    split.delegate = nil
    right.isHidden = true
    precondition(NativeSplitDividerGeometry.rects(in: split).isEmpty, "hidden inspector has no active divider")
    right.isHidden = false
    right.frame.origin.x = 300
    precondition(NativeSplitDividerGeometry.rects(in: split).isEmpty, "overlapping views cannot create a divider")
    left.frame = NSRect(x: 0, y: 0, width: 300, height: 600)
    right.frame = split.bounds
    let sidebarGlass = NativeSplitDividerGeometry.rects(in: split)
    precondition(sidebarGlass.count == 1 && sidebarGlass[0].width <= 7)
    precondition(sidebarGlass[0].contains(NSPoint(x: 299, y: 300)), "full-width glass underlay preserves the sidebar edge")
    left.frame = split.bounds
    right.frame = NSRect(x: 680, y: 0, width: 320, height: 600)
    let inspectorGlass = NativeSplitDividerGeometry.rects(in: split)
    precondition(inspectorGlass.count == 1 && inspectorGlass[0].contains(NSPoint(x: 680, y: 300)))
    split.isVertical = false
    left.frame = NSRect(x: 0, y: 0, width: 1000, height: 250)
    right.frame = NSRect(x: 0, y: 251, width: 1000, height: 349)
    let horizontal = NativeSplitDividerGeometry.rects(in: split)
    precondition(horizontal.count == 1 && horizontal[0].height <= 7)
    precondition(horizontal[0].contains(NSPoint(x: 500, y: 250)))
    print("PASS: decorative, hidden, overlapping, glass, horizontal and delegated divider targets")
}
}
