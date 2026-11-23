import AppKit
import SwiftUI

/// Registers cursors for the text fragments this view actually draws.
class ReferenceCursorTextView: NSTextView {
    override func resetCursorRects() {
        registerTextCursorRects()
    }

    func registerTextCursorRects(excluding control: NSRect? = nil) {
        guard isSelectable, let storage = textStorage, let layout = layoutManager,
              let container = textContainer, storage.length > 0 else { return }
        let origin = textContainerOrigin
        let visible = visibleRect.offsetBy(dx: -origin.x, dy: -origin.y)
        let glyphs = layout.glyphRange(forBoundingRect: visible, in: container)
        guard glyphs.length > 0 else { return }
        let characters = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        storage.enumerateAttribute(.link, in: characters) { link, range, _ in
            let cursor: NSCursor = link == nil ? .iBeam : .pointingHand
            let run = NSIntersectionRange(glyphs, layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil))
            guard run.length > 0 else { return }
            // TextKit can extend a wrapped run to the edge of its container.
            // Constrain the horizontal span to the run's glyphs on this line.
            layout.enumerateLineFragments(forGlyphRange: run) { line, used, _, lineGlyphs, _ in
                let fragmentGlyphs = NSIntersectionRange(run, lineGlyphs)
                let ink = layout.boundingRect(forGlyphRange: fragmentGlyphs, in: container)
                let left = max(used.minX, ink.minX)
                let right = min(used.maxX, ink.maxX)
                guard right > left else { return }
                let glyphBounds = NSRect(x: left, y: line.minY, width: right - left, height: line.height)
                layout.enumerateEnclosingRects(forGlyphRange: fragmentGlyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: container) { rect, _ in
                    let fragment = rect.intersection(glyphBounds).intersection(visible).offsetBy(dx: origin.x, dy: origin.y)
                    self.registerCursorRect(fragment, cursor: cursor, excluding: control)
                }
            }
        }
    }

    private func registerCursorRect(_ fragment: NSRect, cursor: NSCursor, excluding control: NSRect?) {
        guard !fragment.isEmpty else { return }
        if let control, fragment.intersects(control) {
            let cut = fragment.intersection(control)
            for rect in [
                NSRect(x: fragment.minX, y: fragment.minY, width: fragment.width, height: cut.minY - fragment.minY),
                NSRect(x: fragment.minX, y: cut.maxY, width: fragment.width, height: fragment.maxY - cut.maxY),
                NSRect(x: fragment.minX, y: cut.minY, width: cut.minX - fragment.minX, height: cut.height),
                NSRect(x: cut.maxX, y: cut.minY, width: fragment.maxX - cut.maxX, height: cut.height)
            ] where !rect.isEmpty {
                addCursorRect(rect, cursor: cursor)
            }
        } else {
            addCursorRect(fragment, cursor: cursor)
        }
    }
}

/// SwiftUI's selectable Text can give its selection cursor priority over links.
/// Keep both selection and link hit testing on the same native text layout.
struct ReferenceLinkText: View {
    let text: AttributedString
    var color: NSColor = .labelColor
    var semibold = false
    var scriptureLabel: String? = nil

    var body: some View {
        ReferenceBaselineLayout {
            ReferenceLinkTextView(text: text, color: color, semibold: semibold, scriptureLabel: scriptureLabel)
            Text(text).fontWeight(semibold ? .semibold : nil)
                .hidden().accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}

private struct ReferenceBaselineLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews[0].sizeThatFits(proposal)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews[0].place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
    }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? {
        // SwiftUI does not forward the NSTextView's first baseline through
        // NSViewRepresentable. Measure the equivalent SwiftUI text for alignment.
        guard guide == .firstTextBaseline else { return nil }
        return subviews[1].dimensions(in: .init(width: bounds.width, height: nil))[guide]
    }
}

private struct ReferenceLinkTextView: NSViewRepresentable {
    let text: AttributedString
    var color: NSColor = .labelColor
    var semibold = false
    var scriptureLabel: String? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> PreviewTextView {
        let view = PreviewTextView()
        view.isEditable = false
        view.isSelectable = true
        view.isRichText = true
        view.drawsBackground = false
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isHorizontallyResizable = false
        view.isVerticallyResizable = false
        view.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        view.delegate = context.coordinator
        return view
    }

