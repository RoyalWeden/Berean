import SwiftUI
import UIKit

/// Observe touchdown without competing with scrolling, links, selection or pinch.
/// A fast pan may be recognized only after much of its travel has occurred.
private final class ChapterTouchStartObserver: UIGestureRecognizer {
    var onStart: ((CGPoint, TimeInterval) -> Void)?
    var onMove: ((CGPoint) -> Void)?
    var onFinish: ((CGPoint, TimeInterval) -> Void)?
    var onCancel: (() -> Void)?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        let active = event.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled } ?? Array(touches)
        guard active.count == 1, let touch = touches.first else { onCancel?(); finish(); return }
        onStart?(touch.location(in: view?.window), touch.timestamp)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if let touch = touches.first { onMove?(touch.location(in: view?.window)) }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if let touch = touches.first { onFinish?(touch.location(in: view?.window), touch.timestamp) }
        finish()
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { onCancel?(); finish() }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

    private func finish() {
        // Stay possible while observing, then fail. This observer never wins
        // recognition or requires the native scroll/selection gestures to fail.
        state = .failed
    }
}

/// A chapter is one selectable document. Inline controls participate in UIKit link hit testing
/// but are excluded from copied text and from persisted highlight offsets.
struct IOSChapterTextView: UIViewRepresentable {
    struct Piece {
        let verse: Int
        let start: Int
        let end: Int
    }

    var passageId: String
    var header: String?
    var headerDetail: String?
    var chapterTags: [(name: String, color: String?, slot: Int?)]
    var chapterStudy: ReaderChapterStudy?
    var verses: [ReaderVerse]
    var style: ReaderStyle
    var baseFontSize: Double
    var selectedVerses: Set<Int>
    var selectionFocus: Int?
    var scrollTarget: Int?
    var actionClearance: CGFloat = 0
    var animateOutline = true
    var scrollRevision: UUID?
    let positionReader: ScripturePositionReader
    var restorePosition: () -> ScriptureReadingPosition? = { nil }
    var historyRestore: ScriptureHistoryRestore?
    var isHistoryRestoreCurrent: (UUID?) -> Bool = { _ in true }
    var finishHistoryRestore: (ScriptureHistoryRestore, ScriptureReadingPosition?) -> Void = { _, _ in }
    var savePosition: (ScriptureReadingPosition) -> Void = { _ in }
    var findRequest: Int
    var reference: (Int, Int) -> String
    var onStrongs: (String, Int?) -> Void
    var onOpenStrongsTab: (String, Int?) -> Void
    var onNotes: (Int) -> Void
    var onChapterNotes: () -> Void = {}
    var onNumberingInfo: () -> Void = {}
    var onCitations: (Int) -> Void
    var onVerseTap: (Int) -> Void
    var onTextSelection: () -> Void = {}
    var onVerseActions: (Int) -> Void
    var onTagClick: (String, Int?) -> Void
    var onHighlight: (Piece, String) -> Void
    var onStep: (Int) -> Void
    var canPullChapter: (Int) -> Bool = { _ in false }
    var onChapterPull: (ChapterPullCue?) -> Void = { _ in }
    var onChapterPullCommit: (Int) -> Void = { _ in }
    var onPinchPreview: (Double?) -> Void
    var onPinchCommit: (Double) -> Void
    /// Scrolling down hides the reader chrome (passage capsule, dock); scrolling up or reaching the top shows it.
    var onChromeHidden: (Bool) -> Void = { _ in }
    /// "Search for …" / "Look Up in Lexicon" from a text selection (Mac reader parity).
    var onSearchText: (String) -> Void = { _ in }
    var onLexiconSearch: (String) -> Void = { _ in }
    var onBookSearch: (String) -> Void = { _ in }
    var bookName: String = ""
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ReaderTextView {
        let storage = NSTextStorage()
        let layout = OutlineLayoutManager()
        let container = NSTextContainer(size: .zero)
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let view = ReaderTextView(frame: .zero, textContainer: container)
        layout.reader = context.coordinator
        layout.view = view
        view.reader = context.coordinator
        positionReader.capture = { [weak coordinator = context.coordinator, weak view] preferred in
            guard let coordinator, let view else { return nil }
            return coordinator.readingPosition(in: view, preferred: preferred)
        }
        view.isEditable = false
        view.isSelectable = true
        view.isFindInteractionEnabled = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 16, left: style.width.phoneInset, bottom: 10, right: style.width.phoneInset)
        view.linkTextAttributes = [.underlineStyle: NSUnderlineStyle([]).rawValue]
        view.alwaysBounceVertical = true
        // Keep Scripture clear between floating controls; only the glass
        // controls themselves should blur the words directly behind them.
        if #available(iOS 26.0, *) { view.topEdgeEffect.isHidden = true }
        view.accessibilityLabel = "Scripture text"
        view.delegate = context.coordinator
        let touchStart = ChapterTouchStartObserver()
        touchStart.cancelsTouchesInView = false
        touchStart.delaysTouchesBegan = false
        touchStart.delaysTouchesEnded = false
        touchStart.onStart = { [weak coordinator = context.coordinator, weak view] point, timestamp in
            guard let view else { return }
            coordinator?.beginBodyTap(in: view, at: point, timestamp: timestamp)
            coordinator?.beginChapterPull(view, at: point)
        }
        touchStart.onMove = { [weak coordinator = context.coordinator, weak view] point in
            guard let view else { return }
            coordinator?.moveBodyTap(to: point)
            coordinator?.trackChapterPull(view, at: point)
        }
        touchStart.onFinish = { [weak coordinator = context.coordinator, weak view] point, timestamp in
            guard let view else { return }
            coordinator?.finishBodyTap(in: view, at: point, timestamp: timestamp)
            coordinator?.finishChapterPull(view, at: point)
        }
        touchStart.onCancel = { [weak coordinator = context.coordinator] in
            coordinator?.cancelBodyTap()
            coordinator?.cancelChapterPull()
        }
        view.addGestureRecognizer(touchStart)

