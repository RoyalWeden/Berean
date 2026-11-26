import SwiftUI
import AppKit

/// Only a direct, phased trackpad gesture can trigger chapter navigation.
private final class ChapterPullScrollView: NSScrollView {
    var reader: ChapterTextView.Coordinator?
    private var travel = ChapterPullTravel()
    private var ignoresPullMomentum = false
    private var pull: ChapterPullCue?
    private var pullIntent = ChapterPullIntent(armDistance: 112, disarmDistance: 92)
    private var keyboardMonitor: Any?
    private var positionCheckpoint: Timer?
    private var checkpointDue: TimeInterval = 0
    private var pendingViewportAction: (() -> Void)?
    private var viewportSettle: Timer?
    private var applyingViewport = false
    private var studyPreviewOrigin: NSPoint?
    private var appliedViewportGeometry: ViewportGeometry?
    private var historyOffsetCorrection: HistoryOffsetCorrection?
    private struct HistoryOffsetCorrection {
        let actionID = UUID()
        var appliedY: CGFloat?
        var queued = false
    }

    private struct ViewportGeometry: Equatable {
        let clipSize: NSSize
        let documentFrame: NSRect
        let textInset: NSSize?
    }

    private var viewportGeometry: ViewportGeometry? {
        guard let documentView else { return nil }
        return ViewportGeometry(clipSize: contentView.bounds.size, documentFrame: documentView.frame,
                                textInset: (documentView as? NSTextView)?.textContainerInset)
    }

    var isRestoringViewport: Bool { pendingViewportAction != nil }

    // SwiftUI may queue a restore before this native view has a window or size.
    // Apply the latest intent once its actual viewport exists, then retain it
    // only through the initial native layout burst.
    func enqueueViewportAction(correctHistoryOffset: Bool = false, _ action: @escaping () -> Void) {
        pendingViewportAction = action
        appliedViewportGeometry = nil
        historyOffsetCorrection = correctHistoryOffset ? HistoryOffsetCorrection() : nil
        applyViewportActionIfReady()
    }

    private func applyViewportActionIfReady() {
        guard !applyingViewport, window != nil,
              contentView.bounds.width > 0, contentView.bounds.height > 0,
              let documentView, documentView.frame.width > 0,
              let geometry = viewportGeometry, geometry != appliedViewportGeometry,
              let action = pendingViewportAction else { return }
        applyingViewport = true
        action()
        applyingViewport = false
        appliedViewportGeometry = viewportGeometry
        historyOffsetCorrection?.appliedY = contentView.bounds.minY
        // A native inspector can resize through several widths after attachment.
        // Apply immediately, then retain this one intent through that layout burst.
        // Any new scroll/input owns the viewport and cancels it immediately.
        viewportSettle?.invalidate()
        let timer = Timer(timeInterval: 0.5, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.cancelViewportAction() }
        }
        viewportSettle = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    override func layout() {
        super.layout()
        applyViewportActionIfReady()
    }

    override func reflectScrolledClipView(_ clipView: NSClipView) {
        super.reflectScrolledClipView(clipView)
        guard reader != nil else { return }
        if studyPreviewOrigin != clipView.bounds.origin {
            studyPreviewOrigin = clipView.bounds.origin
            reader?.textView?.dismissStudyPreview()
        }
        if !applyingViewport, let event = NSApp.currentEvent, event.window === window,
           event.type == .leftMouseDragged { cancelViewportAction() }
        if clipView === contentView { queueHistoryOffsetCorrection() }
        checkpointDue = ProcessInfo.processInfo.systemUptime + 0.35
        // Scroll reflection can run at the display refresh rate. Keep one idle
        // timer instead of allocating/cancelling a Swift task for every frame.
        if positionCheckpoint == nil { scheduleCheckpoint(after: 0.35) }
    }

    // AppKit can still adjust the clip origin after the final resize, with no
    // change in its dimensions. Retry once for this geometry after reflection.
    private func queueHistoryOffsetCorrection() {
        guard !applyingViewport, var correction = historyOffsetCorrection, !correction.queued,
              let appliedY = correction.appliedY, contentView.bounds.minY != appliedY,
              viewportGeometry == appliedViewportGeometry else { return }
        correction.queued = true
        historyOffsetCorrection = correction
        let actionID = correction.actionID
        DispatchQueue.main.async { [weak self] in
            guard let self, self.historyOffsetCorrection?.actionID == actionID else { return }
            self.historyOffsetCorrection?.queued = false
            guard let appliedY = self.historyOffsetCorrection?.appliedY, self.contentView.bounds.minY != appliedY,
                  self.viewportGeometry == self.appliedViewportGeometry, let action = self.pendingViewportAction else { return }
            self.historyOffsetCorrection?.appliedY = nil
            self.applyingViewport = true
            action()
            self.applyingViewport = false
        }
    }

    private func scheduleCheckpoint(after delay: TimeInterval) {
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.positionCheckpoint = nil
                let remaining = self.checkpointDue - ProcessInfo.processInfo.systemUptime
                if remaining > 0.001 { self.scheduleCheckpoint(after: remaining); return }
                if self.isRestoringViewport { self.scheduleCheckpoint(after: 0.35); return }
                guard let reader = self.reader, let position = reader.readingPosition(in: self) else { return }
                reader.parent.savePosition(position)
            }
        }
        positionCheckpoint = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stopKeyboardMonitor()
        guard window != nil else { return }
        applyViewportActionIfReady()
        keyboardMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { [weak self] event in
            guard let self, let window, event.window === window, window.isKeyWindow,
                  window.attachedSheet == nil else { return event }
            self.cancelViewportAction()
            guard event.type == .keyDown else { return event }
            let responder = window.firstResponder
            let editing = responder is NSTextView && responder !== reader?.textView
            return reader?.parent?.onFindKey(event, editing) == true ? nil : event
        }
    }

    func stopKeyboardMonitor() {
        positionCheckpoint?.invalidate()
        positionCheckpoint = nil
        if let keyboardMonitor {
            NSEvent.removeMonitor(keyboardMonitor)
            self.keyboardMonitor = nil
        }
    }

    func cancelViewportAction() {
        viewportSettle?.invalidate()
        viewportSettle = nil
        pendingViewportAction = nil
        appliedViewportGeometry = nil
        historyOffsetCorrection = nil
    }

    private func publish(_ cue: ChapterPullCue?) {
        guard cue != pull else { return }
        pull = cue
        reader?.parent?.onChapterPull(cue)
    }

    override func setFrameSize(_ newSize: NSSize) {
        let ranges = frame.size != newSize ? reader?.visibleSelectedRanges(in: self) ?? [] : []
        super.setFrameSize(newSize)
        applyViewportActionIfReady()
        for range in ranges {
            if reader?.revealSelectedRange(range, in: self) == true { break }
        }
    }

    override func scrollWheel(with event: NSEvent) {
        cancelViewportAction()
        if ignoresPullMomentum, !event.momentumPhase.isEmpty {
            if event.momentumPhase.contains(.ended) { ignoresPullMomentum = false }
            return
        }
        if event.phase.contains(.cancelled) {
            pullIntent.cancel()
            travel.reset()
            ignoresPullMomentum = false
            publish(nil)
        }
        if event.phase.contains(.began) {
            ignoresPullMomentum = false
            let bounds = contentView.bounds
            let top = documentView?.frame.minY ?? 0
            let bottom = max(top, (documentView?.frame.maxY ?? 0) - bounds.height)
            pullIntent.begin(atTop: bounds.minY <= top + 2, atBottom: bounds.minY >= bottom - 2)
            travel.reset()
            publish(nil)
        }

        if event.phase.contains(.ended) {
            let direction = pullIntent.finish()
            travel.reset()
            publish(nil)
            super.scrollWheel(with: event)
            if let direction, let parent = reader?.parent, parent.canPullChapter(direction) {
                // Chapter navigation must capture the outgoing page now. A
                // normal finger release instead uses the idle checkpoint:
                // saving through AppModel here rebuilds the reader just as
                // AppKit hands the gesture over to momentum scrolling.
                if let reader, let position = reader.readingPosition(in: self) { parent.savePosition(position) }
                ignoresPullMomentum = true
                parent.onChapterPullCommit(direction)
            }
            return
        }

        if event.hasPreciseScrollingDeltas, event.momentumPhase.isEmpty, event.phase.contains(.changed),
           let reader, let parent = reader.parent, let text = reader.textView,
           text.selectedRange().length == 0 {
            travel.add(horizontal: event.scrollingDeltaX, vertical: event.scrollingDeltaY)
            // Eligibility was captured at gesture begin. Elastic clip bounds,
            // stationary packets or one sideways correction must not erase a
            // slow pull; actual reversal reduces its accumulated distance.
            publish(pullIntent.update(direction: travel.direction, distance: travel.distance,
                allowed: travel.isVertical && parent.canPullChapter(travel.direction)))
        } else if event.phase.contains(.changed) {
            pullIntent.cancel()
            travel.reset()
            publish(nil)
        }

        super.scrollWheel(with: event)
    }
}

