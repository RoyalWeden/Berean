import SwiftUI
import AppKit
import BereanNotes
import BereanReference

/// The Mac notes editor (ADR-0014): formatted while you type, no visible Markdown. The text storage holds the note's
/// Markdown verbatim; `MarkdownLiveSpans` decides the styling, hidden markup becomes null glyphs (no width, no caret
/// stops), list markers draw as bullets. ⌘B / ⌘I / ⌘U / ⇧⌘X / ⇧⌘H and Format ▸ Heading wrap the selection in markup;
/// Copy puts formatted text (RTF), plain text and the Markdown source (for pasting back into a note);
/// Copy as Plain Text (⌥⇧⌘C) puts the readable text only.
struct RichNoteEditor: NSViewRepresentable {
    @Binding var text: String
    var fontSize: CGFloat = 15
    var formatRequest: NoteFormatRequest? = nil
    var onLink: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        layout.delegate = context.coordinator
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        let tv = NoteTextView(frame: .zero, textContainer: container)
        tv.isRichText = false            // the storage is Markdown; formatting is applied by the styler
        tv.allowsUndo = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.drawsBackground = false
        tv.textContainerInset = NSSize(width: 0, height: 8)
        tv.autoresizingMask = [.width]
        tv.isVerticallyResizable = true
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.delegate = context.coordinator
        tv.coordinator = context.coordinator
        tv.setAccessibilityLabel("Note text")
        // Link colour comes from the styled runs (task boxes keep their accent / secondary tint); this only adds the hand.
        tv.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        tv.string = text
        context.coordinator.textView = tv
        context.coordinator.restyle()
        let scroll = NSScrollView()
        scroll.documentView = tv
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.autohidesScrollers = true
        return scroll
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        let c = context.coordinator
        let previousRequest = c.parent.formatRequest
        c.parent = self
        if let request = formatRequest, request != previousRequest {
            DispatchQueue.main.async { [weak c] in
                guard let c, c.parent.formatRequest == request, let editor = c.textView,
                      let window = editor.window else { return }
                switch request.action {
                case .inline(let open, let close): editor.wrapSelection(open, close)
                case .highlight(let color): editor.setHighlight(color)
                case .heading(let level): editor.setHeading(level)
                case .list(let style): editor.setList(style)
                case .insertTable: editor.insertTable()
                case .addTableRow: editor.addTableRow()
                case .addTableColumn: editor.addTableColumn()
                case .deleteTableRow: editor.deleteTablePart(columnOnly: false)
                case .deleteTableColumn: editor.deleteTablePart(columnOnly: true)
                case .deleteTable: editor.deleteTable()
                }
                window.makeFirstResponder(editor)
            }
        }
        guard let tv = c.textView, tv.string != text, !c.editing else { return }
        tv.string = text
        c.restyle()
    }

    final class Coordinator: NSObject, NSTextViewDelegate, NSLayoutManagerDelegate {
        var parent: RichNoteEditor
        weak var textView: NoteTextView?
        var editing = false
        var hidden = IndexSet()
        var substitutions: [Int: (len: Int, glyph: String)] = [:]

        init(_ p: RichNoteEditor) { parent = p }

        // MARK: styling

        func restyle() {
            guard let tv = textView, let storage = tv.textStorage else { return }
            let text = tv.string
            let size = parent.fontSize
            let body = NSFont.systemFont(ofSize: size)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 3; para.paragraphSpacing = 6
            storage.beginEditing()
            let all = NSRange(location: 0, length: storage.length)
            storage.setAttributes([.font: body, .foregroundColor: NSColor.labelColor, .paragraphStyle: para], range: all)
            hidden = IndexSet(); substitutions = [:]
            for sp in MarkdownLiveSpans.spans(text) where NSMaxRange(sp.range) <= storage.length {
                let r = sp.range
                switch sp.kind {
                case .hidden: hidden.insert(integersIn: r.location..<NSMaxRange(r))
                case .bold: addTrait(.boldFontMask, r, storage)
                case .italic: addTrait(.italicFontMask, r, storage)
                case .strike: storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .underline: storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .code:
                    storage.addAttributes([.font: NSFont.monospacedSystemFont(ofSize: size * 0.92, weight: .regular), .backgroundColor: NSColor.quaternaryLabelColor], range: r)
                case .highlight(let c): storage.addAttribute(.backgroundColor, value: NSColor(Color.highlight(c ?? "yellow")).withAlphaComponent(0.35), range: r)
                case .link(let url):
                    if let u = URL(string: url) { storage.addAttributes([.link: u, .foregroundColor: NSColor.linkColor, .underlineStyle: NSUnderlineStyle.single.rawValue], range: r) }
                case .wikilink(let target):
                    storage.addAttributes([.link: URL(string: "berean-note:" + (target.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target))!,
                                           .foregroundColor: NSColor.linkColor], range: r)
                case .heading(let level):
                    let scale: [CGFloat] = [1.75, 1.45, 1.25, 1.12, 1.05, 1.0]
                    let hp = NSMutableParagraphStyle(); hp.paragraphSpacingBefore = level <= 2 ? 10 : 6; hp.paragraphSpacing = 4
                    storage.addAttributes([.font: NSFont.systemFont(ofSize: size * scale[min(level, 6) - 1], weight: level <= 2 ? .bold : .semibold), .paragraphStyle: hp], range: r)
                case .quote:
                    let qp = NSMutableParagraphStyle(); qp.headIndent = 18; qp.firstLineHeadIndent = 18; qp.paragraphSpacing = 4
                    storage.addAttributes([.paragraphStyle: qp, .foregroundColor: NSColor.secondaryLabelColor], range: r)
                case .calloutLabel(let t):
                    substitutions[r.location] = (r.length, String((t.capitalized + ": ").prefix(r.length)))
                    storage.addAttributes([.font: NSFont.systemFont(ofSize: size, weight: .semibold), .foregroundColor: NSColor.controlAccentColor], range: r)
                case .bullet:
                    substitutions[r.location] = (r.length, "•")
                    storage.addAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, range: r)
                case .task(let on):
                    substitutions[r.location] = (r.length, on ? "☑" : "□")
                    storage.addAttribute(.link, value: NoteTaskLink.url(for: r), range: NSRange(location: r.location, length: 1))
                    storage.addAttribute(.foregroundColor, value: on ? NSColor.controlAccentColor : NSColor.secondaryLabelColor, range: r)
                case .codeBlock:
                    storage.addAttributes([.font: NSFont.monospacedSystemFont(ofSize: size * 0.9, weight: .regular), .backgroundColor: NSColor.quaternaryLabelColor.withAlphaComponent(0.5)], range: r)
                case .tableRow:
                    storage.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: size * 0.92, weight: .regular), range: r)
                    let cells = MarkdownLiveSpans.tableCells(in: text as NSString, range: r)
                    if !cells.isEmpty {
                        for delimiter in [r.location] + cells.map(\.upperBound) {
                            storage.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor,
                                                 range: NSRange(location: delimiter, length: 1))
                        }
                    }
                case .tableHeader:
                    storage.addAttributes([.font: NSFont.monospacedSystemFont(ofSize: size * 0.92, weight: .semibold),
                                           .backgroundColor: NSColor.labelColor.withAlphaComponent(0.07)], range: r)
                case .tableRule, .rule:
                    storage.addAttributes([.foregroundColor: NSColor.tertiaryLabelColor,
                                           .font: NSFont.monospacedSystemFont(ofSize: size * 0.92, weight: .regular)], range: r)
                case .image:
                    storage.addAttributes([.foregroundColor: NSColor.secondaryLabelColor, .backgroundColor: NSColor.quaternaryLabelColor], range: r)
                case .structure: break
                }
            }
            // Scripture references written as plain text link to the passage (original note auto-linking; same
            // berean-note: route the editor already resolves as a passage first).
            for ref in NoteVerseRefs.linkSpans(content: text) where NSMaxRange(ref.range) <= storage.length {
                guard let url = URL(string: "berean-note:" + (ref.reference.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ref.reference)) else { continue }
                storage.addAttributes([.link: url, .foregroundColor: NSColor.linkColor], range: ref.range)
            }
            storage.endEditing()
            if let lm = tv.layoutManager { lm.invalidateGlyphs(forCharacterRange: all, changeInLength: 0, actualCharacterRange: nil); lm.invalidateLayout(forCharacterRange: all, actualCharacterRange: nil) }
            tv.typingAttributes = [.font: body, .foregroundColor: NSColor.labelColor, .paragraphStyle: para]
        }

        func addTrait(_ trait: NSFontTraitMask, _ r: NSRange, _ storage: NSTextStorage) {
            storage.enumerateAttribute(.font, in: r) { v, sub, _ in
                let f = (v as? NSFont) ?? .systemFont(ofSize: parent.fontSize)
                storage.addAttribute(.font, value: NSFontManager.shared.convert(f, toHaveTrait: trait), range: sub)
            }
        }

        // MARK: glyphs — hidden markup takes no space; substitutions draw their replacement in the first glyph

        func layoutManager(_ layoutManager: NSLayoutManager, shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>, properties props: UnsafePointer<NSLayoutManager.GlyphProperty>,
                           characterIndexes charIndexes: UnsafePointer<Int>, font aFont: NSFont, forGlyphRange glyphRange: NSRange) -> Int {
            let n = glyphRange.length
            var newProps = Array(UnsafeBufferPointer(start: props, count: n))
            var newGlyphs = Array(UnsafeBufferPointer(start: glyphs, count: n))
            var changed = false
            var pending: [UniChar] = []   // replacement characters still to place, then null glyphs
            var subLeft = 0
            for i in 0..<n {
                let ci = charIndexes[i]
                if let sub = substitutions[ci] {
                    pending = Array(sub.glyph.utf16); subLeft = sub.len
                }
                if subLeft > 0 {
                    subLeft -= 1; changed = true
                    if !pending.isEmpty {
                        var ch = pending.removeFirst(), g = CGGlyph(0)
                        if CTFontGetGlyphsForCharacters(aFont as CTFont, &ch, &g, 1) { newGlyphs[i] = g; newProps[i] = [] } else { newProps[i] = .null }
                    } else { newProps[i] = .null }
                    continue
                }
                if hidden.contains(ci) { newProps[i] = .null; changed = true }
            }
            guard changed else { return 0 }
            layoutManager.setGlyphs(newGlyphs, properties: newProps, characterIndexes: charIndexes, font: aFont, forGlyphRange: glyphRange)
            return n
        }

        // MARK: editing

        func textDidChange(_ notification: Notification) {
            guard let tv = textView else { return }
            editing = true
            parent.text = tv.string
            restyle()
            editing = false
        }

        /// Keeps the caret off hidden markup: it moves past it in the direction of travel.
        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
            guard let text, let dash = NoteAutoEmDash.dashRange(in: textView.string as NSString, range: range, replacement: text) else { return true }
            textView.insertText("—", replacementRange: dash)
            return false
        }

        func textView(_ textView: NSTextView, willChangeSelectionFromCharacterRange old: NSRange, toCharacterRange new: NSRange) -> NSRange {
            guard new.length == 0, hidden.contains(new.location) || (new.location > 0 && hidden.contains(new.location - 1) && hidden.contains(new.location)) else { return new }
            var loc = new.location
            if new.location >= old.location { while hidden.contains(loc), loc < (textView.string as NSString).length { loc += 1 } }
            else { while loc > 0, hidden.contains(loc - 1) { loc -= 1 } }
            return NSRange(location: loc, length: 0)
        }

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let url = link as? URL else { return false }
            if url.scheme == NoteTaskLink.scheme {
                guard let editor = textView as? NoteTextView,
                      let edit = NoteTaskLink.edit(for: url, in: editor.string as NSString) else { return true }
                editor.replace(edit.range, with: edit.replacement, select: editor.selectedRange())
                return true
            }
            parent.onLink(url)
            return true
        }
    }
}

