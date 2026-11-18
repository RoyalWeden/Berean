// Run with the actual shared reader implementation:
// xcrun swiftc apple/Shared/ReaderVerse.swift scripts/native/reader-backgrounds/main.swift -o /tmp/berean-reader-backgrounds
// /tmp/berean-reader-backgrounds
import AppKit

let width = 360
let height = 360
let origin = CGPoint(x: 18, y: 30)
let source = "\t8\tFor nation shall rise against G123 nation, and kingdom against kingdom: and there shall be earthquakes in divers places.\n\t9\tBut take heed to yourselves.\n Study Tag "
let storage = NSTextStorage(string: source, attributes: [.font: NSFont.systemFont(ofSize: 17)])
let layout = ReaderTextLayoutManager()
let container = NSTextContainer(containerSize: CGSize(width: 300, height: 320))
container.lineFragmentPadding = 0
storage.addLayoutManager(layout)
layout.addTextContainer(container)
let text = source as NSString
let second = text.range(of: "\t9\t")
storage.addAttribute(NSAttributedString.Key("bereanSkip"), value: true, range: NSRange(location: 0, length: 3))
storage.addAttribute(NSAttributedString.Key("bereanSkip"), value: true, range: second)
let strongs = text.range(of: "G123")
storage.addAttribute(NSAttributedString.Key("bereanSkip"), value: true, range: strongs)
let tag = text.range(of: " Study Tag ")
storage.addAttributes([NSAttributedString.Key("bereanSkip"): true,
                       .link: URL(string: "berean-tag:study")!, .backgroundColor: NSColor.systemGreen], range: tag)
let start = text.range(of: "shall rise").location
let end = text.range(of: "take heed").upperBound
let selected = NSRange(location: start, length: end - start)
storage.addAttribute(.backgroundColor, value: NSColor.systemBlue, range: selected)
layout.ensureLayout(for: container)

let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                             isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.cgContext.translateBy(x: 0, y: CGFloat(height))
graphics.cgContext.scaleBy(x: 1, y: -1)
layout.drawBackground(forGlyphRange: layout.glyphRange(for: container), at: origin)
NSGraphicsContext.restoreGraphicsState()

func alpha(_ point: CGPoint) -> CGFloat {
    bitmap.colorAt(x: Int(point.x), y: Int(point.y))?.alphaComponent ?? 0
}
var testedLines = 0
layout.enumerateLineFragments(forGlyphRange: layout.glyphRange(forCharacterRange: selected, actualCharacterRange: nil)) { _, used, _, line, _ in
    let characters = NSIntersectionRange(selected, layout.characterRange(forGlyphRange: line, actualGlyphRange: nil))
    var body = text.rangeOfCharacter(from: .letters, range: characters)
    while body.location != NSNotFound,
          storage.attribute(NSAttributedString.Key("bereanSkip"), at: body.location, effectiveRange: nil) != nil {
        let next = body.upperBound
        body = text.rangeOfCharacter(from: .letters, range: NSRange(location: next, length: characters.upperBound - next))
    }
    guard body.location != NSNotFound else { return }
    let glyph = layout.glyphRange(forCharacterRange: body, actualCharacterRange: nil)
    let bounds = layout.boundingRect(forGlyphRange: glyph, in: container).offsetBy(dx: origin.x, dy: origin.y)
    precondition(alpha(CGPoint(x: bounds.midX, y: used.midY + origin.y)) > 0.8, "Missing background on selected line \(testedLines)")
    precondition(alpha(CGPoint(x: origin.x + 305, y: used.midY + origin.y)) < 0.05, "Selected trailing whitespace")
    testedLines += 1
}
let numberGlyphs = layout.glyphRange(forCharacterRange: NSRange(location: second.location + 1, length: 1), actualCharacterRange: nil)
let number = layout.boundingRect(forGlyphRange: numberGlyphs, in: container).offsetBy(dx: origin.x, dy: origin.y)
precondition(alpha(CGPoint(x: number.midX, y: number.midY)) < 0.05, "Selected verse number")
let strongBounds = layout.boundingRect(forGlyphRange: layout.glyphRange(forCharacterRange: strongs, actualCharacterRange: nil), in: container)
    .offsetBy(dx: origin.x, dy: origin.y)
precondition(alpha(CGPoint(x: strongBounds.midX, y: strongBounds.midY)) < 0.05, "Selected Strong's annotation")
let tagBounds = layout.boundingRect(forGlyphRange: layout.glyphRange(forCharacterRange: tag, actualCharacterRange: nil), in: container)
    .offsetBy(dx: origin.x, dy: origin.y)
precondition(alpha(CGPoint(x: tagBounds.midX, y: tagBounds.midY)) > 0.8, "Lost tag's own background")
precondition(testedLines >= 3, "Fixture did not wrap")
print("Reader background rendering passed: \(testedLines) wrapped lines, clean gutter/Strong's/trailing space, preserved tag")
