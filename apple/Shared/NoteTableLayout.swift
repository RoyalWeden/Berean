import SwiftUI
import BereanNotes
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Reserve the earlier columns on continuation lines within the last cell.
final class NoteTextContainer: NSTextContainer {
    override func lineFragmentRect(
        forProposedRect proposedRect: CGRect, at characterIndex: Int,
        writingDirection baseWritingDirection: NSWritingDirection,
        remaining remainingRect: UnsafeMutablePointer<CGRect>?
    ) -> CGRect {
        var rect = proposedRect
        if baseWritingDirection != .rightToLeft,
           let layout = layoutManager as? NoteTableLayout,
           let inset = layout.lastCellContinuationInset(at: characterIndex, width: rect.width) {
            rect.origin.x += inset
            rect.size.width -= inset
        }
        return super.lineFragmentRect(forProposedRect: rect, at: characterIndex,
                                      writingDirection: baseWritingDirection, remaining: remainingRect)
    }
}

/// Adds a grid to complete Markdown tables while keeping the original character indices
/// for TextKit selection, undo, paste and navigation between cells.
final class NoteTableLayout: NSLayoutManager {
    private struct Row {
        let range: NSRange
        let boundaries: [Int]
        let dividers: [CGFloat]
        let header: Bool
        let hasBody: Bool
        let lastCellInset: CGFloat
    }

    private var rows: [Row] = []
    private var referenceBlockRanges: [NSRange] = []

    #if os(macOS)
    typealias PlatformImage = NSImage
    #else
    typealias PlatformImage = UIImage
    #endif
    #if os(macOS)
    static let fallbackWidth: CGFloat = 680
    #else
    /// A typical iPhone text width; drawing still fits the real line width.
    static let fallbackWidth: CGFloat = 360
    #endif
    private struct ImageSlot { let character: Int; let image: PlatformImage; let size: CGSize; let source: NSRange }
    /// An image's on-screen frame (text-container coordinates + origin) and its Markdown range.
    struct ImageFrame { let rect: CGRect; let source: NSRange }
    /// The image whose resize handle is shown (caret inside its Markdown/caption).
    var activeImageLocation: Int?
    /// Live width while dragging the resize handle (keyed by the image's Markdown location).
    var dragImageWidth: (location: Int, width: CGFloat)?
    private var imageSlots: [ImageSlot] = []
    nonisolated(unsafe) private static let imageCache = NSCache<NSString, PlatformImage>()

    /// The original shows an image at its CSS pixel width (one pixel per point), regardless of
    /// the file's DPI, so size by pixels on both platforms.
    static func pixelSize(_ image: PlatformImage) -> CGSize {
        #if os(macOS)
        if let rep = image.representations.first, rep.pixelsWide > 0, rep.pixelsHigh > 0 {
            return CGSize(width: rep.pixelsWide, height: rep.pixelsHigh)
        }
        return image.size
        #else
        return CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        #endif
    }

    /// Posted on the main thread when a remote (https) note image finishes downloading.
    static let remoteImageLoaded = Notification.Name("BereanNoteRemoteImageLoaded")
    /// URLs already requested (touched on the main thread only, from styling).
    nonisolated(unsafe) private static var remoteRequested = Set<String>()

    /// Remote images (`![alt](https://…)`, which the original renders as <img>): returned from the
    /// cache, else fetched once in the background; editors restyle on `remoteImageLoaded`.
    static func remoteImage(_ source: String) -> PlatformImage? {
        guard let url = URL(string: source), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        let key = source as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard remoteRequested.insert(source).inserted else { return nil }
        Task.detached(priority: .utility) {
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  ((response as? HTTPURLResponse)?.statusCode ?? 200) < 400, data.count < 25_000_000,
                  let image = PlatformImage(data: data) else { return }
            imageCache.setObject(image, forKey: key)
            await MainActor.run { NotificationCenter.default.post(name: remoteImageLoaded, object: nil) }
        }
        return nil
    }

    static func decodedImage(_ source: String) -> PlatformImage? {
        if !source.hasPrefix("data:") { return remoteImage(source) }
        // Hashing a multi-hundred-KB base64 string per keystroke is the slow path; length plus
        // three short slices identifies an image well enough for a decode cache.
        let ns = source as NSString
        let n = ns.length
        func slice(_ at: Int) -> String { ns.substring(with: NSRange(location: max(0, min(at, n - 48)), length: min(48, n))) }
        let key = "\(n):\(slice(0)):\(slice(n / 2)):\(slice(n - 48))" as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard let data = NoteImages.dataURIBytes(source), let image = PlatformImage(data: data) else { return nil }
        imageCache.setObject(image, forKey: key)
        return image
    }

