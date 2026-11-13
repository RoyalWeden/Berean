import SwiftUI
import UIKit

/// A chapter is one selectable document. Inline controls participate in UIKit link hit testing
/// but are excluded from copied text and from persisted highlight offsets.
struct IOSChapterTextView: UIViewRepresentable {
    struct Piece {
        let verse: Int
        let start: Int
        let end: Int
    }

    var passageId: String
    var header: String?
    var chapterTags: [(name: String, color: String?, slot: Int?)]
    var verses: [ReaderVerse]
    var style: ReaderStyle
    var selectedVerses: Set<Int>
    var scrollTarget: Int?
    var findRequest: Int
    var reference: (Int, Int) -> String
    var onStrongs: (String) -> Void
    var onVerseTap: (Int) -> Void
    var onVerseActions: (Int) -> Void
    var onTagClick: (String, Int?) -> Void
    var onHighlight: (Piece, String) -> Void
    var onStep: (Int) -> Void
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = ReaderTextView(frame: .zero, textContainer: nil)
        view.reader = context.coordinator
        view.isEditable = false
        view.isSelectable = true
        view.isFindInteractionEnabled = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 16, left: 20, bottom: 24, right: 20)
        view.linkTextAttributes = [.underlineStyle: NSUnderlineStyle([]).rawValue]
        view.alwaysBounceVertical = true
        view.accessibilityLabel = "Scripture text"
        view.delegate = context.coordinator

        let gutterTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapVerseGutter(_:)))
        gutterTap.delegate = context.coordinator
        view.addGestureRecognizer(gutterTap)

        for direction in [UISwipeGestureRecognizer.Direction.left, .right] {
            let swipe = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swipe(_:)))
            swipe.direction = direction
            swipe.delegate = context.coordinator
            view.addGestureRecognizer(swipe)
        }
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        let shouldFind = coordinator.parent.findRequest != findRequest
        coordinator.parent = self
        if shouldFind {
            DispatchQueue.main.async { [weak view] in
                view?.findInteraction?.presentFindNavigator(showingReplace: false)
            }
        }
        let key = Key(header: header, tags: chapterTags.map { TagKey(name: $0.name, color: $0.color, slot: $0.slot) },
                      verses: verses, style: style, selected: selectedVerses, dark: colorScheme == .dark)
        let samePassage = coordinator.passageId == passageId
        let clearance = selectedVerses.isEmpty ? ReaderFloatingControls.dockOffset : ReaderFloatingControls.scrollClearance
        let previousOffset = view.contentOffset
        let previousInset = view.adjustedContentInset
        let previousBottom = max(-previousInset.top, view.contentSize.height + previousInset.bottom - view.bounds.height)
        let keepChapterEndVisible = samePassage && clearance != view.contentInset.bottom
            && previousBottom > -previousInset.top && previousOffset.y >= previousBottom - 2
        view.contentInset.bottom = clearance
        view.verticalScrollIndicatorInsets.bottom = clearance
        if key != coordinator.key || !samePassage {
            let selection = view.selectedRange
            let oldText = view.text
            view.attributedText = coordinator.render(key.dark)
            view.setNeedsLayout()
            DispatchQueue.main.async { [weak view] in
                (view as? ReaderTextView)?.updateVerseOutline()
            }
            if samePassage {
                if view.text == oldText, NSMaxRange(selection) <= view.textStorage.length {
                    view.selectedRange = selection
                }
                view.setContentOffset(previousOffset, animated: false)
            } else {
                view.selectedRange = NSRange(location: 0, length: 0)
                view.setContentOffset(CGPoint(x: 0, y: -view.adjustedContentInset.top), animated: false)
                coordinator.lastTarget = nil
            }
            coordinator.key = key
            coordinator.passageId = passageId
        }
        if keepChapterEndVisible {
            view.layoutIfNeeded()
            let inset = view.adjustedContentInset
            let bottom = max(-inset.top, view.contentSize.height + inset.bottom - view.bounds.height)
            view.setContentOffset(CGPoint(x: previousOffset.x, y: bottom), animated: false)
        }
        if scrollTarget == nil { coordinator.lastTarget = nil }
        if let target = scrollTarget, target != coordinator.lastTarget, let range = coordinator.verseRanges[target] {
            coordinator.lastTarget = target
            let currentPassage = passageId
            DispatchQueue.main.async { [weak view, weak coordinator] in
                guard let view, let coordinator, coordinator.passageId == currentPassage,
                      coordinator.lastTarget == target, NSMaxRange(range) <= view.textStorage.length,
                      let position = view.position(from: view.beginningOfDocument, offset: range.location) else { return }
                view.layoutIfNeeded()
                let inset = view.adjustedContentInset
                let y = view.caretRect(for: position).minY - inset.top - 12
                let bottom = view.contentSize.height + inset.bottom - view.bounds.height
                view.setContentOffset(CGPoint(x: 0, y: max(-inset.top, min(y, bottom))), animated: false)
            }
        }
    }

    struct TagKey: Equatable {
        let name: String
        let color: String?
        let slot: Int?
    }

    struct Key: Equatable {
        let header: String?
        let tags: [TagKey]
        let verses: [ReaderVerse]
        let style: ReaderStyle
        let selected: Set<Int>
        let dark: Bool
    }

    final class ReaderTextView: UITextView {
        weak var reader: Coordinator?

        private let verseOutline = CAShapeLayer()

        override func layoutSubviews() {
            super.layoutSubviews()
            updateVerseOutline()
        }

        func updateVerseOutline() {
            guard let reader else { return }
            if verseOutline.superlayer == nil {
                verseOutline.fillColor = nil
                verseOutline.lineWidth = 1
                verseOutline.zPosition = 100
                verseOutline.lineDashPattern = [4, 3]
                layer.addSublayer(verseOutline)
            }
            let path = UIBezierPath()
            for range in selectedVerseRanges(reader.parent.selectedVerses, in: reader.bodyRanges) where range.length > 0 {
                func characterRect(at offset: Int) -> CGRect? {
                    guard let start = position(from: beginningOfDocument, offset: offset),
                          let end = position(from: start, offset: 1),
                          let range = textRange(from: start, to: end) else { return nil }
                    return firstRect(for: range)
                }
                guard let first = characterRect(at: range.location),
                      let last = characterRect(at: NSMaxRange(range) - 1) else { continue }
                let rect = CGRect(x: textContainerInset.left - 4, y: first.minY - 3,
                                  width: bounds.width - textContainerInset.left - textContainerInset.right + 8,
                                  height: last.maxY - first.minY + 6)
                guard !rect.isEmpty, rect.height.isFinite, rect.minY.isFinite else { continue }
                path.append(UIBezierPath(roundedRect: rect, cornerRadius: 9))
            }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            verseOutline.frame = CGRect(origin: .zero, size: CGSize(width: bounds.width, height: max(bounds.height, contentSize.height)))
            verseOutline.strokeColor = UIColor.tintColor.withAlphaComponent(0.7).cgColor
            verseOutline.path = path.cgPath
            CATransaction.commit()
        }

        override func copy(_ sender: Any?) {
            if let copy = reader?.plainSelection(in: self) {
                Clipboard.copy(copy)
            } else {
                super.copy(sender)
            }
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        private static let skip = NSAttributedString.Key("bereanSkip")
        var parent: IOSChapterTextView
        var key: Key?
        var passageId: String?
        var lastTarget: Int?
        var verseRanges: [Int: NSRange] = [:]
        fileprivate var bodyRanges: [Int: NSRange] = [:]

        init(_ parent: IOSChapterTextView) { self.parent = parent }

        func render(_ dark: Bool) -> NSAttributedString {
            let out = NSMutableAttributedString()
            verseRanges.removeAll(keepingCapacity: true)
            bodyRanges.removeAll(keepingCapacity: true)
            let size = CGFloat(parent.style.fontSize)
            let regular = font(size)
            let italic = regular.fontDescriptor.withSymbolicTraits(.traitItalic).map { UIFont(descriptor: $0, size: size) } ?? UIFont.italicSystemFont(ofSize: size)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = parent.style.lineSpacing
            paragraph.paragraphSpacing = size * 0.55
            if parent.style.showVerseNumbers {
                paragraph.tabStops = [NSTextTab(textAlignment: .right, location: size * 1.25),
                                      NSTextTab(textAlignment: .left, location: size * 1.8)]
                paragraph.headIndent = size * 1.8
            }
            let base: [NSAttributedString.Key: Any] = [.font: regular, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
            if let header = parent.header {
                out.append(NSAttributedString(string: header + "\n", attributes: [
                    .font: UIFont.preferredFont(forTextStyle: .callout), .foregroundColor: UIColor.secondaryLabel, Self.skip: true,
                ]))
            }
            if !parent.chapterTags.isEmpty {
                appendTags(parent.chapterTags, verse: nil, to: out, base: base, dark: dark)
                out.append(NSAttributedString(string: "\n", attributes: [.paragraphStyle: paragraph, Self.skip: true]))
            }
            for verse in parent.verses {
                let start = out.length
                if let title = verse.title, !title.isEmpty {
                    out.append(NSAttributedString(string: title + "\n", attributes: base.merging([
                        .font: italic, .foregroundColor: UIColor.secondaryLabel, Self.skip: true,
                    ]) { _, new in new }))
                }
                if parent.style.showVerseNumbers {
                    let selected = parent.selectedVerses.contains(verse.verse)
                    let number = base.merging([
                        .font: UIFont.monospacedDigitSystemFont(ofSize: max(13, size * 0.75), weight: selected ? .bold : .medium),
                        .foregroundColor: selected ? UIColor.tintColor : UIColor.secondaryLabel,
                        .link: URL(string: "berean-verse:\(verse.verse)")!, Self.skip: true,
                    ]) { _, new in new }
                    out.append(NSAttributedString(string: "\t", attributes: number))
                    out.append(NSAttributedString(string: "\(verse.verse)", attributes: number))
                    out.append(NSAttributedString(string: "\t", attributes: number))
                }
                let bodyStart = out.length
                let tint = verse.tint.map { UIColor(Color.highlight($0)).withAlphaComponent(0.25) }
                var wordBase = base
                if let tint { wordBase[.backgroundColor] = tint }
                var offset = 0
                for (index, word) in verse.words.enumerated() {
                    if index > 0 { appendBody(" ", at: &offset, marks: verse.marks, to: out, attributes: wordBase) }
                    var attributes = wordBase
                    if word.italic { attributes[.font] = italic }
                    if word.red, parent.style.redLetters { attributes[.foregroundColor] = UIColor.systemRed }
                    appendBody(word.text, at: &offset, marks: verse.marks, to: out, attributes: attributes)
                    if parent.style.showStrongs {
                        for number in word.strongs {
                            let id = number.trimmingCharacters(in: CharacterSet(charactersIn: "()"))
                            guard !id.isEmpty, let url = URL(string: "strongs:\(id)") else { continue }
                            out.append(NSAttributedString(string: "\u{2009}" + id, attributes: base.merging([
                                .font: UIFont.monospacedDigitSystemFont(ofSize: max(10, size * 0.6), weight: .medium),
                                .foregroundColor: UIColor.tintColor, .baselineOffset: size * 0.28, .link: url, Self.skip: true,
                            ]) { _, new in new }))
                        }
                    }
                }
                bodyRanges[verse.verse] = NSRange(location: bodyStart, length: out.length - bodyStart)
                if verse.noteCount > 0 {
                    out.append(NSAttributedString(string: verse.noteCount > 1 ? "  ●\(verse.noteCount)" : "  ●",
                        attributes: base.merging([.font: UIFont.systemFont(ofSize: max(8, size * 0.5)),
                                                  .foregroundColor: UIColor.tintColor, Self.skip: true]) { _, new in new }))
                }
                appendTags(verse.tags, verse: verse.verse, to: out, base: base, dark: dark)
                out.append(NSAttributedString(string: "\n", attributes: base))
                verseRanges[verse.verse] = NSRange(location: start, length: out.length - start)
            }
            return out
        }

        private func font(_ size: CGFloat) -> UIFont {
            let system = UIFont.systemFont(ofSize: size)
            switch parent.style.family {
            case "serif": return UIFont(name: "Georgia", size: size) ?? system
            case "palatino": return UIFont(name: "Palatino-Roman", size: size) ?? system
            case "mono": return UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
            case "garamond", "crimson", "lora", "merriweather", "sourceserif":
                return system.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? system
            default: return system
            }
        }

        private func appendBody(_ text: String, at offset: inout Int, marks: [ReaderVerse.Mark],
                                to out: NSMutableAttributedString, attributes: [NSAttributedString.Key: Any]) {
            let run = NSMutableAttributedString(string: text, attributes: attributes)
            // Apply marks in stored order so the last overlapping mark wins, as in the Mac reader.
            let span = NSRange(location: offset, length: run.length)
            for mark in marks where mark.end > mark.start {
                let hit = NSIntersectionRange(span, NSRange(location: mark.start, length: mark.end - mark.start))
                guard hit.length > 0 else { continue }
                run.addAttribute(.backgroundColor, value: UIColor(Color.highlight(mark.color)).withAlphaComponent(0.35),
                                 range: NSRange(location: hit.location - offset, length: hit.length))
            }
            out.append(run)
            offset += run.length
        }

        private func appendTags(_ tags: [(name: String, color: String?, slot: Int?)], verse: Int?,
                                to out: NSMutableAttributedString, base: [NSAttributedString.Key: Any], dark: Bool) {
            for tag in tags {
                var url = URLComponents()
                url.scheme = "berean-tag"
                url.host = "open"
                url.queryItems = [URLQueryItem(name: "name", value: tag.name),
                                  URLQueryItem(name: "verse", value: verse.map(String.init))]
                guard let link = url.url else { continue }
                let color = UIColor(TagColor.color(tag.color, slot: tag.slot, dark: dark))
                out.append(NSAttributedString(string: "  #\(tag.name)", attributes: base.merging([
                    .font: UIFont.systemFont(ofSize: max(12, parent.style.fontSize * 0.74), weight: .medium),
                    .foregroundColor: color, .link: link, Self.skip: true,
                ]) { _, new in new }))
            }
        }

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case let .link(url) = textItem.content else { return defaultAction }
            switch url.scheme {
            case "berean-verse":
                guard let verse = Int(url.absoluteString.dropFirst("berean-verse:".count)) else { return nil }
                return UIAction { [weak self, weak textView] _ in
                    textView?.selectedTextRange = nil
                    self?.parent.onVerseTap(verse)
                }
            case "strongs":
                let id = String(url.absoluteString.dropFirst("strongs:".count))
                return UIAction { [weak self] _ in self?.parent.onStrongs(id) }
            case "berean-tag":
                let fields = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
                guard let name = fields?.first(where: { $0.name == "name" })?.value else { return nil }
                let verse = fields?.first(where: { $0.name == "verse" })?.value.flatMap(Int.init)
                return UIAction { [weak self] _ in self?.parent.onTagClick(name, verse) }
            default:
                return defaultAction
            }
        }

        func textView(_ textView: UITextView, menuConfigurationFor textItem: UITextItem,
                      defaultMenu: UIMenu) -> UITextItem.MenuConfiguration? {
            // The link's tap opens an in-app destination. Avoid system preview/copy-link for internal URLs.
            nil
        }

        func plainSelection(in view: UITextView) -> String? {
            let portions = portions(in: view.selectedRange, storage: view.textStorage)
            return portions.isEmpty ? nil : plainText(portions)
        }

        private func plainText(_ portions: [(Piece, String)]) -> String {
            portions.map { $0.1.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: " ")
        }

        private func portions(in range: NSRange, storage: NSAttributedString) -> [(Piece, String)] {
            guard range.location != NSNotFound, range.length > 0, NSMaxRange(range) <= storage.length else { return [] }
            return parent.verses.compactMap { verse -> (Piece, String)? in
                guard let body = bodyRanges[verse.verse] else { return nil }
                let intersection = NSIntersectionRange(range, body)
                guard intersection.length > 0 else { return nil }
                let prefix = NSRange(location: body.location, length: intersection.location - body.location)
                let start = bodyText(storage, in: prefix).utf16.count
                let selected = bodyText(storage, in: intersection)
                guard !selected.isEmpty else { return nil }
                return (Piece(verse: verse.verse, start: start, end: start + selected.utf16.count), selected)
            }
        }

        private func isVerseMarkerSelection(_ range: NSRange, in view: UITextView) -> Bool {
            guard range.location != NSNotFound, range.length > 0,
                  NSMaxRange(range) <= view.textStorage.length else { return false }
            var isMarker = true
            view.textStorage.enumerateAttribute(.link, in: range) { value, _, stop in
                if (value as? URL)?.scheme != "berean-verse" {
                    isMarker = false
                    stop.pointee = true
                }
            }
            return isMarker
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            // A quick second tap can invoke UIKit's word selection before the gutter tap wins.
            // A verse marker is a control. Body selections may still span across markers.
            if isVerseMarkerSelection(textView.selectedRange, in: textView) {
                textView.selectedTextRange = nil
            }
        }

        func textView(_ view: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            if isVerseMarkerSelection(range, in: view) { return UIMenu(children: []) }
            let portions = portions(in: range, storage: view.textStorage)
            guard let first = portions.first, let last = portions.last else { return nil }
            let text = plainText(portions)
            let copy = UIAction(title: "Copy Text", image: UIImage(systemName: "doc.on.doc")) { _ in Clipboard.copy(text) }
            let reference = parent.reference(first.0.verse, last.0.verse)
            let copyWithReference = UIAction(title: "Copy with Reference", image: UIImage(systemName: "number")) { _ in
                let lines = portions.map { "\($0.0.verse) \($0.1.trimmingCharacters(in: .whitespacesAndNewlines))" }
                Clipboard.copy(([reference] + lines).joined(separator: "\n"))
            }
            let highlight = UIMenu(title: "Highlight Selection", image: UIImage(systemName: "highlighter"),
                                   children: highlightColors.map { color in
                UIAction(title: color.capitalized) { [weak self, weak view] _ in
                    view?.selectedRange = NSRange(location: range.location, length: 0)
                    for (piece, _) in portions { self?.parent.onHighlight(piece, color) }
                }
            })
            var actions: [UIMenuElement] = [copy, copyWithReference, highlight]
            if first.0.verse == last.0.verse {
                actions.append(UIAction(title: "Verse Actions", image: UIImage(systemName: "ellipsis.circle")) { [weak self, weak view] _ in
                    view?.selectedRange = NSRange(location: range.location, length: 0)
                    self?.parent.onVerseActions(first.0.verse)
                })
            }
            actions += suggestedActions.filter { item in
                guard let command = item as? UICommand else { return false }
                return command.action != #selector(UIResponderStandardEditActions.copy(_:))
            }
            return UIMenu(children: actions)
        }

        private func bodyText(_ storage: NSAttributedString, in range: NSRange) -> String {
            var result = ""
            storage.enumerateAttribute(Self.skip, in: range) { skip, run, _ in
                if skip == nil { result += (storage.string as NSString).substring(with: run) }
            }
            return result
        }

        private func verseInGutter(_ point: CGPoint, in view: UITextView) -> Int? {
            let bodyEdge = view.textContainerInset.left + view.textContainer.lineFragmentPadding + CGFloat(parent.style.fontSize) * 1.8
            guard parent.style.showVerseNumbers, point.x >= 0, point.x < bodyEdge,
                  let position = view.closestPosition(to: CGPoint(x: bodyEdge + 2, y: point.y)) else { return nil }
            let offset = view.offset(from: view.beginningOfDocument, to: position)
            guard let verse = verseRanges.first(where: { NSLocationInRange(offset, $0.value) })?.key,
                  let start = bodyRanges[verse]?.location,
                  let body = view.position(from: view.beginningOfDocument, offset: start) else { return nil }
            let caret = view.caretRect(for: body)
            guard point.x < caret.minX, point.y >= caret.minY - 3, point.y <= caret.maxY + 3 else { return nil }
            return verse
        }

        @objc func tapVerseGutter(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view as? UITextView,
                  let verse = verseInGutter(gesture.location(in: view), in: view) else { return }
            view.selectedTextRange = nil
            parent.onVerseTap(verse)
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard gesture is UITapGestureRecognizer, let view = gesture.view as? UITextView else { return true }
            return verseInGutter(touch.location(in: view), in: view) != nil
        }

        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let view = gesture.view as? UITextView else { return false }
            if gesture is UITapGestureRecognizer { return true }
            let x = gesture.location(in: view).x - view.bounds.minX
            return x > 24 && x < view.bounds.width - 24 && view.selectedRange.length == 0
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other === (gesture.view as? UITextView)?.panGestureRecognizer
        }

        @objc func swipe(_ gesture: UISwipeGestureRecognizer) {
            parent.onStep(gesture.direction == .left ? 1 : -1)
        }
    }
}
