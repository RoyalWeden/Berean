import Foundation
#if os(macOS)
import AppKit
typealias ReaderBackgroundColor = NSColor

/// Late hover metadata must not replace the chapter or reset native selection.
func updateReaderStrongsTooltips(_ storage: NSTextStorage, values: [String: String]) {
    storage.beginEditing()
    storage.enumerateAttribute(.link, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
        guard let url = value as? URL, url.scheme == "strongs" else { return }
        let id = String(url.absoluteString.dropFirst("strongs:".count))
        storage.addAttribute(.toolTip, value: values[id] ?? "Strong's \(id) — open in the lexicon", range: range)
    }
    storage.endEditing()
}
#else
import UIKit
typealias ReaderBackgroundColor = UIColor
#endif

/// Keep native character selection and saved highlights on readable glyphs.
/// TextKit's default paragraph fills can include the hanging indent, gutter,
/// newline and trailing line space even when those characters are not copied.
class ReaderTextLayoutManager: NSLayoutManager {
    private var backgroundOrigin = CGPoint.zero
    private let skip = NSAttributedString.Key("bereanSkip")
    @MainActor private var findDrawing = FindDrawing()

    private struct FindDrawing: Sendable {
        var matches: [[NSRange]] = []
        var current: Int?

        var currentRanges: [NSRange] { current.map { matches[$0] } ?? [] }

        var coverage: NSRange? {
            guard let first = matches.first?.first, let last = matches.last?.last else { return nil }
            return NSUnionRange(first, last)
        }
    }

    @MainActor func setFindMatches(_ matches: [[NSRange]], current: Int?) {
        let previous = findDrawing
        findDrawing = FindDrawing(matches: matches, current: current.flatMap { matches.indices.contains($0) ? $0 : nil })
        guard let storage = textStorage else { return }
        let dirty: [NSRange]
        if previous.matches != matches {
            dirty = [previous.coverage, findDrawing.coverage].compactMap { $0 }
        } else if previous.current != findDrawing.current {
            dirty = previous.currentRanges + findDrawing.currentRanges
        } else {
            return
        }
        let valid = NSRange(location: 0, length: storage.length)
        for range in dirty {
            let changed = NSIntersectionRange(range, valid)
            if changed.length > 0 { invalidateDisplay(forCharacterRange: changed) }
        }
    }

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        let previous = backgroundOrigin
        backgroundOrigin = origin
        defer { backgroundOrigin = previous }
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        drawFindMatches(forGlyphRange: glyphsToShow, at: origin)
    }

    private func drawFindMatches(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        let drawing = MainActor.assumeIsolated { findDrawing }
        guard !drawing.matches.isEmpty, glyphsToShow.length > 0, let container = textContainers.first else { return }
        let visibleCharacters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        #if os(macOS)
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        #else
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.saveGState()
        defer { context.restoreGState() }
        #endif
        for (index, match) in drawing.matches.enumerated() {
            guard let first = match.first, let last = match.last else { continue }
            if first.location >= visibleCharacters.upperBound { break }
            guard last.upperBound > visibleCharacters.location else { continue }
            let active = index == drawing.current
            let color = active ? ReaderBackgroundColor.systemOrange.withAlphaComponent(0.48)
                : ReaderBackgroundColor.systemYellow.withAlphaComponent(0.20)
            color.setFill()
            for range in match {
                let characters = NSIntersectionRange(range, visibleCharacters)
                guard characters.length > 0 else { continue }
                let glyphs = glyphRange(forCharacterRange: characters, actualCharacterRange: nil)
                let visible = NSIntersectionRange(glyphs, glyphsToShow)
                guard visible.length > 0 else { continue }
                enumerateEnclosingRects(forGlyphRange: visible, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
                                        in: container) { rect, _ in
                    let bounds = rect.offsetBy(dx: origin.x, dy: origin.y)
                    #if os(macOS)
                    NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
                    #else
                    UIBezierPath(roundedRect: bounds, cornerRadius: 2).fill()
                    #endif
                }
            }
        }
    }

    override func fillBackgroundRectArray(_ rectArray: UnsafePointer<CGRect>, count rectCount: Int,
                                          forCharacterRange charRange: NSRange, color: ReaderBackgroundColor) {
        guard let storage = textStorage, let container = textContainers.first,
              charRange.location != NSNotFound, charRange.location <= storage.length,
              charRange.length <= storage.length - charRange.location else {
            super.fillBackgroundRectArray(rectArray, count: rectCount, forCharacterRange: charRange, color: color)
            return
        }
        let source = storage.string as NSString
        let ink = CharacterSet.whitespacesAndNewlines.inverted
        storage.enumerateAttribute(skip, in: charRange) { excluded, run, _ in
            guard run.length > 0 else { return }
            let tag = (storage.attribute(.link, at: run.location, effectiveRange: nil) as? URL)?.scheme == "berean-tag"
            let tagColor = storage.attribute(.backgroundColor, at: run.location, effectiveRange: nil) as? ReaderBackgroundColor
            var decoration = excluded != nil && tag && tagColor?.isEqual(color) == true
            #if os(macOS)
            let hoverColor = self.temporaryAttribute(.backgroundColor, atCharacterIndex: run.location, effectiveRange: nil) as? NSColor
            decoration = decoration || (excluded != nil && hoverColor?.isEqual(color) == true)
            #endif
            guard excluded == nil || decoration else { return }
            let glyphs = self.glyphRange(forCharacterRange: run, actualCharacterRange: nil)
            self.enumerateLineFragments(forGlyphRange: glyphs) { _, usedRect, _, lineGlyphs, _ in
                let part = NSIntersectionRange(glyphs, lineGlyphs)
                guard part.length > 0 else { return }
                let characters = NSIntersectionRange(run, self.characterRange(forGlyphRange: part, actualGlyphRange: nil))
                let first = source.rangeOfCharacter(from: ink, range: characters)
                guard first.location != NSNotFound else { return }
                let last = source.rangeOfCharacter(from: ink, options: .backwards, range: characters)
                let visible = decoration ? characters : NSRange(location: first.location, length: NSMaxRange(last) - first.location)
                let visibleGlyphs = self.glyphRange(forCharacterRange: visible, actualCharacterRange: nil)
                let glyphBounds = self.boundingRect(forGlyphRange: visibleGlyphs, in: container)
                let bounds = CGRect(x: glyphBounds.minX, y: usedRect.minY,
                                    width: glyphBounds.width, height: usedRect.height)
                    .offsetBy(dx: self.backgroundOrigin.x, dy: self.backgroundOrigin.y)
                // Derive the fill from the character range, rather than the
                // paragraph rectangles (which deliberately include blank space).
                // TextKit's drawing context already clips the visible region.
                guard !bounds.isEmpty else { return }
                #if os(macOS)
                NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
                #else
                UIBezierPath(roundedRect: bounds, cornerRadius: 2).fill()
                #endif
            }
        }
    }
}

