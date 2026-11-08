import SwiftUI
import UIKit
import BereanNotes

/// iPhone notes editor (ADR-0014): same live-preview model as the Mac editor — Markdown kept verbatim in the text
/// storage, markup hidden as null glyphs, bullets/tasks/callout labels substituted, formatting via the edit menu.
struct RichNoteEditorIOS: UIViewRepresentable {
    @Binding var text: String
    var fontSize: CGFloat = 17
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
        tv.backgroundColor = .clear
        tv.alwaysBounceVertical = true
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.adjustsFontForContentSizeCategory = true
        tv.text = text
        tv.accessibilityLabel = "Note text"
        context.coordinator.textView = tv
        context.coordinator.restyle()
        return tv
    }

    func updateUIView(_ tv: NoteUITextView, context: Context) {
        context.coordinator.parent = self
        guard tv.text != text, !context.coordinator.editing else { return }
        tv.text = text
        context.coordinator.restyle()
    }

    final class Coordinator: NSObject, UITextViewDelegate, @preconcurrency NSLayoutManagerDelegate {
        var parent: RichNoteEditorIOS
        weak var textView: NoteUITextView?
        var editing = false
        var hidden = IndexSet()
        var substitutions: [Int: (len: Int, glyph: String)] = [:]
        init(_ p: RichNoteEditorIOS) { parent = p }

        func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, traits: UIFontDescriptor.SymbolicTraits = []) -> UIFont {
            let base = UIFont.systemFont(ofSize: size, weight: weight)
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
                case .task(let on): substitutions[r.location] = (r.length, on ? "☑" : "□")
                case .codeBlock: storage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .regular), .backgroundColor: UIColor.secondarySystemFill], range: r)
                case .tableRow: storage.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: size * 0.88, weight: .regular), range: r)
                case .tableRule, .rule: storage.addAttribute(.foregroundColor, value: UIColor.tertiaryLabel, range: r)
                case .image: storage.addAttributes([.foregroundColor: UIColor.secondaryLabel, .backgroundColor: UIColor.tertiarySystemFill], range: r)
                case .structure: break
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

        func textViewDidChange(_ textView: UITextView) {
            editing = true
            parent.text = textView.text
            restyle()
            editing = false
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            let r = textView.selectedRange
            guard r.length == 0, hidden.contains(r.location) else { return }
            var loc = r.location
            let len = (textView.text as NSString).length
            while hidden.contains(loc), loc < len { loc += 1 }
            textView.selectedRange = NSRange(location: loc, length: 0)
        }

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            if case .link(let url) = textItem.content { return UIAction { [weak self] _ in self?.parent.onLink(url) } }
            return defaultAction
        }

        /// Edit menu: formatting and Copy as Plain Text join the standard items.
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let tv = textView as? NoteUITextView else { return nil }
            let format = UIMenu(title: "Format", image: UIImage(systemName: "textformat"), children: [
                UIAction(title: "Bold", image: UIImage(systemName: "bold")) { _ in tv.wrap("**", "**") },
                UIAction(title: "Italic", image: UIImage(systemName: "italic")) { _ in tv.wrap("*", "*") },
                UIAction(title: "Underline", image: UIImage(systemName: "underline")) { _ in tv.wrap("<u>", "</u>") },
                UIAction(title: "Strikethrough", image: UIImage(systemName: "strikethrough")) { _ in tv.wrap("~~", "~~") },
                UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { _ in tv.wrap("==", "==") },
            ])
            var items = suggestedActions
            if range.length > 0 { items.insert(UIAction(title: "Copy as Plain Text", image: UIImage(systemName: "doc.plaintext")) { _ in tv.copyPlain() }, at: 0) }
            items.insert(format, at: 0)
            return UIMenu(children: items)
        }
    }
}

final class NoteUITextView: UITextView {
    weak var coordinator: RichNoteEditorIOS.Coordinator?
    static let markdownType = "com.berean.note-markdown"

    func wrap(_ open: String, _ close: String) {
        let r = selectedRange
        let s = (text ?? "") as NSString
        let inner = r.length > 0 ? s.substring(with: r) : ""
        guard let start = position(from: beginningOfDocument, offset: r.location), let end = position(from: start, offset: r.length),
              let range = textRange(from: start, to: end) else { return }
        replace(range, withText: open + inner + close)
        selectedRange = NSRange(location: r.location + open.utf16.count, length: inner.utf16.count)
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
        insertText(s)
    }
}