        let verseTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapVerse(_:)))
        verseTap.delegate = context.coordinator
        view.addGestureRecognizer(verseTap)

        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.resizeText(_:)))
        pinch.delegate = context.coordinator
        view.addGestureRecognizer(pinch)

        for direction in [UISwipeGestureRecognizer.Direction.left, .right] {
            let swipe = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swipe(_:)))
            swipe.direction = direction
            swipe.numberOfTouchesRequired = 1
            swipe.delegate = context.coordinator
            view.addGestureRecognizer(swipe)
        }
        return view
    }

    private static let chapterEndTolerance: CGFloat = 8

    static func dismantleUIView(_ view: ReaderTextView, coordinator: Coordinator) {
        guard let position = coordinator.readingPosition(in: view) else { return }
        coordinator.parent.savePosition(position)
    }

    func updateUIView(_ view: ReaderTextView, context: Context) {
        let coordinator = context.coordinator
        let shouldFind = coordinator.parent.findRequest != findRequest
        let previous = coordinator.parent
        if previous.passageId != passageId, let position = coordinator.readingPosition(in: view) {
            // A warm replacement keeps the same UITextView, so dismantle won't
            // capture its outgoing viewport. Don't mutate model state mid-update.
            DispatchQueue.main.async { previous.savePosition(position) }
        }
        coordinator.parent = self
        if shouldFind {
            DispatchQueue.main.async { [weak view] in
                view?.findInteraction?.presentFindNavigator(showingReplace: false)
            }
        }
        let key = Key(header: header, tags: chapterTags.map { TagKey(name: $0.name, color: $0.color, slot: $0.slot) }, chapterStudy: chapterStudy,
                      verses: verses, style: style, dark: colorScheme == .dark)
        view.updateOutlineMotion()
        let samePassage = coordinator.passageId == passageId
        let previousSelection = coordinator.renderedSelection
        let revealSelection = samePassage && !selectedVerses.subtracting(previousSelection).isEmpty
        if view.contentInset.bottom != actionClearance {
            let previousOffset = view.contentOffset
            let previousInset = view.adjustedContentInset
            let previousBottom = view.contentSize.height + previousInset.bottom - view.bounds.height
            let wasAtChapterEnd = samePassage
                && previousBottom > -previousInset.top + 1
                && previousOffset.y >= previousBottom - Self.chapterEndTolerance
            // At the end, keep the last line above the dock as it reappears.
            // Elsewhere, retain the reading offset and clamp if clearance shrinks.
            view.contentInset.bottom = actionClearance
            view.verticalScrollIndicatorInsets.bottom = actionClearance
            let inset = view.adjustedContentInset
            let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
            let y = wasAtChapterEnd ? bottom : min(max(previousOffset.y, -inset.top), bottom)
            view.setContentOffset(CGPoint(x: previousOffset.x, y: y), animated: false)
        }
        if key != coordinator.key || !samePassage {
            let previousOffset = view.contentOffset
            let selection = view.selectedRange
            let oldText = view.text
            let inset = view.adjustedContentInset
            let previousBottom = view.contentSize.height + inset.bottom - view.bounds.height
            let wasAtEnd = samePassage && previousBottom > -inset.top + 1 && previousOffset.y >= previousBottom - 1
            let readingAnchor = samePassage && !wasAtEnd ? coordinator.readingAnchor(in: view) : nil
            let strongsChanged = samePassage && coordinator.key?.style.showStrongs != style.showStrongs
            let bodyAnchor = strongsChanged ? coordinator.bodyReflowAnchor(in: view) : nil
            if view.textContainerInset.left != style.width.phoneInset {
                view.textContainerInset.left = style.width.phoneInset
                view.textContainerInset.right = style.width.phoneInset
            }
            view.attributedText = coordinator.render(key.dark)
            view.setNeedsLayout()

            if samePassage {
                if view.text.utf16.elementsEqual(oldText?.utf16 ?? "".utf16),
                   NSMaxRange(selection) <= view.textStorage.length {
                    view.selectedRange = selection
                } else {
                    view.selectedRange = NSRange(location: 0, length: 0)
                }
                if let bodyAnchor {
                    coordinator.restoreBodyReflowAnchor(bodyAnchor, in: view, fallback: previousOffset)
                } else if wasAtEnd {
                    coordinator.layoutThroughEnd(of: NSRange(location: 0, length: view.textStorage.length), in: view)
                    view.layoutIfNeeded()
                    let inset = view.adjustedContentInset
                    let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
                    view.setContentOffset(CGPoint(x: previousOffset.x, y: bottom), animated: false)
                } else if let readingAnchor {
                    coordinator.restoreReadingAnchor(readingAnchor, in: view, fallback: previousOffset)
                } else {
                    view.setContentOffset(previousOffset, animated: false)
                }
            } else {
                coordinator.editionArrival = nil
                view.selectedRange = NSRange(location: 0, length: 0)
                view.setContentOffset(CGPoint(x: 0, y: -view.adjustedContentInset.top), animated: false)
                coordinator.lastTarget = nil
                coordinator.resetScrollChrome()
            }
            coordinator.key = key
            coordinator.passageId = passageId
        }
        if previousSelection != selectedVerses {
            coordinator.updateMarkerColors(in: view.textStorage, changed: previousSelection.symmetricDifference(selectedVerses))
            coordinator.renderedSelection = selectedVerses
            view.rememberViewportPosition()
        }
        if previousSelection != selectedVerses || !samePassage {
            view.layoutManager.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: view.textStorage.length))
        }
        if revealSelection, scrollTarget == nil, historyRestore == nil {
            let currentPassage = passageId
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == currentPassage,
                      coordinator.parent.passageId == currentPassage, coordinator.parent.scrollTarget == nil,
                      coordinator.parent.selectedVerses == selectedVerses,
                      coordinator.parent.isHistoryRestoreCurrent(nil) else { return }
                let ranges = selectionRevealRanges(selectedVerses, previous: previousSelection, focus: selectionFocus, in: coordinator.verseRanges, orderedVerses: coordinator.parent.verses.map(\.verse))
                for range in ranges {
                    coordinator.layoutThroughEnd(of: range, in: view)
                    guard let lines = coordinator.renderedLineBounds(of: range, in: view) else { continue }
                    let inset = view.adjustedContentInset
                    let top = view.bounds.minY + inset.top
                    let bottom = view.bounds.maxY - inset.bottom
                    guard top <= bottom,
                          let offset = selectionRevealOffset(lines: lines, visible: top...bottom,
                                                             gap: ReaderFloatingControls.readingGap) else { continue }
                    if offset != 0 {
                        let end = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
                        let y = min(max(view.contentOffset.y + offset, -inset.top), end)
                        if y != view.contentOffset.y {
                            view.setContentOffset(CGPoint(x: view.contentOffset.x, y: y), animated: false)
                            coordinator.checkpointPosition(in: view)
                        }
                    }
                    break
                }
            }
        }
        if (!samePassage || historyRestore != nil), scrollTarget == nil {
            let restore = historyRestore
            let revision = restore?.revision
            view.afterViewportLayout { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == passageId, coordinator.parent.passageId == passageId,
                      coordinator.parent.scrollTarget == nil, coordinator.parent.historyRestore?.revision == revision,
                      coordinator.parent.isHistoryRestoreCurrent(revision),
                      let position = restore?.position ?? coordinator.parent.restorePosition() else { return }
                if restore != nil { view.discardResizeAnchor() }
                coordinator.restoreReadingPosition(position, in: view)
                if let restore { coordinator.parent.finishHistoryRestore(restore, coordinator.readingPosition(in: view)) }
            }
        }
        if scrollTarget == nil { coordinator.lastTarget = nil }
        if let target = scrollTarget, let range = coordinator.verseRanges[target] {
            let request = ScriptureScrollTarget(verse: target, lastSelectedVerse: selectedVerses.max(), revision: scrollRevision)
            guard request != coordinator.lastTarget else { return }
            coordinator.lastTarget = request
            let currentPassage = passageId
            view.afterViewportLayout { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == currentPassage,
                      coordinator.parent.scrollTarget == target, coordinator.lastTarget == request,
                      coordinator.parent.isHistoryRestoreCurrent(nil),
                      coordinator.parent.selectedVerses.max() == request.lastSelectedVerse,
                      NSMaxRange(range) <= view.textStorage.length else { return }
                let lastRange = request.lastSelectedVerse.flatMap { verse in
                    verse >= target ? coordinator.verseRanges[verse] : nil
                }
                // A fresh TextKit viewport may still report a partial content height. Lay out the
                // chapter before clamping a requested destination against the scrollable end.
                coordinator.layoutChapter(in: view)
                guard let targetLines = coordinator.renderedLineBounds(of: range, in: view) else {
                    coordinator.lastTarget = nil
                    return
                }
                let inset = view.adjustedContentInset
                let top = targetLines.lowerBound
                var y = top - inset.top - 12
                if let lastRange, lastRange.length > 1 {
                    let lastLine = coordinator.lastLineBottom(of: lastRange, in: view) + ReaderFloatingControls.readingGap
                    let readingHeight = view.bounds.height - inset.top - inset.bottom
                    if lastLine - top <= readingHeight {
                        y = max(y, lastLine - view.bounds.height + inset.bottom)
                    }
                }
                let bottom = view.contentSize.height + inset.bottom - view.bounds.height
                view.setContentOffset(CGPoint(x: 0, y: max(-inset.top, min(y, bottom))), animated: false)
                // Programmatic verse jumps have no drag-end event to checkpoint their destination.
                coordinator.checkpointPosition(in: view)
            }
        }
    }

    struct TagKey: Equatable {
        let name: String
        let color: String?
        let slot: Int?
    }

    struct Key: Equatable {
        let header: String?
        let tags: [TagKey]
        let chapterStudy: ReaderChapterStudy?
        let verses: [ReaderVerse]
        let style: ReaderStyle
        let dark: Bool
    }

    final class ReaderTextView: UITextView {
        weak var reader: Coordinator?

        // MARK: VoiceOver — one element per verse (the chapter used to read as one text blob with
        // no way to select a verse). Double-tap = tap (select/deselect); "Verse Actions" action.
        private var verseElements: [VerseAccessibilityElement] = []
        private var verseElementsKey = ""

        override var isAccessibilityElement: Bool { get { false } set { } }
        override var accessibilityElements: [Any]? {
            get {
                guard let reader else { return nil }
                let key = "\(reader.parent.passageId)|\(textStorage.length)|\(reader.verseRanges.count)"
                if key != verseElementsKey {
                    let text = textStorage.string as NSString
                    verseElements = reader.verseRanges.keys.sorted().compactMap { verse in
                        guard let range = reader.verseRanges[verse], NSMaxRange(range) <= text.length else { return nil }
                        var body = text.substring(with: range).trimmingCharacters(in: .whitespacesAndNewlines)
                        let number = String(verse)
                        if body.hasPrefix(number) { body = String(body.dropFirst(number.count)).trimmingCharacters(in: .whitespaces) }
                        return VerseAccessibilityElement(textView: self, verse: verse, range: range, text: body)
                    }
                    verseElementsKey = key
                }
                return verseElements
            }
            set { }
        }

        func verseFrame(_ range: NSRange) -> CGRect {
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
            return rect.offsetBy(dx: textContainerInset.left, dy: textContainerInset.top)
        }

        private var pendingViewportAction: (() -> Void)?

        private var viewportSize = CGSize.zero
        private var positionBeforeResize: ScriptureReadingPosition?
        private var selectionVisibleBeforeResize = false
        private var positionPassage: String?
        private var resizeRestore: Task<Void, Never>?

        func rememberViewportPosition() {
            guard !bounds.isEmpty, bounds.size == viewportSize, pendingViewportAction == nil,
                  resizeRestore == nil, let reader else { return }
            let top = max(0, contentOffset.y + adjustedContentInset.top)
            if positionPassage == reader.passageId, let positionBeforeResize,
               positionBeforeResize.selectedVerses == reader.parent.selectedVerses,
               abs(positionBeforeResize.offset - top) <= 1 { return }
            positionBeforeResize = reader.readingPosition(in: self)
            positionPassage = reader.passageId
            selectionVisibleBeforeResize = reader.selectedGroupLines(in: self).map {
                $0.lowerBound >= top - 1 && $0.upperBound <= bounds.maxY - adjustedContentInset.bottom + 1
            } ?? false
        }

        func discardResizeAnchor() {
            resizeRestore?.cancel()
            resizeRestore = nil
            positionBeforeResize = nil
            positionPassage = nil
        }

        func afterViewportLayout(_ action: @escaping () -> Void) {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if bounds.isEmpty { pendingViewportAction = action }
                else { action() }
            }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard !bounds.isEmpty else { return }
            let previousSize = viewportSize
            viewportSize = bounds.size
            if let action = pendingViewportAction {
                pendingViewportAction = nil
                resizeRestore?.cancel()
                resizeRestore = nil
                afterViewportLayout(action)
            } else if previousSize != viewportSize, let position = positionBeforeResize, let reader,
                      positionPassage == reader.passageId,
                      resizeRestore != nil || abs(previousSize.width - viewportSize.width) > 1 {
                let passage = reader.passageId
                let jump = reader.lastTarget
                let revealSelection = selectionVisibleBeforeResize
                resizeRestore?.cancel()
                resizeRestore = Task { [weak self, weak reader] in
                    // Rotation can lay out the new width before the height and safe-area insets settle.
                    try? await Task.sleep(for: .milliseconds(160))
                    guard !Task.isCancelled, let self else { return }
                    defer { resizeRestore = nil; rememberViewportPosition() }
                    guard let reader, reader.passageId == passage, reader.parent.passageId == passage,
                          reader.lastTarget == jump, !isDragging, !isDecelerating else { return }
                    reader.restoreReadingPosition(position, in: self, revealSelection: revealSelection)
                    positionBeforeResize = nil
                    positionPassage = nil
                }
            } else {
                rememberViewportPosition()
            }
        }

        let outlineMotion = ReaderOutlineMotion()

        func updateOutlineMotion() {
            let parent = reader?.parent
            outlineMotion.update(active: window != nil && parent?.animateOutline == true && parent?.selectedVerses.isEmpty == false) { [weak self] in
                guard let self, let reader else { return }
                for range in selectedVerseRanges(reader.parent.selectedVerses, in: reader.verseRanges, orderedVerses: reader.parent.verses.map(\.verse)) {
                    layoutManager.invalidateDisplay(forCharacterRange: range)
                }
            }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            updateOutlineMotion()
        }

        override func copy(_ sender: Any?) {
            if let copy = reader?.plainSelection(in: self) {
                Clipboard.copy(copy)
            } else {
                super.copy(sender)
            }
        }
    }

    private final class OutlineLayoutManager: ReaderTextLayoutManager {
        weak var reader: Coordinator?
        weak var view: ReaderTextView?

        override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
            defer { super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin) }
            guard let reader, let container = textContainers.first,
                  !reader.parent.selectedVerses.isEmpty,
                  let context = UIGraphicsGetCurrentContext() else { return }
            context.saveGState()
            defer { context.restoreGState() }
            UIColor.tintColor.withAlphaComponent(ReaderFloatingControls.outlineOpacity).setStroke()
            UIColor.tintColor.withAlphaComponent(ReaderFloatingControls.fillOpacity).setFill()
            let textView = view
            let phase = MainActor.assumeIsolated { textView?.outlineMotion.phase ?? 0 }
            for range in selectedVerseRanges(reader.parent.selectedVerses, in: reader.verseRanges, orderedVerses: reader.parent.verses.map(\.verse)) {
                let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                guard glyphs.length > 0, NSIntersectionRange(glyphs, glyphsToShow).length > 0 else { continue }
                let first = lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
                let last = lineFragmentUsedRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil)
                let rect = CGRect(x: origin.x - 4, y: origin.y + first.minY,
                                  width: container.size.width + 8, height: last.maxY - first.minY)
                    .insetBy(dx: 0, dy: -ReaderFloatingControls.outlinePadding)
                guard !rect.isEmpty else { continue }
                let outline = UIBezierPath(roundedRect: rect, cornerRadius: ReaderFloatingControls.outlineRadius)
                outline.lineWidth = 1
                outline.setLineDash([4, 3], count: 2, phase: phase)
                outline.fill()
                outline.stroke()
            }
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        struct ReadingAnchor {
            let verse: Int
            let offsetFromTop: CGFloat
        }

        func readingAnchor(in view: UITextView) -> ReadingAnchor? {
            let top = view.contentOffset.y + view.adjustedContentInset.top
            guard top > view.textContainerInset.top,
                  let position = view.closestPosition(to: CGPoint(x: view.bounds.midX, y: top)) else { return nil }
            // UIKit position conversion is independent of the candidate verse.
            // Do it once per viewport capture, rather than once per dictionary entry.
            let offset = view.offset(from: view.beginningOfDocument, to: position)
            guard let verse = verseRanges.first(where: { NSLocationInRange(offset, $0.value) })?.key,
                  let start = verseRanges[verse]?.location,
                  let marker = view.position(from: view.beginningOfDocument, offset: start) else { return nil }
            let markerY = view.caretRect(for: marker).minY
            guard markerY.isFinite else { return nil }
            return ReadingAnchor(verse: verse, offsetFromTop: markerY - top)
        }

        func bodyReflowAnchor(in view: UITextView) -> ReaderBodyReflowAnchor? {
            let top = view.contentOffset.y + view.adjustedContentInset.top
            let bottom = view.bounds.maxY - view.adjustedContentInset.bottom
            guard top > 1, bottom > top else { return nil }
            var index: Int?
            if let focus = parent.selectionFocus, parent.selectedVerses.contains(focus),
               let range = bodyRanges[focus],
               let position = view.position(from: view.beginningOfDocument, offset: range.location) {
                let y = view.caretRect(for: position).minY
                if y >= top, y < bottom { index = range.location }
            }
            if index == nil, let position = view.closestPosition(to: CGPoint(x: view.bounds.midX, y: top + (bottom - top) * 0.45)) {
                index = view.offset(from: view.beginningOfDocument, to: position)
            }
            guard let index, let verse = verseRanges.first(where: { NSLocationInRange(index, $0.value) })?.key,
                  let range = bodyRanges[verse],
                  let offset = readerBodyOffset(in: view.textStorage, range: range, index: index),
                  let bodyIndex = readerBodyStorageIndex(in: view.textStorage, range: range, offset: offset),
                  let position = view.position(from: view.beginningOfDocument, offset: bodyIndex) else { return nil }
            let y = view.caretRect(for: position).minY
            guard y.isFinite else { return nil }
            return ReaderBodyReflowAnchor(verse: verse, bodyOffset: offset, offsetFromTop: y - top)
        }

        func restoreBodyReflowAnchor(_ anchor: ReaderBodyReflowAnchor, in view: UITextView, fallback: CGPoint) {
            guard let range = bodyRanges[anchor.verse],
                  let index = readerBodyStorageIndex(in: view.textStorage, range: range, offset: anchor.bodyOffset),
                  let position = view.position(from: view.beginningOfDocument, offset: index) else {
                view.setContentOffset(fallback, animated: false)
                return
            }
            layoutChapter(in: view)
            let inset = view.adjustedContentInset
            let y = view.caretRect(for: position).minY - anchor.offsetFromTop - inset.top
            let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
            view.setContentOffset(CGPoint(x: fallback.x, y: y.isFinite ? min(max(y, -inset.top), bottom) : fallback.y), animated: false)
        }

        func readingPosition(in view: UITextView, preferred: Int? = nil) -> ScriptureReadingPosition? {
            guard passageId == parent.passageId else { return nil }
            let inset = view.adjustedContentInset
            let top = view.contentOffset.y + inset.top
            let offset = max(0, top)
            let visiblePreferred = preferred.flatMap { verse -> ReadingAnchor? in
                guard let range = verseRanges[verse], let lines = renderedLineBounds(of: range, in: view),
                      lines.lowerBound >= top, lines.lowerBound < view.bounds.maxY - inset.bottom else { return nil }
                return ReadingAnchor(verse: verse, offsetFromTop: lines.lowerBound - top)
            }
            let anchor = visiblePreferred ?? readingAnchor(in: view)
            let bottom = view.contentSize.height + inset.bottom - view.bounds.height
            let atEnd = bottom > -inset.top + 1 && view.contentOffset.y >= bottom - 1
            return ScriptureReadingPosition(offset: offset, verse: anchor?.verse, atEnd: atEnd,
                                            selectedVerses: parent.selectedVerses,
                                            returnEdition: editionArrival?.returnEdition(at: offset),
                                            viewportWidth: view.bounds.width, verseOffsetFromTop: anchor?.offsetFromTop)
        }

        func selectedGroupLines(in view: UITextView) -> ClosedRange<CGFloat>? {
            let selection = parent.selectedVerses
            guard let first = selection.min(), let last = selection.max(), selection.count == last - first + 1,
                  let head = verseRanges[first], let tail = verseRanges[last] else { return nil }
            return renderedLineBounds(of: NSUnionRange(head, tail), in: view)
        }

        func restoreReadingPosition(_ position: ScriptureReadingPosition, in view: UITextView, revealSelection: Bool = false) {
            layoutChapter(in: view)
            let inset = view.adjustedContentInset
            let minimum = -inset.top
            let maximum = max(minimum, view.contentSize.height + inset.bottom - view.bounds.height)
            let widthChanged = position.viewportWidth.map { abs($0 - view.bounds.width) > 1 } ?? false
            let verseTop = position.offset == 0 || widthChanged ? position.verse.flatMap { verseRanges[$0] }
                .flatMap { view.position(from: view.beginningOfDocument, offset: $0.location) }
                .map { view.caretRect(for: $0).minY - (position.verseOffsetFromTop ?? 0) } : nil
            let target = (verseTop.flatMap { $0.isFinite ? $0 : nil } ?? position.offset) - inset.top
            var y = position.atEnd ? maximum : min(max(target, minimum), maximum)
            let top = y + inset.top
            let bottom = y + view.bounds.height - inset.bottom
            if revealSelection, position.selectedVerses == parent.selectedVerses,
               let lines = selectedGroupLines(in: view), top <= bottom,
               let delta = selectionRevealOffset(lines: lines, visible: top...bottom, gap: ReaderFloatingControls.readingGap) {
                y = min(max(y + delta, minimum), maximum)
            }
            view.setContentOffset(CGPoint(x: 0, y: y), animated: false)
            editionArrival = position.returnEdition.map {
                ScriptureEditionArrival(edition: $0, offset: max(0, view.contentOffset.y + view.adjustedContentInset.top))
            }
        }

        func restoreReadingAnchor(_ anchor: ReadingAnchor, in view: UITextView, fallback: CGPoint) {
            guard let range = verseRanges[anchor.verse],
                  let marker = view.position(from: view.beginningOfDocument, offset: range.location) else {
                view.setContentOffset(fallback, animated: false)
                return
            }
            layoutThroughEnd(of: range, in: view)
            let inset = view.adjustedContentInset
            let y = view.caretRect(for: marker).minY - anchor.offsetFromTop - inset.top
            let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
            view.setContentOffset(CGPoint(x: fallback.x, y: y.isFinite ? min(max(y, -inset.top), bottom) : fallback.y),
                                  animated: false)
        }

        func layoutChapter(in view: UITextView) {
            view.layoutIfNeeded()
            view.layoutManager.ensureLayout(for: view.textContainer)
            view.setNeedsLayout()
            view.layoutIfNeeded()
        }

        func layoutThroughEnd(of range: NSRange, in view: UITextView) {
            view.layoutIfNeeded()
            view.layoutManager.ensureLayout(forCharacterRange: NSRange(location: 0, length: NSMaxRange(range)))
        }

        // Use the final rendered glyph, excluding the paragraph break, just like the selection outline.
        func lastLineBottom(of range: NSRange, in view: UITextView) -> CGFloat {
            renderedLineBounds(of: range, in: view)?.upperBound ?? view.textContainerInset.top
        }

        func renderedLineBounds(of range: NSRange, in view: UITextView) -> ClosedRange<CGFloat>? {
            guard range.length > 1 else { return nil }
            let layout = view.layoutManager
            let text = NSRange(location: range.location, length: range.length - 1)
            let glyphs = layout.glyphRange(forCharacterRange: text, actualCharacterRange: nil)
            guard glyphs.length > 0 else { return nil }
            let inset = view.textContainerInset.top
            let first = layout.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil).minY + inset
            let last = layout.lineFragmentUsedRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil).maxY + inset
            return first...last
        }

        private static let skip = NSAttributedString.Key("bereanSkip")
        private var pinchStartSize: Double?
        private var pinchPreviewSize: Double?
        private let selectionFeedback = UISelectionFeedbackGenerator()
        var parent: IOSChapterTextView
        var key: Key?
        private var lastScrollY: CGFloat = 0
        private var scrollTravel: CGFloat = 0
        private var chromeHidden = false

        private var chapterPull: ChapterPullCue?
        private var chapterPullIntent = ChapterPullIntent(armDistance: 112, disarmDistance: 88)

        private func publishChapterPull(_ pull: ChapterPullCue?) {
            guard pull != chapterPull else { return }
            chapterPull = pull
            parent.onChapterPull(pull)
            if pull?.ready == true,
               UserLibrary.defaults.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
                selectionFeedback.selectionChanged()
            }
        }

        private var chapterPullActive = false
        private var chapterPullOrigin: CGPoint?
        private var pendingChapterPullCommit: UUID?

        func beginChapterPull(_ scrollView: UIScrollView, at point: CGPoint) {
            cancelChapterPull()
            guard let view = scrollView as? UITextView, view.selectedRange.length == 0,
                  pinchStartSize == nil else { return }
            chapterPullActive = true
            chapterPullOrigin = point
            let top = -scrollView.adjustedContentInset.top
            let bottom = max(top, scrollView.contentSize.height + scrollView.adjustedContentInset.bottom - scrollView.bounds.height)
            let fits = bottom <= top + 1
            chapterPullIntent.begin(atTop: fits || scrollView.contentOffset.y <= top + 2,
                                    atBottom: fits || scrollView.contentOffset.y >= bottom - 2)
        }

        func trackChapterPull(_ scrollView: UIScrollView, at point: CGPoint) {
            guard chapterPullActive else { return }
            guard let view = scrollView as? UITextView, view.selectedRange.length == 0,
                  pinchStartSize == nil,
                  let origin = chapterPullOrigin else { cancelChapterPull(); return }
            // Window-space touch travel survives clamped short-page scrolling
            // and fast/coalesced input; UIScrollView may reset pan translation.
            let travel = CGPoint(x: point.x - origin.x, y: point.y - origin.y)
            let direction = travel.y > 0 ? -1 : 1
            publishChapterPull(chapterPullIntent.update(direction: direction, distance: abs(travel.y),
                allowed: abs(travel.y) > abs(travel.x) && parent.canPullChapter(direction)))
        }

        func finishChapterPull(_ scrollView: UIScrollView, at point: CGPoint) {
            guard chapterPullActive else { return }
            trackChapterPull(scrollView, at: point)
            chapterPullActive = false
            chapterPullOrigin = nil
            let direction = chapterPullIntent.finish()
            publishChapterPull(nil)
            guard let direction, parent.canPullChapter(direction) else { return }
            let passage = parent.passageId
            let commit = UUID()
            pendingChapterPullCommit = commit
            // The passive observer receives touch-up before UIScrollView ends
            // tracking. Replacing its document here lets the outgoing drag's
            // momentum scroll the new chapter, even after its position restores.
            DispatchQueue.main.async { [weak self, weak scrollView] in
                guard let self, let scrollView else { return }
                self.commitChapterPullWhenReleased(direction, passage: passage, commit: commit, in: scrollView)
            }
        }

        private func commitChapterPullWhenReleased(_ direction: Int, passage: String, commit: UUID,
                                                  in scrollView: UIScrollView) {
            guard pendingChapterPullCommit == commit, passageId == passage,
                  parent.passageId == passage, parent.canPullChapter(direction) else { return }
            // One main-queue turn isn't sufficient on every release: UIKit may
            // still be tracking and start deceleration after that turn. Wait for
            // its public interaction flags; a new touch/passage cancels the token.
            if scrollView.isTracking || scrollView.isDragging {
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(16)) { [weak self, weak scrollView] in
                    guard let self, let scrollView else { return }
                    self.commitChapterPullWhenReleased(direction, passage: passage, commit: commit, in: scrollView)
                }
                return
            }
            pendingChapterPullCommit = nil
            scrollView.stopScrollingAndZooming()
            parent.onChapterPullCommit(direction)
        }

        func cancelChapterPull() {
            pendingChapterPullCommit = nil
            chapterPullActive = false
            chapterPullOrigin = nil
            chapterPullIntent.cancel()
            publishChapterPull(nil)
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { checkpointPosition(in: scrollView) }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            checkpointPosition(in: scrollView)
        }

        fileprivate func checkpointPosition(in scrollView: UIScrollView) {
            guard let view = scrollView as? UITextView, let position = readingPosition(in: view) else { return }
            parent.savePosition(position)
        }

        func resetScrollChrome() {
            pendingChapterPullCommit = nil
            pendingReaderTap = nil
            bodyTapIntent.reset()
            rejectedBodyTap = nil
            pendingTapTimestamp = 0
            chapterPullActive = false
            chapterPullOrigin = nil
            chapterPullIntent.cancel()
            lastScrollY = 0
            scrollTravel = 0
            chromeHidden = false
            chapterPull = nil
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            (scrollView as? ReaderTextView)?.rememberViewportPosition()
            let inset = scrollView.adjustedContentInset
            let y = scrollView.contentOffset.y + inset.top
            defer { lastScrollY = y }
            // Only user scrolling moves the chrome; programmatic jumps and restores leave it alone.
            guard scrollView.isTracking || scrollView.isDecelerating else { scrollTravel = 0; return }
            let delta = y - lastScrollY
            scrollTravel = (delta > 0) == (scrollTravel > 0) ? scrollTravel + delta : delta   // hysteresis per direction
            let atTop = y < 40
            let bottom = max(-inset.top, scrollView.contentSize.height + inset.bottom - scrollView.bounds.height)
            let atBottom = scrollView.contentOffset.y >= bottom - IOSChapterTextView.chapterEndTolerance
            let hide: Bool
            if atTop || atBottom { hide = false } else if scrollTravel > 36 { hide = true } else if scrollTravel < -24 { hide = false } else { return }
            guard hide != chromeHidden else { return }
            chromeHidden = hide
            parent.onChromeHidden(hide)
        }

        var passageId: String?
        var lastTarget: ScriptureScrollTarget?
        var editionArrival: ScriptureEditionArrival?
        var verseRanges: [Int: NSRange] = [:]
        var renderedSelection: Set<Int> = []
        private var markerRanges: [Int: NSRange] = [:]

        private func markerColor(_ verse: Int) -> UIColor {
            let accent = parent.style.themeAccent.map { UIColor(ReaderTheme.color($0)) } ?? .tintColor   // reading theme
            return parent.selectedVerses.contains(verse) ? accent : accent.withAlphaComponent(0.82)
        }

        func updateMarkerColors(in storage: NSTextStorage, changed: Set<Int>) {
            storage.beginEditing()
            for verse in changed {
                guard let range = markerRanges[verse] else { continue }
                let color = markerColor(verse)
                storage.addAttribute(.foregroundColor, value: color, range: range)
            }
            storage.endEditing()
        }

        fileprivate var bodyRanges: [Int: NSRange] = [:]
        private var psalmTitleRanges: [Int: NSRange] = [:]

        init(_ parent: IOSChapterTextView) { self.parent = parent }

        func render(_ dark: Bool) -> NSAttributedString {
            let out = NSMutableAttributedString()
            verseRanges.removeAll(keepingCapacity: true)
            bodyRanges.removeAll(keepingCapacity: true)
            psalmTitleRanges.removeAll(keepingCapacity: true)
            markerRanges.removeAll(keepingCapacity: true)
            let size = CGFloat(parent.style.fontSize)
            let regular = font(size)
            let italic = regular.fontDescriptor.withSymbolicTraits(.traitItalic).map { UIFont(descriptor: $0, size: size) } ?? UIFont.italicSystemFont(ofSize: size)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = parent.style.lineSpacing
            paragraph.paragraphSpacing = size * 0.55
            let hasAnnotations = parent.verses.contains { $0.noteCount > 0 || !$0.tags.isEmpty || $0.citationCount > 0 || $0.mentionCount > 0 }
            if parent.style.showVerseNumbers {
                paragraph.tabStops = [NSTextTab(textAlignment: .right, location: size * 1.25),
                                      NSTextTab(textAlignment: .left, location: size * 1.8)]
                paragraph.headIndent = size * 1.8
            } else if hasAnnotations {
                paragraph.tabStops = [NSTextTab(textAlignment: .left, location: size * 0.8)]
                paragraph.headIndent = size * 0.8
            }
            let bodyColor = parent.style.themeText.map { UIColor(ReaderTheme.color($0)) } ?? UIColor.label   // reading theme
            let base: [NSAttributedString.Key: Any] = [.font: regular, .foregroundColor: bodyColor, .paragraphStyle: paragraph]
            if let header = parent.header {
                let headerParagraph = NSMutableParagraphStyle()
                headerParagraph.firstLineHeadIndent = paragraph.headIndent
                headerParagraph.headIndent = paragraph.headIndent
                headerParagraph.paragraphSpacing = size * 0.55
                var attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.preferredFont(forTextStyle: .caption1), .foregroundColor: UIColor.secondaryLabel,
                    .paragraphStyle: headerParagraph, Self.skip: true,
                ]
                if parent.headerDetail != nil { attributes[.link] = URL(string: "berean-numbering:info")! }
                out.append(NSAttributedString(string: header + "  ⓘ\n", attributes: attributes))
            }
            if let study = parent.chapterStudy {
                let headerParagraph = NSMutableParagraphStyle()
                headerParagraph.firstLineHeadIndent = paragraph.headIndent
                headerParagraph.headIndent = paragraph.headIndent
                headerParagraph.paragraphSpacing = size * 0.55
                let attachment = NSTextAttachment()
                attachment.image = UIImage(systemName: study.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15))?
                    .withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
                let marker = NSMutableAttributedString(attachment: attachment)
                marker.append(NSAttributedString(string: "\n"))
                marker.addAttributes([.paragraphStyle: headerParagraph, Self.skip: true,
                    .link: URL(string: "berean-chapter-study:tags")!], range: NSRange(location: 0, length: marker.length))
                out.append(marker)
            }
            for verse in parent.verses {
                let start = out.length
                let numberedTitle = verse.numberBeforeTitle && verse.title?.isEmpty == false && parent.style.showVerseNumbers
                let titleParagraph = (paragraph.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                titleParagraph.firstLineHeadIndent = numberedTitle ? 0 : paragraph.headIndent
                titleParagraph.headIndent = paragraph.headIndent
                if !numberedTitle { titleParagraph.tabStops = [] }
                titleParagraph.paragraphSpacing = numberedTitle ? paragraph.paragraphSpacing : size * 0.3
                let titleFont = italic.withSize(size * (verse.numberBeforeTitle ? 0.92 : 0.85))
                let titleAttributes = base.merging([
                    .font: titleFont, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: titleParagraph, Self.skip: true,
                ]) { _, new in new }
                if let title = verse.title, !title.isEmpty, !numberedTitle {
                    // Titles (Psalm superscriptions, section headings) align with the verse text column, not the gutter.
                    let titleStart = out.length
                    out.append(NSAttributedString(string: title + "\n", attributes: titleAttributes))
                    if verse.numberBeforeTitle { psalmTitleRanges[verse.verse] = NSRange(location: titleStart, length: out.length - titleStart - 1) }
                }
                if verse.noteCount > 0 || !verse.tags.isEmpty || verse.citationCount > 0 || verse.mentionCount > 0 {
                    let attachment = NSTextAttachment()
                    attachment.image = UIImage(systemName: verse.studySymbol,
                        withConfiguration: UIImage.SymbolConfiguration(pointSize: max(12, size * 0.65)))?
                        .withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
                    let marker = NSMutableAttributedString(attachment: attachment)
                    marker.addAttributes(base.merging([
                        .paragraphStyle: numberedTitle ? titleParagraph : paragraph,
                        .link: URL(string: "\((verse.citationCount > 0 || verse.mentionCount > 0) && verse.noteCount == 0 && verse.tags.isEmpty ? "berean-verse-citations" : "berean-verse-notes"):\(verse.verse)")!, Self.skip: true,
                    ]) { _, new in new }, range: NSRange(location: 0, length: marker.length))
                    out.append(marker)
                }
                if parent.style.showVerseNumbers {
                    let number = base.merging([
                        .font: UIFont.monospacedDigitSystemFont(ofSize: max(13, size * 0.75), weight: .semibold),
                        .foregroundColor: markerColor(verse.verse),
                        .paragraphStyle: numberedTitle ? titleParagraph : paragraph,
                        .link: URL(string: "berean-verse:\(verse.verse)")!, Self.skip: true,
                    ]) { _, new in new }
                    let markerStart = out.length
                    out.append(NSAttributedString(string: "\t\(verse.readerVerseLabel)\t", attributes: number))
                    markerRanges[verse.verse] = NSRange(location: markerStart, length: out.length - markerStart)
                } else if hasAnnotations {
                    out.append(NSAttributedString(string: "\t", attributes: base.merging([Self.skip: true]) { _, new in new }))
                }
                if numberedTitle, let title = verse.title {
                    let titleStart = out.length
                    out.append(NSAttributedString(string: title.replacingOccurrences(of: "\n", with: " ") + "\u{2028}", attributes: titleAttributes))
                    psalmTitleRanges[verse.verse] = NSRange(location: titleStart, length: out.length - titleStart - 1)
                }
                let bodyStart = out.length
                let tint = verse.tint.map { UIColor(Color.highlight($0)).withAlphaComponent(0.25) }
                var wordBase = base
                if let tint { wordBase[.backgroundColor] = tint }
                var offset = 0
                for (index, word) in verse.words.enumerated() {
                    if index > 0 { appendBody(" ", at: &offset, marks: verse.marks, to: out, attributes: wordBase) }
                    var attributes = wordBase
                    if word.italic { attributes[.font] = italic }
                    if word.red, parent.style.redLetters { attributes[.foregroundColor] = UIColor.systemRed }
                    appendBody(word.text, at: &offset, marks: verse.marks, to: out, attributes: attributes)
                    if parent.style.showStrongs {
                        for number in word.strongs {
                            let id = number.trimmingCharacters(in: CharacterSet(charactersIn: "()"))
                            guard !id.isEmpty, let url = URL(string: "strongs:\(id)") else { continue }
                            out.append(NSAttributedString(string: "\u{2009}" + id, attributes: base.merging([
                                .font: UIFont.monospacedDigitSystemFont(ofSize: max(10, size * 0.6), weight: .medium),
                                .foregroundColor: UIColor.tintColor, .baselineOffset: size * 0.28, .link: url, Self.skip: true,
                            ]) { _, new in new }))
                        }
                    }
                }
                bodyRanges[verse.verse] = NSRange(location: bodyStart, length: out.length - bodyStart)
                out.append(NSAttributedString(string: "\n", attributes: base))
                verseRanges[verse.verse] = NSRange(location: start, length: out.length - start)
            }
            return out
        }

        private func font(_ size: CGFloat) -> UIFont {
            ScriptureFont.nativeFont(parent.style.family, size: size)
        }

        private func appendBody(_ text: String, at offset: inout Int, marks: [ReaderVerse.Mark],
                                to out: NSMutableAttributedString, attributes: [NSAttributedString.Key: Any]) {
            let run = NSMutableAttributedString(string: text, attributes: attributes)
            // Apply marks in stored order so the last overlapping mark wins, as in the Mac reader.
            let span = NSRange(location: offset, length: run.length)
            for mark in marks where mark.end > mark.start {
                let hit = NSIntersectionRange(span, NSRange(location: mark.start, length: mark.end - mark.start))
                guard hit.length > 0 else { continue }
                run.addAttribute(.backgroundColor, value: UIColor(Color.highlight(mark.color)).withAlphaComponent(0.35),
                                 range: NSRange(location: hit.location - offset, length: hit.length))
            }
            out.append(run)
            offset += run.length
        }

        private func appendTags(_ tags: [(name: String, color: String?, slot: Int?)], verse: Int?,
                                to out: NSMutableAttributedString, base: [NSAttributedString.Key: Any], dark: Bool) {
            for tag in tags {
                var url = URLComponents()
                url.scheme = "berean-tag"
                url.host = "open"
                url.queryItems = [URLQueryItem(name: "name", value: tag.name),
                                  URLQueryItem(name: "verse", value: verse.map(String.init))]
                guard let link = url.url else { continue }
                let color = UIColor(TagColor.color(tag.color, slot: tag.slot, dark: dark))
                out.append(NSAttributedString(string: "  #\(tag.name)", attributes: base.merging([
                    .font: UIFont.systemFont(ofSize: max(12, parent.style.fontSize * 0.74), weight: .medium),
                    .foregroundColor: color, .link: link, Self.skip: true,
                ]) { _, new in new }))
            }
        }

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case let .link(url) = textItem.content else { return defaultAction }
            switch url.scheme {
            case "berean-numbering":
                return UIAction(title: "About Septuagint Numbering") { [weak self] _ in self?.parent.onNumberingInfo() }
            case "berean-chapter-study":
                return UIAction(title: "Chapter Notes and Tags") { [weak self] _ in self?.parent.onChapterNotes() }
            case "berean-verse":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) else { return nil }
                let number = parent.verses.first { $0.verse == verse }?.readerVerseLabel ?? String(verse)
                let title = parent.selectedVerses.contains(verse) ? "Deselect Verse \(number)" : "Select Verse \(number)"
                return UIAction(title: title) { [weak self, weak textView] _ in
                    guard let textView else { return }
                    self?.toggleVerse(verse, in: textView)
                }
            case "berean-verse-notes":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse-notes:".count)) else { return nil }
                let number = parent.verses.first { $0.verse == verse }?.readerVerseLabel ?? String(verse)
                return UIAction(title: "Study Details for Verse \(number)") { [weak self] _ in self?.parent.onNotes(verse) }
            case "berean-verse-citations":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse-citations:".count)) else { return nil }
                let number = parent.verses.first { $0.verse == verse }?.readerVerseLabel ?? String(verse)
                return UIAction(title: "Note Cross References for Verse \(number)") { [weak self] _ in
                    self?.parent.onCitations(verse)
                }
            case "strongs":
                let id = String(url.absoluteString.dropFirst("strongs:".count))
                let verse = verseRanges.first { NSLocationInRange(textItem.range.location, $0.value) }?.key
                return UIAction { [weak self] _ in self?.parent.onStrongs(id, verse) }
            case "berean-tag":
                let fields = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
                guard let name = fields?.first(where: { $0.name == "name" })?.value else { return nil }
                let verse = fields?.first(where: { $0.name == "verse" })?.value.flatMap(Int.init)
                return UIAction { [weak self] _ in self?.parent.onTagClick(name, verse) }
            default:
                return defaultAction
            }
        }

        func textView(_ textView: UITextView, menuConfigurationFor textItem: UITextItem,
                      defaultMenu: UIMenu) -> UITextItem.MenuConfiguration? {
            guard case let .link(url) = textItem.content, url.scheme == "strongs" else { return nil }
            let id = String(url.absoluteString.dropFirst("strongs:".count))
            let verse = verseRanges.first { NSLocationInRange(textItem.range.location, $0.value) }?.key
            let open = UIAction(title: "Open", image: UIImage(systemName: "character.book.closed")) { [weak self] _ in
                self?.parent.onStrongs(id, verse)
            }
            let newTab = UIAction(title: "Open in New Tab", image: UIImage(systemName: "plus.square.on.square")) { [weak self] _ in
                self?.parent.onOpenStrongsTab(id, verse)
            }
            let copy = UIAction(title: "Copy Strong’s Number", image: UIImage(systemName: "doc.on.doc")) { _ in Clipboard.copy(id) }
            let reference = UIAction(title: "Copy Reference", image: UIImage(systemName: "number")) { _ in Clipboard.copy("Strong's \(id)") }
            let copies = UIMenu(options: .displayInline, children: [copy, reference])
            return UITextItem.MenuConfiguration(preview: nil, menu: UIMenu(title: id, children: [open, newTab, copies]))
        }

        func plainSelection(in view: UITextView) -> String? {
            let portions = portions(in: view.selectedRange, storage: view.textStorage)
            return portions.isEmpty ? nil : plainText(portions)
        }

        private func plainText(_ portions: [(Piece, String)]) -> String {
            portions.map { $0.1.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: " ")
        }

        private func portions(in range: NSRange, storage: NSAttributedString) -> [(Piece, String)] {
            guard range.location != NSNotFound, range.length > 0, NSMaxRange(range) <= storage.length else { return [] }
            return parent.verses.compactMap { verse -> (Piece, String)? in
                guard let body = bodyRanges[verse.verse] else { return nil }
                let intersection = NSIntersectionRange(range, body)
                guard intersection.length > 0 else { return nil }
                let prefix = NSRange(location: body.location, length: intersection.location - body.location)
                let start = bodyText(storage, in: prefix).utf16.count
                let selected = bodyText(storage, in: intersection)
                guard !selected.isEmpty else { return nil }
                return (Piece(verse: verse.verse, start: start, end: start + selected.utf16.count), selected)
            }
        }

        private func isVerseMarkerSelection(_ range: NSRange, in view: UITextView) -> Bool {
            guard range.location != NSNotFound, range.length > 0,
                  NSMaxRange(range) <= view.textStorage.length else { return false }
            var isMarker = true
            view.textStorage.enumerateAttribute(.link, in: range) { value, _, stop in
                if (value as? URL)?.scheme != "berean-verse" {
                    isMarker = false
                    stop.pointee = true
                }
            }
            return isMarker
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            traceTap("native-selection-change", in: textView)
            let selection = textView.selectedRange
            if selection.length > 0,
               bodyTapIntent.rejectsNativeSelection(at: ProcessInfo.processInfo.systemUptime) || rejectedBodyTap != nil {
                textView.selectedTextRange = nil
                return
            }
            let trimmed = readerTextSelection(selection, in: textView.textStorage, excluding: Self.skip)
            if trimmed != selection {
                if trimmed.length == 0 { textView.selectedTextRange = nil }
                else { textView.selectedRange = trimmed }
            }
            if trimmed.length > 0 { beginNativeTextSelection(in: textView) }
        }

        private var textSelectionCleanupQueued = false

        private func beginNativeTextSelection(in view: UITextView) {
            guard !parent.selectedVerses.isEmpty, !textSelectionCleanupQueued else { return }
            textSelectionCleanupQueued = true
            let passage = parent.passageId
            // UIKit also reports selection during representable updates. Wait
            // for a meaningful native range to survive that update before
            // leaving whole-verse mode, preserving the native handles/menu.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self else { return }
                self.textSelectionCleanupQueued = false
                guard let view, self.passageId == passage, self.parent.passageId == passage,
                      view.selectedRange.length > 0, !self.parent.selectedVerses.isEmpty else { return }
                self.traceTap("clear-whole-selection", in: view)
                self.bodyTapIntent.reset()
                self.pendingReaderTap = nil
                self.parent.onTextSelection()
            }
        }

        func textView(_ view: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            if isVerseMarkerSelection(range, in: view) { return UIMenu(children: []) }
            let portions = portions(in: range, storage: view.textStorage)
            guard let first = portions.first, let last = portions.last else { return nil }
            let text = plainText(portions)
            let copy = UIAction(title: "Copy Text", image: UIImage(systemName: "doc.on.doc")) { _ in Clipboard.copy(text) }
            let reference = parent.reference(first.0.verse, last.0.verse)
            let displayedNumbers = Dictionary(uniqueKeysWithValues: parent.verses.map { ($0.verse, $0.readerVerseLabel) })
            let copyWithReference = UIAction(title: "Copy with Reference", image: UIImage(systemName: "number")) { _ in
                let lines = portions.map { "\(displayedNumbers[$0.0.verse] ?? String($0.0.verse)) \($0.1.trimmingCharacters(in: .whitespacesAndNewlines))" }
                Clipboard.copy(([reference] + lines).joined(separator: "\n"))
            }
            let highlight = UIMenu(title: "Highlight Selection", image: UIImage(systemName: "highlighter"),
                                   children: highlightColors.map { color in
                UIAction(title: color.capitalized) { [weak self, weak view] _ in
                    view?.selectedRange = NSRange(location: range.location, length: 0)
                    for (piece, _) in portions { self?.parent.onHighlight(piece, color) }
                }
            })
            var actions: [UIMenuElement] = [copy, copyWithReference, highlight]
            let words = text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
            if !words.isEmpty, words.count <= 12 {
                let query = words.joined(separator: " ")
                let shown = query.count > 24 ? String(query.prefix(23)) + "…" : query
                actions.append(UIAction(title: "Search for “\(shown)”", image: UIImage(systemName: "magnifyingglass")) { [weak self] _ in
                    self?.parent.onSearchText(query)
                })
                if !parent.bookName.isEmpty {
                    actions.append(UIAction(title: "Search in \(parent.bookName)", image: UIImage(systemName: "text.magnifyingglass")) { [weak self] _ in
                        self?.parent.onBookSearch(query)
                    })
                }
                if words.count == 1 {
                    let word = query.trimmingCharacters(in: .punctuationCharacters).lowercased()
                    actions.append(UIAction(title: "Look Up in Lexicon", image: UIImage(systemName: "character.book.closed")) { [weak self] _ in
                        self?.parent.onLexiconSearch(word)
                    })
                }
            }
            if first.0.verse == last.0.verse {
                actions.append(UIAction(title: "Verse Actions", image: UIImage(systemName: "ellipsis.circle")) { [weak self, weak view] _ in
                    view?.selectedRange = NSRange(location: range.location, length: 0)
                    self?.parent.onVerseActions(first.0.verse)
                })
            }
            actions += suggestedActions.filter { item in
                guard let command = item as? UICommand else { return false }
                return command.action != #selector(UIResponderStandardEditActions.copy(_:))
            }
            return UIMenu(children: actions)
        }

        private func bodyText(_ storage: NSAttributedString, in range: NSRange) -> String {
            var result = ""
            storage.enumerateAttribute(Self.skip, in: range) { skip, run, _ in
                if skip == nil { result += (storage.string as NSString).substring(with: run) }
            }
            return result
        }

        private func verseInGutter(_ point: CGPoint, in view: UITextView) -> Int? {
            let gutterLimit = view.textContainerInset.left + view.textContainer.lineFragmentPadding + CGFloat(parent.style.fontSize) * 1.8
            guard parent.style.showVerseNumbers, point.x >= 0, point.x < gutterLimit,
                  let position = view.closestPosition(to: point) else { return nil }
            let offset = view.offset(from: view.beginningOfDocument, to: position)
            guard let verse = markerRanges.first(where: {
                offset >= $0.value.location && offset <= NSMaxRange($0.value)
            })?.key,
                  let start = bodyRanges[verse]?.location,
                  let body = view.position(from: view.beginningOfDocument, offset: start) else { return nil }
            let caret = view.caretRect(for: body)
            guard point.x < caret.minX, point.y >= caret.minY - 3, point.y <= caret.maxY + 3 else { return nil }
            return verse
        }

        private enum ReaderTap {
            case verse(Int, marker: Bool)
            case chapterStep(Int)
        }

        private func characterAtTap(_ point: CGPoint, in view: UITextView) -> Int? {
            let container = view.textContainer
            let layout = view.layoutManager
            let inset = view.textContainerInset
            let location = CGPoint(x: point.x - inset.left, y: point.y - inset.top)
            let glyph = layout.glyphIndex(for: location, in: container)
            guard glyph < layout.numberOfGlyphs,
                  layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(location) else { return nil }
            let index = layout.characterIndexForGlyph(at: glyph)
            return index < view.textStorage.length ? index : nil
        }

        private func readerTap(at point: CGPoint, in view: UITextView) -> ReaderTap? {
            // Keep native handles and non-verse links with UIKit. Verse numbers
            // are selection controls, so rapid number taps must not select text.
            guard view.selectedRange.length == 0 else { return nil }
            let character = characterAtTap(point, in: view)
            if let character,
               let link = view.textStorage.attribute(.link, at: character, effectiveRange: nil) {
                guard let url = link as? URL, url.scheme == "berean-verse",
                      let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) else { return nil }
                return .verse(verse, marker: true)
            }
            if let verse = verseInGutter(point, in: view) { return .verse(verse, marker: true) }
            if let character {
                let verse = bodyRanges.first { NSLocationInRange(character, $0.value) }?.key
                    ?? psalmTitleRanges.first { NSLocationInRange(character, $0.value) }?.key
                return verse.map { .verse($0, marker: false) }
            }

            // Keep navigation in the outer margin. Wider reading layouts leave less margin for this gesture.
            guard parent.selectedVerses.isEmpty else { return nil }
            let x = point.x - view.bounds.minX
            let inset = view.textContainerInset
            let fragmentPadding = view.textContainer.lineFragmentPadding
            if x >= 0 && x < min(30, inset.left + fragmentPadding) { return .chapterStep(-1) }
            if x <= view.bounds.width && x > view.bounds.width - min(30, inset.right + fragmentPadding) { return .chapterStep(1) }
            return nil
        }

        #if DEBUG
        private var tapTrace: [[String: String]] = []
        private static let tapTraceQueue = DispatchQueue(label: "berean.reader.tap-diagnostics")
        #endif

        private func traceTap(_ event: String, in view: UITextView) {
            #if DEBUG
            guard ProcessInfo.processInfo.environment["BEREAN_READER_TAP_TRACE"] != nil else { return }
            tapTrace.append(["event": event, "nativeRange": NSStringFromRange(view.selectedRange),
                             "selected": parent.selectedVerses.sorted().map(String.init).joined(separator: ","),
                             "pending": String(describing: pendingReaderTap),
                             "time": String(ProcessInfo.processInfo.systemUptime)])
            if tapTrace.count > 128 { tapTrace.removeFirst(tapTrace.count - 128) }
            guard let data = try? JSONSerialization.data(withJSONObject: tapTrace, options: [.sortedKeys]) else { return }
            let destination = URL(fileURLWithPath: NSTemporaryDirectory() + "berean-reader-taps.json")
            Self.tapTraceQueue.async { try? data.write(to: destination, options: .atomic) }
            #endif
        }

        private var pendingReaderTap: ReaderTap?
        private var pendingTapTimestamp: TimeInterval = 0
        private var bodyTapIntent = ReaderBodyTapIntent()
        private var rejectedBodyTap: UUID?

        func beginBodyTap(in view: UITextView, at point: CGPoint, timestamp: TimeInterval) {
            rejectedBodyTap = nil
            let local = view.convert(point, from: view.window)
            let verse: Int?
            if case let .verse(number, marker: false) = readerTap(at: local, in: view) { verse = number }
            else { verse = nil }
            bodyTapIntent.begin(verse: verse, point: point, time: timestamp, hasNativeSelection: view.selectedRange.length > 0)
            traceTap("body-start-\(verse.map(String.init) ?? "none")", in: view)
        }

        func moveBodyTap(to point: CGPoint) { bodyTapIntent.move(to: point) }
        func cancelBodyTap() { bodyTapIntent.cancel(); rejectedBodyTap = nil }

        func finishBodyTap(in view: UITextView, at point: CGPoint, timestamp: TimeInterval) {
            guard let completion = bodyTapIntent.finish(point: point, time: timestamp, hasNativeSelection: view.selectedRange.length > 0) else { return }
            if completion.rejectsNativeSelection {
                let token = UUID()
                rejectedBodyTap = token
                // Native tap actions can publish a text range later in this
                // same event. Keep a verse tap a verse tap until it is drained.
                DispatchQueue.main.async { [weak self] in
                    if self?.rejectedBodyTap == token { self?.rejectedBodyTap = nil }
                }
            }
            traceTap("body-complete-\(completion.verse)", in: view)
            toggleVerse(completion.verse, in: view)
        }

        @objc func tapVerse(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view as? UITextView else { return }
            traceTap("recognized-tap", in: view)
            // Keep the touch-down target if selection reveal/layout moved the
            // document while this short tap was being recognized.
            let tap = pendingReaderTap
            guard let tap else { return }
            switch tap {
            case let .verse(verse, _):
                bodyTapIntent.marker(verse: verse, point: gesture.location(in: view.window), time: pendingTapTimestamp)
                toggleVerse(verse, in: view)
            case let .chapterStep(step): parent.onStep(step)
            }
        }

        private func toggleVerse(_ verse: Int, in view: UITextView) {
            traceTap("toggle-\(verse)", in: view)
            view.selectedTextRange = nil
            parent.onVerseTap(verse)
            if UserLibrary.defaults.object(forKey: "berean.haptics.enabled") as? Bool ?? true { selectionFeedback.selectionChanged() }
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard gesture is UITapGestureRecognizer, let view = gesture.view as? UITextView else { return true }
            let point = touch.location(in: view)
            let hit = readerTap(at: point, in: view)
            // Body taps come from the passive touch observer. They must not
            // wait for UIKit's cross-verse word-double-tap failure graph.
            let tap: ReaderTap?
            if case .verse(_, marker: false) = hit { tap = nil } else { tap = hit }
            pendingReaderTap = tap
            pendingTapTimestamp = touch.timestamp
            traceTap("receive-\(point)", in: view)
            return tap != nil
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            guard gesture is UITapGestureRecognizer, other !== gesture,
                  other is UITapGestureRecognizer,
                  case .verse(_, marker: true) = pendingReaderTap else { return false }
            // Verse numbers remain controls, including rapid repeated taps.
            return true
        }

        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let view = gesture.view as? UITextView else { return false }
            if gesture is UITapGestureRecognizer { traceTap("begin-tap", in: view); return true }
            if gesture is UIPinchGestureRecognizer { return view.selectedRange.length == 0 }
            guard parent.selectedVerses.isEmpty, pinchStartSize == nil else { return false }
            let x = gesture.location(in: view).x - view.bounds.minX
            return x > 24 && x < view.bounds.width - 24 && view.selectedRange.length == 0
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            !(gesture is UIPinchGestureRecognizer) && other === (gesture.view as? UITextView)?.panGestureRecognizer
        }

        @objc func resizeText(_ gesture: UIPinchGestureRecognizer) {
            switch gesture.state {
            case .began:
                pinchStartSize = parent.baseFontSize
            case .changed:
                guard let start = pinchStartSize, gesture.scale.isFinite else { return }
                let size = ScriptureTextSize.clamped((start * gesture.scale).rounded())
                guard size != (pinchPreviewSize ?? start) else { return }
                pinchPreviewSize = size
                parent.onPinchPreview(size)
            case .ended:
                if let size = pinchPreviewSize { parent.onPinchCommit(size) }
                pinchStartSize = nil
                pinchPreviewSize = nil
            case .cancelled, .failed:
                if pinchPreviewSize != nil { parent.onPinchPreview(nil) }
                pinchStartSize = nil
                pinchPreviewSize = nil
            default:
                break
            }
        }

        @objc func swipe(_ gesture: UISwipeGestureRecognizer) {
            guard gesture.state == .recognized, parent.selectedVerses.isEmpty, pinchStartSize == nil else { return }
            parent.onStep(gesture.direction == .left ? 1 : -1)
        }
    }
}