/// The Mac Scripture reader: ONE TextKit text view for the whole chapter, so a selection can run across verses
/// (VERSE rows as separate SwiftUI Texts could not). Verse numbers, Strong's numbers and study markers are links with
/// a pointing-hand cursor and a hover tint; right-click gives the verse actions; ⌘C copies like the existing
/// app (several verses → "Book c:v1-v2" + numbered lines; ⌘⇧C → plain text on one line).
struct ChapterTextView: NSViewRepresentable {
    var passageId = ""                       // text|book|chapter — scroll position is kept only within one passage
    var header: [String] = []                       // versification note, etc.
    var headerDetail: String?
    var chapterTags: [(name: String, color: String?, slot: Int?)] = []
    var verses: [ReaderVerse]
    var chapterStudy: ReaderChapterStudy?
    var style: ReaderStyle
    var selectedVerses: Set<Int> = []
    var selectionFocus: Int?
    var scrollTarget: Int?
    var actionClearance: CGFloat = 0
    var animateOutline = true
    var scrollRevision: UUID?
    var titleBarClearance: CGFloat = 0
    let positionReader: ScripturePositionReader
    var onFindRefresh: (String, Int, Int) -> Void = { _, _, _ in }
    var onFindKey: (NSEvent, Bool) -> Bool = { _, _ in false }
    var restorePosition: () -> ScriptureReadingPosition? = { nil }
    var historyRestore: ScriptureHistoryRestore?
    var isHistoryRestoreCurrent: (UUID?) -> Bool = { _ in true }
    var finishHistoryRestore: (ScriptureHistoryRestore, ScriptureReadingPosition?) -> Void = { _, _ in }
    var savePosition: (ScriptureReadingPosition) -> Void = { _ in }
    var selectedVerseCopyText: (Bool) -> String?
    var rangeCopyText: (Set<Int>, Bool) -> String?
    var verseMenu: (Int) -> NSMenu
    var tagMenu: (String, Int?) -> NSMenu           // tag name, verse (nil = chapter tag)
    var strongsTooltips: [String: String] = [:]
    var onStudyPreview: @MainActor (Int) async -> [ReaderStudyPreview] = { _ in [] }
    var onStrongs: (String, Int?) -> Void
    var onOpenStrongsTab: (String, Int?) -> Void
    var onIdiom: (String) -> Void = { _ in }
    var onNewIdiom: (String) -> Void = { _ in }
    var onNotes: (Int) -> Void
    var onChapterNotes: () -> Void = {}
    var onNumberingInfo: () -> Void = {}
    var onCitations: (Int) -> Void
    /// A verse number was clicked (shift = extend the range from the last clicked verse).
    var onVerseClick: (Int, Bool) -> Void
    var onCopySelectedVerses: () -> Void
    var canPullChapter: (Int) -> Bool = { _ in false }
    var onChapterPull: (ChapterPullCue?) -> Void = { _ in }
    var onChapterPullCommit: (Int) -> Void = { _ in }
    /// Highlight part of a verse: (verse, display start, display end, colour) — display offsets into the verse's shown words.
    var onHighlightRange: (Int, Int, Int, String) -> Void = { _, _, _, _ in }
    var onSearchSelection: (String) -> Void = { _ in }
    var onBookSearch: (String) -> Void = { _ in }
    var bookName: String = ""
    var onLexiconSearch: (String) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = ChapterPullScrollView()
        scroll.reader = context.coordinator
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.autohidesScrollers = true
        scroll.verticalScrollElasticity = .allowed
        scroll.automaticallyAdjustsContentInsets = false
        let storage = NSTextStorage()
        let layout = ReaderTextLayoutManager()
        let container = NSTextContainer()
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let tv = ReaderTextView(frame: .zero, textContainer: container)
        tv.isEditable = false
        tv.isSelectable = true
        tv.drawsBackground = false
        tv.isRichText = true
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.autoresizingMask = [.width]
        tv.textContainer?.widthTracksTextView = true
        tv.linkTextAttributes = [:]
        tv.delegate = context.coordinator
        tv.coordinator = context.coordinator
        tv.setAccessibilityLabel("Scripture text")
        scroll.documentView = tv
        context.coordinator.textView = tv
        positionReader.capture = { [weak coordinator = context.coordinator, weak scroll] preferred in
            guard let coordinator, let scroll else { return nil }
            return coordinator.readingPosition(in: scroll, preferred: preferred)
        }
        positionReader.find = { [weak coordinator = context.coordinator] query, step in
            coordinator?.find(query, step: step) ?? (0, 0)
        }
        return scroll
    }

    private static func isAtChapterEnd(_ clip: NSClipView) -> Bool {
        var end = clip.bounds
        end.origin.y = clip.documentRect.maxY
        let bottom = clip.constrainBoundsRect(end).minY
        return bottom > clip.documentRect.minY + 1 && clip.bounds.minY >= bottom - 1
    }

    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        let restoring = (scroll as? ChapterPullScrollView)?.isRestoringViewport == true
        (scroll as? ChapterPullScrollView)?.stopKeyboardMonitor()
        (scroll as? ChapterPullScrollView)?.cancelViewportAction()
        // Do not replace the saved intent with a transient, partially laid-out capture.
        guard !restoring, let position = coordinator.readingPosition(in: scroll) else { return }
        coordinator.parent.savePosition(position)
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let c = context.coordinator
        if let previous = c.parent, previous.passageId != passageId,
           let position = c.readingPosition(in: scroll) {
            // Warm chapter changes reuse this view instead of dismantling it.
            // Save through the outgoing callback, outside the view update.
            DispatchQueue.main.async { previous.savePosition(position) }
        }
        c.parent = self
        guard let tv = c.textView else { return }
        tv.titleBarClearance = titleBarClearance
        tv.updateOutlineMotion()
        let clip = scroll.contentView
        let firstPassage = c.lastPassage.isEmpty
        let passageChanged = c.lastPassage != passageId
        let key = Key(header: header, chapterTags: chapterTags.map(\.name), chapterStudy: chapterStudy, verses: verses, style: style)
        let insetChanged = scroll.contentInsets.bottom != actionClearance
        let wasAtEnd = !passageChanged && (insetChanged || key != c.lastKey) && Self.isAtChapterEnd(clip)
        if insetChanged {
            var bounds = clip.bounds
            // Preserve the chapter end when the floating capsule adds scroll room.
            // Elsewhere, preserve the visible text and let the selection reveal run separately.
            scroll.contentInsets.bottom = actionClearance
            scroll.scrollerInsets.bottom = actionClearance
            if wasAtEnd { bounds.origin.y = clip.documentRect.maxY }
            clip.scroll(to: clip.constrainBoundsRect(bounds).origin)
            scroll.reflectScrolledClipView(clip)
        }
        let previousBounds = clip.bounds
        let previousSelection = c.renderedSelection
        let revealSelection = !passageChanged && !selectedVerses.subtracting(previousSelection).isEmpty
        if key != c.lastKey || passageChanged {
            tv.dismissStudyPreview()
            let keepScroll = c.lastPassage == passageId
            let origin = previousBounds.origin
            let readingAnchor = keepScroll ? c.readingAnchor(at: origin.y, in: tv) : nil
            let strongsChanged = keepScroll && c.lastKey?.style.showStrongs != style.showStrongs
            let bodyAnchor = strongsChanged ? c.bodyReflowAnchor(in: tv) : nil
            let sel = tv.selectedRanges
            let previousText = tv.string
            c.clearFindHighlight()
            tv.readerWidth = style.width
            tv.textStorage?.setAttributedString(c.build(self))
            if keepScroll {
                c.refreshFindAfterRestyle()
            } else {
                _ = c.find("", step: 0)
            }
            tv.needsDisplay = true
            if keepScroll {
                // Character ranges use UTF-16 offsets, so even canonically equal text can invalidate them.
                let kept = previousText.utf16.elementsEqual(tv.string.utf16) ? sel : []
                tv.selectedRanges = kept.isEmpty ? [NSValue(range: NSRange(location: 0, length: 0))] : kept
                var proposed = previousBounds
                if let bodyAnchor, let y = c.bodyReflowTop(bodyAnchor, in: tv) {
                    proposed.origin.y = y
                } else if wasAtEnd, let container = tv.textContainer {
                    tv.layoutManager?.ensureLayout(for: container)
                    proposed.origin.y = clip.documentRect.maxY
                } else if let readingAnchor, let range = c.verseRanges[readingAnchor.verse], let container = tv.textContainer {
                    tv.layoutManager?.ensureLayout(for: container)
                    if let marker = tv.firstRect(forVerseRange: range) {
                        proposed.origin.y = tv.convert(marker, to: clip).minY - readingAnchor.offsetFromTop
                    }
                }
                clip.scroll(to: clip.constrainBoundsRect(proposed).origin)
                scroll.reflectScrolledClipView(clip)
            }
            c.lastKey = key
            c.lastTooltips = strongsTooltips
            if passageChanged {
                c.lastPassage = passageId
                c.editionArrival = nil
                var start = clip.bounds
                start.origin.y = clip.documentRect.minY
                clip.scroll(to: clip.constrainBoundsRect(start).origin)
                scroll.reflectScrolledClipView(clip)
                c.scrolledTo = nil
            }
        }
        if c.lastTooltips != strongsTooltips, let storage = tv.textStorage {
            updateReaderStrongsTooltips(storage, values: strongsTooltips)
            c.lastTooltips = strongsTooltips
        }
        if c.renderedSelection != selectedVerses {
            if let storage = tv.textStorage {
                c.updateMarkerColors(in: storage, changed: c.renderedSelection.symmetricDifference(selectedVerses))
            }
            c.renderedSelection = selectedVerses
            tv.needsDisplay = true
        }
        if revealSelection, scrollTarget == nil, historyRestore == nil {
            let destination = passageId
            DispatchQueue.main.async { [weak scroll, weak c] in
                guard let scroll, let c, c.lastPassage == destination,
                      c.parent.passageId == destination, c.parent.scrollTarget == nil,
                      c.parent.selectedVerses == selectedVerses,
                      c.parent.isHistoryRestoreCurrent(nil) else { return }
                for range in selectionRevealRanges(selectedVerses, previous: previousSelection, focus: selectionFocus, in: c.verseRanges, orderedVerses: c.parent.verses.map(\.verse)) {
                    if c.revealSelectedRange(range, in: scroll) { break }
                }
            }
        }
        if (passageChanged || historyRestore != nil), scrollTarget == nil {
            let restore = historyRestore
            let revision = restore?.revision
            DispatchQueue.main.async { [weak tv, weak scroll, weak c] in
                guard let tv, let scroll = scroll as? ChapterPullScrollView, let c, c.lastPassage == passageId,
                      c.parent?.scrollTarget == nil, c.parent?.historyRestore?.revision == revision,
                      c.parent?.isHistoryRestoreCurrent(revision) == true,
                      let position = restore?.position ?? c.parent?.restorePosition(),
                      let container = tv.textContainer else { return }
                var finishedHistoryRestore = false
                scroll.enqueueViewportAction(correctHistoryOffset: firstPassage && restore != nil) { [weak scroll, weak tv, weak c] in
                    guard let scroll, let tv, let c, let parent = c.parent, c.lastPassage == passageId,
                          parent.scrollTarget == nil else { return }
                    if finishedHistoryRestore {
                        // A newly mounted reader can still change geometry after its
                        // first application. Let the native layout burst correct it
                        // while this action owns the viewport and no new restore exists.
                        guard firstPassage, parent.isHistoryRestoreCurrent(nil) else { return }
                    } else {
                        guard parent.historyRestore?.revision == revision,
                              parent.isHistoryRestoreCurrent(revision) else { return }
                    }
                    tv.layoutManager?.ensureLayout(for: container)
                    let clip = scroll.contentView
                    var bounds = clip.bounds
                    let reflowed = position.viewportWidth.map { abs($0 - clip.bounds.width) > 1 } ?? false
                    let reflowTop = reflowed ? position.verse.flatMap { c.verseRanges[$0] }
                        .flatMap { tv.firstVerseLineTop(in: $0) }
                        .flatMap { y in position.verseOffsetFromTop.map { tv.convert(NSPoint(x: 0, y: y), to: clip).y - $0 } } : nil
                    let verseTop = position.offset == 0 ? position.verse.flatMap { c.verseRanges[$0] }
                        .flatMap { tv.firstVerseLineTop(in: $0) }
                        .map { tv.convert(NSPoint(x: 0, y: $0), to: clip).y - tv.visibleTitleBarClearance - 12 } : nil
                    bounds.origin.y = position.atEnd ? clip.documentRect.maxY : reflowTop ?? verseTop ?? (clip.documentRect.minY + position.offset)
                    clip.scroll(to: clip.constrainBoundsRect(bounds).origin)
                    scroll.reflectScrolledClipView(clip)
                    c.editionArrival = position.returnEdition.map {
                        ScriptureEditionArrival(edition: $0, offset: max(0, clip.bounds.minY - clip.documentRect.minY))
                    }
                    if let restore, !finishedHistoryRestore {
                        finishedHistoryRestore = true
                        parent.finishHistoryRestore(restore, c.readingPosition(in: scroll))
                    }
                }
            }
        }
        if scrollTarget == nil { c.scrolledTo = nil }
        if let target = scrollTarget, c.verseRanges[target] != nil {
            let request = ScriptureScrollTarget(verse: target, lastSelectedVerse: selectedVerses.max(), revision: scrollRevision)
            guard request != c.scrolledTo else { return }
            c.scrolledTo = request
            let destination = passageId
            DispatchQueue.main.async { [weak tv, weak scroll, weak c] in
                guard let tv, let scroll = scroll as? ChapterPullScrollView, let c,
                      c.parent.passageId == destination, c.parent.scrollTarget == target,
                      c.parent.isHistoryRestoreCurrent(nil),
                      c.scrolledTo == request, c.parent.selectedVerses.max() == request.lastSelectedVerse,
                      let range = c.verseRanges[target], let container = tv.textContainer else { return }
                scroll.enqueueViewportAction { [weak scroll, weak tv, weak c] in
                    guard let scroll, let tv, let c, c.parent.passageId == destination,
                          c.parent.scrollTarget == target, c.scrolledTo == request,
                          c.parent.isHistoryRestoreCurrent(nil),
                          c.parent.selectedVerses.max() == request.lastSelectedVerse else { return }
                    scroll.layoutSubtreeIfNeeded()
                    tv.layoutManager?.ensureLayout(for: container)
                    if let firstLine = tv.firstVerseLineTop(in: range) {
                        let clip = scroll.contentView
                        let top = tv.convert(NSPoint(x: 0, y: firstLine), to: clip).y
                        var proposed = clip.bounds
                        let titleBarClearance = tv.visibleTitleBarClearance
                        // Opening the first verse keeps the chapter header and top inset in view.
                        proposed.origin.y = target == c.parent.verses.first?.verse ? clip.documentRect.minY : top - titleBarClearance - 12
                        if let lastVerse = request.lastSelectedVerse,
                           lastVerse >= target, let lastRange = c.verseRanges[lastVerse],
                           let bottom = tv.lastVerseLineBottom(in: lastRange) {
                            let lastLine = tv.convert(NSPoint(x: 0, y: bottom), to: clip).y + ReaderFloatingControls.readingGap
                            let readingHeight = proposed.height - c.parent.actionClearance
                            if lastLine - top <= readingHeight - titleBarClearance {
                                proposed.origin.y = max(proposed.origin.y, lastLine - readingHeight)
                            }
                        }
                        clip.scroll(to: clip.constrainBoundsRect(proposed).origin)
                        scroll.reflectScrolledClipView(clip)
                    }
                }
            }
        }
    }

    struct Key: Equatable {
        var header: [String]; var chapterTags: [String]; var chapterStudy: ReaderChapterStudy?; var verses: [ReaderVerse]; var style: ReaderStyle
    }

    // MARK: - Coordinator: builds the text, routes clicks, copies

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChapterTextView!
        weak var textView: ReaderTextView?
        var lastKey: Key?
        var lastTooltips: [String: String] = [:]
        var lastPassage = ""
        var scrolledTo: ScriptureScrollTarget?
        var editionArrival: ScriptureEditionArrival?
        /// verse → range of its paragraph (number + text) in the text storage.
        var renderedSelection: Set<Int> = []
        private var markerRanges: [Int: NSRange] = [:]

        func updateMarkerColors(in storage: NSTextStorage, changed: Set<Int>) {
            storage.beginEditing()
            for verse in changed {
                guard let range = markerRanges[verse] else { continue }
                storage.addAttribute(.foregroundColor, value: markerColor(verse, parent), range: range)
            }
            storage.endEditing()
        }

        private func markerColor(_ verse: Int, _ reader: ChapterTextView) -> NSColor {
            let accent = reader.style.themeAccent.map { NSColor(ReaderTheme.color($0)) } ?? .controlAccentColor   // reading theme
            return reader.selectedVerses.contains(verse) ? accent : accent.withAlphaComponent(0.82)
        }

        private var findQuery = ""
        private var findIndex = 0
        private var findRanges: [[NSRange]] = []
        private var findHighlight: [NSRange] = []

        func clearFindHighlight() {
            if let textView, let layout = textView.layoutManager {
                for range in findHighlight where range.upperBound <= textView.string.utf16.count {
                    layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: range)
                }
            }
            findHighlight.removeAll()
        }

        private func findMatches(_ query: String, in storage: NSTextStorage) -> [[NSRange]] {
            let source = storage.string as NSString
            var matches: [[NSRange]] = []
            for verse in verseRanges.keys.sorted() {
                guard let start = verseTextStarts[verse], let paragraph = verseRanges[verse] else { continue }
                let words = NSMutableString(string: "")
                var runs: [(display: NSRange, source: NSRange)] = []
                storage.enumerateAttribute(Self.skipKey, in: NSRange(start..<paragraph.upperBound)) { skip, range, _ in
                    guard skip == nil else { return }
                    runs.append((NSRange(location: words.length, length: range.length), range))
                    words.append(source.substring(with: range))
                }
                var cursor = 0
                while cursor < words.length {
                    let match = words.range(of: query, options: [.caseInsensitive, .diacriticInsensitive],
                                            range: NSRange(cursor..<words.length))
                    guard match.location != NSNotFound, match.length > 0 else { break }
                    matches.append(runs.compactMap { run in
                        let part = NSIntersectionRange(match, run.display)
                        guard part.length > 0 else { return nil }
                        return NSRange(location: run.source.location + part.location - run.display.location, length: part.length)
                    })
                    cursor = match.upperBound
                }
            }
            return matches
        }

        @MainActor func refreshFindAfterRestyle() {
            guard !findQuery.isEmpty, let storage = textView?.textStorage else { return }
            findRanges = findMatches(findQuery, in: storage)
            findIndex = min(findIndex, max(0, findRanges.count - 1))
            let current = highlightFindMatch() == nil ? 0 : findIndex + 1
            let query = findQuery, total = findRanges.count, passage = parent.passageId
            DispatchQueue.main.async { [weak self] in
                guard let self, parent.passageId == passage, findQuery == query,
                      (findRanges.isEmpty ? 0 : findIndex + 1) == current,
                      findRanges.count == total else { return }
                parent.onFindRefresh(query, current, total)
            }
        }

        private func highlightFindMatch() -> NSRange? {
            guard findRanges.indices.contains(findIndex), let first = findRanges[findIndex].first else { return nil }
            findHighlight = findRanges[findIndex]
            for part in findHighlight {
                textView?.layoutManager?.addTemporaryAttribute(.backgroundColor,
                                                               value: NSColor.systemYellow.withAlphaComponent(0.40),
                                                               forCharacterRange: part)
            }
            return first
        }

        func find(_ query: String, step: Int) -> (current: Int, total: Int) {
            clearFindHighlight()
            if query.isEmpty {
                findQuery = ""
                findRanges.removeAll()
                findIndex = 0
                return (0, 0)
            }
            guard let textView, let storage = textView.textStorage else { return (0, 0) }
            if query != findQuery {
                findQuery = query
                findRanges = findMatches(query, in: storage)
                let top = readingAnchor(at: textView.enclosingScrollView?.contentView.bounds.minY ?? 0, in: textView)
                    .flatMap { verseTextStarts[$0.verse] } ?? 0
                findIndex = findRanges.firstIndex { ($0.first?.location ?? 0) >= top } ?? 0
            } else if !findRanges.isEmpty {
                findIndex = (findIndex + step + findRanges.count) % findRanges.count
            }
            guard let range = highlightFindMatch() else { return (0, 0) }
            if let scroll = textView.enclosingScrollView, let top = textView.firstVerseLineTop(in: range) {
                let clip = scroll.contentView
                let y = textView.convert(NSPoint(x: 0, y: top), to: clip).y
                var bounds = clip.bounds
                bounds.origin.y = y - max(textView.visibleTitleBarClearance + 64, bounds.height * 0.4)
                clip.scroll(to: clip.constrainBoundsRect(bounds).origin)
                scroll.reflectScrolledClipView(clip)
            }
            return (findIndex + 1, findRanges.count)
        }

        var verseRanges: [Int: NSRange] = [:]
        /// verse → storage index where its words start (after the gutter).
        var verseTextStarts: [Int: Int] = [:]

        static let verseKey = NSAttributedString.Key("bereanVerse")       // Int on every character of a verse paragraph
        static let skipKey = NSAttributedString.Key("bereanSkip")         // gutter number, Strong's, chips: not copied as text

        func textView(_ textView: NSTextView, willChangeSelectionFromCharacterRanges oldSelectedCharRanges: [NSValue],
                      toCharacterRanges newSelectedCharRanges: [NSValue]) -> [NSValue] {
            guard let storage = textView.textStorage else { return newSelectedCharRanges }
            return newSelectedCharRanges.map {
                NSValue(range: readerTextSelection($0.rangeValue, in: storage, excluding: Self.skipKey))
            }
        }

        func font(_ size: Double, italic: Bool = false) -> NSFont {
            let font = ScriptureFont.nativeFont(parent.style.family, size: CGFloat(size))
            return italic ? NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) : font
        }

        func build(_ p: ChapterTextView) -> NSAttributedString {
            let out = NSMutableAttributedString()
            verseRanges = [:]; verseTextStarts = [:]
            markerRanges.removeAll(keepingCapacity: true)
            let size = p.style.fontSize
            let para = NSMutableParagraphStyle()
            para.lineSpacing = p.style.lineSpacing
            para.paragraphSpacing = size * 0.55
            let hasAnnotations = p.verses.contains { $0.noteCount > 0 || !$0.tags.isEmpty || $0.citationCount > 0 || $0.mentionCount > 0 }
            let gutterWidth: CGFloat = p.style.showVerseNumbers ? 34 : hasAnnotations ? 16 : 0
            if p.style.showVerseNumbers {
                para.tabStops = [NSTextTab(textAlignment: .right, location: 26), NSTextTab(textAlignment: .left, location: gutterWidth)]
                para.headIndent = gutterWidth
            } else if hasAnnotations {
                para.tabStops = [NSTextTab(textAlignment: .left, location: gutterWidth)]
                para.headIndent = gutterWidth
            }
            let bodyColor = p.style.themeText.map { NSColor(ReaderTheme.color($0)) } ?? NSColor.labelColor   // reading theme
            let base: [NSAttributedString.Key: Any] = [.font: font(size), .foregroundColor: bodyColor, .paragraphStyle: para]

            let headPara = NSMutableParagraphStyle(); headPara.paragraphSpacing = 10; headPara.headIndent = gutterWidth; headPara.firstLineHeadIndent = gutterWidth
            for h in p.header {
                var attributes: [NSAttributedString.Key: Any] = [.font: NSFont.preferredFont(forTextStyle: .caption1), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: headPara, Self.skipKey: true]
                if let detail = p.headerDetail {
                    attributes[.link] = URL(string: "berean-numbering:info")!
                    attributes[.toolTip] = detail
                }
                out.append(NSAttributedString(string: h + "  ⓘ\n", attributes: attributes))
            }
            if let study = p.chapterStudy {
                let attachment = NSTextAttachment()
                attachment.image = NSImage(systemSymbolName: study.symbol, accessibilityDescription: study.summary)?
                    .withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
                let marker = NSMutableAttributedString(attachment: attachment)
                marker.append(NSAttributedString(string: "\n"))
                marker.addAttributes([.paragraphStyle: headPara, Self.skipKey: true,
                    .foregroundColor: NSColor.secondaryLabelColor,
                    .link: URL(string: "berean-chapter-study:tags")!, .toolTip: study.summary],
                    range: NSRange(location: 0, length: marker.length))
                out.append(marker)
            }

            for v in p.verses {
                let start = out.length
                let numberedTitle = v.numberBeforeTitle && v.title?.isEmpty == false && p.style.showVerseNumbers
                let titlePara = (para.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                titlePara.firstLineHeadIndent = numberedTitle ? 0 : gutterWidth
                titlePara.headIndent = gutterWidth
                if !numberedTitle { titlePara.tabStops = [] }
                titlePara.paragraphSpacing = numberedTitle ? para.paragraphSpacing : size * 0.3
                let titleAttributes = base.merging([.font: font(size * (v.numberBeforeTitle ? 0.92 : 0.85), italic: true), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: titlePara, Self.skipKey: true]) { $1 }
                if let title = v.title, !title.isEmpty, !numberedTitle {
                    out.append(NSAttributedString(string: title + "\n", attributes: titleAttributes))
                }
                // Personal study material belongs in the margin, not in the
                // reading/copying run. Keep the number's separate click target.
                if v.noteCount > 0 || !v.tags.isEmpty || v.citationCount > 0 || v.mentionCount > 0 {
                    let attachment = NSTextAttachment()
                    attachment.image = NSImage(systemSymbolName: v.studySymbol, accessibilityDescription: v.studySummary)?
                        .withSymbolConfiguration(.init(pointSize: max(10, size * 0.65), weight: .medium))
                    let marker = NSMutableAttributedString(attachment: attachment)
                    marker.addAttributes([
                        .foregroundColor: NSColor.secondaryLabelColor,
                        .paragraphStyle: numberedTitle ? titlePara : para, Self.skipKey: true,
                        .link: URL(string: "\((v.citationCount > 0 || v.mentionCount > 0) && v.noteCount == 0 && v.tags.isEmpty ? "berean-verse-citations" : "berean-verse-notes"):\(v.verse)")!,
                    ], range: NSRange(location: 0, length: marker.length))
                    out.append(marker)
                }
                if p.style.showVerseNumbers {
                    // Gutter: right-aligned verse number (a link → verse actions), note dot.
                    let numAttrs: [NSAttributedString.Key: Any] = [
                        .font: NSFont.monospacedDigitSystemFont(ofSize: max(10, size * 0.62), weight: .semibold),
                        .foregroundColor: markerColor(v.verse, p),
                        .link: URL(string: "berean-verse:\(v.verse)")!, .paragraphStyle: numberedTitle ? titlePara : para, Self.skipKey: true,
                        .toolTip: "Verse \(v.readerVerseLabel) — click to select (⇧-click for a range); right-click for highlight, tag, note, copy…",
                    ]
                    // The whole gutter (both tabs and the number) is the verse-number target, so single digits are easy to hit.
                    let gutterTab = numAttrs.merging([.font: NSFont.systemFont(ofSize: CGFloat(size))]) { $1 }
                    let markerStart = out.length
                    out.append(NSAttributedString(string: "\t", attributes: gutterTab))
                    out.append(NSAttributedString(string: "\(v.readerVerseLabel)", attributes: numAttrs))
                    out.append(NSAttributedString(string: "\t", attributes: gutterTab))
                    markerRanges[v.verse] = NSRange(location: markerStart, length: out.length - markerStart)
                } else if hasAnnotations {
                    out.append(NSAttributedString(string: "\t", attributes: base.merging([Self.skipKey: true]) { $1 }))
                }
                if numberedTitle, let title = v.title {
                    // A line break, not a new paragraph: title + body form one
                    // verse, with no paragraph gap or second gutter to select.
                    out.append(NSAttributedString(string: title.replacingOccurrences(of: "\n", with: " ") + "\u{2028}", attributes: titleAttributes))
                }
                let textStart = out.length
                verseTextStarts[v.verse] = textStart
                // Words with italics / red letters / character highlights; Strong's numbers as superscript links.
                var pos = 0
                for (i, w) in v.words.enumerated() {
                    if i > 0 {
                        var a = base
                        if let m = v.marks.last(where: { $0.start <= pos && pos < $0.end }) { a[.backgroundColor] = NSColor(Color.highlight(m.color)).withAlphaComponent(0.35) }
                        if let idiom = v.idioms.first(where: { $0.start <= pos && pos < $0.end }), let url = URL(string: "berean-idiom:\(idiom.id)") {
                            a[.underlineStyle] = NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue
                            a[.underlineColor] = NSColor.systemPurple; a[.link] = url
                            a[.toolTip] = idiom.meaning.isEmpty ? "Idiom — click to open" : idiom.meaning
                        }
                        out.append(NSAttributedString(string: " ", attributes: a)); pos += 1
                    }
                    let units = Array(w.text.utf16)
                    var k = 0
                    while k < units.count {
                        let hit = v.marks.last { $0.start <= pos + k && pos + k < $0.end }
                        var j = k + 1
                        while j < units.count, v.marks.last(where: { $0.start <= pos + j && pos + j < $0.end })?.color == hit?.color { j += 1 }
                        var a = base
                        if w.italic { a[.font] = font(size, italic: true) }
                        if w.red && p.style.redLetters { a[.foregroundColor] = NSColor.systemRed }
                        if let hit { a[.backgroundColor] = NSColor(Color.highlight(hit.color)).withAlphaComponent(0.35) }
                        let chunkStart = out.length
                        out.append(NSAttributedString(string: String(decoding: units[k..<j], as: UTF16.self), attributes: a))
                        // Idiom terms: dotted underline, meaning as tooltip, click opens the idiom note.
                        let plain = NSRange(location: pos + k, length: j - k)
                        for idiom in v.idioms {
                            let hit = NSIntersectionRange(plain, NSRange(location: idiom.start, length: idiom.end - idiom.start))
                            guard hit.length > 0, let url = URL(string: "berean-idiom:\(idiom.id)") else { continue }
                            out.addAttributes([
                                .underlineStyle: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue,
                                .underlineColor: NSColor.systemPurple, .link: url,
                                .toolTip: idiom.meaning.isEmpty ? "Idiom — click to open" : idiom.meaning,
                            ], range: NSRange(location: chunkStart + hit.location - plain.location, length: hit.length))
                        }
                        k = j
                    }
                    pos += units.count
                    if p.style.showStrongs {
                        for n in w.strongs {
                            let id = n.trimmingCharacters(in: CharacterSet(charactersIn: "()"))
                            out.append(NSAttributedString(string: "\u{2009}" + id, attributes: [
                                .font: NSFont.monospacedDigitSystemFont(ofSize: max(9, size * 0.58), weight: .medium),
                                .foregroundColor: NSColor.controlAccentColor, .baselineOffset: size * 0.38,
                                .link: URL(string: "strongs:\(id)")!, .paragraphStyle: para, Self.skipKey: true,
                                .toolTip: p.strongsTooltips[id] ?? "Strong's \(id) — open in the lexicon",
                            ]))
                        }
                    }
                }
                out.append(NSAttributedString(string: "\n", attributes: base))
                let range = NSRange(location: start, length: out.length - start)
                out.addAttribute(Self.verseKey, value: v.verse, range: range)
                let tint = v.tint.map { NSColor(Color.highlight($0)).withAlphaComponent(0.22) }
                if let tint {
                    out.enumerateAttribute(.backgroundColor, in: NSRange(location: textStart, length: out.length - textStart - 1)) { val, r, _ in
                        if val == nil { out.addAttribute(.backgroundColor, value: tint, range: r) }
                    }
                }
                verseRanges[v.verse] = range
            }
            return out
        }

        func chip(_ t: (name: String, color: String?, slot: Int?), verse: Int?) -> NSAttributedString {
            let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let c = NSColor(TagColor.color(t.color, slot: t.slot, dark: dark))
            let enc = t.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? t.name
            return NSAttributedString(string: "#\(t.name)", attributes: [
                .font: NSFont.systemFont(ofSize: max(10, parent.style.fontSize * 0.68), weight: .medium), .foregroundColor: c,
                .backgroundColor: c.withAlphaComponent(0.13), .link: URL(string: "berean-tag:\(enc)?v=\(verse ?? 0)")!, Self.skipKey: true,
                .toolTip: "Tag #\(t.name) — click for options",
            ])
        }

        // Links: verse number → verse actions; Strong's → lexicon; tag chip → tag menu.
        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let url = link as? URL ?? (link as? String).flatMap(URL.init(string:)) else { return false }
            switch url.scheme {
            case "berean-numbering":
                parent.onNumberingInfo()
            case "berean-chapter-study":
                parent.onChapterNotes()
            case "berean-verse":
                if let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) {
                    textView.window?.makeFirstResponder(textView)
                    textView.setSelectedRange(NSRange(location: charIndex, length: 0))
                    parent.onVerseClick(verse, NSApp.currentEvent?.modifierFlags.contains(.shift) ?? false)
                }
            case "berean-verse-notes":
                if let verse = Int(url.absoluteString.dropFirst("berean-verse-notes:".count)) { parent.onNotes(verse) }
            case "berean-verse-citations":
                if let verse = Int(url.absoluteString.dropFirst("berean-verse-citations:".count)) { parent.onCitations(verse) }
            case "strongs":
                parent.onStrongs(String(url.absoluteString.dropFirst("strongs:".count)), verse(at: charIndex))
            case "berean-idiom":
                parent.onIdiom(String(url.absoluteString.dropFirst("berean-idiom:".count)))
            case "berean-tag":
                let s = url.absoluteString.dropFirst("berean-tag:".count)
                let parts = s.split(separator: "?v=", maxSplits: 1).map(String.init)
                let name = parts.first?.removingPercentEncoding ?? ""
                let v = parts.count > 1 ? Int(parts[1]) : nil
                popUp(parent.tagMenu(name, v == 0 ? nil : v), at: charIndex, in: textView)
            default: return false
            }
            return true
        }

        func popUp(_ menu: NSMenu, at charIndex: Int, in tv: NSTextView) {
            guard let lm = tv.layoutManager, let tc = tv.textContainer else { return }
            let g = lm.glyphIndexForCharacter(at: charIndex)
            var rect = lm.boundingRect(forGlyphRange: NSRange(location: g, length: 1), in: tc)
            rect.origin.x += tv.textContainerOrigin.x; rect.origin.y += tv.textContainerOrigin.y
            menu.popUp(positioning: nil, at: NSPoint(x: rect.minX, y: rect.maxY + 2), in: tv)
        }

        func readingAnchor(at top: CGFloat, in view: ReaderTextView) -> (verse: Int, offsetFromTop: CGFloat)? {
            guard let clip = view.enclosingScrollView?.contentView, let layout = view.layoutManager,
                  let container = view.textContainer, layout.numberOfGlyphs > 0 else { return nil }
            let localTop = view.convert(NSPoint(x: 0, y: top), from: clip).y
            let readableTop = localTop + view.visibleTitleBarClearance
            guard readableTop > view.textContainerOrigin.y else { return nil }
            let point = CGPoint(x: container.lineFragmentPadding, y: readableTop - view.textContainerOrigin.y)
            let glyph = layout.glyphIndex(for: point, in: container)
            guard glyph < layout.numberOfGlyphs,
                  let verse = verse(at: layout.characterIndexForGlyph(at: glyph)),
                  let range = verseRanges[verse], let marker = view.firstRect(forVerseRange: range) else { return nil }
            return (verse, marker.minY - localTop)
        }

        /// Keep the same body word on screen when Strong's adds/removes lines.
        /// Prefer a visible focused verse; otherwise follow the viewport center.
        func bodyReflowAnchor(in view: ReaderTextView) -> ReaderBodyReflowAnchor? {
            guard let clip = view.enclosingScrollView?.contentView,
                  clip.bounds.minY > clip.documentRect.minY + 1,
                  let storage = view.textStorage, let layout = view.layoutManager,
                  let container = view.textContainer, layout.numberOfGlyphs > 0 else { return nil }
            let top = view.convert(clip.bounds.origin, from: clip).y
            let readableTop = top + view.visibleTitleBarClearance
            let bottom = top + clip.bounds.height - parent.actionClearance
            guard bottom > readableTop else { return nil }
            var index: Int?
            if let focus = parent.selectionFocus, parent.selectedVerses.contains(focus),
               let range = verseRanges[focus], let first = view.firstVerseLineTop(in: range),
               first >= readableTop, first < bottom {
                index = verseTextStarts[focus]
            }
            if index == nil {
                let point = CGPoint(x: container.size.width * 0.5,
                                    y: readableTop + (bottom - readableTop) * 0.45 - view.textContainerOrigin.y)
                let glyph = layout.glyphIndex(for: point, in: container)
                guard glyph < layout.numberOfGlyphs else { return nil }
                index = layout.characterIndexForGlyph(at: glyph)
            }
            guard let index, let verse = verse(at: index), let range = bodyRange(verse),
                  let offset = readerBodyOffset(in: storage, range: range, index: index),
                  let bodyIndex = readerBodyStorageIndex(in: storage, range: range, offset: offset),
                  let y = bodyLineTop(bodyIndex, in: view) else { return nil }
            return ReaderBodyReflowAnchor(verse: verse, bodyOffset: offset, offsetFromTop: y - top)
        }

        private func bodyRange(_ verse: Int) -> NSRange? {
            guard let start = verseTextStarts[verse], let range = verseRanges[verse], NSMaxRange(range) > start else { return nil }
            return NSRange(location: start, length: NSMaxRange(range) - start - 1)
        }

        private func bodyLineTop(_ index: Int, in view: ReaderTextView) -> CGFloat? {
            guard let layout = view.layoutManager, let container = view.textContainer else { return nil }
            layout.ensureLayout(for: container)
            let glyph = layout.glyphIndexForCharacter(at: index)
            guard glyph < layout.numberOfGlyphs else { return nil }
            return layout.lineFragmentUsedRect(forGlyphAt: glyph, effectiveRange: nil).minY + view.textContainerOrigin.y
        }

        func bodyReflowTop(_ anchor: ReaderBodyReflowAnchor, in view: ReaderTextView) -> CGFloat? {
            guard let storage = view.textStorage, let range = bodyRange(anchor.verse),
                  let index = readerBodyStorageIndex(in: storage, range: range, offset: anchor.bodyOffset),
                  let y = bodyLineTop(index, in: view), let clip = view.enclosingScrollView?.contentView else { return nil }
            return view.convert(NSPoint(x: 0, y: y), to: clip).y - anchor.offsetFromTop
        }

        func visibleSelectedRanges(in scroll: NSScrollView) -> [NSRange] {
            guard let parent, lastPassage == parent.passageId, let textView,
                  !parent.selectedVerses.isEmpty else { return [] }
            let clip = scroll.contentView
            let top = clip.bounds.minY + textView.visibleTitleBarClearance
            let bottom = clip.bounds.maxY - parent.actionClearance
            return selectionRevealRanges(parent.selectedVerses, previous: [], focus: parent.selectionFocus, in: verseRanges, orderedVerses: parent.verses.map(\.verse))
                .filter { range in
                    guard let lines = selectionLines(range, in: clip) else { return false }
                    return lines.lowerBound >= top && lines.upperBound <= bottom
                }
        }

        @discardableResult
        func revealSelectedRange(_ range: NSRange, in scroll: NSScrollView) -> Bool {
            guard let textView, let container = textView.textContainer else { return false }
            textView.layoutManager?.ensureLayout(for: container)
            let clip = scroll.contentView
            let top = clip.bounds.minY + textView.visibleTitleBarClearance
            let bottom = clip.bounds.maxY - (parent?.actionClearance ?? 0)
            guard top <= bottom, let lines = selectionLines(range, in: clip),
                  let offset = selectionRevealOffset(lines: lines, visible: top...bottom,
                                                     gap: ReaderFloatingControls.readingGap) else { return false }
            if offset != 0 {
                let destination = clip.bounds.offsetBy(dx: 0, dy: offset)
                clip.scroll(to: clip.constrainBoundsRect(destination).origin)
                scroll.reflectScrolledClipView(clip)
            }
            return true
        }

        private func selectionLines(_ range: NSRange, in clip: NSClipView) -> ClosedRange<CGFloat>? {
            guard let textView, let first = textView.firstVerseLineTop(in: range),
                  let last = textView.lastVerseLineBottom(in: range) else { return nil }
            let top = textView.convert(NSPoint(x: 0, y: first), to: clip).y
            let bottom = textView.convert(NSPoint(x: 0, y: last), to: clip).y
            return top <= bottom ? top...bottom : nil
        }

        @MainActor func readingPosition(in scroll: NSScrollView, preferred: Int? = nil) -> ScriptureReadingPosition? {
            guard let parent, lastPassage == parent.passageId, let view = textView else { return nil }
            let clip = scroll.contentView
            guard clip.bounds.width > 0, clip.bounds.height > 0, view.frame.width > 0 else { return nil }
            let offset = max(0, clip.bounds.minY - clip.documentRect.minY)
            let visiblePreferred = preferred.flatMap { verse -> Int? in
                guard let range = verseRanges[verse], let first = view.firstVerseLineTop(in: range) else { return nil }
                let y = view.convert(NSPoint(x: 0, y: first), to: clip).y
                return y >= clip.bounds.minY + view.visibleTitleBarClearance && y < clip.bounds.maxY - parent.actionClearance ? verse : nil
            }
            let verse = visiblePreferred ?? readingAnchor(at: clip.bounds.minY, in: view)?.verse
            let verseOffset = verse.flatMap { verseRanges[$0] }.flatMap { view.firstVerseLineTop(in: $0) }
                .map { view.convert(NSPoint(x: 0, y: $0), to: clip).y - clip.bounds.minY }
            return ScriptureReadingPosition(offset: offset, verse: verse, selectedVerses: parent.selectedVerses,
                                            returnEdition: editionArrival?.returnEdition(at: offset),
                                            viewportWidth: clip.bounds.width, verseOffsetFromTop: verseOffset)
        }

        func verse(at index: Int) -> Int? {
            guard let ts = textView?.textStorage, index >= 0, index < ts.length else { return nil }
            return ts.attribute(Self.verseKey, at: index, effectiveRange: nil) as? Int
        }

        /// The copied text of a range: verse words only (no gutter numbers, Strong's, dots or chips).
        func plainText(_ range: NSRange) -> String {
            guard let ts = textView?.textStorage else { return "" }
            var out = ""
            ts.enumerateAttribute(Self.skipKey, in: range) { skip, r, _ in if skip == nil { out += (ts.string as NSString).substring(with: r) } }
            return out.replacingOccurrences(of: "\t", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\n", with: " ")
        }

        /// Display offset within a verse's shown words for a storage index (skipped runs — Strong's, chips, dots — not counted).
        func displayOffset(verse: Int, at index: Int) -> Int? {
            guard let ts = textView?.textStorage, let start = verseTextStarts[verse], let r = verseRanges[verse] else { return nil }
            let end = min(max(index, start), NSMaxRange(r) - 1)
            var n = 0
            ts.enumerateAttribute(Self.skipKey, in: NSRange(location: start, length: end - start)) { skip, sub, _ in if skip == nil { n += sub.length } }
            return n
        }

        /// The selection split per verse into display ranges (empty pieces dropped).
        func selectedPieces() -> [(verse: Int, start: Int, end: Int)] {
            guard let r = textView?.selectedRange(), r.length > 0 else { return [] }
            return verses(in: r).compactMap { v in
                guard let vr = verseRanges[v], let ts = verseTextStarts[v] else { return nil }
                let lo = max(r.location, ts), hi = min(NSMaxRange(r), NSMaxRange(vr) - 1)
                guard hi > lo, let a = displayOffset(verse: v, at: lo), let b = displayOffset(verse: v, at: hi), b > a else { return nil }
                return (v, a, b)
            }
        }

        /// Verses touched by a selection, in order.
        func verses(in range: NSRange) -> [Int] {
            parent.verses.map(\.verse).filter { v in verseRanges[v].map { NSIntersectionRange($0, range).length > 0 } ?? false }
        }

        /// ⌘C: within one verse → the selected words; across verses → the existing app's formatted passage.
        func copyText(plain: Bool) -> String? {
            guard let tv = textView else { return nil }
            let r = tv.selectedRange()
            if r.length == 0 {
                return parent.selectedVerseCopyText(plain)
            }
            let touched = Set(verses(in: r))
            if touched.count <= 1 { return plainText(r) }
            return parent.rangeCopyText(touched, plain)
        }
    }
}