    /// Inline `data:` images draw above their caption in a tall caption line (minimum line
    /// height); the Markdown source (and its character indices) is never changed. Paragraph
    /// spacing-before is not used: TextKit skips it when the paragraph starts with hidden glyphs.
    /// The width images were last sized for, so text views can restyle when it changes.
    private(set) var imageStyledWidth: CGFloat = 0
    var hasImages: Bool { !imageSlots.isEmpty }

    /// Set when a table was shrunk/clipped for the current width, so a width change restyles.
    private(set) var tablesScaledForWidth = false

    /// True when images (or width-fitted tables) exist and were sized for a different text width.
    func imagesNeedRestyle(forAvailable available: CGFloat) -> Bool {
        (hasImages || tablesScaledForWidth) && available > 40 && abs(available - imageStyledWidth) > 1
    }

    func styleImages(in storage: NSTextStorage, available: CGFloat) {
        imageSlots = []
        imageStyledWidth = available > 40 ? available : 0
        let text = storage.string as NSString
        for found in NoteImages.find(in: storage.string) {
            guard let image = Self.decodedImage(found.source) else { continue }
            // Before the first layout the container can still be zero-wide; drawing clamps to the real line width.
            let size = NoteImages.displaySize(natural: Self.pixelSize(image), savedWidth: found.width, available: available > 40 ? available : Self.fallbackWidth)
            guard size.height > 0 else { continue }
            let paragraph = text.paragraphRange(for: NSRange(location: found.range.location, length: 0))
            // A visible character on the image's line: the caption, else the paragraph's line break.
            let anchor = found.captionRange.length > 0 ? found.captionRange.location
                : (NSMaxRange(paragraph) > NSMaxRange(found.range) ? NSMaxRange(paragraph) - 1 : found.range.location)
            #if os(macOS)
            let font = (storage.attribute(.font, at: anchor, effectiveRange: nil) as? NSFont) ?? .systemFont(ofSize: 13)
            #else
            let font = (storage.attribute(.font, at: anchor, effectiveRange: nil) as? UIFont) ?? .systemFont(ofSize: 15)
            #endif
            let captionHeight = ceil(font.ascender - font.descender + font.leading)
            let current = (storage.attribute(.paragraphStyle, at: paragraph.location, effectiveRange: nil) as? NSParagraphStyle) ?? .default
            let style = current.mutableCopy() as! NSMutableParagraphStyle
            style.minimumLineHeight = size.height + 10 + captionHeight
            storage.addAttribute(.paragraphStyle, value: style, range: paragraph)
            imageSlots.append(ImageSlot(character: anchor, image: image, size: size,
                                        source: NSRange(location: found.range.location, length: max(NSMaxRange(found.range), NSMaxRange(found.captionRange)) - found.range.location)))
        }
    }

    private func imageRect(_ slot: ImageSlot, origin: CGPoint) -> CGRect? {
        let glyph = glyphIndexForCharacter(at: slot.character)
        guard glyph < numberOfGlyphs else { return nil }
        let line = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let padding = textContainer(forGlyphAt: glyph, effectiveRange: nil)?.lineFragmentPadding ?? 5
        let available = max(0, line.width - padding * 2)
        let scale = min(1, available / slot.size.width)
        var size = CGSize(width: slot.size.width * scale, height: slot.size.height * scale)
        if let drag = dragImageWidth, drag.location == slot.source.location, size.width > 0 {
            // Live preview while dragging: same aspect, never taller than the reserved line.
            let w = min(max(48, drag.width), max(available, size.width))
            size = CGSize(width: w, height: size.height * w / size.width)
        }
        return CGRect(x: line.minX + padding + origin.x, y: line.minY + 4 + origin.y, width: size.width, height: size.height)
    }

    /// Frames of every laid-out image (for hit testing the resize handle).
    func imageFrames(origin: CGPoint) -> [ImageFrame] {
        imageSlots.compactMap { slot in imageRect(slot, origin: origin).map { ImageFrame(rect: $0, source: slot.source) } }
    }

    static func handleRect(for image: CGRect) -> CGRect {
        CGRect(x: image.maxX - 7, y: image.maxY - 7, width: 14, height: 14)
    }

