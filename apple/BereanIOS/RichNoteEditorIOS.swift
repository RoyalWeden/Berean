import SwiftUI
import UIKit
import BereanNotes
import BereanReference

/// iPhone notes editor (ADR-0014): same live-preview model as the Mac editor — Markdown kept verbatim in the text
/// storage, markup hidden as null glyphs, bullets/tasks/callout labels substituted, formatting via the edit menu.
struct RichNoteEditorIOS: UIViewRepresentable {
    @Binding var text: String
    var fontSize: CGFloat = 17
    var fontFamily = "system"
    var detectVerseReferences = true
    var spellCheck = true
    var formatRequest: NoteFormatRequest? = nil
    var onLink: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> NoteUITextView {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        layout.delegate = context.coordinator
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        let tv = NoteUITextView(frame: .zero, textContainer: container)
        tv.coordinator = context.coordinator
        tv.delegate = context.coordinator
        let taskTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.activateTask(_:)))
        taskTap.delegate = context.coordinator
        tv.addGestureRecognizer(taskTap)
        tv.backgroundColor = .clear
        tv.alwaysBounceVertical = true
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.adjustsFontForContentSizeCategory = true
        tv.spellCheckingType = spellCheck ? .yes : .no
        tv.text = text
        tv.accessibilityLabel = "Note text"
        context.coordinator.textView = tv
        tv.inputAccessoryView = context.coordinator.formatBar()
        context.coordinator.restyle()
        return tv
    }

    func updateUIView(_ tv: NoteUITextView, context: Context) {
        let coordinator = context.coordinator
        let styleChanged = coordinator.parent.detectVerseReferences != detectVerseReferences
            || coordinator.parent.fontFamily != fontFamily || coordinator.parent.fontSize != fontSize
        let spellingSettingChanged = coordinator.parent.spellCheck != spellCheck
        let previousRequest = coordinator.parent.formatRequest
        coordinator.parent = self
        if let request = formatRequest, request != previousRequest {
            DispatchQueue.main.async { [weak coordinator, weak tv] in
                guard coordinator?.parent.formatRequest == request, let tv, tv.window != nil else { return }
                switch request.action {
                case .inline(let open, let close): tv.wrap(open, close)
                case .highlight(let color): tv.setHighlight(color)
                case .heading(let level): tv.setHeading(level)
                case .list(let style): tv.setList(style)
                case .callout(let kind): tv.insertCallout(kind)
                case .insertTable: tv.insertTable()
                case .addTableRow: tv.addTableRow()
                case .addTableColumn: tv.addTableColumn()
                case .deleteTableRow: tv.deleteTablePart(columnOnly: false)
                case .deleteTableColumn: tv.deleteTablePart(columnOnly: true)
                case .deleteTable: tv.deleteTable()
                }
                tv.becomeFirstResponder()
            }
        }
        if spellingSettingChanged { tv.spellCheckingType = spellCheck ? .yes : .no }
        let contentChanged = tv.text != text && !coordinator.editing
        if contentChanged { tv.text = text }
        if contentChanged || styleChanged { coordinator.restyle() }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate, @preconcurrency NSLayoutManagerDelegate {
        var parent: RichNoteEditorIOS
        weak var textView: NoteUITextView?
        var editing = false
        private var proseItems: [UIBarButtonItem] = []
        private var cellItems: [UIBarButtonItem] = []
        private weak var previousCellItem: UIBarButtonItem?
        private weak var nextCellItem: UIBarButtonItem?
        private var showingCellNavigation = false

        /// Format bar docked above the keyboard (original iPhone note editor): bold, italic, highlight, heading, list,
        /// checklist, quote, link, and a key to hide the keyboard.
        @MainActor func formatBar() -> UIToolbar {
            let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
            func item(_ symbol: String, _ label: String, _ run: @escaping (NoteUITextView) -> Void) -> UIBarButtonItem {
                let action = UIAction(title: label, image: UIImage(systemName: symbol)) { [weak self] _ in
                    guard let tv = self?.textView else { return }
                    run(tv)
                    UISelectionFeedbackGenerator().selectionChanged()
                }
                let b = UIBarButtonItem(primaryAction: action)
                b.accessibilityLabel = label
                return b
            }
            let flex = UIBarButtonItem.flexibleSpace()
            let formatting = [
                item("arrow.uturn.backward", "Undo") { $0.undoManager?.undo() }, flex,
                item("arrow.uturn.forward", "Redo") { $0.undoManager?.redo() }, flex,
                item("bold", "Bold") { $0.wrap("**", "**") }, flex,
                item("italic", "Italic") { $0.wrap("*", "*") }, flex,
                item("highlighter", "Highlight") { $0.setHighlight(nil) }, flex,
                item("textformat.size", "Heading") { $0.setHeading(2) }, flex,
                item("list.bullet", "Bulleted List") { $0.setList(.bullet) }, flex,
                item("checklist", "Checklist") { $0.setList(.checklist) }, flex,
            ]
            let dismiss = item("keyboard.chevron.compact.down", "Hide Keyboard") { $0.resignFirstResponder() }
            proseItems = formatting + [
                item("text.quote", "Quote") { $0.wrap("\n> ", "") }, flex,
                item("link", "Link") { $0.wrap("[", "](https://)") }, flex,
                dismiss,
            ]
            let next = item("chevron.forward", "Next Cell") { $0.moveTableCell(from: $0.selectedRange, backwards: false) }
            let previous = item("chevron.backward", "Previous Cell") { $0.moveTableCell(from: $0.selectedRange, backwards: true) }
            previousCellItem = previous
            nextCellItem = next
            cellItems = formatting + [previous, flex, next, flex, dismiss]
            bar.items = proseItems
            bar.sizeToFit()
            return bar
        }

        private func updateTableNavigation() {
            guard let tv = textView, let bar = tv.inputAccessoryView as? UIToolbar else { return }
            let previous = tv.tableCellDestination(backwards: true) != nil
            let next = tv.tableCellDestination(backwards: false) != nil
            let showCells = previous || next
            if showCells != showingCellNavigation {
                showingCellNavigation = showCells
                bar.setItems(showCells ? cellItems : proseItems, animated: false)
            }
            if showCells {
                previousCellItem?.isEnabled = previous
                nextCellItem?.isEnabled = next
            }
        }
        var hidden = IndexSet()
        var substitutions: [Int: (len: Int, glyph: String)] = [:]
        init(_ p: RichNoteEditorIOS) { parent = p }

        func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, traits: UIFontDescriptor.SymbolicTraits = []) -> UIFont {
            let base = ScriptureFont.nativeFont(parent.fontFamily, size: size, weight: weight)
            guard !traits.isEmpty, let d = base.fontDescriptor.withSymbolicTraits(base.fontDescriptor.symbolicTraits.union(traits)) else { return base }
            return UIFont(descriptor: d, size: size)
        }

        func restyle() {
            guard let tv = textView else { return }
            let storage = tv.textStorage
            let text = tv.text ?? ""
            let size = UIFontMetrics(forTextStyle: .body).scaledValue(for: parent.fontSize)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 3; para.paragraphSpacing = 6
            let all = NSRange(location: 0, length: storage.length)
            let sel = tv.selectedRange
            storage.beginEditing()
            storage.setAttributes([.font: font(size), .foregroundColor: UIColor.label, .paragraphStyle: para], range: all)
            hidden = IndexSet(); substitutions = [:]
            for sp in MarkdownLiveSpans.spans(text) where NSMaxRange(sp.range) <= storage.length {
                let r = sp.range
                switch sp.kind {
                case .hidden: hidden.insert(integersIn: r.location..<NSMaxRange(r))
                case .bold: addTraits(.traitBold, r, storage)
                case .italic: addTraits(.traitItalic, r, storage)
                case .strike: storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .underline: storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .code: storage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: size * 0.92, weight: .regular), .backgroundColor: UIColor.tertiarySystemFill], range: r)
                case .highlight(let c): storage.addAttribute(.backgroundColor, value: UIColor(Color.highlight(c ?? "yellow")).withAlphaComponent(0.35), range: r)
                case .link(let url): if let u = URL(string: url) { storage.addAttribute(.link, value: u, range: r) }
                case .wikilink(let t): storage.addAttribute(.link, value: URL(string: "berean-note:" + (t.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? t))!, range: r)
                case .heading(let level):
                    let scale: [CGFloat] = [1.6, 1.35, 1.2, 1.1, 1.05, 1.0]
                    storage.addAttribute(.font, value: font(size * scale[min(level, 6) - 1], level <= 2 ? .bold : .semibold), range: r)
                case .quote:
                    let qp = NSMutableParagraphStyle(); qp.headIndent = 16; qp.firstLineHeadIndent = 16
                    storage.addAttributes([.paragraphStyle: qp, .foregroundColor: UIColor.secondaryLabel], range: r)
                case .calloutLabel(let t):
                    substitutions[r.location] = (r.length, String((t.capitalized + ": ").prefix(r.length)))
                    storage.addAttributes([.font: font(size, .semibold), .foregroundColor: UIColor.tintColor], range: r)
                case .bullet: substitutions[r.location] = (r.length, "•"); storage.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: r)
                case .task(let on):
                    substitutions[r.location] = (r.length, on ? "☑" : "□")
                    storage.addAttribute(Self.taskAttribute, value: NoteTaskLink.url(for: r), range: NSRange(location: r.location, length: 1))
                case .codeBlock: storage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .regular), .backgroundColor: UIColor.secondarySystemFill], range: r)
                case .tableRow:
                    storage.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .regular), range: r)
                    let cells = MarkdownLiveSpans.tableCells(in: text as NSString, range: r)
                    if !cells.isEmpty {
                        for delimiter in [r.location] + cells.map(\.upperBound) {
                            storage.addAttribute(.foregroundColor, value: UIColor.tertiaryLabel,
                                                 range: NSRange(location: delimiter, length: 1))
                        }
                    }
                case .tableHeader:
                    storage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .semibold),
                                           .backgroundColor: UIColor.tertiarySystemFill], range: r)
                case .tableRule, .rule:
                    storage.addAttributes([.foregroundColor: UIColor.tertiaryLabel,
                                           .font: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .regular)], range: r)
                case .image: storage.addAttributes([.foregroundColor: UIColor.secondaryLabel, .backgroundColor: UIColor.tertiarySystemFill], range: r)
                case .structure: break
                }
            }
            // Scripture references written as plain text link to the passage (original note auto-linking; same
            // berean-note: route the editor already resolves as a passage first).
            if parent.detectVerseReferences {
                for ref in NoteVerseRefs.linkSpans(content: text) where NSMaxRange(ref.range) <= storage.length {
                    guard let url = URL(string: "berean-note:" + (ref.reference.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ref.reference)) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: UIColor.link], range: ref.range)
                }
            }
            storage.endEditing()
            tv.layoutManager.invalidateGlyphs(forCharacterRange: all, changeInLength: 0, actualCharacterRange: nil)
            tv.layoutManager.invalidateLayout(forCharacterRange: all, actualCharacterRange: nil)
            if NSMaxRange(sel) <= storage.length { tv.selectedRange = sel }
            tv.typingAttributes = [.font: font(size), .foregroundColor: UIColor.label, .paragraphStyle: para]
        }

        func addTraits(_ t: UIFontDescriptor.SymbolicTraits, _ r: NSRange, _ storage: NSTextStorage) {
            storage.enumerateAttribute(.font, in: r) { v, sub, _ in
                let f = (v as? UIFont) ?? font(parent.fontSize)
                if let d = f.fontDescriptor.withSymbolicTraits(f.fontDescriptor.symbolicTraits.union(t)) { storage.addAttribute(.font, value: UIFont(descriptor: d, size: f.pointSize), range: sub) }
            }
        }

        func layoutManager(_ layoutManager: NSLayoutManager, shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>, properties props: UnsafePointer<NSLayoutManager.GlyphProperty>,
                           characterIndexes charIndexes: UnsafePointer<Int>, font aFont: UIFont, forGlyphRange glyphRange: NSRange) -> Int {
            let n = glyphRange.length
            var newProps = Array(UnsafeBufferPointer(start: props, count: n))
            var newGlyphs = Array(UnsafeBufferPointer(start: glyphs, count: n))
            var changed = false, pending: [UniChar] = [], subLeft = 0
            for i in 0..<n {
                let ci = charIndexes[i]
                if let sub = substitutions[ci] { pending = Array(sub.glyph.utf16); subLeft = sub.len }
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

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard let dash = NoteAutoEmDash.dashRange(in: textView.text as NSString, range: range, replacement: text),
                  let start = textView.position(from: textView.beginningOfDocument, offset: dash.location),
                  let end = textView.position(from: start, offset: dash.length),
                  let span = textView.textRange(from: start, to: end) else { return true }
            textView.replace(span, withText: "—")
            return false
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            NotificationCenter.default.post(name: .bereanNoteEditing, object: true)
            updateTableNavigation()
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            NotificationCenter.default.post(name: .bereanNoteEditing, object: false)
        }

        func textViewDidChange(_ textView: UITextView) {
            editing = true
            parent.text = textView.text
            restyle()
            editing = false
            updateTableNavigation()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            defer { updateTableNavigation() }
            let r = textView.selectedRange
            guard r.length == 0, hidden.contains(r.location) else { return }
            var loc = r.location
            let len = (textView.text as NSString).length
            while hidden.contains(loc), loc < len { loc += 1 }
            textView.selectedRange = NSRange(location: loc, length: 0)
        }

        private static let taskAttribute = NSAttributedString.Key("BereanNoteTask")

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            taskLink(at: gestureRecognizer) != nil
        }

        @objc func activateTask(_ gestureRecognizer: UITapGestureRecognizer) {
            guard let url = taskLink(at: gestureRecognizer) else { return }
            (textView as? NoteUITextView)?.toggleTask(url)
        }

        private func taskLink(at gestureRecognizer: UIGestureRecognizer) -> URL? {
            guard let editor = textView, editor.markedTextRange == nil else { return nil }
            let container = editor.textContainer
            var point = gestureRecognizer.location(in: editor)
            point.x -= editor.textContainerInset.left
            point.y -= editor.textContainerInset.top
            let layout = editor.layoutManager
            let glyph = layout.glyphIndex(for: point, in: container)
            guard glyph < layout.numberOfGlyphs,
                  layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(point) else { return nil }
            let index = layout.characterIndexForGlyph(at: glyph)
            guard index < editor.textStorage.length,
                  let url = editor.textStorage.attribute(Self.taskAttribute, at: index, effectiveRange: nil) as? URL,
                  url.scheme == NoteTaskLink.scheme else { return nil }
            return url
        }

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case .link(let url) = textItem.content else { return defaultAction }
            return UIAction { [weak self] _ in self?.parent.onLink(url) }
        }

        /// Edit menu: formatting and Copy as Plain Text join the standard items.
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let tv = textView as? NoteUITextView else { return nil }
            let format = UIMenu(title: "Format", image: UIImage(systemName: "textformat"), children: [
                UIAction(title: "Bold", image: UIImage(systemName: "bold")) { _ in tv.wrap("**", "**") },
                UIAction(title: "Italic", image: UIImage(systemName: "italic")) { _ in tv.wrap("*", "*") },
                UIAction(title: "Underline", image: UIImage(systemName: "underline")) { _ in tv.wrap("<u>", "</u>") },
                UIAction(title: "Strikethrough", image: UIImage(systemName: "strikethrough")) { _ in tv.wrap("~~", "~~") },
                UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { _ in tv.setHighlight(nil) },
            ])
            var items = suggestedActions
            if range.length > 0 { items.insert(UIAction(title: "Copy as Plain Text", image: UIImage(systemName: "doc.plaintext")) { _ in tv.copyPlain() }, at: 0) }
            let tableActions = tv.tableNavigationActions(for: range)
            if !tableActions.isEmpty {
                items.insert(UIMenu(title: "Table", image: UIImage(systemName: "tablecells"),
                                    children: tableActions), at: 0)
            }
            items.insert(format, at: 0)
            return UIMenu(children: items)
        }
    }
}