/// NSTextView with verse-aware context menu, copy and link hover underline.
final class ReaderTextView: NSTextView {
    weak var coordinator: ChapterTextView.Coordinator?
    private let outlineMotion = ReaderOutlineMotion()

    /// VoiceOver / assistive path to verse selection (clicking a verse is pointer-only). Acts on
    /// the verse at the text cursor exactly like a click (toggle) or Shift-click (range).
    override func accessibilityCustomActions() -> [NSAccessibilityCustomAction]? {
        [NSAccessibilityCustomAction(name: "Select or Deselect Verse") { [weak self] in self?.selectVerseAtCursor(extend: false) ?? false },
         NSAccessibilityCustomAction(name: "Select Through Verse") { [weak self] in self?.selectVerseAtCursor(extend: true) ?? false }]
    }

    private func selectVerseAtCursor(extend: Bool) -> Bool {
        guard let c = coordinator, let verse = c.verse(at: min(selectedRange().location, max(0, string.utf16.count - 1))) else { return false }
        c.parent.onVerseClick(verse, extend)
        return true
    }

    func updateOutlineMotion() {
        let parent = coordinator?.parent
        outlineMotion.update(active: window != nil && parent?.animateOutline == true && parent?.selectedVerses.isEmpty == false) { [weak self] in
            self?.needsDisplay = true
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateReadingInset(for: frame.width)
        updateOutlineMotion()
        if window == nil { dismissStudyPreview() }
    }

    private var hovered: NSRange?
    private var studyPreviewTask: Task<Void, Never>?
    private var studyPreview: NSPopover?

    func dismissStudyPreview() {
        studyPreviewTask?.cancel()
        studyPreviewTask = nil
        studyPreview?.close()
        studyPreview = nil
    }

    private var qaStudyPreviewEnabled: Bool {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        return Bundle.main.bundleIdentifier == "com.berean.native.mac.dev"
            && arguments.contains("--qa-library") && arguments.contains("--qa-study-preview")
        #else
        return false
        #endif
    }

    private func prepareStudyPreview(at index: Int?, range: NSRange?, allowInactive: Bool = false, delayed: Bool = true) {
        dismissStudyPreview()
        guard let index, let range, let storage = textStorage, index < storage.length,
              let url = storage.attribute(.link, at: index, effectiveRange: nil) as? URL,
              ["berean-verse-notes", "berean-verse-citations"].contains(url.scheme ?? ""),
              let number = Int(url.absoluteString.dropFirst((url.scheme?.count ?? 0) + 1)),
              let parent = coordinator?.parent,
              let verse = parent.verses.first(where: { $0.verse == number }) else { return }
        let load = parent.onStudyPreview
        studyPreviewTask = Task { @MainActor [weak self] in
            if delayed {
                do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
            }
            guard let self, !Task.isCancelled, self.hovered == range else { return }
            let items = await load(number)
            guard !Task.isCancelled, self.hovered == range, let window = self.window,
                  allowInactive || window.isKeyWindow, let host = window.contentView else { return }
            // NSTextInputClient gives the actual rendered first-line rectangle in
            // screen space, including scrolling/insets. Converting through the
            // window avoids manually mixing flipped TextKit/container coordinates.
            let screenAnchor = self.firstRect(forCharacterRange: range, actualRange: nil)
            guard !screenAnchor.isEmpty else { return }
            let windowAnchor = window.convertFromScreen(screenAnchor)
            let textAnchor = self.convert(windowAnchor, from: nil)
            guard self.visibleRect.intersects(textAnchor) else { return }
            let anchor = host.convert(windowAnchor, from: nil)
            let popover = NSPopover()
            popover.behavior = .transient
            popover.animates = false
            // Resolve content before showing, so the card does not change height
            // and shift its arrow after the user has already started reading it.
            popover.contentViewController = NSHostingController(rootView: ReaderStudyHoverCard(verse: verse, items: items))
            self.studyPreview = popover
            popover.show(relativeTo: anchor, of: host, preferredEdge: .maxX)
            #if DEBUG
            if self.qaStudyPreviewEnabled {
                DispatchQueue.main.async { [weak self, weak popover] in
                    guard let self, let popover, self.studyPreview === popover,
                          let frame = popover.contentViewController?.view.window?.frame else { return }
                    func rect(_ r: NSRect) -> [CGFloat] { [r.minX, r.minY, r.width, r.height] }
                    let roundTrip = window.convertToScreen(host.convert(anchor, to: nil))
                    let payload: [String: Any] = ["verse": number, "screenAnchor": rect(screenAnchor),
                        "roundTripAnchor": rect(roundTrip), "popoverFrame": rect(frame), "windowIsKey": window.isKeyWindow]
                    if let data = try? JSONSerialization.data(withJSONObject: payload, options: .sortedKeys) {
                        try? data.write(to: UserLibrary.directory.appendingPathComponent("study-preview-geometry.json"), options: .atomic)
                    }
                }
            }
            #endif
        }
    }
    private var tracking: NSTrackingArea?

    var readerWidth = ScriptureWidth.normal {
        didSet { if readerWidth != oldValue { updateReadingInset(for: frame.width) } }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateReadingInset(for: newSize.width)
    }

    private func updateReadingInset(for width: CGFloat) {
        let inset = max(20, (width - readerWidth.macMaximum) / 2)
        let next = NSSize(width: inset, height: 18 + visibleTitleBarClearance)
        if textContainerInset != next { textContainerInset = next }
    }

    fileprivate var titleBarClearance: CGFloat = 0 {
        didSet { if oldValue != titleBarClearance { updateReadingInset(for: frame.width) } }
    }

    fileprivate var visibleTitleBarClearance: CGFloat {
        guard window?.styleMask.contains(.fullScreen) != true else {
            return titleBarClearance
        }
        // Hidden toolbar backgrounds can make SwiftUI report no top safe-area inset.
        return max(52, titleBarClearance)
    }

    override var acceptsFirstResponder: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        defer { super.draw(dirtyRect) }
        guard let c = coordinator, !c.parent.selectedVerses.isEmpty,
              let layout = layoutManager, let container = textContainer else { return }
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSColor.controlAccentColor.withAlphaComponent(ReaderFloatingControls.outlineOpacity).setStroke()
        NSColor.controlAccentColor.withAlphaComponent(ReaderFloatingControls.fillOpacity).setFill()
        let origin = textContainerOrigin
        for range in selectedVerseRanges(c.parent.selectedVerses, in: c.verseRanges, orderedVerses: c.parent.verses.map(\.verse)) {
            let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0 else { continue }
            let first = layout.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            let last = layout.lineFragmentUsedRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil)
            let padding = ReaderFloatingControls.outlinePadding
            let rect = NSRect(x: origin.x, y: first.minY + origin.y,
                              width: container.containerSize.width,
                              height: last.maxY - first.minY).insetBy(dx: 0, dy: -padding)
            guard dirtyRect.intersects(rect) else { continue }
            let radius = ReaderFloatingControls.outlineRadius
            let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
            path.lineWidth = 1
            path.setLineDash([4, 3], count: 2, phase: outlineMotion.phase)
            path.fill()
            path.stroke()
        }
    }

    override func mouseDown(with event: NSEvent) {
        (enclosingScrollView as? ChapterPullScrollView)?.cancelViewportAction()
        window?.makeFirstResponder(self)
        #if DEBUG
        // CUA has no hover operation. This opt-in QA-only entry exercises the
        // same preview and anchor through a real Option-click, without claiming
        // that it verifies continuous physical hovering.
        if qaStudyPreviewEnabled, event.modifierFlags.contains(.option),
           let index = charIndex(at: event), let storage = textStorage {
            var range = NSRange()
            if let url = storage.attribute(.link, at: index, effectiveRange: &range) as? URL,
               ["berean-verse-notes", "berean-verse-citations"].contains(url.scheme ?? "") {
                hovered = range
                prepareStudyPreview(at: index, range: range, allowInactive: true, delayed: false)
                return
            }
        }
        #endif
        // A single click on a link (verse number, Strong's number, tag chip) acts like a button; anything else is text
        // selection. (The built-in link handling did not fire for these custom-scheme links inside SwiftUI.)
        dismissStudyPreview()
        if event.clickCount == 1, let c = coordinator, let ts = textStorage {
            if let i = charIndex(at: event, includeVerseGutter: true),
               let url = ts.attribute(.link, at: i, effectiveRange: nil) as? URL,
               url.scheme == "berean-verse",
               let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) {
                setSelectedRange(NSRange(location: i, length: 0))
                c.parent.onVerseClick(verse, event.modifierFlags.contains(.shift))
                return
            }
            if let i = charIndex(at: event),
               let link = ts.attribute(.link, at: i, effectiveRange: nil),
               c.textView(self, clickedOnLink: link, at: i) {
                return
            }
        }
        super.mouseDown(with: event)
    }

    override func resetCursorRects() {
        // NSTextView registers its I-beam for the entire document rectangle,
        // including text under floating controls. The hit-tested tracking area
        // below supplies the reader cursor, so AppKit and SwiftUI have one owner.
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeInKeyWindow, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    func charIndex(at event: NSEvent, includeVerseGutter: Bool = false) -> Int? {
        let p = convert(event.locationInWindow, from: nil)
        guard let lm = layoutManager, let tc = textContainer else { return nil }
        guard lm.numberOfGlyphs > 0 else { return nil }
        let pt = NSPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
        var fraction: CGFloat = 0
        let g = lm.glyphIndex(for: pt, in: tc, fractionOfDistanceThroughGlyph: &fraction)
        guard g < lm.numberOfGlyphs else { return nil }
        let rect = lm.boundingRect(forGlyphRange: NSRange(location: g, length: 1), in: tc)
        let index = lm.characterIndexForGlyph(at: g)
        if rect.insetBy(dx: -2, dy: -2).contains(pt) { return index }
        if includeVerseGutter, let storage = textStorage, let c = coordinator,
           c.parent.style.showVerseNumbers, index < storage.length, let verse = c.verse(at: index),
           let start = c.verseTextStarts[verse], start > 0, start < storage.length {
            let firstWord = lm.glyphIndexForCharacter(at: start)
            let line = lm.lineFragmentRect(forGlyphAt: firstWord, effectiveRange: nil)
            let word = lm.boundingRect(forGlyphRange: NSRange(location: firstWord, length: 1), in: tc)
            if pt.x >= 0, pt.x < word.minX, pt.y >= line.minY, pt.y < line.maxY {
                return start - 1
            }
        }
        return nil
    }

    private func updateReaderCursor(at event: NSEvent, glyphIndex: Int?) {
        let index = glyphIndex ?? charIndex(at: event, includeVerseGutter: true)
        let linked = index.flatMap { index in
            guard let storage = textStorage, index < storage.length else { return nil as Any? }
            return storage.attribute(.link, at: index, effectiveRange: nil)
        } != nil
        let cursor: NSCursor = linked ? .pointingHand : .iBeam
        if NSCursor.current != cursor { cursor.set() }
    }

    // Tracking areas also receive events beneath floating SwiftUI controls.
    // Only set the text cursor when the reader actually owns the hit.
    private func ownsPointer(at event: NSEvent) -> Bool {
        // Native split dividers have a wider resize hit region than their drawn
        // line. The text view's tracking area can overlap that region; yield to
        // AppKit rather than resetting its resize cursor to the I-beam.
        guard !isOverNativeDivider(event.locationInWindow) else { return false }
        guard let window, event.locationInWindow.y <= window.contentLayoutRect.maxY,
              let content = window.contentView else { return false }
        let root = content.superview ?? content
        let point = root.superview?.convert(event.locationInWindow, from: nil) ?? event.locationInWindow
        guard let hit = root.hitTest(point) else { return false }
        return hit === self || hit.isDescendant(of: self)
    }

    private func isOverNativeDivider(_ windowPoint: NSPoint) -> Bool {
        var ancestor = superview
        while let view = ancestor {
            if let split = view as? NSSplitView {
                let point = split.convert(windowPoint, from: nil)
                if NativeSplitDividerGeometry.rects(in: split, outset: 6).contains(where: { $0.contains(point) }) { return true }
            }
            ancestor = view.superview
        }
        return false
    }

    override func cursorUpdate(with event: NSEvent) {
        guard ownsPointer(at: event) else { return }
        updateReaderCursor(at: event, glyphIndex: nil)
    }

    override func mouseEntered(with event: NSEvent) {
        guard ownsPointer(at: event) else { return }
        updateReaderCursor(at: event, glyphIndex: nil)
    }

    override func mouseMoved(with event: NSEvent) {
        guard ownsPointer(at: event) else {
            clearLinkHover()
            return
        }
        let index = charIndex(at: event)
        updateReaderCursor(at: event, glyphIndex: index)
        guard let lm = layoutManager, let ts = textStorage else { return }
        var newRange: NSRange?
        if let index, index < ts.length {
            let string = ts.string as NSString
            var link = NSRange()
            if string.character(at: index) != 9, ts.attribute(.link, at: index, effectiveRange: &link) != nil {
                // The tabs on either side of a verse number enlarge the click target only.
                while link.length > 0 && string.character(at: link.location) == 9 {
                    link.location += 1
                    link.length -= 1
                }
                while link.length > 0 && string.character(at: NSMaxRange(link) - 1) == 9 {
                    link.length -= 1
                }
                newRange = link
            }
        }
        if newRange != hovered {
            prepareStudyPreview(at: index, range: newRange)
            if let h = hovered, NSMaxRange(h) <= ts.length { lm.removeTemporaryAttribute(.backgroundColor, forCharacterRange: h) }
            if let n = newRange { lm.addTemporaryAttribute(.backgroundColor, value: NSColor.controlAccentColor.withAlphaComponent(0.14), forCharacterRange: n) }
            hovered = newRange
        }
    }

    override func mouseExited(with event: NSEvent) {
        clearLinkHover()
    }

    private func clearLinkHover() {
        dismissStudyPreview()
        if let h = hovered, let ts = textStorage, NSMaxRange(h) <= ts.length { layoutManager?.removeTemporaryAttribute(.backgroundColor, forCharacterRange: h) }
        hovered = nil
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let c = coordinator, let i = charIndex(at: event) else { return super.menu(for: event) }
        if let storage = textStorage, i < storage.length,
           let url = storage.attribute(.link, at: i, effectiveRange: nil) as? URL, url.scheme == "strongs" {
            let id = String(url.absoluteString.dropFirst("strongs:".count))
            let menu = NSMenu()
            let title = NSMenuItem(title: id, action: nil, keyEquivalent: "")
            title.isEnabled = false
            menu.addItem(title)
            menu.addItem(.separator())
            menu.addItem(ClosureMenuItem("Open", image: "character.book.closed") { c.parent.onStrongs(id, c.verse(at: i)) })
            menu.addItem(ClosureMenuItem("Open in New Tab", image: "plus.square.on.square") { c.parent.onOpenStrongsTab(id, c.verse(at: i)) })
            menu.addItem(.separator())
            menu.addItem(ClosureMenuItem("Copy Strong’s Number", image: "doc.on.doc") { Clipboard.copy(id) })
            menu.addItem(ClosureMenuItem("Copy Reference", image: "number") { Clipboard.copy("Strong's \(id)") })
            return menu
        }
        guard let v = c.verse(at: i) else { return super.menu(for: event) }
        let menu = c.parent.verseMenu(v)
        // Look up the clicked (or the single selected) word in the Lexicon — the original's untagged-word click.
        let wordRange = selectedRange().length > 0 ? selectedRange() : selectionRange(forProposedRange: NSRange(location: i, length: 0), granularity: .selectByWord)
        let word = (string as NSString).substring(with: wordRange).trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
        if !word.isEmpty, word.count <= 40, !word.contains(where: { $0.isWhitespace || $0.isNumber }) {
            let look = ClosureMenuItem("Look Up “\(word)” in Lexicon") { c.parent.onLexiconSearch(word.lowercased()) }
            look.image = NSImage(systemSymbolName: "character.book.closed", accessibilityDescription: nil)
            menu.insertItem(look, at: 0)
            menu.insertItem(.separator(), at: 1)
        }
        if selectedRange().length > 0 {
            let pieces = c.selectedPieces()
            if !pieces.isEmpty {
                let hl = NSMenuItem(title: "Highlight Selection", action: nil, keyEquivalent: "")
                hl.image = NSImage(systemSymbolName: "highlighter", accessibilityDescription: nil)
                let sub = NSMenu()
                for color in ["yellow", "red", "green", "blue", "purple"] {
                    sub.addItem(ClosureMenuItem(color.capitalized) { for p in pieces { c.parent.onHighlightRange(p.verse, p.start, p.end, color) } })
                }
                hl.submenu = sub
                menu.insertItem(hl, at: 0)
            }
            let words = (string as NSString).substring(with: selectedRange())
                .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            if !words.isEmpty, words.count <= 120 {
                let shown = words.count > 32 ? String(words.prefix(31)) + "…" : words
                let search = ClosureMenuItem("Search for “\(shown)”") { c.parent.onSearchSelection(words) }
                search.image = NSImage(systemSymbolName: "magnifyingglass", accessibilityDescription: nil)
                menu.insertItem(search, at: 0)
                if words.count <= 40 {
                    let idiom = ClosureMenuItem("New Idiom “\(shown)”…") { c.parent.onNewIdiom(words) }
                    idiom.image = NSImage(systemSymbolName: "character.book.closed", accessibilityDescription: nil)
                    menu.insertItem(idiom, at: 1)
                }
                if !c.parent.bookName.isEmpty {
                    let inBook = ClosureMenuItem("Search for “\(shown)” in \(c.parent.bookName)") { c.parent.onBookSearch(words) }
                    inBook.image = NSImage(systemSymbolName: "text.magnifyingglass", accessibilityDescription: nil)
                    menu.insertItem(inBook, at: 1)
                }
            }
            menu.insertItem(.separator(), at: 0)
            menu.insertItem(ClosureMenuItem("Copy as Plain Text", key: "C", modifiers: [.command, .shift]) { [weak self] in self?.copyPlain(nil) }, at: 0)
            menu.insertItem(ClosureMenuItem("Copy", key: "c") { [weak self] in self?.copy(nil) }, at: 0)
        }
        return menu
    }

    override func copy(_ sender: Any?) {
        guard let s = coordinator?.copyText(plain: false) else { return }
        NSPasteboard.general.clearContents()
        if NSPasteboard.general.setString(s, forType: .string), selectedRange().length == 0 {
            coordinator?.parent.onCopySelectedVerses()
        }
    }

    @objc func copyPlain(_ sender: Any?) {
        guard let s = coordinator?.copyText(plain: true) else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string)
    }

    /// ⌘C / ⌘⇧C are handled here: SwiftUI's Edit ▸ Copy does not reach an AppKit text view hosted in SwiftUI
    /// (verified 2026-11-08: the key equivalent arrives here, `copy:` never does).
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if window?.firstResponder === self, selectedRange().length > 0 || !(coordinator?.parent.selectedVerses.isEmpty ?? true), event.charactersIgnoringModifiers?.lowercased() == "c" {
            if mods == [.command] { copy(nil); return true }
            if mods == [.command, .shift] { copyPlain(nil); return true }
        }
        return false   // everything else goes to the menus (⌘⇧D, ⌘K…); NSTextView's own handling swallowed some app shortcuts
    }
}