    private func drawImages(in characters: NSRange, origin: CGPoint) {
        for slot in imageSlots where slot.character < NSMaxRange(characters) {
            guard let rect = imageRect(slot, origin: origin) else { continue }
            #if os(macOS)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6).addClip()
            slot.image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            NSGraphicsContext.restoreGraphicsState()
            if activeImageLocation == slot.source.location || dragImageWidth?.location == slot.source.location {
                // Selected image: accent outline + bottom-right resize handle (original's drag handle).
                NSColor.controlAccentColor.setStroke()
                let outline = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
                outline.lineWidth = 2
                outline.stroke()
                let handle = NSBezierPath(ovalIn: Self.handleRect(for: rect).insetBy(dx: 2, dy: 2))
                NSColor.white.setFill(); handle.fill()
                NSColor.controlAccentColor.setStroke(); handle.lineWidth = 2; handle.stroke()
            }
            #else
            UIGraphicsGetCurrentContext()?.saveGState()
            UIBezierPath(roundedRect: rect, cornerRadius: 6).addClip()
            slot.image.draw(in: rect)
            UIGraphicsGetCurrentContext()?.restoreGState()
            #endif
        }
    }


    func styleReferenceBlocks(in storage: NSTextStorage, spans: [MarkdownLiveSpans.Span],
                               scriptureBlocks: [NoteScriptureBlock],
                               paragraph: NSParagraphStyle, headingAttributes: [NSAttributedString.Key: Any]) {
        let dictionary = NoteLexiconBlock.detect(in: storage.string, spans: spans)
        // Edits can precede SwiftUI's async canonical verification. Never style
        // yesterday's ranges over new source, even for one native text-change pass.
        let scripture = scriptureBlocks.filter { $0.isCurrent(in: storage.string) }
        let blocks = dictionary.map { ($0.range, $0.heading) }
            + scripture.map { ($0.range, $0.referenceRange) }
        referenceBlockRanges = blocks.map { $0.0 }
        for (range, heading) in blocks {
            let inset = paragraph.mutableCopy() as! NSMutableParagraphStyle
            inset.firstLineHeadIndent = 12
            inset.headIndent = 12
            inset.tailIndent = -12
            inset.paragraphSpacing = 8
            // The entry starts with a Latin Strong’s ID even for Hebrew lemmas.
            // Keep the surrounding English definition in its natural direction.
            inset.baseWritingDirection = .leftToRight
            storage.addAttribute(.paragraphStyle, value: inset, range: range)
            storage.addAttributes(headingAttributes, range: heading)
        }
    }


    func styleTables(
        in storage: NSTextStorage, spans: [MarkdownLiveSpans.Span],
        paragraph: NSParagraphStyle, hidden: inout IndexSet, available: CGFloat = 0
    ) {
        rows = []
        tablesScaledForWidth = false
        // Before first layout the container width can be 0 or effectively unbounded.
        let width = available > 40 && available < 4000 ? available : Self.fallbackWidth
        let source = storage.string as NSString
        let lines = spans.filter { $0.kind == .tableHeader || $0.kind == .tableRule || $0.kind == .tableRow }
        var index = 0
        while index + 2 < lines.count {
            let row = lines[index]
            let header = lines[index + 1]
            let rule = lines[index + 2]
            index += 1
            guard row.kind == .tableRow, header.kind == .tableHeader, header.range == row.range,
                  rule.kind == .tableRule else { continue }

            let headerCells = MarkdownLiveSpans.tableCells(in: source, range: row.range)
            var group = [(row.range, headerCells)]
            index += 2
            var previous = rule.range
            while index < lines.count, lines[index].kind == .tableRow,
                  source.lineRange(for: previous).upperBound == lines[index].range.location {
                let range = lines[index].range
                let cells = MarkdownLiveSpans.tableCells(in: source, range: range)
                guard cells.count == headerCells.count,
                      index + 1 == lines.count || lines[index + 1].kind != .tableHeader else { break }
                group.append((range, cells))
                previous = range
                index += 1
            }

            // Source padding varies across imported notes. Collapse it visually so
            // adjacent rows share a text inset while their editing offsets stay intact.
            for (_, cells) in group {
                for cell in cells {
                    var start = cell.location
                    var end = cell.upperBound
                    while start < end, isPadding(source.character(at: start)) { start += 1 }
                    while end > start, isPadding(source.character(at: end - 1)) { end -= 1 }
                    hidden.insert(integersIn: cell.location..<start)
                    hidden.insert(integersIn: end..<cell.upperBound)
                }
            }
            func measureCells() -> [[CGFloat]] {
                group.map { _, cells in
                    cells.map { cell -> CGFloat in
                        let displayed = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: cell))
                        for markers in hidden.rangeView(of: cell.location..<cell.upperBound).reversed() {
                            displayed.deleteCharacters(in: NSRange(location: markers.lowerBound - cell.location, length: markers.count))
                        }
                        return ceil(displayed.size().width)
                    }
                }
            }
            var cellWidths = measureCells()
            let alignmentFactors: [CGFloat] = MarkdownLiveSpans.tableCells(in: source, range: rule.range).map {
                let marker = source.substring(with: $0).trimmingCharacters(in: .whitespaces)
                if marker.hasPrefix(":"), marker.hasSuffix(":") { return 0.5 }
                return marker.hasSuffix(":") ? 1 : 0
            }
            var columns = headerCells.indices.map { column in
                max(40, cellWidths.map { $0[column] }.max() ?? 0)
            }
            // Fit moderately wide tables. Keep natural-size wrapped rows when fitting the
            // whole table would make the text too small.
            let pipeEstimate = storage.attributedSubstring(from: NSRange(location: row.range.location, length: 1)).size().width
            var fontScale: CGFloat = 1
            tablesScaledForWidth = true
            let total = columns.reduce(0) { $0 + $1 + 18 + pipeEstimate }
            let scale = min(1, (width - 4) / max(1, total))
            if scale >= 0.85, scale < 1 {
                fontScale = scale
                for (range, _) in group {
                    let line = source.lineRange(for: range)
                    storage.enumerateAttribute(.font, in: line) { value, run, _ in
                        #if os(macOS)
                        if let font = value as? NSFont { storage.addAttribute(.font, value: font.withSize(font.pointSize * scale), range: run) }
                        #else
                        if let font = value as? UIFont { storage.addAttribute(.font, value: font.withSize(font.pointSize * scale), range: run) }
                        #endif
                    }
                }
                cellWidths = measureCells()
                columns = headerCells.indices.map { column in max(40 * scale, cellWidths.map { $0[column] }.max() ?? 0) }
            }
            let rowStyle = paragraph.mutableCopy() as! NSMutableParagraphStyle
            rowStyle.paragraphSpacing = 0
            rowStyle.lineSpacing = 0

