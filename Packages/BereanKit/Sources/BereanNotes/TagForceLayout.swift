import Foundation

/// Port of src/components/tags/tagForceLayout.ts — node sizing, golden-spiral seeding and one
/// integration step (repulsion, drawn-edge springs, centre gravity, hard non-overlap pass).
public enum TagForceLayout {
    public struct Node: Equatable, Sendable {
        public var id: String
        public var x: Double, y: Double, vx: Double, vy: Double
        public var r: Double
        public var pinned: Bool
        public init(id: String, x: Double, y: Double, vx: Double = 0, vy: Double = 0, r: Double, pinned: Bool) {
            self.id = id; self.x = x; self.y = y; self.vx = vx; self.vy = vy; self.r = r; self.pinned = pinned
        }
    }

    public static let rMin = 14.0, rMax = 40.0

    public static func nodeRadius(verseCount: Int, chapterCount: Int, edgeCount: Int) -> Double {
        let usage = Double(verseCount + 3 * chapterCount).squareRoot()
        let conn = Double(edgeCount).squareRoot()
        return max(rMin, min(rMax, rMin + 2.6 * usage + 3.2 * conn))
    }

    public static func edgeCountByTag(_ edges: [TagEdge]) -> [String: Int] {
        var m: [String: Int] = [:]
        for e in edges { m[e.source, default: 0] += 1; m[e.target, default: 0] += 1 }
        return m
    }

    public static func seed(_ tags: [VerseTagSummary], edges: [TagEdge], center: (x: Double, y: Double)) -> [Node] {
        let ec = edgeCountByTag(edges)
        let golden = Double.pi * (3 - 5.0.squareRoot())
        return tags.enumerated().map { i, t in
            let r = nodeRadius(verseCount: t.verseCount, chapterCount: t.chapterCount, edgeCount: ec[t.id] ?? 0)
            if let x = t.graphX, let y = t.graphY { return Node(id: t.id, x: x, y: y, r: r, pinned: t.graphPinned) }
            let rad = 40 + 22 * Double(i + 1).squareRoot()
            let ang = Double(i) * golden
            return Node(id: t.id, x: center.x + rad * cos(ang), y: center.y + rad * sin(ang), r: r, pinned: false)
        }
    }

    /// Mutates `nodes`; returns the max displacement so callers can stop once settled.
    @discardableResult
    public static func step(_ nodes: inout [Node], edges: [TagEdge], center: (x: Double, y: Double),
                            charge: Double = 1400, spring: Double = 0.02, springLength: Double = 120,
                            gravity: Double = 0.015, damping: Double = 0.85,
                            jitter: () -> Double = { Double.random(in: -0.5...0.5) }) -> Double {
        let n = nodes.count
        for i in 0..<n {
            for j in (i + 1)..<max(i + 1, n) {
                var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
                var d2 = dx * dx + dy * dy
                if d2 == 0 { dx = jitter() * 0.1; dy = jitter() * 0.1; d2 = max(dx * dx + dy * dy, 1e-6) }
                let minDist = nodes[i].r + nodes[j].r + 24
                let d = d2.squareRoot()
                let f = charge / d2 + (d < minDist ? (minDist - d) * 0.6 : 0)
                let fx = dx / d * f, fy = dy / d * f
                nodes[i].vx += fx; nodes[i].vy += fy
                nodes[j].vx -= fx; nodes[j].vy -= fy
            }
        }
        let index = Dictionary(nodes.indices.map { (nodes[$0].id, $0) }, uniquingKeysWith: { a, _ in a })
        for e in edges {
            guard let a = index[e.source], let b = index[e.target] else { continue }
            let dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y
            let d = max(hypot(dx, dy), 1)
            let f = (d - springLength) * spring
            let fx = dx / d * f, fy = dy / d * f
            nodes[a].vx += fx; nodes[a].vy += fy
            nodes[b].vx -= fx; nodes[b].vy -= fy
        }
        var maxDisp = 0.0
        for i in nodes.indices {
            if nodes[i].pinned { nodes[i].vx = 0; nodes[i].vy = 0; continue }
            nodes[i].vx = (nodes[i].vx + (center.x - nodes[i].x) * gravity) * damping
            nodes[i].vy = (nodes[i].vy + (center.y - nodes[i].y) * gravity) * damping
            nodes[i].x += nodes[i].vx; nodes[i].y += nodes[i].vy
            maxDisp = max(maxDisp, abs(nodes[i].vx) + abs(nodes[i].vy))
        }
        let gap = 12.0
        for _ in 0..<8 {
            var moved = false
            for i in 0..<n {
                for j in (i + 1)..<max(i + 1, n) {
                    var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
                    var d = hypot(dx, dy)
                    if d < 0.01 { let jx = jitter(), jy = jitter(); dx = jx == 0 ? 0.01 : jx; dy = jy == 0 ? 0.01 : jy; d = max(hypot(dx, dy), 0.01) }
                    let minD = nodes[i].r + nodes[j].r + gap
                    if d >= minD { continue }
                    let push = minD - d, ux = dx / d, uy = dy / d
                    let (aShare, bShare): (Double, Double) = nodes[i].pinned == nodes[j].pinned ? (0.5, 0.5)
                        : nodes[i].pinned ? (0, 1) : (1, 0)
                    nodes[i].x += ux * push * aShare; nodes[i].y += uy * push * aShare
                    nodes[j].x -= ux * push * bShare; nodes[j].y -= uy * push * bShare
                    if aShare > 0 { nodes[i].vx = 0; nodes[i].vy = 0 }
                    if bShare > 0 { nodes[j].vx = 0; nodes[j].vy = 0 }
                    moved = true
                }
            }
            if !moved { break }
            maxDisp = max(maxDisp, 1.5)
        }
        return maxDisp
    }
}
