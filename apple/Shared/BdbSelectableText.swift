import SwiftUI
import BereanBible
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// BDB is English dictionary prose containing Hebrew runs. Give each paragraph an
/// explicit English base direction; the Unicode bidi algorithm still lays Hebrew
/// runs out naturally. No directional control characters enter the copied text.
private func bdbAttributedText(_ source: String, findQuery: String) -> NSAttributedString {
    #if os(macOS)
    let body = NSFont.preferredFont(forTextStyle: .body)
    let label = NSColor.labelColor
    let secondary = NSColor.secondaryLabelColor
    let accent = NSColor.controlAccentColor
    #else
    let body = UIFont.preferredFont(forTextStyle: .body)
    let label = UIColor.label
    let secondary = UIColor.secondaryLabel
    let accent = UIColor.tintColor
    #endif
    let paragraph = NSMutableParagraphStyle()
    paragraph.baseWritingDirection = .leftToRight
    paragraph.alignment = .left
    paragraph.lineSpacing = 3
    paragraph.paragraphSpacing = 6
    let result = NSMutableAttributedString()
    for token in BdbNotes.tokens(source) {
        var attributes: [NSAttributedString.Key: Any] = [
            .font: body, .foregroundColor: label, .paragraphStyle: paragraph
        ]
        let text: String
        switch token {
        case .text(let value): text = value
        case .number(let value):
            text = value
            attributes[.foregroundColor] = secondary
        case .abbr(let expanded, _):
            text = expanded
            attributes[.foregroundColor] = accent
            #if os(macOS)
            attributes[.font] = NSFontManager.shared.convert(body, toHaveTrait: .italicFontMask)
            #else
            if let descriptor = body.fontDescriptor.withSymbolicTraits(.traitItalic) {
                attributes[.font] = UIFont(descriptor: descriptor, size: body.pointSize)
            }
            #endif
        }
        result.append(NSAttributedString(string: text, attributes: attributes))
    }
    let query = findQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    if query.count >= 2 {
        let text = result.string as NSString
        var start = 0
        while start < text.length {
            let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive],
                                   range: NSRange(location: start, length: text.length - start))
            guard range.location != NSNotFound, range.length > 0 else { break }
            #if os(macOS)
            result.addAttribute(.backgroundColor, value: NSColor.systemYellow.withAlphaComponent(0.45), range: range)
            #else
            result.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.45), range: range)
            #endif
            start = NSMaxRange(range)
        }
    }
    return result
}

#if os(macOS)
struct BdbSelectableText: NSViewRepresentable {
    let text: String
    var findQuery = ""

    func makeNSView(context: Context) -> NSTextView {
        let view = NSTextView()
        view.isEditable = false
        view.isSelectable = true
        view.isRichText = true
        view.drawsBackground = false
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isHorizontallyResizable = false
        view.isVerticallyResizable = true
        view.setAccessibilityLabel("BDB Notes")
        return view
    }

    func updateNSView(_ view: NSTextView, context: Context) {
        let value = bdbAttributedText(text, findQuery: findQuery)
        if !view.attributedString().isEqual(to: value) { view.textStorage?.setAttributedString(value) }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0, let container = nsView.textContainer,
              let layout = nsView.layoutManager else { return nil }
        container.containerSize = CGSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        return CGSize(width: width, height: ceil(layout.usedRect(for: container).height))
    }
}
#else
struct BdbSelectableText: UIViewRepresentable {
    let text: String
    var findQuery = ""

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.accessibilityLabel = "BDB Notes"
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let value = bdbAttributedText(text, findQuery: findQuery)
        if !view.attributedText.isEqual(to: value) { view.attributedText = value }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}
#endif
