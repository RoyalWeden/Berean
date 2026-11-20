import AppKit
import SwiftUI

@MainActor enum NativeSplitDividerGeometry {
    static func rects(in split: NSSplitView, outset: CGFloat = 3) -> [NSRect] {
        // Hosting systems also install decoration views in a split view. Only
        // arranged panes describe divider boundaries; overlapping decorations
        // must never turn an entire reading pane into a resize region.
        let panes = split.arrangedSubviews.filter {
            !$0.isHidden && !split.isSubviewCollapsed($0) && $0.frame.width > 0 && $0.frame.height > 0
        }.sorted { split.isVertical ? $0.frame.minX < $1.frame.minX : $0.frame.minY < $1.frame.minY }
        return zip(panes, panes.dropFirst()).compactMap { first, second in
            let axis: (NSRect) -> (CGFloat, CGFloat) = { rect in
                split.isVertical ? (rect.minX, rect.maxX) : (rect.minY, rect.maxY)
            }
            var start = axis(first.frame).1
            var end = axis(second.frame).0
            if end < start - 0.5 {
                // Modern native sidebar/inspector glass can overlap a main pane
                // whose frame spans the entire split. Use the anchored narrow
                // pane's inner edge, not the full-width underlay's outer edge.
                let bounds = axis(split.bounds)
                let full: (NSView) -> Bool = { pane in
                    let frame = axis(pane.frame)
                    return abs(frame.0 - bounds.0) < 0.5 && abs(frame.1 - bounds.1) < 0.5
                }
                let pane: NSView
                if full(first), !full(second) { pane = second }
                else if full(second), !full(first) { pane = first }
                else { return nil }
                let frame = axis(pane.frame)
                if abs(frame.0 - bounds.0) < 0.5 { start = frame.1 - split.dividerThickness }
                else if abs(frame.1 - bounds.1) < 0.5 { start = frame.0 }
                else { return nil }
                end = start + split.dividerThickness
            }
            guard end - start <= max(16, split.dividerThickness) else { return nil }
            let thickness = max(split.dividerThickness, end - start)
            let rect = (split.isVertical
                ? NSRect(x: start - outset, y: split.bounds.minY, width: thickness + outset * 2, height: split.bounds.height)
                : NSRect(x: split.bounds.minX, y: start - outset, width: split.bounds.width, height: thickness + outset * 2))
                .intersection(split.visibleRect)
            return rect.isEmpty ? nil : rect
        }
    }
}

/// SwiftUI's hosting views can restore an inherited cursor after NSSplitView
/// first enters its divider. Own only the native divider's narrow tracking
/// region, without intercepting hits, replacing its delegate or monitoring the
/// window's input. The split view continues to perform the actual resize.
struct NativeDividerCursorRegions: NSViewRepresentable {
    func makeNSView(context: Context) -> Probe { Probe() }
    func updateNSView(_ view: Probe, context: Context) { view.scheduleRefresh() }
    static func dismantleNSView(_ view: Probe, coordinator: Void) { view.stop() }

    final class Probe: NSView {
        private struct Region {
            weak var split: NSSplitView?
            let area: NSTrackingArea
            let vertical: Bool
        }
        private var regions: [Region] = []
        private var queued = false

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard let window else { return }
            NotificationCenter.default.addObserver(self, selector: #selector(splitResized(_:)),
                name: NSSplitView.didResizeSubviewsNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(windowChanged(_:)),
                name: NSWindow.didResizeNotification, object: window)
            scheduleRefresh()
        }
        override func layout() { super.layout(); scheduleRefresh() }

        @objc private func splitResized(_ notification: Notification) {
            guard let split = notification.object as? NSSplitView, split.window === window else { return }
            scheduleRefresh()
        }
        @objc private func windowChanged(_ notification: Notification) { scheduleRefresh() }

        func stop() {
            NotificationCenter.default.removeObserver(self)
            clearRegions()
        }
        private func clearRegions() {
            for region in regions { region.split?.removeTrackingArea(region.area) }
            regions.removeAll()
        }
        func scheduleRefresh() {
            guard !queued else { return }
            queued = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.queued = false
                self.refresh()
            }
        }
        private func refresh() {
            guard let content = window?.contentView else { clearRegions(); return }
            let candidates = collect(in: content)
            // Ordinary SwiftUI updates must not tear down/re-enter a stationary
            // cursor's tracking region. Replace areas only when geometry changes.
            if candidates.count == regions.count,
               zip(candidates, regions).allSatisfy({ candidate, region in
                   candidate.0 === region.split && candidate.1 == region.area.rect
                       && candidate.0.isVertical == region.vertical
               }) { return }
            clearRegions()
            for (split, rect) in candidates {
                let area = NSTrackingArea(rect: rect,
                    options: [.activeInKeyWindow, .cursorUpdate, .mouseMoved, .mouseEnteredAndExited, .enabledDuringMouseDrag],
                    owner: self)
                split.addTrackingArea(area)
                regions.append(Region(split: split, area: area, vertical: split.isVertical))
            }
            #if DEBUG
            if ProcessInfo.processInfo.environment["BEREAN_CURSOR_TRACE"] != nil,
               let data = try? JSONSerialization.data(withJSONObject: regions.map { region in
                   ["rect": NSStringFromRect(region.area.rect),
                    "windowRect": NSStringFromRect(region.split?.convert(region.area.rect, to: nil) ?? .zero)]
               }, options: [.sortedKeys]) {
                try? data.write(to: URL(fileURLWithPath: NSTemporaryDirectory() + "berean-native-divider-regions.json"), options: .atomic)
            }
            #endif
        }
        private func collect(in view: NSView) -> [(NSSplitView, NSRect)] {
            guard !view.isHidden, !view.visibleRect.isEmpty else { return [] }
            var candidates: [(NSSplitView, NSRect)] = []
            if let split = view as? NSSplitView {
                for rect in NativeSplitDividerGeometry.rects(in: split) {
                    candidates.append((split, rect))
                }
            }
            for child in view.subviews { candidates += collect(in: child) }
            return candidates
        }

        private func updateCursor(_ event: NSEvent) {
            guard event.window === window, window?.isKeyWindow == true else { return }
            // Check the current geometry even if a resize has queued a refresh.
            // Stale tracking events must never leave a resize cursor over text.
            guard let region = regions.first(where: { region in
                guard let split = region.split, !split.isHiddenOrHasHiddenAncestor else { return false }
                let point = split.convert(event.locationInWindow, from: nil)
                return NativeSplitDividerGeometry.rects(in: split).contains { $0.contains(point) }
            }) else { return }
            let cursor: NSCursor = region.vertical ? .resizeLeftRight : .resizeUpDown
            if NSCursor.current != cursor { cursor.set() }
        }
        override func cursorUpdate(with event: NSEvent) { updateCursor(event) }
        override func mouseEntered(with event: NSEvent) { updateCursor(event) }
        override func mouseMoved(with event: NSEvent) { updateCursor(event) }
        override func mouseExited(with event: NSEvent) {
            // Let the newly entered native control/text region restore its own
            // cursor, rather than forcing an arrow across unrelated content.
            for region in regions { if let split = region.split { window?.invalidateCursorRects(for: split) } }
        }
    }
}