/// Reflow anchors count only body UTF-16 units. Inline Strong's links and
/// annotation chips can change length without changing the word being read.
struct ReaderBodyReflowAnchor {
    let verse: Int
    let bodyOffset: Int
    let offsetFromTop: CGFloat
}

func readerBodyStorageIndex(in text: NSAttributedString, range: NSRange, offset: Int) -> Int? {
    guard range.location != NSNotFound, range.location >= 0, range.length >= 0, range.location <= text.length,
          range.length <= text.length - range.location, offset >= 0 else { return nil }
    var remaining = offset
    var result: Int?
    var last: Int?
    text.enumerateAttribute(NSAttributedString.Key("bereanSkip"), in: range) { skipped, run, stop in
        guard skipped == nil, run.length > 0 else { return }
        last = NSMaxRange(run) - 1
        if remaining < run.length {
            // TextKit may return a UTF-16 position inside an emoji or combining
            // sequence. Anchor its first character rather than a surrogate.
            let index = run.location + remaining
            result = max(run.location, (text.string as NSString).rangeOfComposedCharacterSequence(at: index).location)
            stop.pointee = true
        } else { remaining -= run.length }
    }
    return result ?? last.map {
        max(range.location, (text.string as NSString).rangeOfComposedCharacterSequence(at: $0).location)
    }
}

func readerBodyOffset(in text: NSAttributedString, range: NSRange, index: Int) -> Int? {
    guard range.location != NSNotFound, range.location >= 0, range.length >= 0, range.location <= text.length,
          range.length <= text.length - range.location else { return nil }
    let end = min(max(index, range.location), NSMaxRange(range))
    var offset = 0
    text.enumerateAttribute(NSAttributedString.Key("bereanSkip"),
                            in: NSRange(location: range.location, length: end - range.location)) { skipped, run, _ in
        if skipped == nil { offset += run.length }
    }
    return offset
}

