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
    var detectStrongsReferences = true
    var scriptureBlocks: [NoteScriptureBlock] = []
    var hermasEdition = HermasText.robertsDonaldson
    var spellCheck = true
    var formatRequest: NoteFormatRequest? = nil
    var onWikiLinkQuery: (NoteWikiLinkCompletion?) -> Void = { _ in }
    var onWikiLinkAnchor: (CGRect) -> Void = { _ in }
    var onReferenceCompletion: (NoteReferenceCompletion?) -> Void = { _ in }
    var onSlashCompletion: (NoteSlashCompletion?) -> Void = { _ in }
    var onTableContext: (Bool) -> Void = { _ in }
    var onWikiLinkCommand: (NoteWikiLinkCommand) -> Bool = { _ in false }
    var onInsertLink: (NSRange) -> Void = { _ in }
    var onLink: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> NoteUITextView {
        let storage = NSTextStorage()
        let layout = NoteTableLayout()
        layout.delegate = context.coordinator
        storage.addLayoutManager(layout)
        let container = NoteTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        let tv = NoteUITextView(frame: .zero, textContainer: container)
        tv.coordinator = context.coordinator
        tv.delegate = context.coordinator
        let taskTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.activateTask(_:)))
        taskTap.delegate = context.coordinator
        tv.addGestureRecognizer(taskTap)
        tv.backgroundColor = .clear
        tv.textContainerInset = UIEdgeInsets(top: 6, left: 0, bottom: 16, right: 0)
        container.lineFragmentPadding = 0
        tv.alwaysBounceVertical = true
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        // TextKit runs carry explicit fonts, so refresh the entire attributed layout.
        tv.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
            (editor: NoteUITextView, _: UITraitCollection) in
            editor.coordinator?.restyle()
        }
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
            || coordinator.parent.detectStrongsReferences != detectStrongsReferences
            || coordinator.parent.scriptureBlocks != scriptureBlocks || coordinator.parent.hermasEdition != hermasEdition
            || coordinator.parent.fontFamily != fontFamily || coordinator.parent.fontSize != fontSize
        let spellingSettingChanged = coordinator.parent.spellCheck != spellCheck
        let previousRequest = coordinator.parent.formatRequest
        coordinator.parent = self
        if let request = formatRequest, request != previousRequest {
            DispatchQueue.main.async { [weak coordinator, weak tv] in
                guard coordinator?.parent.formatRequest == request, let tv, tv.window != nil else { return }
                switch request.action {
                case .inline(let open, let close): tv.wrap(open, close)
                case .link(let destination, let selection): tv.insertLink(destination, at: selection ?? tv.selectedRange)
                case .wikiLink(let completion, let title):
                    guard tv.markedTextRange == nil,
                          let edit = completion.edit(in: tv.text ?? "", selection: tv.selectedRange, title: title) else { return }
                    tv.applyWikiLinkEdit(edit)
                case .referenceBlock(let completion, let replacement):
                    guard tv.markedTextRange == nil,
                          let edit = completion.edit(in: tv.text ?? "", selection: tv.selectedRange, replacement: replacement) else { return }
                    tv.applyWikiLinkEdit(edit)
                case .slash(let completion, let replacement, let caret):
                    guard tv.markedTextRange == nil,
                          let edit = completion.edit(in: tv.text ?? "", selection: tv.selectedRange, replacement: replacement, caretOffset: caret) else { return }
                    tv.applyWikiLinkEdit(edit)
                case .highlight(let color): tv.setHighlight(color)
                case .removeHighlight: tv.removeHighlight()
                case .inlineCode: tv.toggleInlineCode()
                case .heading(let level): tv.setHeading(level)
                case .list(let style): tv.setList(style)
                case .callout(let kind): tv.insertCallout(kind)
                case .insertTable: tv.insertTable()
                case .insertImage(let markdown): tv.insertImageMarkdown(markdown)
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
        if (contentChanged || styleChanged) && tv.markedTextRange == nil { coordinator.restyle() }
        coordinator.scheduleWikiLinkQuery()
    }

    static func dismantleUIView(_ textView: NoteUITextView, coordinator: Coordinator) {
        // UIKit does not guarantee didEndEditing when SwiftUI removes a focused
        // editor (for example, Trash). Finish this owner's signal after teardown.
        textView.delegate = nil
        textView.resignFirstResponder()
        coordinator.finishEditingSession(deferred: true)
        coordinator.textView = nil
        textView.coordinator = nil
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate, @preconcurrency NSLayoutManagerDelegate {
        var parent: RichNoteEditorIOS
        weak var textView: NoteUITextView?
        var editing = false
        private let focusOwner = UUID()
        private var hasEditingSession = false

        func finishEditingSession(deferred: Bool = false) {
            guard hasEditingSession else { return }
            hasEditingSession = false
            let activity = NoteEditorActivity(owner: focusOwner, isEditing: false)
            if deferred {
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .bereanNoteEditing, object: activity)
                }
            } else {
                NotificationCenter.default.post(name: .bereanNoteEditing, object: activity)
            }
        }
        private var wikiLinkQueryScheduled = false
        private var publishedWikiLinkQuery: NoteWikiLinkCompletion?
        private var publishedReferenceCompletion: NoteReferenceCompletion?
        private var publishedSlashCompletion: NoteSlashCompletion?
        private var publishedTableContext = false
        private var publishedWikiLinkAnchor: CGRect?

        /// Read the final UIKit selection after styling and SwiftUI updates settle.
        func scheduleWikiLinkQuery() {
            guard !wikiLinkQueryScheduled else { return }
            wikiLinkQueryScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.wikiLinkQueryScheduled = false
                let query: NoteWikiLinkCompletion?
                if let editor = self.textView, editor.isFirstResponder, editor.markedTextRange == nil {
                    query = NoteWikiLinkCompletion.detect(in: editor.text ?? "", selection: editor.selectedRange)
                } else {
                    query = nil
                }
                let reference: NoteReferenceCompletion?
                if query == nil, let editor = self.textView, editor.isFirstResponder, editor.markedTextRange == nil {
                    reference = NoteReferenceCompletion.detect(in: editor.text ?? "", selection: editor.selectedRange)
                } else { reference = nil }
                let slash: NoteSlashCompletion?
                if query == nil, reference == nil, let editor = self.textView, editor.isFirstResponder, editor.markedTextRange == nil {
                    slash = NoteSlashCompletion.detect(in: editor.text ?? "", selection: editor.selectedRange)
                } else { slash = nil }
                if query != nil || reference != nil || slash != nil, let editor = self.textView, let selection = editor.selectedTextRange {
                    let anchor = editor.caretRect(for: selection.end)
                        .offsetBy(dx: -editor.bounds.origin.x, dy: -editor.bounds.origin.y)
                    if anchor != self.publishedWikiLinkAnchor {
                        self.publishedWikiLinkAnchor = anchor
                        self.parent.onWikiLinkAnchor(anchor)
                    }
                } else {
                    self.publishedWikiLinkAnchor = nil
                }
                // Preserve table context when the toolbar takes focus; formatting uses
                // the native editor's retained selection, not the current first responder.
                let inTable = self.textView.map { editor in
                    noteTableContext(in: (editor.text ?? "") as NSString, selection: editor.selectedRange) != nil
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
                if slash != self.publishedSlashCompletion {
                    self.publishedSlashCompletion = slash
                    self.parent.onSlashCompletion(slash)
                }
            }
        }
        private var proseItems: [UIBarButtonItem] = []
        private var cellItems: [UIBarButtonItem] = []
        private weak var undoItem: UIBarButtonItem?
        private weak var redoItem: UIBarButtonItem?
        private var showingCellNavigation = false

        /// Keep the keyboard accessory spacious; text styles live in a native
        /// menu and the table button follows the editor's retained selection.
        @MainActor func formatBar() -> UIToolbar {
            let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
            bar.autoresizingMask = [.flexibleWidth]
            func action(_ symbol: String, _ label: String, attributes: UIMenuElement.Attributes = [],
                        _ run: @escaping (NoteUITextView) -> Void) -> UIAction {
                UIAction(title: label, image: UIImage(systemName: symbol), attributes: attributes) { [weak self] _ in
                    guard let self, let tv = self.textView else { return }
                    run(tv)
                    readerNavigationFeedback()
                    self.updateTableNavigation()
                }
            }
            func item(_ symbol: String, _ label: String, _ run: @escaping (NoteUITextView) -> Void) -> UIBarButtonItem {
                let button = UIBarButtonItem(primaryAction: action(symbol, label, run))
                button.accessibilityLabel = label
                return button
            }
            func menuItem(_ symbol: String, _ label: String, menu: UIMenu) -> UIBarButtonItem {
                let button = UIBarButtonItem(image: UIImage(systemName: symbol), primaryAction: nil, menu: menu)
                button.accessibilityLabel = label
                return button
            }
            func formattingMenu(inTable: Bool) -> UIMenu {
                let colors = (highlightColors + ["orange"]).map { color in
                    action("highlighter", color.capitalized) { $0.setHighlight(color) }
                }
                let highlight = UIMenu(title: "Highlight", image: UIImage(systemName: "highlighter"), children: [
                    action("highlighter", "Default") { $0.setHighlight(nil) }
                ] + colors + [action("eraser", "Remove Highlight") { $0.removeHighlight() }])
                var groups: [UIMenuElement] = [UIMenu(options: .displayInline, children: [
                    action("bold", "Bold") { $0.wrap("**", "**") },
                    action("italic", "Italic") { $0.wrap("*", "*") },
                    action("underline", "Underline") { $0.wrap("<u>", "</u>") },
                    action("strikethrough", "Strikethrough") { $0.wrap("~~", "~~") },
                    highlight,
                    action("chevron.left.forwardslash.chevron.right", "Inline Code") { $0.toggleInlineCode() }
                ])]
                if !inTable {
                    let headings = [action("text.alignleft", "Body") { $0.setHeading(0) }]
                        + (1...3).map { level in action("textformat.size", "Heading \(level)") { $0.setHeading(level) } }
                    let lists = NoteListStyle.allCases.map { style in
                        action(style.symbol, style.title) { $0.setList(style) }
                    }
                    groups.append(UIMenu(options: .displayInline, children: [
                        UIMenu(title: "Paragraph Style", image: UIImage(systemName: "textformat.size"), children: headings),
                        UIMenu(title: "Lists", image: UIImage(systemName: "list.bullet"), children: lists),
                        action("text.quote", "Quote") { $0.wrap("\n> ", "") }
                    ]))
                }
                groups.append(UIMenu(options: .displayInline, children: [
                    action("link", "Insert Link…") { [weak self] in self?.parent.onInsertLink($0.selectedRange) }
                ]))
                return UIMenu(children: groups)
            }
            func grouped(_ groups: [[UIBarButtonItem]]) -> [UIBarButtonItem] {
                // Adjacent items share UIKit's native glass. Separate related
                // groups rather than spending a whole glass capsule per icon.
                groups.enumerated().flatMap { index, buttons in
                    index == 0 ? buttons : [.flexibleSpace()] + buttons
                }
            }
            let undo = item("arrow.uturn.backward", "Undo") { $0.undoManager?.undo() }
            let redo = item("arrow.uturn.forward", "Redo") { $0.undoManager?.redo() }
            undoItem = undo
            redoItem = redo
            let dismiss = item("keyboard.chevron.compact.down", "Hide Keyboard") { $0.resignFirstResponder() }
            proseItems = grouped([
                [undo, redo],
                [menuItem("textformat", "Formatting", menu: formattingMenu(inTable: false)),
                 item("tablecells", "Insert Table") { $0.insertTable() },
                 item("checklist", "Checklist") { $0.setList(.checklist) }],
                [dismiss]
            ])
            let navigation = UIDeferredMenuElement.uncached { [weak self] completion in
                guard let self, let tv = self.textView else { completion([]); return }
                let actions = [true, false].map { backwards in
                    UIAction(title: backwards ? "Previous Cell" : "Next Cell",
                             image: UIImage(systemName: backwards ? "chevron.backward" : "chevron.forward"),
                             attributes: tv.tableCellDestination(backwards: backwards) == nil ? .disabled : []) { [weak self] _ in
                        guard let self, let editor = self.textView else { return }
                        editor.moveTableCell(from: editor.selectedRange, backwards: backwards)
                        readerNavigationFeedback()
                        self.updateTableNavigation()
                    }
                }
                completion([UIMenu(options: .displayInline, children: actions)])
            }
            let table = UIMenu(children: [
                navigation,
                UIMenu(options: .displayInline, children: [
                    action("rectangle.split.1x2", "Add Row Below") { $0.addTableRow() },
                    action("rectangle.split.2x1", "Add Column After") { $0.addTableColumn() }
                ]),
                UIMenu(options: .displayInline, children: [
                    action("minus.rectangle", "Delete Row", attributes: .destructive) { $0.deleteTablePart(columnOnly: false) },
                    action("minus.rectangle.portrait", "Delete Column", attributes: .destructive) { $0.deleteTablePart(columnOnly: true) },
                    action("trash", "Delete Table", attributes: .destructive) { $0.deleteTable() }
                ])
            ])
            cellItems = grouped([
                [undo, redo],
                [menuItem("textformat", "Formatting", menu: formattingMenu(inTable: true)),
                 menuItem("tablecells", "Table Options", menu: table)],
                [dismiss]
            ])
            bar.items = proseItems
            bar.sizeToFit()
            return bar
        }

        private func updateTableNavigation() {
            guard let tv = textView, let bar = tv.inputAccessoryView as? UIToolbar else { return }
            undoItem?.isEnabled = tv.undoManager?.canUndo == true
            redoItem?.isEnabled = tv.undoManager?.canRedo == true
            let showCells = noteTableContext(in: (tv.text ?? "") as NSString, selection: tv.selectedRange) != nil
            if showCells != showingCellNavigation {
                showingCellNavigation = showCells
                bar.setItems(showCells ? cellItems : proseItems, animated: false)
            }
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--qa-note-keyboard-trace") {
                let text = (tv.text ?? "") as NSString
                let selection = tv.selectedRange
                let valid = selection.location <= text.length && selection.length <= text.length - selection.location
                let line = valid ? text.lineRange(for: selection) : NSRange(location: 0, length: 0)
                let row: [String: Any] = ["selection": NSStringFromRange(selection), "line": NSStringFromRange(line),
                    "lineFirstCharacter": line.length > 0 ? Int(text.character(at: line.location)) : -1,
                    "inTable": showCells, "items": bar.items?.map { $0.accessibilityLabel ?? "space" } ?? [],
                    "barWidth": bar.bounds.width, "editorWidth": tv.bounds.width, "windowWidth": tv.window?.bounds.width ?? 0,
                    "isFirstResponder": tv.isFirstResponder]
                if let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) {
                    try? data.write(to: UserLibrary.directory.appendingPathComponent("note-keyboard-context.json"), options: .atomic)
                }
            }
            #endif
        }
        var hidden = IndexSet()
        var substitutions: [Int: (len: Int, glyph: String)] = [:]
        private var remoteImageObserver: NSObjectProtocol?

        init(_ p: RichNoteEditorIOS) {
            parent = p
            super.init()
            // A remote (https) image finished downloading: reserve its space and draw it.
            remoteImageObserver = NotificationCenter.default.addObserver(forName: NoteTableLayout.remoteImageLoaded, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.restyle() }
            }
        }

        func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, traits: UIFontDescriptor.SymbolicTraits = []) -> UIFont {
            let base = ScriptureFont.nativeFont(parent.fontFamily, size: size, weight: weight)
            guard !traits.isEmpty, let d = base.fontDescriptor.withSymbolicTraits(base.fontDescriptor.symbolicTraits.union(traits)) else { return base }
            return UIFont(descriptor: d, size: size)
        }

        func restyle() {
            guard let tv = textView, tv.markedTextRange == nil else { return }
            let storage = tv.textStorage
            let text = tv.text ?? ""
            let size = UIFontMetrics(forTextStyle: .body).scaledValue(for: parent.fontSize, compatibleWith: tv.traitCollection)
            let para = NSMutableParagraphStyle(); para.lineSpacing = 3; para.paragraphSpacing = 6
            let all = NSRange(location: 0, length: storage.length)
            let sel = tv.selectedRange
            storage.beginEditing()
            storage.setAttributes([.font: font(size), .foregroundColor: UIColor.label, .paragraphStyle: para], range: all)
            hidden = IndexSet(); substitutions = [:]
            var explicitLinks = IndexSet()
            let spans = MarkdownLiveSpans.spans(text)
            for sp in spans where NSMaxRange(sp.range) <= storage.length {
                let r = sp.range
                switch sp.kind {
                case .hidden: hidden.insert(integersIn: r.location..<NSMaxRange(r))
                case .bold: addTraits(.traitBold, r, storage)
                case .italic: addTraits(.traitItalic, r, storage)
                case .strike: storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .underline: storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                case .code: storage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: size * 0.92, weight: .regular), .backgroundColor: UIColor.tertiarySystemFill], range: r)
                case .highlight(let c): storage.addAttribute(.backgroundColor, value: UIColor(Color.highlight(c ?? "yellow")).withAlphaComponent(0.35), range: r)
                case .link(let url):
                    explicitLinks.insert(integersIn: r.location..<NSMaxRange(r))
                    if let u = URL(string: url) { storage.addAttribute(.link, value: u, range: r) }
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
                    let cells = MarkdownLiveSpans.tableCells(in: text as NSString, range: r)
                    if !cells.isEmpty {
                        for delimiter in [r.location] + cells.map(\.upperBound) {
                            storage.addAttribute(.foregroundColor, value: UIColor.tertiaryLabel,
                                                 range: NSRange(location: delimiter, length: 1))
                        }
                    }
                case .tableHeader:
                    storage.addAttribute(.font, value: font(size, .semibold), range: r)
                case .tableRule, .rule:
                    storage.addAttribute(.foregroundColor, value: UIColor.tertiaryLabel, range: r)
                case .image: storage.addAttributes([.foregroundColor: UIColor.secondaryLabel, .font: UIFont.systemFont(ofSize: size * 0.85)], range: r)
                case .structure: break
                }
            }
            // Image sources (base64) are blanked for the reference scanners: same ranges, no per-keystroke scan.
            let scanText = NoteImages.maskingSources(text)
            // Scripture references written as plain text link to the passage (original note auto-linking; same
            // berean-note: route the editor already resolves as a passage first).
            if parent.detectVerseReferences {
                for ref in NoteVerseRefs.linkSpans(content: scanText, hermas: parent.hermasEdition) where NSMaxRange(ref.range) <= storage.length {
                    // Explicit Markdown links own their label even when it reads like a verse.
                    guard !explicitLinks.intersects(integersIn: ref.range.location..<NSMaxRange(ref.range)) else { continue }
                    guard let url = URL(string: "berean-note:" + (ref.reference.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ref.reference)) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: UIColor.link], range: ref.range)
                }
            }
            // A verified block can use richer reference grammar (Hermas sections,
            // comma-separated book names) than the legacy inline scanner.
            if parent.detectVerseReferences {
                for block in parent.scriptureBlocks where block.isCurrent(in: text) {
                    guard let url = URL(string: "berean-note:" + (block.reference.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? block.reference)) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: UIColor.link], range: block.referenceRange)
                }
            }
            // Link explicit Strong's IDs without changing the saved dictionary/prose source.
            if parent.detectStrongsReferences {
                for ref in NoteStrongsLinks.spans(in: scanText, markdownSpans: spans) where NSMaxRange(ref.range) <= storage.length {
                    guard !explicitLinks.intersects(integersIn: ref.range.location..<NSMaxRange(ref.range)),
                          let url = URL(string: "berean-native-dev://lexicon/" + ref.number) else { continue }
                    storage.addAttributes([.link: url, .foregroundColor: UIColor.link], range: ref.range)
                }
            }
            (tv.layoutManager as? NoteTableLayout)?.styleReferenceBlocks(in: storage, spans: spans,
                scriptureBlocks: parent.scriptureBlocks, paragraph: para,
                headingAttributes: [.font: font(size, .semibold)])
            (tv.layoutManager as? NoteTableLayout)?.styleTables(in: storage, spans: spans, paragraph: para, hidden: &hidden,
                                                                 available: tv.textContainer.size.width - 2 * tv.textContainer.lineFragmentPadding)
            (tv.layoutManager as? NoteTableLayout)?.styleImages(in: storage, available: tv.textContainer.size.width - 2 * tv.textContainer.lineFragmentPadding)
            // Null glyphs still participate in TextKit background geometry.
            // Highlight only visible text, not hidden delimiters or destinations.
            for range in hidden.rangeView {
                storage.removeAttribute(.backgroundColor, range: NSRange(range))
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
            if text == "\n", range == textView.selectedRange, range.length == 0, textView.markedTextRange == nil {
                let wiki = NoteWikiLinkCompletion.detect(in: textView.text, selection: range)
                let reference = wiki == nil ? NoteReferenceCompletion.detect(in: textView.text, selection: range) : nil
                let slash = wiki == nil && reference == nil ? NoteSlashCompletion.detect(in: textView.text, selection: range) : nil
                if ((wiki != nil && wiki == publishedWikiLinkQuery)
                    || (reference != nil && reference == publishedReferenceCompletion)
                    || (slash != nil && slash == publishedSlashCompletion)),
                   parent.onWikiLinkCommand(.accept) { return false }
            }
            guard let dash = NoteAutoEmDash.dashRange(in: textView.text as NSString, range: range, replacement: text),
                  let start = textView.position(from: textView.beginningOfDocument, offset: dash.location),
                  let end = textView.position(from: start, offset: dash.length),
                  let span = textView.textRange(from: start, to: end) else { return true }
            textView.replace(span, withText: "—")
            return false
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !hasEditingSession {
                hasEditingSession = true
                NotificationCenter.default.post(name: .bereanNoteEditing,
                    object: NoteEditorActivity(owner: focusOwner, isEditing: true))
            }
            updateTableNavigation()
            scheduleWikiLinkQuery()
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            finishEditingSession()
            scheduleWikiLinkQuery()
        }

        func textViewDidChange(_ textView: UITextView) {
            editing = true
            parent.text = textView.text
            if textView.markedTextRange == nil { restyle() }
            editing = false
            updateTableNavigation()
            scheduleWikiLinkQuery()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            defer {
                updateTableNavigation()
                scheduleWikiLinkQuery()
            }
            guard textView.markedTextRange == nil else { return }
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
            let colors = (highlightColors + ["orange"]).map { color in
                UIAction(title: color.capitalized, image: UIImage(systemName: "highlighter")) { _ in
                    tv.setHighlight(color)
                }
            }
            let highlight = UIMenu(title: "Highlight", image: UIImage(systemName: "highlighter"), children: [
                UIAction(title: "Default") { _ in tv.setHighlight(nil) }
            ] + colors + [
                UIAction(title: "Remove Highlight", image: UIImage(systemName: "eraser")) { _ in
                    tv.removeHighlight()
                }
            ])
            let format = UIMenu(title: "Format", image: UIImage(systemName: "textformat"), children: [
                UIAction(title: "Bold", image: UIImage(systemName: "bold")) { _ in tv.wrap("**", "**") },
                UIAction(title: "Italic", image: UIImage(systemName: "italic")) { _ in tv.wrap("*", "*") },
                UIAction(title: "Underline", image: UIImage(systemName: "underline")) { _ in tv.wrap("<u>", "</u>") },
                UIAction(title: "Strikethrough", image: UIImage(systemName: "strikethrough")) { _ in tv.wrap("~~", "~~") },
                highlight,
                UIAction(title: "Inline Code", image: UIImage(systemName: "chevron.left.forwardslash.chevron.right")) { _ in
                    tv.toggleInlineCode()
                },
                UIAction(title: "Insert Link…", image: UIImage(systemName: "link")) { [weak self] _ in
                    self?.parent.onInsertLink(range)
                },
            ])
            var items = suggestedActions
            if range.length > 0 { items.insert(UIAction(title: "Copy as Plain Text", image: UIImage(systemName: "doc.plaintext")) { _ in tv.copyPlain() }, at: 0) }
            let tableActions = tv.tableNavigationActions(for: range)
            if !tableActions.isEmpty {
                items.insert(UIMenu(title: "Table", image: UIImage(systemName: "tablecells"),
                                    children: tableActions), at: 0)
            }
            items.insert(format, at: 0)
            if let image = NoteImages.image(at: range.location, in: tv.text ?? "") {
                let sizes = NoteImageInput.sizePresets(for: image).map { preset in
                    UIAction(title: preset.title, state: image.width == preset.width ? .on : .off) { _ in tv.resizeImage(image, width: preset.width) }
                }
                items.insert(UIMenu(title: "Image Size", image: UIImage(systemName: "photo"), children: sizes), at: 0)
            }
            return UIMenu(children: items)
        }
    }
}

