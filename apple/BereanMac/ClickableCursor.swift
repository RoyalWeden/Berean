import AppKit
import ObjectiveC
import SwiftUI

/// Pointing-hand cursor over every enabled native control (buttons, pop-up / pull-down menus, segmented pickers,
/// checkboxes, toolbar buttons). SwiftUI hosts most of its Mac controls in AppKit views, and those reset their cursor
/// rects to the arrow, so per-view `pointerStyle` can't reach toolbar items and bordered buttons. Installing a
/// `resetCursorRects` override once covers all of them; plain SwiftUI buttons use `.interactivePlain`.
enum ClickableCursor {
    @MainActor private static var installed = false
    @MainActor static func install() {
        guard !installed else { return }
        installed = true
        for cls: AnyClass in [NSButton.self, NSSegmentedControl.self, NSSwitch.self] { swizzle(cls, with: #selector(NSControl.berean_resetCursorRects)) }
        // Toolbar items are SwiftUI hosting views inside AppKit's private item viewer (no NSButton to hook).
        if let viewer = NSClassFromString("NSToolbarItemViewer") { swizzle(viewer, with: #selector(NSView.berean_toolbarResetCursorRects)) }
        swizzle(type(of: NSApplication.shared), original: #selector(NSApplication.sendEvent(_:)),
                with: #selector(NSApplication.berean_sendEvent(_:)))
        #if DEBUG
        ClickableCursorDebug.recordEvent("installed:\(type(of: NSApplication.shared))")
        #endif
        // Toolbar items change enabled state without resetting cursor rects (Back gains history); re-check after events.
        NotificationCenter.default.addObserver(forName: NSWindow.didUpdateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ToolbarCursorWatch.refresh() }
        }
    }

    private static func swizzle(_ cls: AnyClass, original: Selector = #selector(NSView.resetCursorRects), with replacement: Selector) {
        guard let replacementMethod = class_getInstanceMethod(cls, replacement),
              let originalMethod = class_getInstanceMethod(cls, original) else { return }
        // Give the class its own copy first (a no-op when it already overrides), so the exchange never touches
        // NSView's implementation, then exchange it with a class-local copy of the replacement.
        _ = class_addMethod(cls, original, method_getImplementation(originalMethod), method_getTypeEncoding(originalMethod))
        _ = class_addMethod(cls, replacement, method_getImplementation(replacementMethod), method_getTypeEncoding(replacementMethod))
        guard let own = class_getInstanceMethod(cls, original), let mine = class_getInstanceMethod(cls, replacement) else { return }
        method_exchangeImplementations(own, mine)
    }
}

extension NSApplication {
    @objc func berean_sendEvent(_ event: NSEvent) {
        berean_sendEvent(event)
        switch event.type {
        case .mouseMoved, .cursorUpdate, .mouseEntered, .mouseExited, .leftMouseDragged, .rightMouseDragged,
             .leftMouseUp, .rightMouseUp:
            // Run after AppKit and SwiftUI have processed the event, including child-view cursor resets.
            StableClickableCursor.refresh(in: event.window, at: event.locationInWindow)
            StableClickableCursor.scheduleRefresh(in: event.window, at: event.locationInWindow)
        default: break
        }
    }
}

/// A passive cursor region. Hit testing continues through to the actual SwiftUI button.
struct ClickableCursorRegion: NSViewRepresentable {
    let enabled: Bool

    func makeNSView(context: Context) -> Region {
        let region = Region()
        region.enabled = enabled
        StableClickableCursor.register(region)
        return region
    }

    func updateNSView(_ region: Region, context: Context) {
        guard region.enabled != enabled else { return }
        region.enabled = enabled
        StableClickableCursor.refreshForStateChange(in: region)
    }

    final class Region: NSView {
        var enabled = true
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

@MainActor private enum StableClickableCursor {
    private static let regions = NSHashTable<ClickableCursorRegion.Region>.weakObjects()
    private static var refreshPending = false
    private static weak var pendingWindow: NSWindow?
    private static var pendingPoint = NSPoint.zero

    static func register(_ region: ClickableCursorRegion.Region) { regions.add(region) }

    static func refreshForStateChange(in region: ClickableCursorRegion.Region) {
        // Reuse the latest delivered pointer position, including when a keyboard
        // action changes enabled state without generating another mouse event.
        guard let window = region.window, window === pendingWindow,
              !region.isHiddenOrHasHiddenAncestor,
              region.convert(region.bounds, to: nil).contains(pendingPoint),
              region.visibleRect.contains(region.convert(pendingPoint, from: nil)) else { return }
        scheduleRefresh(in: window, at: pendingPoint)
    }

    static func scheduleRefresh(in window: NSWindow?, at point: NSPoint) {
        pendingWindow = window
        pendingPoint = point
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.async {
            refreshPending = false
            // Moving over an inactive window must use that window's controls,
            // rather than controls at the same screen position in the key window.
            guard let source = pendingWindow else { return }
            refresh(in: source, at: pendingPoint)
        }
    }

    static func refresh(in window: NSWindow?, at point: NSPoint) {
        guard let window, let content = window.contentView else { return }
        let root = content.superview ?? content
        let rootPoint = root.superview?.convert(point, from: nil) ?? point
        let target = root.hitTest(rootPoint)
        guard let hit = target else { return }
        if hit is WindowDragArea.DragView {
            setHand(false, in: window, at: point, source: "sidebar space")
            return
        }
        var ancestor: NSView? = hit
        var toolbar: NSView?
        var nativeText = false
        while let view = ancestor {
            if view is NSTextView || (view as? NSTextField).map({ $0.isEditable || $0.isSelectable }) == true { nativeText = true }
            if let control = view as? NSButton { setHand(control.isEnabled, in: window, at: point, source: "button"); return }
            if let control = view as? NSSegmentedControl { setHand(control.isEnabled, in: window, at: point, source: "segments"); return }
            if let control = view as? NSSwitch { setHand(control.isEnabled, in: window, at: point, source: "switch"); return }
            if String(describing: type(of: view)) == "NSToolbarItemViewer", !view.containsEditableText {
                toolbar = view
                break
            }
            ancestor = view.superview
        }
        let matching = regions.allObjects.filter { region in
            guard region.window === window, !region.isHiddenOrHasHiddenAncestor else { return false }
            let local = region.convert(point, from: nil)
            // Require the concrete window-space frame as well as visibleRect:
            // passive SwiftUI wrappers can otherwise match distant points.
            guard region.convert(region.bounds, to: nil).contains(point), region.bounds.contains(local) else { return false }
            // SwiftUI gives the passive background its own platform-view wrapper.
            // Rendered buttons may hit their containing group or its hosting view.
            guard region.visibleRect.contains(local), let host = region.superview?.superview,
                  hit === host || hit.isDescendant(of: host) || host.isDescendant(of: hit) else { return false }
            return true
        }
        if let region = matching.min(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }) {
            #if DEBUG
            let cursorSource = "SwiftUI:\(region.bounds):\(region.convert(NSPoint.zero, to: nil))"
            #else
            let cursorSource = "SwiftUI"
            #endif
            setHand(region.enabled, in: window, at: point, source: cursorSource)
        } else if let toolbar {
            setHand(toolbar.toolbarItemEnabled != false, in: window, at: point, source: "toolbar")
        } else {
            // A control's hand must not linger over passive SwiftUI backgrounds.
            // Native text/link and resize cursors keep ownership.
            if !nativeText, NSCursor.current == .pointingHand {
                setHand(false, in: window, at: point, source: "passive space")
            }
            #if DEBUG
            let nearby = regions.allObjects.filter { $0.window === window && $0.visibleRect.contains($0.convert(point, from: nil)) }.count
            ClickableCursorDebug.trace(enabled: nil, in: window, at: point, source: "unmanaged:\(type(of: hit)):\(nearby)")
            #endif
        }
    }

    private static func setHand(_ enabled: Bool, in window: NSWindow, at point: NSPoint, source: String) {
        let cursor: NSCursor = enabled ? .pointingHand : .arrow
        if NSCursor.current != cursor { cursor.set() }
        #if DEBUG
        ClickableCursorDebug.trace(enabled: enabled, in: window, at: point, source: source)
        #endif
    }
}

extension NSView {
    @objc func berean_toolbarResetCursorRects() {
        berean_toolbarResetCursorRects()
        guard !isHidden, bounds.width > 0, !containsEditableText else { return }
        // Skip disabled items (e.g. Back with no history) when the viewer exposes its NSToolbarItem.
        let enabled = toolbarItemEnabled
        ToolbarCursorWatch.record(self, enabled: enabled)
        guard enabled != false else { return }
        discardCursorRects()
        addCursorRect(visibleRect, cursor: .pointingHand)
    }

    /// The hosted NSToolbarItem's enabled state, when the private viewer exposes `item` (nil if it doesn't).
    fileprivate var toolbarItemEnabled: Bool? {
        let itemSelector = NSSelectorFromString("item")
        guard responds(to: itemSelector), let item = perform(itemSelector)?.takeUnretainedValue() as? NSToolbarItem else { return nil }
        return item.isEnabled
    }

    fileprivate var containsEditableText: Bool {
        if let field = self as? NSTextField, field.isEditable { return true }
        if self is NSTextView { return true }
        return subviews.contains { $0.containsEditableText }
    }
}

extension NSControl {
    @objc func berean_resetCursorRects() {
        berean_resetCursorRects()   // the original implementation after the exchange
        guard isEnabled, !isHidden, !visibleRect.isEmpty else { return }
        discardCursorRects()
        addCursorRect(visibleRect, cursor: .pointingHand)
    }
}

#if DEBUG
enum ClickableCursorDebug {
    @MainActor static func recordEvent(_ event: String) {
        guard ProcessInfo.processInfo.environment["BEREAN_CURSOR_TRACE"] != nil else { return }
        try? event.write(toFile: NSTemporaryDirectory() + "berean-cursor-event.txt", atomically: true, encoding: .utf8)
    }

    @MainActor static func trace(enabled: Bool?, in window: NSWindow, at point: NSPoint, source: String) {
        guard ProcessInfo.processInfo.environment["BEREAN_CURSOR_TRACE"] != nil else { return }
        let mouse = window.mouseLocationOutsideOfEventStream
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(50)) { [weak window] in
            guard let window, window.mouseLocationOutsideOfEventStream == mouse else { return }
            let actual = NSCursor.current == .pointingHand ? "hand"
                : NSCursor.current == .arrow ? "arrow" : NSCursor.current == .iBeam ? "text" : "other"
            let record: [String: Any] = ["expected": enabled.map { $0 ? "hand" : "arrow" } ?? "unmanaged", "actual": actual,
                                       "source": source, "x": point.x, "y": point.y]
            if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) {
                try? data.write(to: URL(fileURLWithPath: NSTemporaryDirectory() + "berean-cursor-state.json"), options: .atomic)
            }
        }
    }

    @MainActor static func dumpToolbar() {
        guard ProcessInfo.processInfo.environment["BEREAN_CURSOR_DEBUG"] != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            var out = ""
            func walk(_ v: NSView, _ d: Int) {
                guard d < 14 else { return }
                out += String(repeating: " ", count: d) + String(describing: type(of: v)) + " \(v.frame)\n"
                v.subviews.forEach { walk($0, d + 1) }
            }
            for w in NSApp.windows { if let f = w.contentView?.superview { walk(f, 0) } }
            try? out.write(toFile: NSTemporaryDirectory() + "berean-views.txt", atomically: true, encoding: .utf8)
        }
    }
}
#endif


/// Remembers each toolbar item viewer's enabled state at its last cursor-rect reset and invalidates its rects when it changes.
@MainActor enum ToolbarCursorWatch {
    private static let states = NSMapTable<NSView, NSNumber>(
        keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory
    )

    static func record(_ view: NSView, enabled: Bool?) {
        guard let enabled else { return }
        states.setObject(NSNumber(value: enabled), forKey: view)
    }

    static func refresh() {
        for view in states.keyEnumerator().allObjects.compactMap({ $0 as? NSView }) {
            guard let now = view.toolbarItemEnabled, states.object(forKey: view)?.boolValue != now else { continue }
            states.setObject(NSNumber(value: now), forKey: view)
            view.window?.invalidateCursorRects(for: view)
        }
    }
}
