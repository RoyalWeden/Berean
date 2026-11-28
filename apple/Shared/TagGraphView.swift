import SwiftUI
import BereanNotes

/// Tag Graph — native port of the original Tags graph (TagsGraphPanel / TagGraphCanvas / side panel).
/// Nodes are verse tags (size = usage + connections, colour = tag colour); solid/dashed lines are the
/// user's drawn connections (arrows, colour, note); faint lines are verse co-occurrence (≥ 2 shared
/// verses). Dragging a node pins it where dropped (saved to `verse_tags.graph_x/y/pinned`, as the
/// original); dragging empty space pans; pinch / ⌘-scroll zooms. Same tables, no new keys.
struct TagGraphView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var graph = TagGraph(tags: [], edges: [], coOccurrence: [], coOccurrenceOmitted: false)
    @State private var nodes: [TagForceLayout.Node] = []
    @State private var settleTask: Task<Void, Never>?
    @State private var offset: CGSize = .zero
    @State private var panStart: CGSize?
    @State private var zoom: CGFloat = 1
    @State private var zoomStart: CGFloat?
    @State private var dragNode: (id: String, start: CGPoint)?
    @State private var selectedTag: String?
    @State private var selectedEdge: String?
    @State private var hovered: String?
    @AppStorage("tagGraph.showCoOccurrence") private var showCoOccurrence = true
    @AppStorage("tagGraph.showLabels") private var showLabels = true
    @State private var search = ""
    @State private var members: [TagMemberDetail] = []
    @State private var viewSize: CGSize = .zero
    @State private var detailHeight: CGFloat = 0

    private var dark: Bool { scheme == .dark }
    private var tagsById: [String: VerseTagSummary] { Dictionary(graph.tags.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var searchMatches: Set<String> {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return [] }
        return Set(graph.tags.filter { $0.name.localizedCaseInsensitiveContains(q) }.map(\.id))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                canvas(size: geo.size)
                    .onAppear { viewSize = geo.size }
                    .onChange(of: geo.size) { _, size in viewSize = size }
                controls
                    .padding(12)
                if graph.tags.isEmpty {
                    ContentUnavailableView("No tags yet", systemImage: "point.3.connected.trianglepath.dotted",
                                           description: Text("Tag verses to see how your topics connect."))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .overlay(alignment: inspectorAlignment) {
                if let id = selectedTag, let tag = tagsById[id] {
                    inspector(tag)
                        .frame(maxWidth: inspectorMaxWidth)
                        .padding(12)
                        .transition(.move(edge: inspectorEdge).combined(with: .opacity))
                }
            }
        }
        .clipped()
        .task(id: app.tagsRevision) { reload() }
        .task(id: selectedTag) { members = selectedTag.flatMap { try? app.verseTags?.members([$0]) } ?? [] }
        .onDisappear { settleTask?.cancel() }
    }

    private var inspectorMaxWidth: CGFloat {
        #if os(iOS)
        .infinity
        #else
        320
        #endif
    }

    private var inspectorEdge: Edge {
        #if os(iOS)
        .bottom
        #else
        .trailing
        #endif
    }

    private var inspectorAlignment: Alignment {
        #if os(iOS)
        .bottom
        #else
        .topTrailing
        #endif
    }

    // MARK: data + simulation

    private func reload() {
        guard let loaded = try? app.tagGraph?.graph() else { return }
        let previous = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var seeded = TagForceLayout.seed(loaded.tags, edges: loaded.edges, center: (0, 0))
        for i in seeded.indices {
            if let old = previous[seeded[i].id], loaded.tags[i].graphX == nil || !loaded.tags[i].graphPinned {
                seeded[i].x = old.x; seeded[i].y = old.y
            }
        }
        let firstLoad = nodes.isEmpty
        graph = loaded
        nodes = seeded
        if let selectedTag, tagsById[selectedTag] == nil { self.selectedTag = nil }
        if let selectedEdge, !loaded.edges.contains(where: { $0.id == selectedEdge }) { self.selectedEdge = nil }
        settle(fitWhenDone: firstLoad)
    }

    private func settle(fitWhenDone: Bool = false) {
        settleTask?.cancel()
        let edges = graph.edges
        if reduceMotion {
            var working = nodes
            for _ in 0..<400 where TagForceLayout.step(&working, edges: edges, center: (0, 0)) > 0.4 {}
            nodes = working
            if fitWhenDone { fit() }
            return
        }
        settleTask = Task { @MainActor in
            var calm = 0, steps = 0
            while !Task.isCancelled, calm < 30, steps < 900 {
                var working = nodes
                let disp = TagForceLayout.step(&working, edges: edges, center: (0, 0))
                // Keep a node under the pointer exactly where the pointer is.
                if let drag = dragNode, let i = working.firstIndex(where: { $0.id == drag.id }),
                   let j = nodes.firstIndex(where: { $0.id == drag.id }) {
                    working[i].x = nodes[j].x; working[i].y = nodes[j].y
                }
                nodes = working
                calm = disp < 0.4 ? calm + 1 : 0
                steps += 1
                if fitWhenDone, steps == 45 { withAnimation(.smooth) { fit() } }
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
    }

    private func fit() {
        guard !nodes.isEmpty, viewSize.width > 0 else { return }
        let minX = nodes.map { $0.x - $0.r }.min()!, maxX = nodes.map { $0.x + $0.r }.max()!
        let minY = nodes.map { $0.y - $0.r }.min()!, maxY = nodes.map { $0.y + $0.r + 18 }.max()!
        let w = max(maxX - minX, 1), h = max(maxY - minY, 1)
        let z = min(2.2, max(0.25, min((viewSize.width - 80) / w, (viewSize.height - 120) / h)))
        zoom = z
        offset = CGSize(width: -(minX + w / 2) * z, height: -(minY + h / 2) * z + 20)
    }

    // MARK: geometry

    private func screen(_ n: TagForceLayout.Node, in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 + offset.width + n.x * zoom, y: size.height / 2 + offset.height + n.y * zoom)
    }

    private func world(_ p: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: (p.x - size.width / 2 - offset.width) / zoom, y: (p.y - size.height / 2 - offset.height) / zoom)
    }

    private func hitNode(_ p: CGPoint, in size: CGSize) -> String? {
        let w = world(p, in: size)
        return nodes.last { hypot($0.x - w.x, $0.y - w.y) <= $0.r + 4 / zoom }?.id
    }

    private func hitEdge(_ p: CGPoint, in size: CGSize) -> String? {
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var best: (String, CGFloat)?
        for e in graph.edges {
            guard let a = byId[e.source], let b = byId[e.target] else { continue }
            let d = distance(p, screen(a, in: size), screen(b, in: size))
            if d < 8, d < (best?.1 ?? .infinity) { best = (e.id, d) }
        }
        return best?.0
    }

    private func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let len2 = dx * dx + dy * dy
        guard len2 > 0 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    // MARK: canvas

    private func canvas(size: CGSize) -> some View {
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let tags = tagsById
        let matches = searchMatches
        let focus: Set<String>? = selectedTag.map { id in
            var s: Set<String> = [id]
            for e in graph.edges where e.source == id || e.target == id { s.insert(e.source); s.insert(e.target) }
            for c in graph.coOccurrence where c.a == id || c.b == id { s.insert(c.a); s.insert(c.b) }
            return s
        }
        return Canvas { ctx, size in
            if showCoOccurrence {
                let maxWeight = Double(graph.coOccurrence.map(\.weight).max() ?? 1)
                for c in graph.coOccurrence {
                    guard let a = byId[c.a], let b = byId[c.b] else { continue }
                    var path = Path(); path.move(to: screen(a, in: size)); path.addLine(to: screen(b, in: size))
                    let dim = focus.map { !($0.contains(c.a) && $0.contains(c.b)) } ?? false
                    ctx.stroke(path, with: .color(.secondary.opacity(dim ? 0.06 : 0.22)),
                               lineWidth: 1 + 3 * Double(c.weight) / maxWeight)
                }
            }
            for e in graph.edges {
                guard let a = byId[e.source], let b = byId[e.target] else { continue }
                let pa = screen(a, in: size), pb = screen(b, in: size)
                let color = e.color.map { TagColor.color($0, slot: nil, dark: dark) } ?? Color.primary.opacity(0.55)
                let selected = e.id == selectedEdge
                let dim = focus.map { !$0.contains(e.source) || !$0.contains(e.target) } ?? false
                var path = Path(); path.move(to: pa); path.addLine(to: pb)
                ctx.stroke(path, with: .color(color.opacity(dim ? 0.2 : 1)),
                           style: StrokeStyle(lineWidth: selected ? 3.5 : 2, lineCap: .round, dash: e.dashed ? [6, 5] : []))
                let ra = a.r * zoom, rb = b.r * zoom
                if e.arrows == .forward || e.arrows == .both { arrow(&ctx, from: pa, to: pb, inset: rb, color: color) }
                if e.arrows == .backward || e.arrows == .both { arrow(&ctx, from: pb, to: pa, inset: ra, color: color) }
            }
            for n in nodes {
                guard let tag = tags[n.id] else { continue }
                let p = screen(n, in: size), r = n.r * zoom
                let fill = TagColor.color(tag.color, slot: tag.colorSlot, dark: dark)
                let dim = (focus.map { !$0.contains(n.id) } ?? false) || (!matches.isEmpty && !matches.contains(n.id))
                let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
                if dim { ctx.fill(Path(ellipseIn: rect), with: .color(Color(white: dark ? 0.12 : 1))) }
                ctx.fill(Path(ellipseIn: rect), with: .color(fill.opacity(dim ? 0.25 : 1)))
                let emphasized = n.id == selectedTag || n.id == hovered || matches.contains(n.id)
                ctx.stroke(Path(ellipseIn: rect.insetBy(dx: -1.5, dy: -1.5)),
                           with: .color(emphasized ? Color.accentColor : Color.primary.opacity(0.12)),
                           lineWidth: emphasized ? 2.5 : 1)
                if n.pinned {
                    ctx.draw(Text(Image(systemName: "pin.fill")).font(.system(size: 8)).foregroundStyle(.white.opacity(0.9)),
                             at: CGPoint(x: p.x, y: p.y))
                }
                if showLabels || emphasized {
                    ctx.draw(Text(tag.name).font(.caption.weight(emphasized ? .semibold : .regular))
                                .foregroundStyle(dim ? Color.secondary.opacity(0.5) : Color.primary),
                             at: CGPoint(x: p.x, y: p.y + r + 9), anchor: .center)
                }
            }
        }
        .contentShape(.rect)
        .gesture(dragGesture(size: size))
        .simultaneousGesture(MagnifyGesture()
            .onChanged { v in
                if zoomStart == nil { zoomStart = zoom }
                zoom = min(3, max(0.2, (zoomStart ?? 1) * v.magnification))
            }
            .onEnded { _ in zoomStart = nil })
        .onTapGesture(count: 1, coordinateSpace: .local) { p in tap(p, size: size) }
        #if os(macOS)
        .onContinuousHover { phase in
            if case .active(let p) = phase { hovered = hitNode(p, in: size) } else { hovered = nil }
        }
        .pointerStyle(hovered == nil ? .default : .link)
        #endif
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tag graph, \(graph.tags.count) tags, \(graph.edges.count) connections")
        .accessibilityChildren {
            ForEach(graph.tags) { tag in
                Button("#\(tag.name)") { selectedTag = tag.id }
                    .accessibilityValue(summary(tag))
            }
        }
    }

    private func arrow(_ ctx: inout GraphicsContext, from a: CGPoint, to b: CGPoint, inset: CGFloat, color: Color) {
        let ang = atan2(b.y - a.y, b.x - a.x)
        let tip = CGPoint(x: b.x - cos(ang) * (inset + 3), y: b.y - sin(ang) * (inset + 3))
        var head = Path()
        head.move(to: tip)
        head.addLine(to: CGPoint(x: tip.x - cos(ang - 0.45) * 11, y: tip.y - sin(ang - 0.45) * 11))
        head.addLine(to: CGPoint(x: tip.x - cos(ang + 0.45) * 11, y: tip.y - sin(ang + 0.45) * 11))
        head.closeSubpath()
        ctx.fill(head, with: .color(color))
    }

    private func dragGesture(size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .local)
            .onChanged { v in
                if dragNode == nil, panStart == nil {
                    if let id = hitNode(v.startLocation, in: size), let n = nodes.first(where: { $0.id == id }) {
                        dragNode = (id, CGPoint(x: n.x, y: n.y))
                    } else {
                        panStart = offset
                    }
                }
                if let drag = dragNode, let i = nodes.firstIndex(where: { $0.id == drag.id }) {
                    nodes[i].x = drag.start.x + v.translation.width / zoom
                    nodes[i].y = drag.start.y + v.translation.height / zoom
                    nodes[i].pinned = true
                    if settleTask == nil || settleTask?.isCancelled == true { settle() }
                } else if let start = panStart {
                    offset = CGSize(width: start.width + v.translation.width, height: start.height + v.translation.height)
                }
            }
            .onEnded { _ in
                if let drag = dragNode, let n = nodes.first(where: { $0.id == drag.id }) {
                    try? app.tagGraph?.setTagPosition(n.id, x: n.x, y: n.y, pinned: true)
                    selectedTag = n.id
                }
                dragNode = nil
                panStart = nil
                settle()
            }
    }

    private func tap(_ p: CGPoint, size: CGSize) {
        if let id = hitNode(p, in: size) {
            withAnimation(.snappy) { selectedTag = selectedTag == id ? nil : id; selectedEdge = nil }
        } else if let e = hitEdge(p, in: size), let edge = graph.edges.first(where: { $0.id == e }) {
            withAnimation(.snappy) { selectedEdge = e; selectedTag = edge.source }
        } else {
            withAnimation(.snappy) { selectedTag = nil; selectedEdge = nil }
        }
    }

    // MARK: controls

    private var controls: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Find tag", text: $search)
                    .textFieldStyle(.plain)
                    .frame(width: 130)
                    .onSubmit {
                        if let id = searchMatches.first { withAnimation(.snappy) { selectedTag = id } }
                    }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .modifier(GraphGlass(cornerRadius: nil))
            HStack(spacing: 2) {
                Button("Fit", systemImage: "arrow.up.left.and.arrow.down.right") { withAnimation(.smooth) { fit() } }
                    .help("Fit the whole graph")
                Button("Zoom Out", systemImage: "minus.magnifyingglass") { withAnimation(.snappy) { zoom = max(0.2, zoom / 1.25) } }
                Button("Zoom In", systemImage: "plus.magnifyingglass") { withAnimation(.snappy) { zoom = min(3, zoom * 1.25) } }
                Menu("Display", systemImage: "slider.horizontal.3") {
                    Toggle("Shared Verses", isOn: $showCoOccurrence)
                    Toggle("Labels", isOn: $showLabels)
                    Divider()
                    Button("Unpin All and Re-arrange", systemImage: "pin.slash") { unpinAll() }
                        .disabled(!graph.tags.contains(where: \.graphPinned))
                }
                .menuIndicator(.hidden)
                .help("Display options")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.interactivePlain)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .modifier(GraphGlass(cornerRadius: nil))
            if graph.coOccurrenceOmitted, showCoOccurrence {
                Text("Shared-verse lines omitted (too many tagged verses)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func unpinAll() {
        for t in graph.tags where t.graphPinned { try? app.tagGraph?.setTagPosition(t.id, x: nil, y: nil, pinned: false) }
        nodes = []   // re-seed on the reload this triggers
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(260))
            withAnimation(.smooth) { fit() }
        }
    }

    // MARK: inspector

    private func summary(_ t: VerseTagSummary) -> String {
        var parts: [String] = []
        if t.verseCount > 0 { parts.append("\(t.verseCount) verse\(t.verseCount == 1 ? "" : "s")") }
        if t.chapterCount > 0 { parts.append("\(t.chapterCount) chapter\(t.chapterCount == 1 ? "" : "s")") }
        return parts.isEmpty ? "Unused" : parts.joined(separator: " · ")
    }

    private func inspector(_ tag: VerseTagSummary) -> some View {
        let edges = graph.edges.filter { $0.source == tag.id || $0.target == tag.id }
        let connected = Set(edges.flatMap { [$0.source, $0.target] })
        let shared = graph.coOccurrence.filter { $0.a == tag.id || $0.b == tag.id }
            .compactMap { c -> (VerseTagSummary, Int)? in
                let other = c.a == tag.id ? c.b : c.a
                return tagsById[other].map { ($0, c.weight) }
            }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                TagChip(name: tag.name, color: tag.color, slot: tag.colorSlot)
                Spacer()
                Button("Close", systemImage: "xmark") { withAnimation(.snappy) { selectedTag = nil; selectedEdge = nil } }
                    .labelStyle(.iconOnly).buttonStyle(.interactivePlain).foregroundStyle(.secondary)
            }
            Text(summary(tag)).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button("Show Verses", systemImage: "magnifyingglass") { app.openSearch("#\(tag.name)", reuseTab: false) }
                Menu("Connect", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
                    ForEach(graph.tags.filter { $0.id != tag.id && !connected.contains($0.id) }) { other in
                        Button("#\(other.name)") { connect(tag.id, other.id) }
                    }
                }
                .menuIndicator(.hidden)
                if tag.graphPinned {
                    Button("Unpin", systemImage: "pin.slash") { try? app.tagGraph?.setTagPosition(tag.id, x: nil, y: nil, pinned: false) }
                }
            }
            .buttonStyle(.bordered).controlSize(.small).lineLimit(1)
            ScrollView {
                inspectorDetails(tag, edges: edges, connected: connected, shared: shared)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { detailHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: min(max(detailHeight, 1), inspectorDetailHeight))
        }
        .padding(14)
        .modifier(GraphGlass(cornerRadius: 18))
    }

    private var inspectorDetailHeight: CGFloat {
        #if os(iOS)
        240
        #else
        360
        #endif
    }

    private func inspectorDetails(_ tag: VerseTagSummary, edges: [TagEdge], connected: Set<String>,
                                  shared: [(VerseTagSummary, Int)]) -> some View {
                VStack(alignment: .leading, spacing: 12) {
                    if !edges.isEmpty {
                        section("Connections") {
                            ForEach(edges) { edge in edgeRow(edge, from: tag.id) }
                        }
                    }
                    if !shared.isEmpty {
                        section("Shares Verses With") {
                            ForEach(shared.prefix(8), id: \.0.id) { other, weight in
                                HStack {
                                    Button { withAnimation(.snappy) { selectedTag = other.id } } label: {
                                        TagChip(name: other.name, color: other.color, slot: other.colorSlot)
                                    }.buttonStyle(.interactivePlain)
                                    Spacer()
                                    Text("\(weight) verses").font(.caption).foregroundStyle(.secondary)
                                    if !connected.contains(other.id) {
                                        Button("Connect", systemImage: "plus.circle") { connect(tag.id, other.id) }
                                            .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                                            .help("Draw a connection to #\(other.name)")
                                    }
                                }
                            }
                        }
                    }
                    if !members.isEmpty {
                        section("Tagged") {
                            ForEach(members.prefix(40)) { m in
                                Button { openMember(m) } label: {
                                    HStack {
                                        Text(m.label).lineLimit(1)
                                        Spacer()
                                        Image(systemName: "arrow.up.forward").font(.caption).foregroundStyle(.tertiary)
                                    }.contentShape(.rect)
                                }
                                .buttonStyle(.interactivePlain)
                            }
                        }
                    }
                }
    }

    @ViewBuilder private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            content()
        }
    }

    private func edgeRow(_ edge: TagEdge, from id: String) -> some View {
        let otherId = edge.source == id ? edge.target : edge.source
        let other = tagsById[otherId]
        let outgoing = edge.source == id
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: arrowSymbol(edge.arrows, outgoing: outgoing)).foregroundStyle(.secondary).frame(width: 16)
                if let other {
                    Button { withAnimation(.snappy) { selectedTag = other.id; selectedEdge = edge.id } } label: {
                        TagChip(name: other.name, color: other.color, slot: other.colorSlot)
                    }.buttonStyle(.interactivePlain)
                }
                Spacer()
                Menu("Edit Connection", systemImage: "ellipsis.circle") {
                    Picker("Arrows", selection: Binding(get: { edge.arrows },
                                                        set: { try? app.tagGraph?.updateEdge(edge.id, .init(arrows: $0)) })) {
                        Text("No Arrows").tag(TagEdgeArrows.none)
                        Text(outgoing ? "Toward #\(other?.name ?? "")" : "Toward #\(tagsById[id]?.name ?? "")").tag(TagEdgeArrows.forward)
                        Text(outgoing ? "From #\(other?.name ?? "")" : "From #\(tagsById[id]?.name ?? "")").tag(TagEdgeArrows.backward)
                        Text("Both Ways").tag(TagEdgeArrows.both)
                    }
                    Toggle("Dashed", isOn: Binding(get: { edge.dashed },
                                                   set: { try? app.tagGraph?.updateEdge(edge.id, .init(dashed: $0)) }))
                    Menu("Colour") {
                        Button("Default") { try? app.tagGraph?.updateEdge(edge.id, .init(color: .some(nil))) }
                        ForEach(["yellow", "red", "green", "blue", "purple"], id: \.self) { c in
                            Button(c.capitalized) { try? app.tagGraph?.updateEdge(edge.id, .init(color: .some(c))) }
                        }
                    }
                    Divider()
                    Button("Remove Connection", systemImage: "trash", role: .destructive) { try? app.tagGraph?.deleteEdge(edge.id) }
                }
                .labelStyle(.iconOnly).menuIndicator(.hidden).buttonStyle(.interactivePlain)
            }
            EdgeNoteField(edgeID: edge.id, saved: edge.note)
                .padding(.leading, 22)
        }
        .padding(6)
        .background(edge.id == selectedEdge ? Color.accentColor.opacity(0.12) : .clear, in: .rect(cornerRadius: 8))
    }

    private func arrowSymbol(_ arrows: TagEdgeArrows, outgoing: Bool) -> String {
        switch arrows {
        case .none: return "line.diagonal"
        case .both: return "arrow.left.and.right"
        case .forward: return outgoing ? "arrow.right" : "arrow.left"
        case .backward: return outgoing ? "arrow.left" : "arrow.right"
        }
    }

    private func connect(_ a: String, _ b: String) {
        guard let result = try? app.tagGraph?.createEdge(a, b) else { return }
        switch result {
        case .created(let e): selectedEdge = e.id
        case .conflict(let existing): selectedEdge = existing.id
        case .invalid: break
        }
    }

    private func openMember(_ m: TagMemberDetail) {
        if let v = m.verses.first {
            let sameChapter = m.verses.filter { $0.bookId == v.bookId && $0.chapter == v.chapter }.map(\.verse)
            let end = sameChapter.max().flatMap { $0 > v.verse ? $0 : nil }
            app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verse, endVerse: end)
        } else if let c = m.wholeChapters.first {
            app.openScripture(bookId: c.bookId, chapter: c.chapter)
        }
    }
}

