import SwiftUI
import AppKit

/// Shared by one Compare host. Passive native regions describe the actual
/// rendered column; no second SwiftUI layout is constructed for its drag image.
@MainActor final class CompareColumnDragController: NSObject, NSDraggingSource {
    private struct Region {
        weak var view: NSView?
        let payload: String
    }
    private var regions: [ObjectIdentifier: Region] = [:]
    weak var canvas: NSView?
    private var session: NSDraggingSession?
    private(set) var activePayload: String?
    private var didEnd: (() -> Void)?

    func register(_ view: NSView, payload: String) {
        regions[ObjectIdentifier(view)] = Region(view: view, payload: payload)
    }
    func unregister(_ view: NSView) { regions.removeValue(forKey: ObjectIdentifier(view)) }

    func begin(event: NSEvent, translation: NSPoint, began: (String) -> Void, ended: @escaping () -> Void) -> Bool {
        trace("requested")
        guard session == nil else { trace("busy"); return false }
        guard let canvas, let window = canvas.window, let content = window.contentView else { trace("no-canvas"); return false }
        trace("context", ["eventType": event.type.rawValue, "matchingWindow": event.window === window,
                          "canvas": NSStringFromRect(canvas.bounds), "regions": regions.count])
        guard event.window === window, event.type == .leftMouseDragged else { trace("wrong-event"); return false }
        regions = regions.filter { $0.value.view != nil }
        var columns: [String: [NSRect]] = [:]
        for region in regions.values {
            guard let view = region.view, view.window === window else { continue }
            let bounds = view.convert(view.bounds, to: canvas).intersection(canvas.bounds)
            if !bounds.isNull, bounds.width > 1, bounds.height > 1 {
                columns[region.payload, default: []].append(bounds)
            }
        }
        let pickup = NSPoint(x: event.locationInWindow.x - translation.x, y: event.locationInWindow.y - translation.y)
        let point = canvas.convert(pickup, from: nil)
        let sources = columns.compactMap { payload, fragments -> (String, [NSRect])? in
            guard fragments.contains(where: { $0.contains(point) }) else { return nil }
            return (payload, fragments)
        }
        // Representable gestures can share one hosting view. Resolve the live
        // source from geometry, not whichever column's recognizer runs first.
        guard sources.count == 1 else { trace("no-unique-source", ["pickup": NSStringFromPoint(pickup), "count": sources.count]); return false }
        let (payload, fragments) = sources[0]
        let visible = fragments.dropFirst().reduce(fragments[0]) { $0.union($1) }
        let renderHost = content.superview ?? content
        let capture = canvas.convert(visible, to: renderHost).intersection(renderHost.bounds)
        let scale = window.backingScaleFactor
        func representation() -> NSBitmapImageRep? {
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                pixelsWide: Int(ceil(capture.width * scale)), pixelsHigh: Int(ceil(capture.height * scale)),
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
            rep.size = capture.size
            return rep
        }
        guard !capture.isNull, let pixels = representation(), let bitmap = representation(),
              let drawing = NSGraphicsContext(bitmapImageRep: bitmap) else { trace("no-bitmap"); return false }
        renderHost.cacheDisplay(in: capture, to: pixels)
        // Window backing is not part of a transparent hosting view's cache.
        // Composite it explicitly and retain the screen's backing resolution.
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = drawing
        drawing.cgContext.scaleBy(x: scale, y: scale)
        canvas.effectiveAppearance.performAsCurrentDrawingAppearance {
            let windowBackground = window.backgroundColor ?? NSColor.textBackgroundColor
            let background = windowBackground.alphaComponent > 0 ? windowBackground : NSColor.textBackgroundColor
            background.withAlphaComponent(1).setFill()
            let bounds = NSRect(origin: .zero, size: capture.size)
            bounds.fill()
            // Stacked aligned passages interleave editions vertically. Capture
            // only this source's actual fragments, never the intervening text
            // belonging to another edition inside their combined bounding box.
            let mask = NSBezierPath()
            for fragment in fragments {
                let rect = canvas.convert(fragment, to: renderHost).intersection(capture)
                guard !rect.isNull, !rect.isEmpty else { continue }
                let y = renderHost.isFlipped ? capture.maxY - rect.maxY : rect.minY - capture.minY
                mask.appendRect(NSRect(x: rect.minX - capture.minX, y: y, width: rect.width, height: rect.height))
            }
            mask.addClip()
            pixels.draw(in: bounds)
        }
        NSGraphicsContext.restoreGraphicsState()
        let image = NSImage(size: capture.size)
        image.addRepresentation(bitmap)
        let item = NSDraggingItem(pasteboardWriter: payload as NSString)
        // Window coordinates preserve the pickup point. Include the recognizer's
        // initial movement rather than centering a new image under the pointer.
        let frame = renderHost.convert(capture, to: nil).offsetBy(dx: translation.x, dy: translation.y)
        item.setDraggingFrame(frame, contents: image)
        trace("snapshot", ["frame": NSStringFromRect(frame), "capture": NSStringFromRect(capture),
                           "pointer": NSStringFromPoint(event.locationInWindow),
                           "translation": NSStringFromPoint(translation), "scale": scale,
                           "flipped": renderHost.isFlipped, "fragments": fragments.map(NSStringFromRect),
                           "background": String(describing: window.backgroundColor)])
        #if DEBUG
        if tracing, let png = bitmap.representation(using: .png, properties: [:]) {
            try? png.write(to: UserLibrary.directory.appendingPathComponent("compare-column-drag.png"), options: .atomic)
            if let unmasked = pixels.representation(using: .png, properties: [:]) {
                try? unmasked.write(to: UserLibrary.directory.appendingPathComponent("compare-column-drag-unmasked.png"), options: .atomic)
            }
        }
        #endif
        didEnd = ended
        activePayload = payload
        let drag = window.beginDraggingSession(items: [item], event: event, source: self)
        session = drag
        drag.draggingFormation = .none
        drag.animatesToStartingPositionsOnCancelOrFail = true
        began(payload)
        return true
    }

