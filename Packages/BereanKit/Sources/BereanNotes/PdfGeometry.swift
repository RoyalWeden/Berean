import Foundation

/// Converts the original's normalised highlight rectangles (0…1, top-left origin of the page *as
/// displayed*, i.e. after the page's /Rotate — pdf.js viewport space) to and from PDF page space
/// (points, bottom-left origin, unrotated crop box), which PDFKit annotations and selections use.
public enum PdfGeometry {
    public struct Box: Equatable, Sendable {
        public var x, y, width, height: Double
        public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
    }

    static func normalizedRotation(_ r: Int) -> Int { ((r % 360) + 360) % 360 }

    /// Display-normalised point (u right, v down) → page point.
    static func toPage(u: Double, v: Double, crop c: Box, rotation: Int) -> (Double, Double) {
        switch normalizedRotation(rotation) {
        case 90: return (c.x + v * c.width, c.y + u * c.height)
        case 180: return (c.x + (1 - u) * c.width, c.y + v * c.height)
        case 270: return (c.x + (1 - v) * c.width, c.y + (1 - u) * c.height)
        default: return (c.x + u * c.width, c.y + (1 - v) * c.height)
        }
    }

    /// Page point → display-normalised point.
    static func toDisplay(x: Double, y: Double, crop c: Box, rotation: Int) -> (Double, Double) {
        let px = c.width > 0 ? (x - c.x) / c.width : 0, py = c.height > 0 ? (y - c.y) / c.height : 0
        switch normalizedRotation(rotation) {
        case 90: return (py, px)
        case 180: return (1 - px, py)
        case 270: return (1 - py, 1 - px)
        default: return (px, 1 - py)
        }
    }

    public static func pageRect(_ r: PdfRect, crop: Box, rotation: Int) -> Box {
        let a = toPage(u: r.x, v: r.y, crop: crop, rotation: rotation)
        let b = toPage(u: r.x + r.w, v: r.y + r.h, crop: crop, rotation: rotation)
        return Box(x: min(a.0, b.0), y: min(a.1, b.1), width: abs(a.0 - b.0), height: abs(a.1 - b.1))
    }

    public static func normalizedRect(_ b: Box, crop: Box, rotation: Int) -> PdfRect {
        let p = toDisplay(x: b.x, y: b.y, crop: crop, rotation: rotation)
        let q = toDisplay(x: b.x + b.width, y: b.y + b.height, crop: crop, rotation: rotation)
        return PdfRect(x: min(p.0, q.0), y: min(p.1, q.1), w: abs(p.0 - q.0), h: abs(p.1 - q.1))
    }
}