            #if os(macOS)
            let clear = NSColor.clear
            #else
            let clear = UIColor.clear
            #endif
            let delimiterText = storage.attributedSubstring(from: NSRange(location: row.range.location, length: 1))
            let pipeSize = delimiterText.size()
            let cellInset: CGFloat = 9 * fontScale
            rowStyle.minimumLineHeight = ceil(pipeSize.height) + 12
            let pipeWidth = pipeSize.width
            var dividers: [CGFloat] = [0]
            for width in columns {
                dividers.append((dividers.last ?? 0) + width + 2 * cellInset + pipeWidth)
            }

            for (offset, entry) in group.enumerated() {
                let (range, cells) = entry
                storage.addAttribute(.paragraphStyle, value: rowStyle, range: source.lineRange(for: range))
                let boundaries = [range.location] + cells.map(\.upperBound)
                let slack = columns.indices.map { columns[$0] - cellWidths[offset][$0] }
                let leading = slack.indices.map { slack[$0] * alignmentFactors[$0] }
                for (column, boundary) in boundaries.enumerated() {
                    let padding: CGFloat
                    if column == 0 {
                        padding = cellInset + leading[0]
                    } else if column == boundaries.count - 1 {
                        // The final divider is drawn at the measured edge. Padding
                        // its glyph would create an empty wrapped line on short rows.
                        padding = 0
                    } else {
                        padding = 2 * cellInset + slack[column - 1] - leading[column - 1] + leading[column]
                    }
                    let pipe = NSRange(location: boundary, length: 1)
                    storage.addAttributes([.kern: padding, .foregroundColor: clear], range: pipe)
                    if let font = delimiterText.attribute(.font, at: 0, effectiveRange: nil) {
                        storage.addAttribute(.font, value: font, range: pipe)
                    }
                }
                rows.append(Row(range: range, boundaries: boundaries, dividers: dividers,
                                header: offset == 0, hasBody: group.count > 1,
                                lastCellInset: dividers[dividers.count - 2] + cellInset))
            }