/// The editor's text view: Markdown-aware formatting commands, copy/paste and drawing of multi-character labels.
final class NoteTextView: NSTextView {
    weak var coordinator: RichNoteEditor.Coordinator?
    static let markdownType = NSPasteboard.PasteboardType("com.berean.note-markdown")

    // MARK: formatting commands

    func wrapSelection(_ open: String, _ close: String) {
        guard let edit = noteFormatEdit(in: string as NSString, selection: selectedRange(),
                                        opening: open, closing: close) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func setHighlight(_ color: String?) {
        guard let edit = noteHighlightEdit(in: string as NSString, selection: selectedRange(), color: color) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func setHeading(_ level: Int) {
        guard let edit = noteHeadingEdit(in: string as NSString, selection: selectedRange(), level: level) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    override func insertNewline(_ sender: Any?) {
        guard !hasMarkedText(),
              let edit = noteListReturnEdit(in: string as NSString, selection: selectedRange()) else {
            super.insertNewline(sender)
            return
        }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    override func insertTab(_ sender: Any?) {
        if !moveTableCell(backwards: false) { super.insertTab(sender) }
    }

    override func insertBacktab(_ sender: Any?) {
        if !moveTableCell(backwards: true) { super.insertBacktab(sender) }
    }

    private func moveTableCell(backwards: Bool) -> Bool {
        guard !hasMarkedText(),
              let destination = noteTableCellDestination(in: string as NSString, selection: selectedRange(),
                                                         backwards: backwards) else { return false }
        setSelectedRange(destination)
        scrollRangeToVisible(destination)
        return true
    }

    func deleteTable() {
        guard let edit = noteWholeTableDeletion(in: string as NSString, selection: selectedRange()) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func deleteTablePart(columnOnly: Bool) {
        guard let edit = noteTableDeletion(in: string as NSString, selection: selectedRange(),
                                           columnOnly: columnOnly) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func addTableColumn() {
        guard let edit = noteTableColumnInsertion(in: string as NSString, selection: selectedRange()) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func addTableRow() {
        guard let edit = noteTableRowInsertion(in: string as NSString, selection: selectedRange()) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func insertTable() {
        guard let edit = noteTableInsertion(in: string as NSString, selection: selectedRange()) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func setList(_ style: NoteListStyle) {
        guard let edit = noteListEdit(in: string as NSString, selection: selectedRange(), style: style) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func replace(_ r: NSRange, with s: String, select: NSRange) {
        guard shouldChangeText(in: r, replacementString: s) else { return }
        textStorage?.replaceCharacters(in: r, with: s)
        didChangeText()
        setSelectedRange(select)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard window?.firstResponder === self else { return super.performKeyEquivalent(with: event) }
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let k = event.charactersIgnoringModifiers?.lowercased() ?? ""
        switch (mods, k) {
        case ([.command], "b"): wrapSelection("**", "**"); return true
        case ([.command], "i"): wrapSelection("*", "*"); return true
        case ([.command], "u"): wrapSelection("<u>", "</u>"); return true
        case ([.command, .shift], "x"): wrapSelection("~~", "~~"); return true
        case ([.command, .shift], "h"): setHighlight(nil); return true
        case ([.command], "c"): copy(nil); return true
        case ([.command, .option, .shift], "c"): copyPlainText(nil); return true
        case ([.command], "v"): paste(nil); return true
        case ([.command, .option], "1"), ([.command, .option], "2"), ([.command, .option], "3"): setHeading(Int(k)!); return true
        case ([.command, .option], "0"): setHeading(0); return true
        case ([.command, .shift], "8"), ([.command, .shift], "*"): setList(.bullet); return true
        default: return super.performKeyEquivalent(with: event)
        }
    }

    // MARK: clipboard

    override func copy(_ sender: Any?) {
        let r = selectedRange()
        guard r.length > 0, let ts = textStorage else { return }
        let source = (string as NSString).substring(with: r)
        let plain = MarkdownLiveSpans.plainText(string, range: r)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.declareTypes([Self.markdownType, .rtf, .string], owner: nil)
        pb.setString(source, forType: Self.markdownType)
        pb.setString(plain, forType: .string)
        // Formatted copy: the styled text with hidden markup removed.
        let styled = NSMutableAttributedString(attributedString: ts.attributedSubstring(from: r))
        var removals: [NSRange] = []
        for i in stride(from: r.length - 1, through: 0, by: -1) where coordinator?.hidden.contains(r.location + i) == true { removals.append(NSRange(location: i, length: 1)) }
        for x in removals { styled.deleteCharacters(in: x) }
        styled.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: styled.length))
        if let rtf = styled.rtf(from: NSRange(location: 0, length: styled.length)) { pb.setData(rtf, forType: .rtf) }
    }

    override func cut(_ sender: Any?) { copy(sender); insertText("", replacementRange: selectedRange()) }

    @objc func copyPlainText(_ sender: Any?) {
        let r = selectedRange()
        guard r.length > 0 else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(MarkdownLiveSpans.plainText(string, range: r), forType: .string)
    }

    /// Paste: a note's own copy pastes its Markdown (formatting kept); anything else pastes as plain text.
    override func paste(_ sender: Any?) {
        let pb = NSPasteboard.general
        let s = pb.string(forType: Self.markdownType) ?? pb.string(forType: .string) ?? ""
        guard !s.isEmpty else { return }
        insertText(s, replacementRange: selectedRange())
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let m = super.menu(for: event) ?? NSMenu()
        if let i = m.items.firstIndex(where: { $0.action == #selector(copy(_:)) }) {
            m.insertItem(ClosureMenuItem("Copy as Plain Text", key: "c", modifiers: [.command, .option, .shift]) { [weak self] in self?.copyPlainText(nil) }, at: i + 1)
        }
        return m
    }
}
