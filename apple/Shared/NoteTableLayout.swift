import SwiftUI
import BereanNotes
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Adds a grid to complete Markdown tables while keeping the original character indices
/// for TextKit selection, undo, paste and navigation between cells.
final class NoteTableLayout: NSLayoutManager {
    private struct Row {
        let range: NSRange
        let boundaries: [Int]
        let dividers: [CGFloat]
        let header: Bool
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

            let cellWidths = group.map { _, cells in
                cells.map { cell -> CGFloat in
                    let displayed = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: cell))
                    for markers in hidden.rangeView(of: cell.location..<cell.upperBound).reversed() {
                        displayed.deleteCharacters(in: NSRange(location: markers.lowerBound - cell.location, length: markers.count))
                    }
                    return ceil(displayed.size().width)
                }
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
            rowStyle.minimumLineHeight = ceil(pipeSize.height) + 9
            let pipeWidth = pipeSize.width
            var dividers: [CGFloat] = [0]
            for width in columns {
                dividers.append((dividers.last ?? 0) + width + 12 + pipeWidth)
            }

            for (offset, entry) in group.enumerated() {
                let (range, cells) = entry
                storage.addAttribute(.paragraphStyle, value: rowStyle, range: source.lineRange(for: range))
                let boundaries = [range.location] + cells.map(\.upperBound)
                for (column, boundary) in boundaries.enumerated() {
                    let padding: CGFloat
                    if column == 0 {
                        padding = 6
                    } else if column == boundaries.count - 1 {
                        // The final divider is drawn at the measured edge. Padding
                        // its glyph would create an empty wrapped line on short rows.
                        padding = 0
                    } else {
                        padding = 12 + columns[column - 1] - cellWidths[offset][column - 1]
                    }
                    let pipe = NSRange(location: boundary, length: 1)
                    storage.addAttributes([.kern: padding, .foregroundColor: clear], range: pipe)
                    if let font = delimiterText.attribute(.font, at: 0, effectiveRange: nil) {
                        storage.addAttribute(.font, value: font, range: pipe)
                    }
                }
                rows.append(Row(range: range, boundaries: boundaries, dividers: dividers, header: offset == 0))
            }

            let ruleStyle = NSMutableParagraphStyle()
            ruleStyle.minimumLineHeight = 1
            ruleStyle.maximumLineHeight = 1
            storage.addAttribute(.paragraphStyle, value: ruleStyle, range: source.lineRange(for: rule.range))
            hidden.insert(integersIn: rule.range.location..<rule.range.upperBound)
        }
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
            context.setStrokeColor(label.withAlphaComponent(0.18).cgColor)
            context.setFillColor(label.withAlphaComponent(0.07).cgColor)
            for row in rows where NSIntersectionRange(characters, row.range).length > 0 {
                let glyphs = row.boundaries.map { glyphIndexForCharacter(at: $0) }
                guard let first = glyphs.first, let last = glyphs.last else { continue }
                var fragment = NSRange()
                let line = lineFragmentRect(forGlyphAt: first, effectiveRange: &fragment)
                let start = line.minX + location(forGlyphAt: first).x
                let x = row.dividers.map { start + $0 }
                guard NSLocationInRange(last, fragment), let end = x.last, end <= line.maxX else {
                    // Keep wrapped text together visually as one table row. Use the
                    // full line fragment so adjacent rows share their outer edges.
                    let lastLine = lineFragmentRect(forGlyphAt: last, effectiveRange: nil)
                    let inset = textContainer(forGlyphAt: first, effectiveRange: nil)?.lineFragmentPadding ?? 0
                    let box = CGRect(x: line.minX + inset, y: line.minY,
                                     width: max(0, line.width - 2 * inset), height: lastLine.maxY - line.minY)
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
                let box = CGRect(x: x[0], y: line.minY, width: x[x.count - 1] - x[0], height: line.height)
                if row.header { context.fill(box) }
                context.stroke(box)
                for divider in x.dropFirst().dropLast() {
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