final class NoteUITextView: UITextView {
    weak var coordinator: RichNoteEditorIOS.Coordinator?
    static let markdownType = "com.berean.note-markdown"
    private var imageRestylePending = false

    /// Images reserve height for the width they were sized at; re-fit them after rotation or resizing.
    override func layoutSubviews() {
        super.layoutSubviews()
        guard let layout = layoutManager as? NoteTableLayout, markedTextRange == nil else { return }
        let available = textContainer.size.width - 2 * textContainer.lineFragmentPadding
        guard !imageRestylePending, layout.imagesNeedRestyle(forAvailable: available) else { return }
        imageRestylePending = true
        DispatchQueue.main.async { [weak self] in
            self?.imageRestylePending = false
            self?.coordinator?.restyle()
        }
    }

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
              let edit = noteBlockReturnEdit(in: (self.text ?? "") as NSString, selection: selectedRange) else {
            super.insertText(text)
            return
        }
        applyFormatEdit(edit)
    }

    func applyWikiLinkEdit(_ edit: NoteWikiLinkEdit) {
        guard markedTextRange == nil else { return }
        // Keep insertion literal and use the existing undoable source-edit path.
        replaceMarkdownLiterally(edit.range, with: edit.replacement, select: edit.selection)
    }

    func insertLink(_ destination: String, at selection: NSRange) {
        applyFormatEdit(noteLinkEdit(in: (text ?? "") as NSString, selection: selection, destination: destination))
    }

    func wrap(_ open: String, _ close: String) {
        applyFormatEdit(noteFormatEdit(in: (text ?? "") as NSString, selection: selectedRange, opening: open, closing: close))
    }

    func toggleInlineCode() {
        applyFormatEdit(noteInlineCodeEdit(in: (text ?? "") as NSString, selection: selectedRange))
    }

    func removeHighlight() {
        applyFormatEdit(noteRemoveHighlightEdit(in: (text ?? "") as NSString, selection: selectedRange))
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
        guard let edit else { return }
        replaceMarkdownLiterally(edit.range, with: edit.replacement, select: edit.selection)
    }

    /// UIKit can apply text substitutions even to programmatic replacements. Write
    /// source literally and record both selections so Undo/Redo restores the
    /// formatting target as well as its text, independently of native typing.
    private func replaceMarkdownLiterally(_ range: NSRange, with replacement: String, select selection: NSRange) {
        let source = textStorage.string as NSString
        guard range.location >= 0, range.length >= 0, range.location <= source.length,
              range.length <= source.length - range.location else { return }
        let resultingLength = source.length - range.length + replacement.utf16.count
        guard selection.location >= 0, selection.length >= 0, selection.location <= resultingLength,
              selection.length <= resultingLength - selection.location else { return }
        let previousText = source.substring(with: range)
        let previousSelection = selectedRange
        let inserted = NSRange(location: range.location, length: replacement.utf16.count)
        undoManager?.registerUndo(withTarget: self) { editor in
            editor.replaceMarkdownLiterally(inserted, with: previousText, select: previousSelection)
        }
        textStorage.replaceCharacters(in: range, with: replacement)
        selectedRange = selection
        coordinator?.textViewDidChange(self)
    }

    func resizeImage(_ image: NoteImages.Image, width: Int?) {
        let source = textStorage.string
        guard let current = NoteImages.find(in: source).first(where: { $0.range.location == image.range.location }) else { return }
        let edit = NoteImages.widthEdit(current, in: source, width: width)
        replaceMarkdownLiterally(edit.range, with: edit.replacement,
                                 select: NSRange(location: NSMaxRange(current.range) + edit.replacement.utf16.count - edit.range.length, length: 0))
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

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), UIPasteboard.general.hasImages { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    func insertImageMarkdown(_ markdown: String) {
        let current = (text ?? "") as NSString
        let safe = NoteImageInput.insertionPoint(in: current, at: selectedRange.location)
        if safe != selectedRange.location { selectedRange = NSRange(location: safe, length: 0) }
        super.insertText(NoteImageInput.block(markdown, in: current, at: safe))
    }

    override func paste(_ sender: Any?) {
        let pb = UIPasteboard.general
        // A copied picture becomes inline image Markdown, as the original.
        if pb.items.first?[Self.markdownType] == nil, !pb.hasStrings, let image = NoteImageInput.pastedImageMarkdown() {
            insertImageMarkdown(image); return
        }
        let md = pb.items.first?[Self.markdownType] as? String
        guard let s = md ?? pb.string, !s.isEmpty else { return }
        super.insertText(s)
    }
}


extension Notification.Name {
    /// Owner-scoped NoteEditorActivity; obsolete teardown must not clear a newer editor.
    static let bereanNoteEditing = Notification.Name("bereanNoteEditing")
}