/// Compare selection is local to a column/passage, never translated through
/// the anchor tab's edition. Shift ranges follow actual displayed row order.
struct ReaderVerseSelection: Equatable {
    private(set) var scope: String?
    private(set) var verses: Set<Int> = []
    private(set) var anchor: Int?
    private(set) var focus: Int?

    mutating func replace(scope: String, verses: Set<Int>, focus: Int?, ordered: [Int]) {
        self.scope = scope
        self.verses = verses.intersection(ordered)
        self.focus = focus.flatMap { self.verses.contains($0) ? $0 : nil } ?? ordered.first(where: self.verses.contains)
        anchor = self.focus
    }

    mutating func restore(_ saved: Self, scope: String, ordered: [Int]) {
        replace(scope: scope, verses: saved.verses, focus: saved.focus, ordered: ordered)
        anchor = saved.anchor.flatMap { ordered.contains($0) ? $0 : nil } ?? focus
    }

    mutating func toggle(_ verse: Int, scope: String, ordered: [Int], extend: Bool) {
        guard let target = ordered.firstIndex(of: verse) else { return }
        if self.scope != scope { self = Self(); self.scope = scope }
        verses.formIntersection(ordered)
        if extend, let anchor, let start = ordered.firstIndex(of: anchor) {
            verses = Set(ordered[min(start, target)...max(start, target)])
            focus = verse
        } else {
            if verses.contains(verse) { verses.remove(verse) } else { verses.insert(verse) }
            focus = verses.contains(verse) ? verse : ordered.first(where: verses.contains)
            anchor = focus
        }
    }
}

/// Stacked Compare interleaves editions. Never draw one selection outline
/// through an intervening verse from another column, even for adjacent IDs.
func readerJoinedSelectionRectangles(_ rectangles: [CGRect], obstacles: [CGRect]) -> [CGRect] {
    var joined: [CGRect] = []
    for rect in rectangles.sorted(by: { $0.minY < $1.minY }) where !rect.isEmpty {
        guard let previous = joined.last else { joined.append(rect); continue }
        let left = max(previous.minX, rect.minX), right = min(previous.maxX, rect.maxX)
        let gap = CGRect(x: left, y: previous.maxY, width: max(0, right - left), height: max(0, rect.minY - previous.maxY))
        if right > left, !obstacles.contains(where: { !$0.intersection(gap).isEmpty }) {
            joined[joined.count - 1] = previous.union(rect)
        } else { joined.append(rect) }
    }
    return joined
}

/// Visual adjacency follows the rendered rows, not arithmetic on persisted IDs.
/// An actual row without a layout range still breaks a group.
func readerSelectionRuns(_ selection: Set<Int>, in orderedVerses: [Int], available: Set<Int>) -> [[Int]] {
    var runs: [[Int]] = []
    var current: [Int] = []
    for verse in orderedVerses {
        if selection.contains(verse), available.contains(verse) {
            current.append(verse)
        } else if !current.isEmpty {
            runs.append(current)
            current = []
        }
    }
    if !current.isEmpty { runs.append(current) }
    return runs
}

/// Distinguish deliberate verse taps from native word selection without making
/// our tap recognizer compete with UITextView's private gesture dependencies.
struct ReaderBodyTapIntent {
    struct Completion: Equatable {
        let verse: Int
        let rejectsNativeSelection: Bool
    }
    private struct Tap {
        let verse: Int
        let point: CGPoint
        let time: TimeInterval
        let marker: Bool
    }
    private struct Candidate {
        let tap: Tap
        let permitsWordSelection: Bool
    }
    private var candidate: Candidate?
    private var previous: Tap?
    static let maximumTapDuration: TimeInterval = 0.45
    static let doubleTapInterval: TimeInterval = 0.5

    mutating func begin(verse: Int?, point: CGPoint, time: TimeInterval, hasNativeSelection: Bool) {
        candidate = nil
        guard !hasNativeSelection, let verse else {
            if hasNativeSelection { previous = nil }
            return
        }
        let wordIntent = previous.map {
            !$0.marker && $0.verse == verse && (0...Self.doubleTapInterval).contains(time - $0.time)
                && distance($0.point, point) <= 24
        } ?? false
        candidate = Candidate(tap: Tap(verse: verse, point: point, time: time, marker: false), permitsWordSelection: wordIntent)
    }

