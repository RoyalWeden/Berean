import SwiftUI
import AppKit

/// The Mac Scripture reader: ONE TextKit text view for the whole chapter, so a selection can run across verses
/// (VERSE rows as separate SwiftUI Texts could not). Verse numbers, Strong's numbers and tag chips are links with
/// a pointing-hand cursor and a hover underline; right-click gives the verse actions; ⌘C copies like the existing
/// app (several verses → "Book c:v1-v2" + numbered lines; ⌘⇧C → plain text on one line).
struct ChapterTextView: NSViewRepresentable {
    var passageId = ""                       // text|book|chapter — scroll position is kept only within one passage
    var header: [String] = []                       // versification note, etc.
    var chapterTags: [(name: String, color: String?, slot: Int?)] = []
    var verses: [ReaderVerse]
    var style: ReaderStyle
    var selectedVerses: Set<Int> = []
    var scrollTarget: Int?
    var selectionReference: () -> String
    var rangeReference: (Int, Int) -> String        // first, last → "John 3:16-18"
    var verseMenu: (Int) -> NSMenu
    var tagMenu: (String, Int?) -> NSMenu           // tag name, verse (nil = chapter tag)
    var onStrongs: (String) -> Void
    /// A verse number was clicked (shift = extend the range from the last clicked verse).
    var onVerseClick: (Int, Bool) -> Void
    /// Highlight part of a verse: (verse, display start, display end, colour) — display offsets into the verse's shown words.
    var onHighlightRange: (Int, Int, Int, String) -> Void = { _, _, _, _ in }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.autohidesScrollers = true
        let tv = ReaderTextView(usingTextLayoutManager: false)
        tv.isEditable = false
        tv.isSelectable = true
        tv.drawsBackground = false
        tv.isRichText = true
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

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let c = context.coordinator
        c.parent = self
        guard let tv = c.textView else { return }
        let key = Key(header: header, chapterTags: chapterTags.map(\.name), verses: verses, style: style, selected: selectedVerses)
        if key != c.lastKey {
            let keepScroll = c.lastPassage == passageId
            let origin = scroll.contentView.bounds.origin
            let sel = tv.selectedRanges
            tv.textStorage?.setAttributedString(c.build(self))
            if keepScroll {
                // Restore the selection only where it still fits; AppKit throws on an empty selection array.
                let kept = sel.filter { $0.rangeValue.upperBound <= tv.string.utf16.count }
                tv.selectedRanges = kept.isEmpty ? [NSValue(range: NSRange(location: 0, length: 0))] : kept
                scroll.contentView.scroll(to: origin)
            }
            c.lastKey = key
            if c.lastPassage != passageId { c.lastPassage = passageId; scroll.contentView.scroll(to: .zero); scroll.reflectScrolledClipView(scroll.contentView); c.scrolledTo = nil }
        }
        if let t = scrollTarget, t != c.scrolledTo, let r = c.verseRanges[t] {
            c.scrolledTo = t
            DispatchQueue.main.async {
                tv.layoutManager?.ensureLayout(for: tv.textContainer!)
                if let rect = tv.firstRect(forVerseRange: r) { scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, rect.minY - 12))); scroll.reflectScrolledClipView(scroll.contentView) }
            }
        }
    }

    struct Key: Equatable {
        var header: [String]; var chapterTags: [String]; var verses: [ReaderVerse]; var style: ReaderStyle; var selected: Set<Int>
    }

    // MARK: - Coordinator: builds the text, routes clicks, copies

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChapterTextView!
        weak var textView: ReaderTextView?
        var lastKey: Key?
        var lastPassage = ""
        var scrolledTo: Int?
        /// verse → range of its paragraph (number + text) in the text storage.
        var verseRanges: [Int: NSRange] = [:]
        /// verse → storage index where its words start (after the gutter).
        var verseTextStarts: [Int: Int] = [:]

        static let verseKey = NSAttributedString.Key("bereanVerse")       // Int on every character of a verse paragraph
        static let skipKey = NSAttributedString.Key("bereanSkip")         // gutter number, Strong's, chips: not copied as text

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
            let size = p.style.fontSize
            let para = NSMutableParagraphStyle()
            para.lineSpacing = p.style.lineSpacing
            para.paragraphSpacing = size * 0.55
            para.tabStops = [NSTextTab(textAlignment: .right, location: 26), NSTextTab(textAlignment: .left, location: 34)]
            para.headIndent = 34
            let base: [NSAttributedString.Key: Any] = [.font: font(size), .foregroundColor: NSColor.labelColor, .paragraphStyle: para]

            let headPara = NSMutableParagraphStyle(); headPara.paragraphSpacing = 10; headPara.headIndent = 34; headPara.firstLineHeadIndent = 34
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
                    out.append(NSAttributedString(string: "\t\t" + title + "\n", attributes: base.merging([.font: font(size * 0.85, italic: true), .foregroundColor: NSColor.secondaryLabelColor, Self.skipKey: true]) { $1 }))
                }
                // Gutter: right-aligned verse number (a link → verse actions), note dot.
                let selected = p.selectedVerses.contains(v.verse)
                let numAttrs: [NSAttributedString.Key: Any] = [
                    .font: NSFont.monospacedDigitSystemFont(ofSize: max(10, size * 0.62), weight: .semibold),
                    .foregroundColor: selected ? NSColor.alternateSelectedControlTextColor : (p.style.showVerseNumbers ? NSColor.secondaryLabelColor : NSColor.clear),
                    .link: URL(string: "berean-verse:\(v.verse)")!, .paragraphStyle: para, Self.skipKey: true,
                    .toolTip: "Verse \(v.verse) — click to select (⇧-click for a range); right-click for highlight, tag, note, copy…",
                ]
                // The whole gutter (both tabs and the number) is the verse-number target, so single digits are easy to hit.
                let gutterTab = numAttrs.merging([.font: NSFont.systemFont(ofSize: CGFloat(size))]) { $1 }
                out.append(NSAttributedString(string: "\t", attributes: gutterTab))
                let badgeAttrs = selected ? numAttrs.merging([.backgroundColor: NSColor.controlAccentColor]) { $1 } : numAttrs
                out.append(NSAttributedString(string: "\(v.verse)", attributes: badgeAttrs))
                out.append(NSAttributedString(string: "\t", attributes: gutterTab))
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
                                .foregroundColor: NSColor.secondaryLabelColor, .baselineOffset: size * 0.38,
                                .link: URL(string: "strongs:\(id)")!, .paragraphStyle: para, Self.skipKey: true,
                                .toolTip: "Strong's \(id) — open in the lexicon",
                            ]))
                        }
                    }
                }
                if v.noteCount > 0 {
                    out.append(NSAttributedString(string: v.noteCount > 1 ? "  ●\(v.noteCount)" : "  ●", attributes: [.font: NSFont.systemFont(ofSize: max(8, size * 0.5)), .foregroundColor: NSColor.controlAccentColor, .paragraphStyle: para, Self.skipKey: true, .toolTip: "\(v.noteCount) note(s)"]))
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
                if let v = Int(url.absoluteString.dropFirst("berean-verse:".count)) { parent.onVerseClick(v, NSApp.currentEvent?.modifierFlags.contains(.shift) ?? false) }
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
                let vs = parent.verses.filter { parent.selectedVerses.contains($0.verse) }
                guard !vs.isEmpty else { return nil }
                if plain { return vs.map(\.displayText).joined(separator: " ") }
                return ([parent.selectionReference()] + vs.map { "\($0.verse) \($0.displayText)" }).joined(separator: "\n")
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
    private var hovered: NSRange?
    private var tracking: NSTrackingArea?

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let inset = max(20, (newSize.width - 760) / 2)
        if abs(textContainerInset.width - inset) > 0.5 { textContainerInset = NSSize(width: inset, height: 18) }
    }

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        // A single click on a link (verse number, Strong's number, tag chip) acts like a button; anything else is text
        // selection. (The built-in link handling did not fire for these custom-scheme links inside SwiftUI.)
        if event.clickCount == 1, let i = charIndex(at: event), let ts = textStorage, i < ts.length,
           let link = ts.attribute(.link, at: i, effectiveRange: nil), let c = coordinator {
            if let url = link as? URL, url.scheme == "berean-verse" {
                setSelectedRange(NSRange(location: i, length: 0))
            }
            _ = c.textView(self, clickedOnLink: link, at: i)
            return
        }
        super.mouseDown(with: event)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t); tracking = t
    }

    func charIndex(at event: NSEvent) -> Int? {
        let p = convert(event.locationInWindow, from: nil)
        guard let lm = layoutManager, let tc = textContainer else { return nil }
        guard lm.numberOfGlyphs > 0 else { return nil }
        let pt = NSPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
        var fraction: CGFloat = 0
        let g = lm.glyphIndex(for: pt, in: tc, fractionOfDistanceThroughGlyph: &fraction)
        guard g < lm.numberOfGlyphs else { return nil }
        let rect = lm.boundingRect(forGlyphRange: NSRange(location: g, length: 1), in: tc)
        guard rect.insetBy(dx: -2, dy: -2).contains(pt) else { return nil }
        return lm.characterIndexForGlyph(at: g)
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        guard let lm = layoutManager, let ts = textStorage else { return }
        var newRange: NSRange?
        if let i = charIndex(at: event), i < ts.length {
            var r = NSRange()
            if ts.attribute(.link, at: i, effectiveRange: &r) != nil { newRange = r }
        }
        if newRange != hovered {
            if let h = hovered, NSMaxRange(h) <= ts.length { lm.removeTemporaryAttribute(.underlineStyle, forCharacterRange: h) }
            if let n = newRange { lm.addTemporaryAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, forCharacterRange: n) }
            hovered = newRange
        }
    }

    override func mouseExited(with event: NSEvent) {
        if let h = hovered, let ts = textStorage, NSMaxRange(h) <= ts.length { layoutManager?.removeTemporaryAttribute(.underlineStyle, forCharacterRange: h) }
        hovered = nil
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let c = coordinator, let i = charIndex(at: event), let v = c.verse(at: i) else { return super.menu(for: event) }
        let menu = c.parent.verseMenu(v)
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
            menu.insertItem(.separator(), at: 0)
            menu.insertItem(ClosureMenuItem("Copy as Plain Text", key: "C", modifiers: [.command, .shift]) { [weak self] in self?.copyPlain(nil) }, at: 0)
            menu.insertItem(ClosureMenuItem("Copy", key: "c") { [weak self] in self?.copy(nil) }, at: 0)
        }
        return menu
    }

    override func copy(_ sender: Any?) {
        guard let s = coordinator?.copyText(plain: false) else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string)
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
        if mods == [.command], event.charactersIgnoringModifiers?.lowercased() == "g" {
            let item = NSMenuItem(); item.tag = NSTextFinder.Action.nextMatch.rawValue
            performFindPanelAction(item); return true
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



