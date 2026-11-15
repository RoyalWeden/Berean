import SwiftUI
import UIKit

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
    var chapterTags: [(name: String, color: String?, slot: Int?)]
    var verses: [ReaderVerse]
    var style: ReaderStyle
    var baseFontSize: Double
    var selectedVerses: Set<Int>
    var scrollTarget: Int?
    var actionClearance: CGFloat = 0
    var restorePosition: () -> ScriptureReadingPosition? = { nil }
    var savePosition: (ScriptureReadingPosition) -> Void = { _ in }
    var findRequest: Int
    var reference: (Int, Int) -> String
    var onStrongs: (String) -> Void
    var onNotes: (Int) -> Void
    var onVerseTap: (Int) -> Void
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

    func makeUIView(context: Context) -> UITextView {
        let storage = NSTextStorage()
        let layout = OutlineLayoutManager()
        let container = NSTextContainer(size: .zero)
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let view = ReaderTextView(frame: .zero, textContainer: container)
        layout.reader = context.coordinator
        view.reader = context.coordinator
        view.isEditable = false
        view.isSelectable = true
        view.isFindInteractionEnabled = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 16, left: style.width.phoneInset, bottom: 24, right: style.width.phoneInset)
        view.linkTextAttributes = [.underlineStyle: NSUnderlineStyle([]).rawValue]
        view.alwaysBounceVertical = true
        view.accessibilityLabel = "Scripture text"
        view.delegate = context.coordinator

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

    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        guard coordinator.passageId == coordinator.parent.passageId else { return }
        let offset = max(0, view.contentOffset.y + view.adjustedContentInset.top)
        coordinator.parent.savePosition(ScriptureReadingPosition(offset: offset, verse: coordinator.readingAnchor(in: view)?.verse))
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        let shouldFind = coordinator.parent.findRequest != findRequest
        coordinator.parent = self
        if shouldFind {
            DispatchQueue.main.async { [weak view] in
                view?.findInteraction?.presentFindNavigator(showingReplace: false)
            }
        }
        let key = Key(header: header, tags: chapterTags.map { TagKey(name: $0.name, color: $0.color, slot: $0.slot) },
                      verses: verses, style: style, dark: colorScheme == .dark)
        let samePassage = coordinator.passageId == passageId
        let previousSelection = coordinator.renderedSelection
        let revealVerse = samePassage ? selectedVerses.subtracting(previousSelection).max() : nil
        let previousOffset = view.contentOffset
        if view.contentInset.bottom != actionClearance {
            let inset = view.adjustedContentInset
            let oldBottom = view.contentSize.height + inset.bottom - view.bounds.height
            let stayAtEnd = samePassage && oldBottom > -inset.top + 1 && previousOffset.y >= oldBottom - 1
            view.contentInset.bottom = actionClearance
            view.verticalScrollIndicatorInsets.bottom = actionClearance
            if stayAtEnd {
                let newInset = view.adjustedContentInset
                let bottom = max(-newInset.top, view.contentSize.height + newInset.bottom - view.bounds.height)
                view.setContentOffset(CGPoint(x: previousOffset.x, y: bottom), animated: false)
            }
        }
        if key != coordinator.key || !samePassage {
            let selection = view.selectedRange
            let oldText = view.text
            let inset = view.adjustedContentInset
            let previousBottom = view.contentSize.height + inset.bottom - view.bounds.height
            let wasAtEnd = samePassage && previousBottom > -inset.top + 1 && previousOffset.y >= previousBottom - 1
            let readingAnchor = samePassage && !wasAtEnd ? coordinator.readingAnchor(in: view) : nil
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
                if wasAtEnd {
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
                view.selectedRange = NSRange(location: 0, length: 0)
                view.setContentOffset(CGPoint(x: 0, y: -view.adjustedContentInset.top), animated: false)
                coordinator.lastTarget = nil
            }
            coordinator.key = key
            coordinator.passageId = passageId
        }
        if previousSelection != selectedVerses {
            coordinator.updateMarkerColors(in: view.textStorage, changed: previousSelection.symmetricDifference(selectedVerses))
            coordinator.renderedSelection = selectedVerses
        }
        if previousSelection != selectedVerses || !samePassage {
            view.layoutManager.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: view.textStorage.length))
        }
        if let revealVerse, scrollTarget == nil {
            let currentPassage = passageId
            // Reveal the line above the floating actions after layout.
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == currentPassage,
                      coordinator.parent.passageId == currentPassage, coordinator.parent.scrollTarget == nil,
                      coordinator.parent.selectedVerses == selectedVerses,
                      let range = coordinator.verseRanges[revealVerse], range.length > 1 else { return }
                coordinator.layoutThroughEnd(of: range, in: view)
                let inset = view.adjustedContentInset
                let visibleBottom = view.bounds.maxY - inset.bottom
                let overlap = coordinator.lastLineBottom(of: range, in: view) + ReaderFloatingControls.readingGap - visibleBottom
                if overlap > 0 {
                    let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
                    let y = min(view.contentOffset.y + overlap, bottom)
                    view.setContentOffset(CGPoint(x: view.contentOffset.x, y: y), animated: false)
                }
            }
        }
        if !samePassage, scrollTarget == nil {
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == passageId,
                      coordinator.parent.scrollTarget == nil, let position = coordinator.parent.restorePosition() else { return }
                coordinator.layoutThroughEnd(of: NSRange(location: 0, length: view.textStorage.length), in: view)
                let inset = view.adjustedContentInset
                let maximum = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
                let verseTop = position.offset == 0 ? position.verse.flatMap { coordinator.verseRanges[$0] }
                    .flatMap { view.position(from: view.beginningOfDocument, offset: $0.location) }
                    .map { view.caretRect(for: $0).minY } : nil
                let y = position.atEnd ? maximum : min((verseTop ?? position.offset) - inset.top, maximum)
                view.setContentOffset(CGPoint(x: 0, y: y), animated: false)
            }
        }
        if scrollTarget == nil { coordinator.lastTarget = nil }
        if let target = scrollTarget, target != coordinator.lastTarget, let range = coordinator.verseRanges[target] {
            coordinator.lastTarget = target
            let currentPassage = passageId
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == currentPassage,
                      coordinator.parent.scrollTarget == target, coordinator.lastTarget == target,
                      NSMaxRange(range) <= view.textStorage.length else { return }
                let lastRange = coordinator.parent.selectedVerses.max().flatMap { verse in
                    verse >= target ? coordinator.verseRanges[verse] : nil
                }
                coordinator.layoutThroughEnd(of: lastRange.map { NSUnionRange(range, $0) } ?? range, in: view)
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
        let verses: [ReaderVerse]
        let style: ReaderStyle
        let dark: Bool
    }

    final class ReaderTextView: UITextView {
        weak var reader: Coordinator?

        override func copy(_ sender: Any?) {
            if let copy = reader?.plainSelection(in: self) {
                Clipboard.copy(copy)
            } else {
                super.copy(sender)
            }
        }
    }

    private final class OutlineLayoutManager: NSLayoutManager {
        weak var reader: Coordinator?

        override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
            defer { super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin) }
            guard let reader, let container = textContainers.first,
                  !reader.parent.selectedVerses.isEmpty,
                  let context = UIGraphicsGetCurrentContext() else { return }
            context.saveGState()
            defer { context.restoreGState() }
            UIColor.tintColor.withAlphaComponent(ReaderFloatingControls.outlineOpacity).setStroke()
            UIColor.tintColor.withAlphaComponent(ReaderFloatingControls.fillOpacity).setFill()
            for range in selectedVerseRanges(reader.parent.selectedVerses, in: reader.verseRanges) {
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
                outline.setLineDash([4, 3], count: 2, phase: 0)
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
                  let position = view.closestPosition(to: CGPoint(x: view.bounds.midX, y: top)),
                  let verse = verseRanges.first(where: {
                      NSLocationInRange(view.offset(from: view.beginningOfDocument, to: position), $0.value)
                  })?.key,
                  let start = verseRanges[verse]?.location,
                  let marker = view.position(from: view.beginningOfDocument, offset: start) else { return nil }
            let markerY = view.caretRect(for: marker).minY
            guard markerY.isFinite else { return nil }
            return ReadingAnchor(verse: verse, offsetFromTop: markerY - top)
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
        private let chapterPullThreshold: CGFloat = 68

        private func publishChapterPull(_ pull: ChapterPullCue?) {
            guard pull != chapterPull else { return }
            chapterPull = pull
            parent.onChapterPull(pull)
            if pull?.ready == true,
               UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
                selectionFeedback.selectionChanged()
            }
        }

        private func trackChapterPull(_ scrollView: UIScrollView) {
            guard scrollView.isDragging,
                  let view = scrollView as? UITextView, view.selectedRange.length == 0,
                  parent.selectedVerses.isEmpty else {
                if scrollView.isDragging { publishChapterPull(nil) }
                return
            }
            let inset = scrollView.adjustedContentInset
            let top = -inset.top
            let bottom = max(top, scrollView.contentSize.height + inset.bottom - scrollView.bounds.height)
            let offset = scrollView.contentOffset.y
            let direction = offset < top ? -1 : 1
            let distance = direction < 0 ? top - offset : offset - bottom
            guard distance >= 18, parent.canPullChapter(direction) else {
                publishChapterPull(nil)
                return
            }
            publishChapterPull(ChapterPullCue(direction: direction, ready: distance >= chapterPullThreshold))
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            publishChapterPull(nil)
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            let requested = chapterPull
            publishChapterPull(nil)
            guard let requested, requested.ready, parent.canPullChapter(requested.direction) else { return }
            parent.onChapterPullCommit(requested.direction)
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            trackChapterPull(scrollView)
            let y = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
            defer { lastScrollY = y }
            // Only user scrolling moves the chrome; programmatic jumps and restores leave it alone.
            guard scrollView.isTracking || scrollView.isDecelerating else { scrollTravel = 0; return }
            let delta = y - lastScrollY
            scrollTravel = (delta > 0) == (scrollTravel > 0) ? scrollTravel + delta : delta   // hysteresis per direction
            let atTop = y < 40
            let atBottom = y + scrollView.bounds.height >= scrollView.contentSize.height + scrollView.adjustedContentInset.bottom - 8
            let hide: Bool
            if atTop || atBottom { hide = false } else if scrollTravel > 36 { hide = true } else if scrollTravel < -24 { hide = false } else { return }
            guard hide != chromeHidden else { return }
            chromeHidden = hide
            parent.onChromeHidden(hide)
        }

        var passageId: String?
        var lastTarget: Int?
        var verseRanges: [Int: NSRange] = [:]
        var renderedSelection: Set<Int> = []
        private var markerRanges: [Int: NSRange] = [:]

        private func markerColor(_ verse: Int) -> UIColor {
            parent.selectedVerses.contains(verse) ? .tintColor : .tintColor.withAlphaComponent(0.82)
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

        init(_ parent: IOSChapterTextView) { self.parent = parent }

        func render(_ dark: Bool) -> NSAttributedString {
            let out = NSMutableAttributedString()
            verseRanges.removeAll(keepingCapacity: true)
            bodyRanges.removeAll(keepingCapacity: true)
            markerRanges.removeAll(keepingCapacity: true)
            let size = CGFloat(parent.style.fontSize)
            let regular = font(size)
            let italic = regular.fontDescriptor.withSymbolicTraits(.traitItalic).map { UIFont(descriptor: $0, size: size) } ?? UIFont.italicSystemFont(ofSize: size)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = parent.style.lineSpacing
            paragraph.paragraphSpacing = size * 0.55
            if parent.style.showVerseNumbers {
                paragraph.tabStops = [NSTextTab(textAlignment: .right, location: size * 1.25),
                                      NSTextTab(textAlignment: .left, location: size * 1.8)]
                paragraph.headIndent = size * 1.8
            }
            let base: [NSAttributedString.Key: Any] = [.font: regular, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
            if let header = parent.header {
                out.append(NSAttributedString(string: header + "\n", attributes: [
                    .font: UIFont.preferredFont(forTextStyle: .callout), .foregroundColor: UIColor.secondaryLabel, Self.skip: true,
                ]))
            }
            if !parent.chapterTags.isEmpty {
                appendTags(parent.chapterTags, verse: nil, to: out, base: base, dark: dark)
                out.append(NSAttributedString(string: "\n", attributes: [.paragraphStyle: paragraph, Self.skip: true]))
            }
            for verse in parent.verses {
                let start = out.length
                if let title = verse.title, !title.isEmpty {
                    // Titles (Psalm superscriptions, section headings) align with the verse text column, not the gutter.
                    let titleParagraph = (paragraph.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                    titleParagraph.firstLineHeadIndent = paragraph.headIndent
                    titleParagraph.headIndent = paragraph.headIndent
                    titleParagraph.tabStops = []
                    titleParagraph.paragraphSpacing = size * 0.35
                    let titleFont = italic.withSize(size * 0.85)
                    out.append(NSAttributedString(string: title + "\n", attributes: base.merging([
                        .font: titleFont, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: titleParagraph, Self.skip: true,
                    ]) { _, new in new }))
                }
                if parent.style.showVerseNumbers {
                    let number = base.merging([
                        .font: UIFont.monospacedDigitSystemFont(ofSize: max(13, size * 0.75), weight: .semibold),
                        .foregroundColor: markerColor(verse.verse),
                        .link: URL(string: "berean-verse:\(verse.verse)")!, Self.skip: true,
                    ]) { _, new in new }
                    let markerStart = out.length
                    out.append(NSAttributedString(string: "\t\(verse.verse)\t", attributes: number))
                    markerRanges[verse.verse] = NSRange(location: markerStart, length: out.length - markerStart)
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
                if verse.noteCount > 0 {
                    out.append(NSAttributedString(string: verse.noteCount > 1 ? "  ●\(verse.noteCount)" : "  ●",
                        attributes: base.merging([.font: UIFont.systemFont(ofSize: max(8, size * 0.5)),
                                                  .foregroundColor: UIColor.tintColor, .link: URL(string: "berean-verse-notes:\(verse.verse)")!, Self.skip: true]) { _, new in new }))
                }
                appendTags(verse.tags, verse: verse.verse, to: out, base: base, dark: dark)
                out.append(NSAttributedString(string: "\n", attributes: base))
                verseRanges[verse.verse] = NSRange(location: start, length: out.length - start)
            }
            return out
        }

        private func font(_ size: CGFloat) -> UIFont {
            let system = UIFont.systemFont(ofSize: size)
            switch parent.style.family {
            case "serif": return UIFont(name: "Georgia", size: size) ?? system
            case "palatino": return UIFont(name: "Palatino-Roman", size: size) ?? system
            case "mono": return UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
            case "garamond", "crimson", "lora", "merriweather", "sourceserif":
                return system.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? system
            default: return system
            }
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
            case "berean-verse":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) else { return nil }
                let title = parent.selectedVerses.contains(verse) ? "Deselect Verse \(verse)" : "Select Verse \(verse)"
                return UIAction(title: title) { [weak self, weak textView] _ in
                    guard let textView else { return }
                    self?.toggleVerse(verse, in: textView)
                }
            case "berean-verse-notes":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse-notes:".count)) else { return nil }
                return UIAction { [weak self] _ in self?.parent.onNotes(verse) }
            case "strongs":
                let id = String(url.absoluteString.dropFirst("strongs:".count))
                return UIAction { [weak self] _ in self?.parent.onStrongs(id) }
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
            // The link's tap opens an in-app destination. Avoid system preview/copy-link for internal URLs.
            nil
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
            let selection = textView.selectedRange
            let trimmed = readerTextSelection(selection, in: textView.textStorage, excluding: Self.skip)
            guard trimmed != selection else { return }
            if trimmed.length == 0 { textView.selectedTextRange = nil }
            else { textView.selectedRange = trimmed }
        }

        func textView(_ view: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            if isVerseMarkerSelection(range, in: view) { return UIMenu(children: []) }
            let portions = portions(in: range, storage: view.textStorage)
            guard let first = portions.first, let last = portions.last else { return nil }
            let text = plainText(portions)
            let copy = UIAction(title: "Copy Text", image: UIImage(systemName: "doc.on.doc")) { _ in Clipboard.copy(text) }
            let reference = parent.reference(first.0.verse, last.0.verse)
            let copyWithReference = UIAction(title: "Copy with Reference", image: UIImage(systemName: "number")) { _ in
                let lines = portions.map { "\($0.0.verse) \($0.1.trimmingCharacters(in: .whitespacesAndNewlines))" }
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

        private func verseAtTap(_ point: CGPoint, in view: UITextView) -> Int? {
            if let verse = verseInGutter(point, in: view) { return verse }
            guard view.selectedRange.length == 0 else { return nil }
            let container = view.textContainer
            let layout = view.layoutManager
            let inset = view.textContainerInset
            let location = CGPoint(x: point.x - inset.left, y: point.y - inset.top)
            let glyph = layout.glyphIndex(for: location, in: container)
            guard glyph < layout.numberOfGlyphs,
                  layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(location) else { return nil }
            let index = layout.characterIndexForGlyph(at: glyph)
            guard index < view.textStorage.length,
                  view.textStorage.attribute(.link, at: index, effectiveRange: nil) == nil else { return nil }
            return bodyRanges.first { NSLocationInRange(index, $0.value) }?.key
        }

        @objc func tapVerse(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view as? UITextView else { return }
            let point = gesture.location(in: view)
            if let verse = verseAtTap(point, in: view) { toggleVerse(verse, in: view); return }
            if let step = edgeStep(point, in: view) {
                if UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true { selectionFeedback.selectionChanged() }
                parent.onStep(step)
            }
        }

        /// A tap in the empty outer margin turns the chapter (left = previous, right = next), as in the original reader.
        /// Only when nothing is selected, so a mis-tap never throws away a selection.
        private func edgeStep(_ point: CGPoint, in view: UITextView) -> Int? {
            guard parent.selectedVerses.isEmpty, view.selectedRange.length == 0 else { return nil }
            let x = point.x - view.bounds.minX
            let zone: CGFloat = 30
            if x < zone { return -1 }
            if x > view.bounds.width - zone { return 1 }
            return nil
        }

        private func toggleVerse(_ verse: Int, in view: UITextView) {
            view.selectedTextRange = nil
            parent.onVerseTap(verse)
            if UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true { selectionFeedback.selectionChanged() }
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard gesture is UITapGestureRecognizer, let view = gesture.view as? UITextView else { return true }
            let point = touch.location(in: view)
            return verseAtTap(point, in: view) != nil || edgeStep(point, in: view) != nil
        }

        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let view = gesture.view as? UITextView else { return false }
            if gesture is UITapGestureRecognizer { return true }
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