    mutating func move(to point: CGPoint) {
        if let candidate, distance(candidate.tap.point, point) > 10 { self.candidate = nil }
    }

    func rejectsNativeSelection(at time: TimeInterval) -> Bool {
        guard let candidate else { return false }
        return !candidate.permitsWordSelection && (0...Self.maximumTapDuration).contains(time - candidate.tap.time)
    }

    mutating func finish(point: CGPoint, time: TimeInterval, hasNativeSelection: Bool) -> Completion? {
        move(to: point)
        guard let candidate else { return nil }
        self.candidate = nil
        guard (0...Self.maximumTapDuration).contains(time - candidate.tap.time) else { return nil }
        previous = Tap(verse: candidate.tap.verse, point: point, time: time, marker: false)
        if hasNativeSelection && candidate.permitsWordSelection { return nil }
        return Completion(verse: candidate.tap.verse, rejectsNativeSelection: !candidate.permitsWordSelection)
    }

    mutating func marker(verse: Int, point: CGPoint, time: TimeInterval) {
        candidate = nil
        previous = Tap(verse: verse, point: point, time: time, marker: true)
    }

    mutating func cancel() { candidate = nil }
    mutating func reset() { candidate = nil; previous = nil }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
}

struct ChapterPullCue: Equatable {
    let direction: Int
    let ready: Bool
}

/// Track the user's net movement, rather than judging each trackpad event.
/// Slow pulls contain zero-delta packets and small sideways corrections.
struct ChapterPullTravel {
    private var horizontal: CGFloat = 0
    private var vertical: CGFloat = 0

    var direction: Int { vertical > 0 ? -1 : 1 }
    var distance: CGFloat { abs(vertical) }
    var isVertical: Bool { abs(vertical) > abs(horizontal) }

    mutating func add(horizontal x: CGFloat, vertical y: CGFloat) {
        horizontal += x
        vertical += y
    }

    mutating func reset() {
        horizontal = 0
        vertical = 0
    }
}

/// A deliberate fresh pull at a chapter edge, with hysteresis around release.
/// Arriving at the edge during an ordinary scroll never arms navigation.
struct ChapterPullIntent {
    let armDistance: CGFloat
    let disarmDistance: CGFloat
    private var edges = Set<Int>()
    private var armed: Int?

    init(armDistance: CGFloat, disarmDistance: CGFloat) {
        self.armDistance = armDistance
        self.disarmDistance = min(disarmDistance, armDistance)
    }

    mutating func begin(atTop: Bool, atBottom: Bool) {
        edges = Set((atTop ? [-1] : []) + (atBottom ? [1] : []))
        armed = nil
    }

    mutating func update(direction: Int, distance: CGFloat, allowed: Bool) -> ChapterPullCue? {
        guard allowed, edges.contains(direction), distance >= 18 else {
            armed = nil
            return nil
        }
        let ready = distance >= (armed == direction ? disarmDistance : armDistance)
        armed = ready ? direction : nil
        return ChapterPullCue(direction: direction, ready: ready)
    }

    mutating func finish() -> Int? {
        let direction = armed
        cancel()
        return direction
    }

    mutating func cancel() {
        edges = []
        armed = nil
    }
}

/// Keeps the native selection endpoints on readable text while preserving a continuous drag across verses.
func readerTextSelection(_ range: NSRange, in storage: NSAttributedString, excluding marker: NSAttributedString.Key) -> NSRange {
    guard range.location != NSNotFound, range.length > 0, NSMaxRange(range) <= storage.length else { return range }
    let text = storage.string as NSString
    let ink = CharacterSet.whitespacesAndNewlines.inverted
    var start: Int?
    var end = range.location
    storage.enumerateAttribute(marker, in: range) { skipped, run, _ in
        guard skipped == nil else { return }
        let first = text.rangeOfCharacter(from: ink, range: run)
        guard first.location != NSNotFound else { return }
        let last = text.rangeOfCharacter(from: ink, options: .backwards, range: run)
        if start == nil { start = first.location }
        end = NSMaxRange(last)
    }
    guard let start else { return NSRange(location: range.location, length: 0) }
    return NSRange(location: start, length: end - start)
}

