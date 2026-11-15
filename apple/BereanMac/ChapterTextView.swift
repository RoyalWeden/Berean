import SwiftUI
import AppKit

/// Only a direct, phased trackpad gesture can trigger chapter navigation.
private final class ChapterPullScrollView: NSScrollView {
    var reader: ChapterTextView.Coordinator?
    private var travel: CGFloat = 0
    private var pull: ChapterPullCue?

    private func publish(_ cue: ChapterPullCue?) {
        guard cue != pull else { return }
        pull = cue
        reader?.parent?.onChapterPull(cue)
    }

    override func scrollWheel(with event: NSEvent) {
        if event.phase.contains(.cancelled) || event.phase.contains(.began) {
            travel = 0
            publish(nil)
        }

        if event.phase.contains(.ended) {
            let requested = pull
            travel = 0
            publish(nil)
            super.scrollWheel(with: event)
            if let requested, requested.ready, let parent = reader?.parent,
               parent.canPullChapter(requested.direction) {
                parent.onChapterPullCommit(requested.direction)
            }
            return
        }

        if event.hasPreciseScrollingDeltas, event.momentumPhase.isEmpty, event.phase.contains(.changed),
           let reader, let parent = reader.parent, let text = reader.textView,
           text.selectedRange().length == 0, parent.selectedVerses.isEmpty {
            let delta = event.scrollingDeltaY
            let bounds = contentView.bounds
            let top = text.frame.minY
            let bottom = max(top, text.frame.maxY - bounds.height)
            let direction = delta > 0 ? -1 : 1
            let againstEdge = direction < 0 ? bounds.minY <= top + 2 : bounds.minY >= bottom - 2
            let vertical = abs(delta) > abs(event.scrollingDeltaX)
            if againstEdge, vertical, parent.canPullChapter(direction) {
                if (travel > 0) != (delta > 0) { travel = 0 }
                travel += delta
                let distance = abs(travel)
                publish(distance >= 18 ? ChapterPullCue(direction: direction, ready: distance >= 112) : nil)
            } else {
                travel = 0
                publish(nil)
            }
        }

        super.scrollWheel(with: event)
    }
}