    private var tracing: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--qa-library")
            && ProcessInfo.processInfo.arguments.contains("--qa-drag-trace")
        #else
        false
        #endif
    }
    private func trace(_ event: String, _ fields: [String: Any] = [:]) {
        guard tracing else { return }
        var row = fields
        row["event"] = event
        row["time"] = ProcessInfo.processInfo.systemUptime
        guard var bytes = try? JSONSerialization.data(withJSONObject: row, options: .sortedKeys) else { return }
        bytes.append(10)
        let url = UserLibrary.directory.appendingPathComponent("compare-column-drag.jsonl")
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        guard let file = try? FileHandle(forWritingTo: url) else { return }
        defer { try? file.close() }
        _ = try? file.seekToEnd()
        try? file.write(contentsOf: bytes)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .withinApplication ? .move : []
    }
    func ignoreModifierKeys(for session: NSDraggingSession) -> Bool { true }
    func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) { NSCursor.closedHand.set() }
    func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) { NSCursor.closedHand.set() }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        trace("ended", ["operation": operation.rawValue])
        let complete = didEnd
        didEnd = nil
        self.session = nil
        activePayload = nil
        complete?()
        if let window = canvas?.window, let content = window.contentView { window.invalidateCursorRects(for: content) }
    }
}

struct CompareDragCanvas: NSViewRepresentable {
    let controller: CompareColumnDragController
    func makeNSView(context: Context) -> NSView { PassThrough() }
    func updateNSView(_ view: NSView, context: Context) { controller.canvas = view }
    private final class PassThrough: NSView { override func hitTest(_ point: NSPoint) -> NSView? { nil } }
}

struct CompareDragRegion: NSViewRepresentable {
    let controller: CompareColumnDragController
    let payload: String
    func makeNSView(context: Context) -> RegionView { RegionView() }
    func updateNSView(_ view: RegionView, context: Context) {
        view.controller = controller
        controller.register(view, payload: payload)
    }
    static func dismantleNSView(_ view: RegionView, coordinator: Void) { view.controller?.unregister(view) }
    final class RegionView: NSView {
        weak var controller: CompareColumnDragController?
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

/// Delay single-click delivery until the lift recognizer yields. NSTextView
/// otherwise enters its own selection tracking loop before the column can lift.
/// Double-click selection and ordinary clicks still pass through on failure.
struct CompareColumnPan: NSGestureRecognizerRepresentable {
    let controller: CompareColumnDragController
    let began: (String) -> Void
    let ended: () -> Void
    final class Coordinator: NSObject, NSGestureRecognizerDelegate {
        func gestureRecognizer(_ gestureRecognizer: NSGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: NSGestureRecognizer) -> Bool { true }
    }
    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }
    func makeNSGestureRecognizer(context: Context) -> ColumnLiftRecognizer {
        let recognizer = ColumnLiftRecognizer()
        recognizer.delegate = context.coordinator
        recognizer.delaysPrimaryMouseButtonEvents = true
        updateNSGestureRecognizer(recognizer, context: context)
        return recognizer
    }
    func updateNSGestureRecognizer(_ recognizer: ColumnLiftRecognizer, context: Context) {
        recognizer.lift = { [weak recognizer] event, translation in
            controller.begin(event: event, translation: translation, began: began, ended: {
                // AppKit's dragging session consumes mouse-up. Explicitly finish
                // the recognizer, otherwise its next drag remains in .began.
                recognizer?.completeNativeDrag()
                ended()
            })
        }
    }
    // Begin the AppKit session inside mouseDragged, before mouse-up. SwiftUI's
    // representable action delivery can be deferred until a later input event.
    func handleNSGestureRecognizerAction(_ recognizer: ColumnLiftRecognizer, context: Context) {}

    final class ColumnLiftRecognizer: NSGestureRecognizer {
        var lift: ((NSEvent, NSPoint) -> Bool)?
        private var start: NSPoint?
        private var lifted = false
        override func mouseDown(with event: NSEvent) {
            guard event.clickCount == 1 else { state = .failed; return }
            start = event.locationInWindow
        }
        override func mouseDragged(with event: NSEvent) {
            guard !lifted, let start else { return }
            let delta = NSPoint(x: event.locationInWindow.x - start.x, y: event.locationInWindow.y - start.y)
            guard hypot(delta.x, delta.y) >= 5 else { return }
            if lift?(event, delta) == true {
                lifted = true
                state = .began
            } else {
                state = .failed
            }
        }
        override func mouseUp(with event: NSEvent) {
            guard start != nil || lifted else { return }
            state = lifted ? .ended : .failed
            start = nil
        }
        func completeNativeDrag() {
            start = nil
            lifted = false
            if state == .began || state == .changed { state = .ended }
        }
        override func reset() {
            super.reset()
            start = nil
            lifted = false
        }
    }
}