/// Edits a connection's note locally and saves after a short pause (not on every keystroke).
private struct EdgeNoteField: View {
    @Environment(AppModel.self) private var app
    let edgeID: String
    let saved: String
    @State private var text = ""
    @State private var loaded = false

    var body: some View {
        TextField("Why are these connected?", text: $text, axis: .vertical)
            .font(.caption).textFieldStyle(.plain).lineLimit(1...3)
            .onAppear { if !loaded { text = saved; loaded = true } }
            .onChange(of: saved) { _, new in if new != text { text = new } }
            .task(id: text) {
                guard loaded, text != saved else { return }
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled else { return }
                try? app.tagGraph?.updateEdge(edgeID, .init(note: text))
            }
            .onDisappear { if loaded, text != saved { try? app.tagGraph?.updateEdge(edgeID, .init(note: text)) } }
    }
}

private struct GraphGlass: ViewModifier {
    let cornerRadius: CGFloat?
    @ViewBuilder func body(content: Content) -> some View {
        if #available(macOS 26.0, iOS 26.0, *) {
            if let cornerRadius { content.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius)) }
            else { content.glassEffect(.regular, in: .capsule) }
        } else {
            if let cornerRadius { content.background(.regularMaterial, in: .rect(cornerRadius: cornerRadius)) }
            else { content.background(.regularMaterial, in: .capsule) }
        }
    }
}