/// The Mac Scripture reader: ONE TextKit text view for the whole chapter, so a selection can run across verses
/// (VERSE rows as separate SwiftUI Texts could not). Verse numbers, Strong's numbers and tag chips are links with
/// a pointing-hand cursor and a hover tint; right-click gives the verse actions; ⌘C copies like the existing
/// app (several verses → "Book c:v1-v2" + numbered lines; ⌘⇧C → plain text on one line).
struct ChapterTextView: NSViewRepresentable {
    var passageId = ""                       // text|book|chapter — scroll position is kept only within one passage
    var header: [String] = []                       // versification note, etc.
    var chapterTags: [(name: String, color: String?, slot: Int?)] = []
    var verses: [ReaderVerse]
    var style: ReaderStyle
    var selectedVerses: Set<Int> = []
    var scrollTarget: Int?
    var actionClearance: CGFloat = 0
    var animateOutline = true
    var scrollRevision: UUID?
    var titleBarClearance: CGFloat = 0
    var restorePosition: () -> ScriptureReadingPosition? = { nil }
    var savePosition: (ScriptureReadingPosition) -> Void = { _ in }
    var selectedVerseCopyText: (Bool) -> String?
    var rangeReference: (Int, Int) -> String        // first, last → "John 3:16-18"
    var verseMenu: (Int) -> NSMenu
    var tagMenu: (String, Int?) -> NSMenu           // tag name, verse (nil = chapter tag)
    var strongsTooltips: [String: String] = [:]
    var onStrongs: (String) -> Void
    var onNotes: (Int) -> Void
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
        scroll.automaticallyAdjustsContentInsets = false
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
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
        tv.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        tv.delegate = context.coordinator
        tv.coordinator = context.coordinator
        tv.setAccessibilityLabel("Scripture text")
        tv.usesFindBar = true                     // ⌘F: find in chapter with match navigation (the original's find bar)
        tv.isIncrementalSearchingEnabled = true
        scroll.documentView = tv
        scroll.findBarPosition = .aboveContent
        context.coordinator.textView = tv
        return scroll
    }

    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        guard let parent = coordinator.parent, coordinator.lastPassage == parent.passageId else { return }
        let top = scroll.contentView.bounds.minY
        let offset = max(0, top - scroll.contentView.documentRect.minY)
        let verse = coordinator.textView.flatMap { coordinator.readingAnchor(at: top, in: $0)?.verse }
        parent.savePosition(ScriptureReadingPosition(offset: offset, verse: verse, selectedVerses: parent.selectedVerses,
                                                      returnEdition: coordinator.editionArrival?.returnEdition(at: offset)))
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let c = context.coordinator
        c.parent = self
        guard let tv = c.textView else { return }
        tv.titleBarClearance = titleBarClearance
        tv.updateOutlineMotion()
        let clip = scroll.contentView
        if scroll.contentInsets.bottom != actionClearance {
            let bounds = clip.bounds
            let end = clip.constrainBoundsRect(bounds.offsetBy(dx: 0, dy: clip.documentRect.height)).minY
            let stayAtEnd = c.lastPassage == passageId && end > clip.documentRect.minY + 1 && bounds.minY >= end - 1
            scroll.contentInsets.bottom = actionClearance
            scroll.scrollerInsets.bottom = actionClearance
            var destination = bounds
            if stayAtEnd { destination.origin.y = clip.documentRect.maxY + actionClearance }
            clip.scroll(to: clip.constrainBoundsRect(destination).origin)
            scroll.reflectScrolledClipView(clip)
        }
        let previousBounds = clip.bounds
        let passageChanged = c.lastPassage != passageId
        let revealVerse = c.lastPassage == passageId
            ? selectedVerses.subtracting(c.renderedSelection).max() : nil
        let key = Key(header: header, chapterTags: chapterTags.map(\.name), verses: verses, style: style, tooltips: strongsTooltips)
        if key != c.lastKey || c.lastPassage != passageId {
            let keepScroll = c.lastPassage == passageId
            let origin = previousBounds.origin
            let readingAnchor = keepScroll ? c.readingAnchor(at: origin.y, in: tv) : nil
            let previousBottom = clip.constrainBoundsRect(previousBounds.offsetBy(dx: 0, dy: clip.documentRect.height)).minY
            let wasAtEnd = keepScroll && previousBottom > clip.documentRect.minY + 1
                && origin.y >= previousBottom - 1
            let sel = tv.selectedRanges
            let previousText = tv.string
            tv.readerWidth = style.width
            tv.textStorage?.setAttributedString(c.build(self))
            tv.needsDisplay = true
            if keepScroll {
                // Character ranges use UTF-16 offsets, so even canonically equal text can invalidate them.
                let kept = previousText.utf16.elementsEqual(tv.string.utf16) ? sel : []
                tv.selectedRanges = kept.isEmpty ? [NSValue(range: NSRange(location: 0, length: 0))] : kept
                var proposed = previousBounds
                if wasAtEnd, let container = tv.textContainer {
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
        if c.renderedSelection != selectedVerses {
            if let storage = tv.textStorage {
                c.updateMarkerColors(in: storage, changed: c.renderedSelection.symmetricDifference(selectedVerses))
            }
            c.renderedSelection = selectedVerses
            tv.needsDisplay = true
        }
        if let revealVerse, scrollTarget == nil {
            let destination = passageId
            // Reveal the line above the floating actions after layout.
            DispatchQueue.main.async { [weak tv, weak scroll, weak c] in
                guard let tv, let scroll, let c, c.lastPassage == destination,
                      c.parent.passageId == destination, c.parent.scrollTarget == nil,
                      c.parent.selectedVerses == selectedVerses,
                      let range = c.verseRanges[revealVerse],
                      let container = tv.textContainer else { return }
                tv.layoutManager?.ensureLayout(for: container)
                guard let bottom = tv.lastVerseLineBottom(in: range) else { return }
                let clip = scroll.contentView
                let lineBottom = tv.convert(NSPoint(x: 0, y: bottom), to: clip).y
                let overlap = lineBottom + ReaderFloatingControls.readingGap - (clip.bounds.maxY - c.parent.actionClearance)
                if overlap > 0 {
                    var proposed = clip.bounds
                    proposed.origin.y += overlap
                    clip.scroll(to: clip.constrainBoundsRect(proposed).origin)
                    scroll.reflectScrolledClipView(clip)
                }
            }
        }
        if passageChanged, scrollTarget == nil {
            DispatchQueue.main.async { [weak tv, weak scroll, weak c] in
                guard let tv, let scroll, let c, c.lastPassage == passageId,
                      c.parent?.scrollTarget == nil, let position = c.parent?.restorePosition(),
                      let container = tv.textContainer else { return }
                tv.layoutManager?.ensureLayout(for: container)
                let clip = scroll.contentView
                var bounds = clip.bounds
                let verseTop = position.offset == 0 ? position.verse.flatMap { c.verseRanges[$0] }
                    .flatMap { tv.firstVerseLineTop(in: $0) }
                    .map { tv.convert(NSPoint(x: 0, y: $0), to: clip).y - tv.visibleTitleBarClearance - 12 } : nil
                bounds.origin.y = position.atEnd ? clip.documentRect.maxY : verseTop ?? (clip.documentRect.minY + position.offset)
                clip.scroll(to: clip.constrainBoundsRect(bounds).origin)
                scroll.reflectScrolledClipView(clip)
                c.editionArrival = position.returnEdition.map {
                    ScriptureEditionArrival(edition: $0, offset: max(0, clip.bounds.minY - clip.documentRect.minY))
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
                guard let tv, let scroll, let c,
                      c.parent.passageId == destination, c.parent.scrollTarget == target,
                      c.scrolledTo == request, c.parent.selectedVerses.max() == request.lastSelectedVerse,
                      let range = c.verseRanges[target], let container = tv.textContainer else { return }
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

    struct Key: Equatable {
        var header: [String]; var chapterTags: [String]; var verses: [ReaderVerse]; var style: ReaderStyle; var tooltips: [String: String]
    }

    // MARK: - Coordinator: builds the text, routes clicks, copies

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChapterTextView!
        weak var textView: ReaderTextView?
        var lastKey: Key?
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
            return reader.selectedVerses.contains(verse) ? .controlAccentColor : NSColor.controlAccentColor.withAlphaComponent(0.82)
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
            let s = CGFloat(size)
            var f: NSFont
            switch parent.style.family {
            case "serif": f = NSFont(name: "Georgia", size: s) ?? .systemFont(ofSize: s)
            case "palatino": f = NSFont(name: "Palatino", size: s) ?? .systemFont(ofSize: s)
            case "mono": f = .monospacedSystemFont(ofSize: s, weight: .regular)
            case "garamond", "crimson", "lora", "merriweather", "sourceserif":
                f = NSFont(descriptor: NSFont.systemFont(ofSize: s).fontDescriptor.withDesign(.serif) ?? NSFont.systemFont(ofSize: s).fontDescriptor, size: s) ?? .systemFont(ofSize: s)
            default: f = .systemFont(ofSize: s)
            }
            if italic { f = NSFontManager.shared.convert(f, toHaveTrait: .italicFontMask) }
            return f
        }

        func build(_ p: ChapterTextView) -> NSAttributedString {
            let out = NSMutableAttributedString()
            verseRanges = [:]; verseTextStarts = [:]
            markerRanges.removeAll(keepingCapacity: true)
            let size = p.style.fontSize
            let para = NSMutableParagraphStyle()
            para.lineSpacing = p.style.lineSpacing
            para.paragraphSpacing = size * 0.55
            let gutterWidth: CGFloat = p.style.showVerseNumbers ? 34 : 0
            if p.style.showVerseNumbers {
                para.tabStops = [NSTextTab(textAlignment: .right, location: 26), NSTextTab(textAlignment: .left, location: gutterWidth)]
                para.headIndent = gutterWidth
            }
            let base: [NSAttributedString.Key: Any] = [.font: font(size), .foregroundColor: NSColor.labelColor, .paragraphStyle: para]

            let headPara = NSMutableParagraphStyle(); headPara.paragraphSpacing = 10; headPara.headIndent = gutterWidth; headPara.firstLineHeadIndent = gutterWidth
            for h in p.header {
                out.append(NSAttributedString(string: h + "\n", attributes: [.font: NSFont.preferredFont(forTextStyle: .callout), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: headPara, Self.skipKey: true]))
            }
            if !p.chapterTags.isEmpty {
                let line = NSMutableAttributedString()
                for (i, t) in p.chapterTags.enumerated() { if i > 0 { line.append(NSAttributedString(string: "  ")) }; line.append(chip(t, verse: nil)) }
                line.addAttributes([.paragraphStyle: headPara, Self.skipKey: true], range: NSRange(location: 0, length: line.length))
                line.append(NSAttributedString(string: "\n", attributes: [.paragraphStyle: headPara]))
                out.append(line)
            }

            for v in p.verses {
                let start = out.length
                if let title = v.title, !title.isEmpty {
                    let prefix = p.style.showVerseNumbers ? "\t\t" : ""
                    out.append(NSAttributedString(string: prefix + title + "\n", attributes: base.merging([.font: font(size * 0.85, italic: true), .foregroundColor: NSColor.secondaryLabelColor, Self.skipKey: true]) { $1 }))
                }
                if p.style.showVerseNumbers {
                    // Gutter: right-aligned verse number (a link → verse actions), note dot.
                    let numAttrs: [NSAttributedString.Key: Any] = [
                        .font: NSFont.monospacedDigitSystemFont(ofSize: max(10, size * 0.62), weight: .semibold),
                        .foregroundColor: markerColor(v.verse, p),
                        .link: URL(string: "berean-verse:\(v.verse)")!, .paragraphStyle: para, Self.skipKey: true,
                        .toolTip: "Verse \(v.verse) — click to select (⇧-click for a range); right-click for highlight, tag, note, copy…",
                    ]
                    // The whole gutter (both tabs and the number) is the verse-number target, so single digits are easy to hit.
                    let gutterTab = numAttrs.merging([.font: NSFont.systemFont(ofSize: CGFloat(size))]) { $1 }
                    let markerStart = out.length
                    out.append(NSAttributedString(string: "\t", attributes: gutterTab))
                    out.append(NSAttributedString(string: "\(v.verse)", attributes: numAttrs))
                    out.append(NSAttributedString(string: "\t", attributes: gutterTab))
                    markerRanges[v.verse] = NSRange(location: markerStart, length: out.length - markerStart)
                }
                let textStart = out.length
                verseTextStarts[v.verse] = textStart
                // Words with italics / red letters / character highlights; Strong's numbers as superscript links.
                var pos = 0
                for (i, w) in v.words.enumerated() {
                    if i > 0 {
                        var a = base
                        if let m = v.marks.last(where: { $0.start <= pos && pos < $0.end }) { a[.backgroundColor] = NSColor(Color.highlight(m.color)).withAlphaComponent(0.35) }
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
                        out.append(NSAttributedString(string: String(decoding: units[k..<j], as: UTF16.self), attributes: a))
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
                if v.noteCount > 0 {
                    out.append(NSAttributedString(string: v.noteCount > 1 ? "  ●\(v.noteCount)" : "  ●", attributes: [.font: NSFont.systemFont(ofSize: max(8, size * 0.5)), .foregroundColor: NSColor.controlAccentColor, .paragraphStyle: para, Self.skipKey: true, .link: URL(string: "berean-verse-notes:\(v.verse)")!, .toolTip: "Open notes for verse \(v.verse) (\(v.noteCount))"]))
                }
                if v.citationCount > 0 {
                    let sizeScale: CGFloat = v.citationCount >= 5 ? 0.72 : v.citationCount >= 2 ? 0.62 : 0.52
                    out.append(NSAttributedString(string: "  ↗", attributes: [
                        .font: NSFont.systemFont(ofSize: max(9, size * sizeScale), weight: .semibold),
                        .foregroundColor: NSColor.controlAccentColor, .paragraphStyle: para, Self.skipKey: true,
                        .link: URL(string: "berean-verse-citations:\(v.verse)")!,
                        .toolTip: v.citationPreview ?? "Open note cross references",
                    ]))
                }
                if !v.tags.isEmpty {
                    out.append(NSAttributedString(string: "  ", attributes: base.merging([Self.skipKey: true]) { $1 }))
                    for (i, t) in v.tags.enumerated() { if i > 0 { out.append(NSAttributedString(string: " ", attributes: [Self.skipKey: true])) }; out.append(chip(t, verse: v.verse)) }
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
                parent.onStrongs(String(url.absoluteString.dropFirst("strongs:".count)))
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
            let vs = verses(in: r)
            if vs.count <= 1 && !plain { return plainText(r) }
            let texts = vs.compactMap { v in parent.verses.first { $0.verse == v } }
            if plain { return vs.count <= 1 ? plainText(r) : texts.map(\.displayText).joined(separator: " ") }
            let head = parent.rangeReference(vs.first!, vs.last!)
            return ([head] + texts.map { "\($0.verse) \($0.displayText)" }).joined(separator: "\n")
        }
    }
}

/// NSTextView with verse-aware context menu, copy and link hover underline.
final class ReaderTextView: NSTextView {
    weak var coordinator: ChapterTextView.Coordinator?
    private let outlineMotion = ReaderOutlineMotion()

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
    }

    private var hovered: NSRange?
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
        for range in selectedVerseRanges(c.parent.selectedVerses, in: c.verseRanges) {
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
        window?.makeFirstResponder(self)
        // A single click on a link (verse number, Strong's number, tag chip) acts like a button; anything else is text
        // selection. (The built-in link handling did not fire for these custom-scheme links inside SwiftUI.)
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

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t); tracking = t
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

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        guard let lm = layoutManager, let ts = textStorage else { return }
        let hitsLink = charIndex(at: event, includeVerseGutter: true).map {
            $0 < ts.length && ts.attribute(.link, at: $0, effectiveRange: nil) != nil
        } ?? false
        var newRange: NSRange?
        if let index = charIndex(at: event), index < ts.length {
            let character = (ts.string as NSString).character(at: index)
            var link = NSRange()
            if character != 9, ts.attribute(.link, at: index, effectiveRange: &link) != nil {
                // The tabs on either side of a verse number enlarge the click target only.
                let string = ts.string as NSString
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
        if hitsLink { NSCursor.pointingHand.set() }
        if newRange != hovered {
            if let h = hovered, NSMaxRange(h) <= ts.length { lm.removeTemporaryAttribute(.backgroundColor, forCharacterRange: h) }
            if let n = newRange { lm.addTemporaryAttribute(.backgroundColor, value: NSColor.controlAccentColor.withAlphaComponent(0.14), forCharacterRange: n) }
            hovered = newRange
        }
    }

    override func mouseExited(with event: NSEvent) {
        if let h = hovered, let ts = textStorage, NSMaxRange(h) <= ts.length { layoutManager?.removeTemporaryAttribute(.backgroundColor, forCharacterRange: h) }
        hovered = nil
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let c = coordinator, let i = charIndex(at: event), let v = c.verse(at: i) else { return super.menu(for: event) }
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
        if mods == [.command], event.charactersIgnoringModifiers?.lowercased() == "f" {
            let item = NSMenuItem(); item.tag = NSTextFinder.Action.showFindInterface.rawValue
            performFindPanelAction(item); return true
        }
        if event.charactersIgnoringModifiers?.lowercased() == "g",
           mods == [.command] || mods == [.command, .shift] {
            let item = NSMenuItem()
            item.tag = (mods.contains(.shift) ? NSTextFinder.Action.previousMatch : .nextMatch).rawValue
            performFindPanelAction(item)
            return true
        }
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



