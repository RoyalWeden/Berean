import AppKit
import ObjectiveC

/// Pointing-hand cursor over every enabled native control (buttons, pop-up / pull-down menus, segmented pickers,
/// checkboxes, toolbar buttons). SwiftUI hosts most of its Mac controls in AppKit views, and those reset their cursor
/// rects to the arrow, so per-view `pointerStyle` can't reach toolbar items and bordered buttons. Installing a
/// `resetCursorRects` override once covers all of them; plain SwiftUI buttons use `.interactivePlain`.
enum ClickableCursor {
    @MainActor static func install() {
        for cls: AnyClass in [NSButton.self, NSSegmentedControl.self] { swizzle(cls, with: #selector(NSControl.berean_resetCursorRects)) }
        // Toolbar items are SwiftUI hosting views inside AppKit's private item viewer (no NSButton to hook).
        if let viewer = NSClassFromString("NSToolbarItemViewer") { swizzle(viewer, with: #selector(NSView.berean_toolbarResetCursorRects)) }
        // Toolbar items change enabled state without resetting cursor rects (Back gains history); re-check after events.
        NotificationCenter.default.addObserver(forName: NSWindow.didUpdateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ToolbarCursorWatch.refresh() }
        }
    }

    private static func swizzle(_ cls: AnyClass, with replacement: Selector) {
        let original = #selector(NSView.resetCursorRects)
        guard let replacementMethod = class_getInstanceMethod(cls, replacement),
              let originalMethod = class_getInstanceMethod(cls, original) else { return }
        // Give the class its own copy first (a no-op when it already overrides), so the exchange never touches
        // NSView's implementation, then exchange it with a class-local copy of the replacement.
        _ = class_addMethod(cls, original, method_getImplementation(originalMethod), method_getTypeEncoding(originalMethod))
        guard class_addMethod(cls, replacement, method_getImplementation(replacementMethod), method_getTypeEncoding(replacementMethod)),
              let own = class_getInstanceMethod(cls, original), let mine = class_getInstanceMethod(cls, replacement) else { return }
        method_exchangeImplementations(own, mine)
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