            let ruleStyle = NSMutableParagraphStyle()
            ruleStyle.minimumLineHeight = 1
            ruleStyle.maximumLineHeight = 1
            storage.addAttribute(.paragraphStyle, value: ruleStyle, range: source.lineRange(for: rule.range))
            hidden.insert(integersIn: rule.range.location..<rule.range.upperBound)
        }
    }

    // Rows are in source order. TextKit calls this repeatedly as a document reflows.
    private func row(at character: Int) -> Row? {
        var start = 0
        var end = rows.count
        while start < end {
            let middle = (start + end) / 2
            let row = rows[middle]
            if character < row.range.location { end = middle }
            else if character >= row.range.upperBound { start = middle + 1 }
            else { return row }
        }
        return nil
    }

    func lastCellContinuationInset(at character: Int, width: CGFloat) -> CGFloat? {
        guard let row = row(at: character),
              character > row.boundaries[row.boundaries.count - 2],
              row.lastCellInset <= width - 90 else { return nil }
        return row.lastCellInset
    }

    private func isPadding(_ character: unichar) -> Bool {
        character == 32 || character == 9
    }

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        #if os(macOS)
        let context = NSGraphicsContext.current?.cgContext
        let label = NSColor.labelColor
        #else
        let context = UIGraphicsGetCurrentContext()
        let label = UIColor.label
        #endif
        if let context, !referenceBlockRanges.isEmpty {
            let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
            context.saveGState()
            context.translateBy(x: origin.x, y: origin.y)
            for range in referenceBlockRanges where NSIntersectionRange(characters, range).length > 0 {
                let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                guard glyphs.length > 0 else { continue }
                let first = lineFragmentRect(forGlyphAt: glyphs.location, effectiveRange: nil)
                let last = lineFragmentRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil)
                let padding = textContainer(forGlyphAt: glyphs.location, effectiveRange: nil)?.lineFragmentPadding ?? 5
                let box = CGRect(x: first.minX + padding, y: first.minY - 2,
                                 width: max(0, first.width - padding * 2), height: last.maxY - first.minY + 4)
                let path = CGPath(roundedRect: box, cornerWidth: 8, cornerHeight: 8, transform: nil)
                context.addPath(path)
                context.setFillColor(label.withAlphaComponent(0.045).cgColor)
                context.fillPath()
                context.addPath(path)
                context.setStrokeColor(label.withAlphaComponent(0.12).cgColor)
                context.setLineWidth(0.75)
                context.strokePath()
            }
            context.restoreGState()
        }
        if let context, !rows.isEmpty {
            let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
            context.saveGState()
            context.translateBy(x: origin.x, y: origin.y)
            context.setLineWidth(1)
            context.setStrokeColor(label.withAlphaComponent(0.24).cgColor)
            context.setFillColor(label.withAlphaComponent(0.08).cgColor)
            for row in rows where NSIntersectionRange(characters, row.range).length > 0 {
                let glyphs = row.boundaries.map { glyphIndexForCharacter(at: $0) }
                guard let first = glyphs.first, let last = glyphs.last else { continue }
                var fragment = NSRange()
                let line = lineFragmentRect(forGlyphAt: first, effectiveRange: &fragment)
                let start = line.minX + location(forGlyphAt: first).x
                // The one-point hidden separator still occupies a line fragment.
                let separatorHeight: CGFloat = row.header && row.hasBody ? 1 : 0
                let x = row.dividers.map { start + $0 }
                let earlierColumnsFit = glyphs.dropLast().allSatisfy { NSLocationInRange($0, fragment) }
                    && row.lastCellInset <= line.width - 90
                guard earlierColumnsFit || (NSLocationInRange(last, fragment) && x.last! <= line.maxX) else {
                    // Keep wrapped text together visually as one table row. Use the
                    // full line fragment so adjacent rows share their outer edges.
                    let lastLine = lineFragmentRect(forGlyphAt: last, effectiveRange: nil)
                    let inset = textContainer(forGlyphAt: first, effectiveRange: nil)?.lineFragmentPadding ?? 0
                    let box = CGRect(x: line.minX + inset, y: line.minY,
                                     width: max(0, line.width - 2 * inset), height: lastLine.maxY - line.minY + separatorHeight)
                    if row.header { context.fill(box) }
                    context.stroke(box)
                    for glyph in glyphs.dropFirst().dropLast() {
                        let fragment = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
                        let boundary = fragment.minX + location(forGlyphAt: glyph).x
                        context.move(to: CGPoint(x: boundary, y: fragment.minY))
                        context.addLine(to: CGPoint(x: boundary, y: fragment.maxY))
                    }
                    context.strokePath()
                    continue
                }
                let lastLine = lineFragmentRect(forGlyphAt: last, effectiveRange: nil)
                let edge = min(x[x.count - 1], line.maxX)
                let box = CGRect(x: start, y: line.minY, width: edge - start,
                                 height: lastLine.maxY - line.minY + separatorHeight)
                if row.header { context.fill(box) }
                context.stroke(box)
                for divider in x.dropFirst().dropLast() where divider < edge {
                    context.move(to: CGPoint(x: divider, y: box.minY))
                    context.addLine(to: CGPoint(x: divider, y: box.maxY))
                }
                context.strokePath()
            }
            context.restoreGState()
        }
        if !imageSlots.isEmpty {
            drawImages(in: characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil), origin: origin)
        }
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    }
}