    func updateNSView(_ view: PreviewTextView, context: Context) {
        let environment = context.environment
        context.coordinator.openURL = environment.openURL
        let baseFont = environment.font ?? .body
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = environment.lineSpacing
        switch environment.multilineTextAlignment {
        case .center: paragraph.alignment = .center
        case .leading: paragraph.alignment = environment.layoutDirection == .rightToLeft ? .right : .left
        case .trailing: paragraph.alignment = environment.layoutDirection == .rightToLeft ? .left : .right
        }
        let formatted = NSMutableAttributedString(string: "")
        if let scriptureLabel, let link = text.runs.first?.link {
            view.setAccessibilityLabel("Open \(scriptureLabel) in Scripture")
            let font = baseFont.resolve(in: environment.fontResolutionContext).ctFont as NSFont
            if let attachment = view.bookIcon(pointSize: font.pointSize) {
                let title = NSMutableAttributedString(attachment: attachment)
                title.append(NSAttributedString(string: " "))
                var attributes: [NSAttributedString.Key: Any] = [.font: font, .paragraphStyle: paragraph]
                if environment.isEnabled { attributes[.link] = link }
                title.addAttributes(attributes, range: NSRange(location: 0, length: title.length))
                formatted.append(title)
            }
        } else {
            view.setAccessibilityLabel(nil)
        }
        for run in text.runs {
            let styled = run.font ?? baseFont
            var font = (semibold ? styled.weight(.semibold) : styled).resolve(in: environment.fontResolutionContext).ctFont as NSFont
            let intent = run.inlinePresentationIntent ?? []
            if intent.contains(.code) { font = .monospacedSystemFont(ofSize: font.pointSize, weight: semibold ? .semibold : .regular) }
            var traits: NSFontTraitMask = []
            if intent.contains(.emphasized) { traits.insert(.italicFontMask) }
            if intent.contains(.stronglyEmphasized) { traits.insert(.boldFontMask) }
            if !traits.isEmpty { font = NSFontManager.shared.convert(font, toHaveTrait: traits) }
            var attributes: [NSAttributedString.Key: Any] = [
                .font: font, .paragraphStyle: paragraph,
                .foregroundColor: run.foregroundColor.map(NSColor.init) ?? (run.link == nil ? color : .linkColor)
            ]
            if let background = run.backgroundColor { attributes[.backgroundColor] = NSColor(background) }
            if let baseline = run.baselineOffset { attributes[.baselineOffset] = baseline }
            if let link = run.link, environment.isEnabled { attributes[.link] = link }
            if run.underlineStyle != nil { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            if run.strikethroughStyle != nil || intent.contains(.strikethrough) {
                attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            formatted.append(NSAttributedString(string: String(text[run.range].characters), attributes: attributes))
        }
        if !view.attributedString().isEqual(to: formatted) {
            view.textStorage?.setAttributedString(formatted)
            view.window?.invalidateCursorRects(for: view)
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView view: PreviewTextView, context: Context) -> CGSize? {
        guard let layout = view.layoutManager, let container = view.textContainer else { return nil }
        let value = view.attributedString()
        let intrinsicWidth = max(1, ceil(value.size().width))
        let proposedWidth = proposal.width.flatMap { $0.isFinite ? max(1, $0) : nil }
        // Measure at the width we will actually return. TextKit positions
        // centered/trailing lines relative to the whole container.
        let width = min(proposedWidth ?? intrinsicWidth, intrinsicWidth)
        container.size = CGSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        return CGSize(width: width, height: ceil(layout.usedRect(for: container).height))
    }

    final class PreviewTextView: ReferenceCursorTextView {
        private var bookAttachment: (pointSize: CGFloat, attachment: NSTextAttachment)?

        func bookIcon(pointSize: CGFloat) -> NSTextAttachment? {
            if let bookAttachment, bookAttachment.pointSize == pointSize { return bookAttachment.attachment }
            guard let book = NSImage(systemSymbolName: "book", accessibilityDescription: nil) else { return nil }
            let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)
                .applying(.init(paletteColors: [.linkColor]))
            let attachment = NSTextAttachment()
            attachment.image = book.withSymbolConfiguration(configuration) ?? book
            bookAttachment = (pointSize, attachment)
            return attachment
        }

        // Leave the enclosing preview/message's context actions in charge.
        override func menu(for event: NSEvent) -> NSMenu? { nil }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var openURL: OpenURLAction?

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let url = link as? URL else { return false }
            openURL?(url)
            return true
        }
    }
}
