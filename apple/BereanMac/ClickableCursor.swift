import AppKit

#if DEBUG
/// Opt-in observation of AppKit's cursor ownership. No method exchanges,
/// private toolbar APIs, cursor rectangles or cursor writes belong here.
@MainActor enum NativeCursorDiagnostics {
    private static var monitor: Any?
    private static var samples: [[String: String]] = []

    static func installIfRequested() {
        guard monitor == nil, ProcessInfo.processInfo.environment["BEREAN_CURSOR_TRACE"] != nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .cursorUpdate, .mouseEntered, .mouseExited, .leftMouseDragged]) { event in
            let window = event.window
            let point = event.locationInWindow
            let eventType = String(describing: event.type)
            DispatchQueue.main.async { [weak window] in
                guard let window else { return }
                let cursor = NSCursor.current
                let actual = cursor == .arrow ? "arrow" : cursor == .iBeam ? "text"
                    : cursor == .pointingHand ? "link" : "native-other"
                let sample = ["cursor": actual, "event": eventType,
                              "x": String(describing: point.x), "y": String(describing: point.y),
                              "windowIsKey": String(window.isKeyWindow)]
                samples.append(sample)
                if samples.count > 64 { samples.removeFirst(samples.count - 64) }
                guard let data = try? JSONSerialization.data(withJSONObject: samples, options: [.sortedKeys]) else { return }
                try? data.write(to: URL(fileURLWithPath: NSTemporaryDirectory() + "berean-native-cursor-samples.json"), options: .atomic)
            }
            return event
        }
    }
}
#endif