extension NSTextView {
    func firstRect(forVerseRange r: NSRange) -> NSRect? {
        guard let lm = layoutManager, let tc = textContainer else { return nil }
        let g = lm.glyphRange(forCharacterRange: NSRange(location: r.location, length: min(1, r.length)), actualCharacterRange: nil)
        var rect = lm.boundingRect(forGlyphRange: g, in: tc)
        rect.origin.y += textContainerOrigin.y
        return rect
    }

    fileprivate func firstVerseLineTop(in range: NSRange) -> CGFloat? {
        guard range.length > 0, let layoutManager else { return nil }
        let first = NSRange(location: range.location, length: 1)
        let glyphs = layoutManager.glyphRange(forCharacterRange: first, actualCharacterRange: nil)
        guard glyphs.length > 0 else { return nil }
        return layoutManager.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil).minY
            + textContainerOrigin.y
    }

    fileprivate func lastVerseLineBottom(in range: NSRange) -> CGFloat? {
        guard range.length > 1, let layoutManager else { return nil }
        // Match the outline: the final newline belongs to the paragraph, but adds no visible verse text.
        let text = NSRange(location: range.location, length: range.length - 1)
        let glyphs = layoutManager.glyphRange(forCharacterRange: text, actualCharacterRange: nil)
        guard glyphs.length > 0 else { return nil }
        return layoutManager.lineFragmentUsedRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil).maxY
            + textContainerOrigin.y
    }
}

/// NSMenuItem that runs a closure (for menus built from Swift).
final class ClosureMenuItem: NSMenuItem {
    private let handler: () -> Void
    init(_ title: String, key: String = "", modifiers: NSEvent.ModifierFlags = [.command], image: String? = nil, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: key)
        keyEquivalentModifierMask = modifiers
        target = self
        if let image { self.image = NSImage(systemSymbolName: image, accessibilityDescription: nil) }
    }
    required init(coder: NSCoder) { fatalError() }
    @objc private func run() { handler() }
}

private struct ReaderStudyHoverCard: View {
    let verse: ReaderVerse
    let items: [ReaderStudyPreview]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Verse \(verse.readerVerseLabel)", systemImage: verse.studySymbol).font(.headline)
            Text(verse.studySummary).font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !items.isEmpty {
                Divider()
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.reference).font(.subheadline.weight(.semibold))
                        Text(item.text).font(.callout).lineLimit(5)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(item.noteTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let preview = verse.citationPreview, !preview.isEmpty {
                Text(preview).font(.callout).lineSpacing(5)
            }
            Text("Click the marker to open study details").font(.caption).foregroundStyle(.secondary)
        }
        .frame(width: 330, alignment: .leading)
        .padding(16)
    }
}