/// Everything the continuous reader needs to draw one verse.
struct ReaderVerse: Equatable {
    struct Word: Equatable { var text: String; var italic: Bool; var red: Bool; var strongs: [String] }
    struct Mark: Equatable { var start: Int; var end: Int; var color: String }   // display offsets into the joined words
    var verse: Int
    var title: String?
    var words: [Word]
    var marks: [Mark] = []
    /// Idiom terms found in the shown words (display offsets, like `marks`): dotted underline + link to the idiom note.
    struct IdiomSpan: Equatable { var start: Int; var end: Int; var id: String; var meaning: String }
    var idioms: [IdiomSpan] = []
    var tint: String?          // whole-verse highlight colour
    var noteCount = 0
    var citationCount = 0
    var mentionCount = 0
    var citationPreview: String?
    /// One quiet margin target; the symbol identifies its primary study material.
    var studyOpensCrossReferences: Bool { citationCount > 0 || mentionCount > 0 }
    var studySymbol: String {
        studyOpensCrossReferences ? "arrow.triangle.branch" : noteCount > 0 ? "note.text" : "tag"
    }
    var studySummary: String {
        var parts: [String] = []
        if noteCount > 0 { parts.append("\(noteCount) \(noteCount == 1 ? "note" : "notes")") }
        if citationCount > 0 { parts.append("\(citationCount) related \(citationCount == 1 ? "passage" : "passages")") }
        if mentionCount > 0 { parts.append("Mentioned in \(mentionCount) \(mentionCount == 1 ? "note" : "notes")") }
        if !tags.isEmpty { parts.append(tags.map { "#" + $0.name }.joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }
    var tags: [(name: String, color: String?, slot: Int?)] = []
    var displayVerse: Int?
    var displayVerseEnd: Int?
    /// A Psalm superscription belongs to the same verse as its opening body line.
    var numberBeforeTitle = false
    var readerVerse: Int { displayVerse ?? verse }
    var readerVerseLabel: String {
        if let end = displayVerseEnd, end > readerVerse { return "\(readerVerse)–\(end)" }
        return String(readerVerse)
    }
    static func == (a: ReaderVerse, b: ReaderVerse) -> Bool {
        a.verse == b.verse && a.title == b.title && a.words == b.words && a.marks == b.marks && a.tint == b.tint && a.noteCount == b.noteCount
            && a.citationCount == b.citationCount && a.mentionCount == b.mentionCount && a.citationPreview == b.citationPreview
            && a.tags.elementsEqual(b.tags, by: ==) && a.displayVerse == b.displayVerse && a.displayVerseEnd == b.displayVerseEnd
            && a.numberBeforeTitle == b.numberBeforeTitle
    }
    /// The verse as displayed (words joined by spaces), the text copy uses.
    var displayText: String { words.map(\.text).joined(separator: " ") }
}

enum ScriptureTextSize {
    static let standard: Double = 16
    static let range: ClosedRange<Double> = 12...30

    static func clamped(_ size: Double) -> Double {
        min(range.upperBound, max(range.lowerBound, size))
    }
}

struct ReaderStyle: Equatable {
    var fontSize: Double
    var lineSpacing: CGFloat
    var family: String
    var showStrongs: Bool
    var showVerseNumbers = true
    var redLetters = true
    var width: ScriptureWidth = .normal
    /// Reading theme text colour ("r g b"), nil = system label colour.
    var themeText: String? = nil
    /// Reading theme accent ("r g b") for verse numbers, nil = system accent.
    var themeAccent: String? = nil
}


enum ScriptureWidth: String, CaseIterable {
    case wide, normal, narrow

    var label: String { rawValue.capitalized }

    var macMaximum: CGFloat {
        switch self {
        case .wide: 920
        case .normal: 760
        case .narrow: 600
        }
    }

    /// iPhone text insets only; desktop reading widths use macMaximum.
    var phoneInset: CGFloat {
        switch self {
        case .wide: 6
        case .normal: 10
        case .narrow: 22
        }
    }
}

/// Chapter study is not necessarily an attached note: tags and mentions have
/// their own symbol and destination rather than implying a nonexistent note.
struct ReaderChapterStudy: Equatable, Sendable {
    let symbol: String
    let summary: String
    let opensCrossReferences: Bool
}

struct ReaderStudyPreview: Identifiable, Sendable {
    let id: String
    let reference: String
    let noteTitle: String
    let text: String
    /// Note excerpts use the same rich preview renderer as Notes, never raw Markdown.
    var isNoteExcerpt = false
}
