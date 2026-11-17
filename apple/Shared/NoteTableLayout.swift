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

    func styleTables(
        in storage: NSTextStorage, spans: [MarkdownLiveSpans.Span],
        paragraph: NSParagraphStyle, hidden: inout IndexSet
    ) {
        rows = []
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
            let cellWidths = group.map { _, cells in
                cells.map { cell -> CGFloat in
                    let displayed = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: cell))
                    for markers in hidden.rangeView(of: cell.location..<cell.upperBound).reversed() {
                        displayed.deleteCharacters(in: NSRange(location: markers.lowerBound - cell.location, length: markers.count))
                    }
                    return ceil(displayed.size().width)
                }
            }
            let alignmentFactors: [CGFloat] = MarkdownLiveSpans.tableCells(in: source, range: rule.range).map {
                let marker = source.substring(with: $0).trimmingCharacters(in: .whitespaces)
                if marker.hasPrefix(":"), marker.hasSuffix(":") { return 0.5 }
                return marker.hasSuffix(":") ? 1 : 0
            }
            let columns = headerCells.indices.map { column in
                max(40, cellWidths.map { $0[column] }.max() ?? 0)
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
            let cellInset: CGFloat = 9
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
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    }
}
