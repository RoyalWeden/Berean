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
    var fontSize: CGFloat = NSFont.systemFontSize
    var fontFamily = "system"
    var detectVerseReferences = true
    var detectStrongsReferences = true
    var spellCheck = true
    var formatRequest: NoteFormatRequest? = nil
    var onWikiLinkQuery: (NoteWikiLinkCompletion?) -> Void = { _ in }
    var onWikiLinkAnchor: (CGRect) -> Void = { _ in }
    var onReferenceCompletion: (NoteReferenceCompletion?) -> Void = { _ in }
    var onTableContext: (Bool) -> Void = { _ in }
    var onWikiLinkCommand: (NoteWikiLinkCommand) -> Bool = { _ in false }
    var onLink: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let storage = NSTextStorage()
        let layout = NoteTableLayout()
        layout.delegate = context.coordinator
        storage.addLayoutManager(layout)
        let container = NoteTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        let tv = NoteTextView(frame: .zero, textContainer: container)
        tv.isRichText = false            // the storage is Markdown; formatting is applied by the styler
        tv.allowsUndo = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.drawsBackground = false
        tv.textContainerInset = NSSize(width: 0, height: 6)
        container.lineFragmentPadding = 0
        tv.autoresizingMask = [.width]
        tv.isVerticallyResizable = true
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.delegate = context.coordinator
        tv.coordinator = context.coordinator
        tv.setAccessibilityLabel("Note text")
        // Link colour comes from the styled runs (task boxes keep their accent / secondary tint); this only adds the hand.
        tv.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        tv.isContinuousSpellCheckingEnabled = spellCheck
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
        let styleChanged = c.parent.detectVerseReferences != detectVerseReferences
            || c.parent.detectStrongsReferences != detectStrongsReferences
            || c.parent.fontFamily != fontFamily || c.parent.fontSize != fontSize
        let spellingSettingChanged = c.parent.spellCheck != spellCheck
        let previousRequest = c.parent.formatRequest
        c.parent = self
        if let request = formatRequest, request != previousRequest {
            DispatchQueue.main.async { [weak c] in
                guard let c, c.parent.formatRequest == request, let editor = c.textView,
                      let window = editor.window else { return }
                switch request.action {
                case .inline(let open, let close): editor.wrapSelection(open, close)
                case .link(let destination, let selection):
                    if let edit = noteLinkEdit(in: editor.string as NSString, selection: selection ?? editor.selectedRange(), destination: destination) {
                        editor.replace(edit.range, with: edit.replacement, select: edit.selection)
                    }
                case .wikiLink(let completion, let title):
                    guard !editor.hasMarkedText(),
                          let edit = completion.edit(in: editor.string, selection: editor.selectedRange(), title: title) else { return }
                    editor.replaceSource(edit.range, with: edit.replacement, select: edit.selection)
                case .referenceBlock(let completion, let replacement):
                    guard !editor.hasMarkedText(),
                          let edit = completion.edit(in: editor.string, selection: editor.selectedRange(), replacement: replacement) else { return }
                    editor.replaceSource(edit.range, with: edit.replacement, select: edit.selection, actionName: "Insert Reference Block")
                case .highlight(let color): editor.setHighlight(color)
                case .removeHighlight:
                    if let edit = noteRemoveHighlightEdit(in: editor.string as NSString, selection: editor.selectedRange()) {
                        editor.replace(edit.range, with: edit.replacement, select: edit.selection)
                    }
                case .inlineCode:
                    if let edit = noteInlineCodeEdit(in: editor.string as NSString, selection: editor.selectedRange()) {
                        editor.replace(edit.range, with: edit.replacement, select: edit.selection)
                    }
                case .heading(let level): editor.setHeading(level)
                case .list(let style): editor.setList(style)
                case .callout(let kind): editor.insertCallout(kind)
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
        guard let tv = c.textView else { return }
        if spellingSettingChanged { tv.isContinuousSpellCheckingEnabled = spellCheck }
        let contentChanged = tv.string != text && !c.editing
        if contentChanged { tv.string = text }
        if contentChanged || styleChanged { c.restyle() }
        if contentChanged { c.publishWikiLinkQuery() }
    }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate, @preconcurrency NSLayoutManagerDelegate {
        var parent: RichNoteEditor
        weak var textView: NoteTextView?
        var editing = false
        var hidden = IndexSet()
        var substitutions: [Int: (len: Int, glyph: String)] = [:]
        private var wikiLinkQueryPending = false
        private var publishedWikiLinkQuery: NoteWikiLinkCompletion?
        private var publishedReferenceCompletion: NoteReferenceCompletion?
        private var publishedTableContext = false

        init(_ p: RichNoteEditor) { parent = p }

        // MARK: styling

        func restyle() {
            guard let tv = textView, let storage = tv.textStorage else { return }
            let text = tv.string
            let size = parent.fontSize
            let body = ScriptureFont.nativeFont(parent.fontFamily, size: size)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 3; para.paragraphSpacing = 6
            storage.beginEditing()
            let all = NSRange(location: 0, length: storage.length)
            storage.setAttributes([.font: body, .foregroundColor: NSColor.labelColor, .paragraphStyle: para], range: all)
            hidden = IndexSet(); substitutions = [:]
            var explicitLinks = IndexSet()
            let spans = MarkdownLiveSpans.spans(text)
            for sp in spans where NSMaxRange(sp.range) <= storage.length {
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
                    explicitLinks.insert(integersIn: r.location..<NSMaxRange(r))
                    if let u = URL(string: url) { storage.addAttributes([.link: u, .foregroundColor: NSColor.linkColor, .underlineStyle: NSUnderlineStyle.single.rawValue], range: r) }
                case .wikilink(let target):
                    storage.addAttributes([.link: URL(string: "berean-note:" + (target.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target))!,
                                           .foregroundColor: NSColor.linkColor], range: r)
                case .heading(let level):
                    let scale: [CGFloat] = [1.75, 1.45, 1.25, 1.12, 1.05, 1.0]
                    let hp = NSMutableParagraphStyle(); hp.paragraphSpacingBefore = level <= 2 ? 10 : 6; hp.paragraphSpacing = 4
                    storage.addAttributes([.font: ScriptureFont.nativeFont(parent.fontFamily, size: size * scale[min(level, 6) - 1], weight: level <= 2 ? .bold : .semibold), .paragraphStyle: hp], range: r)
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
                    let cells = MarkdownLiveSpans.tableCells(in: text as NSString, range: r)
                    if !cells.isEmpty {
                        for delimiter in [r.location] + cells.map(\.upperBound) {
                            storage.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor,
                                                 range: NSRange(location: delimiter, length: 1))
                        }
                    }
                case .tableHeader:
                    storage.addAttribute(.font, value: ScriptureFont.nativeFont(parent.fontFamily, size: size, weight: .semibold), range: r)
                case .tableRule, .rule:
                    storage.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor, range: r)
                case .image:
                    storage.addAttributes([.foregroundColor: NSColor.secondaryLabelColor, .backgroundColor: NSColor.quaternaryLabelColor], range: r)
                case .structure: break
                }
            }
            // Scripture references written as plain text link to the passage (original note auto-linking; same
            // berean-note: route the editor already resolves as a passage first).
            if parent.detectVerseReferences {
                for ref in NoteVerseRefs.linkSpans(content: text) where NSMaxRange(ref.range) <= storage.length {
                    // Explicit Markdown links own their label even when it reads like a verse.
                    guard !explicitLinks.intersects(integersIn: ref.range.location..<NSMaxRange(ref.range)) else { continue }
                    guard let url = URL(string: "berean-note:" + (ref.reference.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ref.reference)) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: NSColor.linkColor], range: ref.range)
                }
            }
            // Link explicit Strong's IDs without changing the saved dictionary/prose source.
            if parent.detectStrongsReferences {
                for ref in NoteStrongsLinks.spans(in: text, markdownSpans: spans) where NSMaxRange(ref.range) <= storage.length {
                    guard !explicitLinks.intersects(integersIn: ref.range.location..<NSMaxRange(ref.range)),
                          let url = URL(string: "berean-native-dev://lexicon/" + ref.number) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: NSColor.linkColor], range: ref.range)
                }
            }
            (tv.layoutManager as? NoteTableLayout)?.styleTables(in: storage, spans: spans, paragraph: para, hidden: &hidden)
            // Null glyphs still participate in TextKit background geometry.
            // Highlight only visible text, not hidden delimiters or destinations.
            for range in hidden.rangeView {
                storage.removeAttribute(.backgroundColor, range: NSRange(range))
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
            publishWikiLinkQuery()
        }

        /// Coalesce notifications and deliver outside representable updates. Read the final caret position
        /// after replacements, which notify text changes before updating their selection.
        func publishWikiLinkQuery() {
            guard !wikiLinkQueryPending else { return }
            wikiLinkQueryPending = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.wikiLinkQueryPending = false
                let query = self.textView.flatMap { editor in
                    editor.window?.firstResponder === editor && !editor.hasMarkedText()
                        ? NoteWikiLinkCompletion.detect(in: editor.string, selection: editor.selectedRange()) : nil
                }
                let reference = self.textView.flatMap { editor in
                    editor.window?.firstResponder === editor && !editor.hasMarkedText() && query == nil
                        ? NoteReferenceCompletion.detect(in: editor.string, selection: editor.selectedRange()) : nil
                }
                if query != nil || reference != nil, let editor = self.textView,
                   let window = editor.window, let scroll = editor.enclosingScrollView {
                    let screenRect = editor.firstRect(forCharacterRange: editor.selectedRange(), actualRange: nil)
                    let rect = scroll.convert(window.convertFromScreen(screenRect), from: nil)
                    let y = scroll.isFlipped ? rect.minY - scroll.bounds.minY : scroll.bounds.maxY - rect.maxY
                    self.parent.onWikiLinkAnchor(CGRect(x: rect.minX - scroll.bounds.minX, y: y,
                                                       width: rect.width, height: rect.height))
                }
                // Preserve table context when the toolbar takes focus; formatting uses
                // the native editor's retained selection, not the current first responder.
                let inTable = self.textView.map { editor in
                    noteTableContext(in: (editor.string) as NSString, selection: editor.selectedRange()) != nil
                } ?? false
                if inTable != self.publishedTableContext {
                    self.publishedTableContext = inTable
                    self.parent.onTableContext(inTable)
                }
                if query != self.publishedWikiLinkQuery {
                    self.publishedWikiLinkQuery = query
                    self.parent.onWikiLinkQuery(query)
                }
                if reference != self.publishedReferenceCompletion {
                    self.publishedReferenceCompletion = reference
                    self.parent.onReferenceCompletion(reference)
                }
            }
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            publishWikiLinkQuery()
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            guard !textView.hasMarkedText() else { return false }
            let wiki = NoteWikiLinkCompletion.detect(in: textView.string, selection: textView.selectedRange())
            let reference = wiki == nil ? NoteReferenceCompletion.detect(in: textView.string, selection: textView.selectedRange()) : nil
            // A key can arrive before the coalesced query notification. Let normal
            // editing continue rather than accepting an older result and losing Return.
            guard (wiki != nil && wiki == publishedWikiLinkQuery)
                    || (reference != nil && reference == publishedReferenceCompletion) else { return false }
            let command: NoteWikiLinkCommand
            switch commandSelector {
            case #selector(NSResponder.moveUp(_:)): command = .up
            case #selector(NSResponder.moveDown(_:)): command = .down
            case #selector(NSResponder.insertNewline(_:)): command = .accept
            case #selector(NSResponder.cancelOperation(_:)): command = .dismiss
            default: return false
            }
            return parent.onWikiLinkCommand(command)
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

    override func scrollRangeToVisible(_ range: NSRange) {
        super.scrollRangeToVisible(range)
        coordinator?.publishWikiLinkQuery()
    }

    override func insertNewline(_ sender: Any?) {
        guard !hasMarkedText(),
              let edit = noteBlockReturnEdit(in: string as NSString, selection: selectedRange()) else {
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

    func insertCallout(_ kind: NoteCalloutKind) {
        guard let edit = noteCalloutEdit(in: string as NSString, selection: selectedRange(), kind: kind) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func setList(_ style: NoteListStyle) {
        guard let edit = noteListEdit(in: string as NSString, selection: selectedRange(), style: style) else { return }
        replace(edit.range, with: edit.replacement, select: edit.selection)
    }

    func replace(_ r: NSRange, with s: String, select: NSRange) {
        replaceSource(r, with: s, select: select, actionName: "Format Note")
    }

    /// Formatting/completion is a separate undo action from native typing.
    /// Register the inverse explicitly so later typing cannot extend its undo range.
    func replaceSource(_ range: NSRange, with replacement: String, select selection: NSRange, actionName: String = "Insert Note Link") {
        let source = string as NSString
        guard let storage = textStorage,
              range.location != NSNotFound, range.location >= 0, range.length >= 0, range.location <= source.length,
              range.length <= source.length - range.location else { return }
        let resultingLength = source.length - range.length + replacement.utf16.count
        guard selection.location != NSNotFound, selection.location >= 0, selection.length >= 0, selection.location <= resultingLength,
              selection.length <= resultingLength - selection.location else { return }
        let previousText = source.substring(with: range)
        let previousSelection = selectedRange()
        let inserted = NSRange(location: range.location, length: replacement.utf16.count)
        breakUndoCoalescing()
        let manager = undoManager
        let registrationEnabled = manager?.isUndoRegistrationEnabled == true
        if registrationEnabled { manager?.disableUndoRegistration() }
        // Retain NSTextView's delegate policy, but own the undo record for this replacement.
        let allowed = shouldChangeText(in: range, replacementString: replacement)
        if allowed {
            storage.replaceCharacters(in: range, with: replacement)
            didChangeText()
            setSelectedRange(selection)
        }
        if registrationEnabled { manager?.enableUndoRegistration() }
        guard allowed else { return }
        manager?.registerUndo(withTarget: self) { editor in
            editor.replaceSource(inserted, with: previousText, select: previousSelection, actionName: actionName)
        }
        manager?.setActionName(actionName)
        breakUndoCoalescing()
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