/// A verse in the iPhone reader as a VoiceOver element.
final class VerseAccessibilityElement: UIAccessibilityElement {
    private weak var textView: IOSChapterTextView.ReaderTextView?
    let verse: Int
    private let range: NSRange

    init(textView: IOSChapterTextView.ReaderTextView, verse: Int, range: NSRange, text: String) {
        self.textView = textView; self.verse = verse; self.range = range
        super.init(accessibilityContainer: textView)
        accessibilityLabel = "Verse \(verse)"
        accessibilityValue = text
        accessibilityHint = "Double-tap to select or deselect."
        accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Verse Actions") { [weak self] _ in
            guard let self, let reader = self.textView?.reader else { return false }
            reader.parent.onVerseActions(self.verse)
            return true
        }]
    }

    override var accessibilityFrameInContainerSpace: CGRect {
        get { textView?.verseFrame(range) ?? .zero }
        set { }
    }

    override var accessibilityTraits: UIAccessibilityTraits {
        get { (textView?.reader?.parent.selectedVerses.contains(verse) ?? false) ? [.button, .selected] : .button }
        set { }
    }

    override func accessibilityActivate() -> Bool {
        guard let reader = textView?.reader else { return false }
        reader.parent.onVerseTap(verse)
        return true
    }
}