final class NoteUITextView: UITextView {
    weak var coordinator: RichNoteEditorIOS.Coordinator?
    static let markdownType = "com.berean.note-markdown"

    override var keyCommands: [UIKeyCommand]? {
        var commands = super.keyCommands ?? []
        for backwards in [false, true] where tableCellDestination(backwards: backwards) != nil {
            let command = UIKeyCommand(input: "\t", modifierFlags: backwards ? .shift : [],
                                       action: #selector(moveTableCell(_:)))
            command.wantsPriorityOverSystemBehavior = true
            commands.append(command)
        }
        return commands
    }

    func tableCellDestination(backwards: Bool) -> NSRange? {
        guard markedTextRange == nil else { return nil }
        return noteTableCellDestination(in: (text ?? "") as NSString, selection: selectedRange,
                                        backwards: backwards)
    }

    func tableNavigationActions(for selection: NSRange) -> [UIAction] {
        guard markedTextRange == nil else { return [] }
        let source = (text ?? "") as NSString
        return [true, false].compactMap { backwards in
            guard noteTableCellDestination(in: source, selection: selection, backwards: backwards) != nil else {
                return nil
            }
            return UIAction(title: backwards ? "Previous Cell" : "Next Cell",
                            image: UIImage(systemName: backwards ? "chevron.backward" : "chevron.forward")) { [weak self] _ in
                guard let self, (self.text ?? "") == source as String else { return }
                self.moveTableCell(from: selection, backwards: backwards)
            }
        }
    }

    @objc private func moveTableCell(_ command: UIKeyCommand) {
        moveTableCell(from: selectedRange, backwards: command.modifierFlags.contains(.shift))
    }

    func moveTableCell(from selection: NSRange, backwards: Bool) {
        guard markedTextRange == nil,
              let destination = noteTableCellDestination(in: (text ?? "") as NSString, selection: selection,
                                                         backwards: backwards) else { return }
        selectedRange = destination
        scrollRangeToVisible(destination)
    }

    override func insertText(_ text: String) {
        guard text == "\n", markedTextRange == nil,
              let edit = noteListReturnEdit(in: (self.text ?? "") as NSString, selection: selectedRange) else {
            super.insertText(text)
            return
        }
        applyFormatEdit(edit)
    }

    func wrap(_ open: String, _ close: String) {
        applyFormatEdit(noteFormatEdit(in: (text ?? "") as NSString, selection: selectedRange, opening: open, closing: close))
    }

    func setHighlight(_ color: String?) {
        applyFormatEdit(noteHighlightEdit(in: (text ?? "") as NSString, selection: selectedRange, color: color))
    }

    func setHeading(_ level: Int) {
        applyFormatEdit(noteHeadingEdit(in: (text ?? "") as NSString, selection: selectedRange, level: level))
    }

    func toggleTask(_ url: URL) {
        guard let edit = NoteTaskLink.edit(for: url, in: (text ?? "") as NSString) else { return }
        applyFormatEdit((edit.range, edit.replacement, selectedRange))
    }

    func deleteTable() {
        guard let edit = noteWholeTableDeletion(in: (text ?? "") as NSString, selection: selectedRange) else { return }
        applyFormatEdit(edit)
    }

    func deleteTablePart(columnOnly: Bool) {
        guard let edit = noteTableDeletion(in: (text ?? "") as NSString, selection: selectedRange,
                                           columnOnly: columnOnly) else { return }
        applyFormatEdit(edit)
    }

    func addTableColumn() {
        guard let edit = noteTableColumnInsertion(in: (text ?? "") as NSString, selection: selectedRange) else { return }
        applyFormatEdit(edit)
    }

    func addTableRow() {
        guard let edit = noteTableRowInsertion(in: (text ?? "") as NSString, selection: selectedRange) else { return }
        applyFormatEdit(edit)
    }

    func insertTable() {
        guard let edit = noteTableInsertion(in: (text ?? "") as NSString, selection: selectedRange) else { return }
        applyFormatEdit(edit)
    }

    func insertCallout(_ kind: NoteCalloutKind) {
        applyFormatEdit(noteCalloutEdit(in: (text ?? "") as NSString, selection: selectedRange, kind: kind))
    }

    func setList(_ style: NoteListStyle) {
        applyFormatEdit(noteListEdit(in: (text ?? "") as NSString, selection: selectedRange, style: style))
    }

    private func applyFormatEdit(_ edit: (range: NSRange, replacement: String, selection: NSRange)?) {
        guard let edit,
              let start = position(from: beginningOfDocument, offset: edit.range.location),
              let end = position(from: start, offset: edit.range.length),
              let range = textRange(from: start, to: end) else { return }
        replace(range, withText: edit.replacement)
        selectedRange = edit.selection
    }

    func copyPlain() {
        UIPasteboard.general.string = MarkdownLiveSpans.plainText(text ?? "", range: selectedRange)
    }

    override func copy(_ sender: Any?) {
        let r = selectedRange
        guard r.length > 0 else { return }
        let s = text ?? ""
        UIPasteboard.general.items = [[Self.markdownType: (s as NSString).substring(with: r), "public.utf8-plain-text": MarkdownLiveSpans.plainText(s, range: r)]]
    }

    override func paste(_ sender: Any?) {
        let pb = UIPasteboard.general
        let md = pb.items.first?[Self.markdownType] as? String
        guard let s = md ?? pb.string, !s.isEmpty else { return }
        super.insertText(s)
    }
}


extension Notification.Name {
    /// Posted with `true` / `false` when the note editor starts / stops editing (the root view hides the dock meanwhile).
    static let bereanNoteEditing = Notification.Name("bereanNoteEditing")
}
