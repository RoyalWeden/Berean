import CryptoKit
import TipKit
import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes
import BereanWorkspace
#if os(macOS)
import AppKit
#endif


private enum CompareIndependentScrollOrigin: Equatable {
    case restore, jump, peer, user
}

private struct CompareIndependentScrollCommand: Equatable {
    var id = UUID()
    let anchor: CompareBookmarkAnchor
    let origin: CompareIndependentScrollOrigin
}

private struct CompareIndependentRowFrame: Equatable {
    let verse: Int
    let minY: CGFloat
    let height: CGFloat

    var crossesTop: Bool { minY <= 0 && minY + height > 0 }
}

private struct CompareIndependentMeasurements: Equatable {
    struct Target: Equatable {
        let stamp: UUID
        let row: CompareIndependentRowFrame
    }

    struct Content: Equatable {
        let frame: CGRect
        let viewportHeight: CGFloat
    }

    var content: Content?
    var top: CompareIndependentRowFrame?
    var target: Target?
}

private struct CompareIndependentMeasurementKey: PreferenceKey {
    static let defaultValue = CompareIndependentMeasurements()

    static func reduce(value: inout Value, nextValue: () -> Value) {
        let next = nextValue()
        if let content = next.content { value.content = content }
        if let target = next.target { value.target = target }
        if let row = next.top {
            if let top = value.top {
                if row.crossesTop ? (!top.crossesTop || row.minY > top.minY)
                    : (!top.crossesTop && row.minY < top.minY) {
                    value.top = row
                }
            } else {
                value.top = row
            }
        }
    }
}

/// The scroll binding and restoration request belong to one pane. Measurements
/// move independently of Compare's observable state and only the top row and a
/// pending target publish frames. The content origin and row frames are reduced
/// together so they describe the same layout pass.
private struct CompareIndependentViewport<Scope: Equatable, Row: View>: View {
    let rows: [ChapterVerseRow]
    let compact: Bool
    let bottomMargin: CGFloat
    let renderingKey: String
    let scope: Scope
    let jumpRevision: UUID?
    let currentJump: () -> CompareIndependentScrollCommand?
    let peer: CompareIndependentScrollCommand?
    let isCurrent: () -> Bool
    let initialAnchor: () -> CompareBookmarkAnchor?
    let observe: (CompareBookmarkAnchor, CompareIndependentScrollOrigin) -> Void
    let userPhase: (Bool) -> Void
    let beganWheel: () -> Void
    @ViewBuilder let row: (ChapterVerseRow) -> Row

    @Environment(\.displayScale) private var displayScale
    @State private var position = ScrollPosition(idType: Int.self)
    @State private var coordinate = UUID()
    @State private var pending: Placement?
    @State private var reading = Reading()

    private struct Placement: Equatable {
        var stamp = UUID()
        let command: CompareIndependentScrollCommand
        var correction: Correction?
        var corrections = 0
        var atStart = false
    }

    private struct Correction: Equatable {
        let fromOffset: CGFloat
        let fromCrop: CGFloat
    }

    private struct NativeViewport: Equatable {
        let offset: CGFloat
        let end: CGFloat

        init(_ geometry: ScrollGeometry) {
            offset = geometry.contentOffset.y + geometry.contentInsets.top
            end = max(0, geometry.contentSize.height + geometry.contentInsets.top
                      + geometry.contentInsets.bottom - geometry.containerSize.height)
        }
    }

    @MainActor private final class Reading {
        var current = false
        var user = false
        var wheelUntil: TimeInterval = 0
        var latestMeasurement: CompareIndependentMeasurements?
        var nativeViewport: NativeViewport?
        var settledStamp: UUID?
        var acknowledgedCorrection: UUID?
        var lastJump: UUID?
        var lastAnchor: CompareBookmarkAnchor?
        var fingerprint: (key: String, width: CGFloat, scale: CGFloat, value: String)?
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if rows.isEmpty {
                    Text("No Text in This Passage").foregroundStyle(.secondary)
                }
                ForEach(rows, id: \.verseNum) { item in
                    row(item)
                        .id(item.verseNum)
                        .background {
                            GeometryReader { geometry in
                                Color.clear.preference(key: CompareIndependentMeasurementKey.self,
                                                       value: measurement(for: item.verseNum, geometry: geometry))
                            }
                            .allowsHitTesting(false)
                        }
                }
            }
            .scrollTargetLayout()
            .padding(compact ? 8 : 16)
            .background {
                GeometryReader { geometry in
                    let space = NamedCoordinateSpace.named(coordinate)
                    Color.clear.preference(key: CompareIndependentMeasurementKey.self,
                        value: .init(content: .init(frame: geometry.frame(in: space),
                                                   viewportHeight: geometry.bounds(of: space)?.height ?? 0)))
                }
                .allowsHitTesting(false)
            }
        }
        .coordinateSpace(name: coordinate)
        .contentMargins(.bottom, bottomMargin, for: .scrollContent)
        .scrollPosition($position, anchor: .top)
        .onScrollGeometryChange(for: NativeViewport.self) { NativeViewport($0) } action: { _, viewport in
            reading.nativeViewport = viewport
            if pending != nil, let measured = reading.latestMeasurement {
                didMeasure(measured)
            }
        }
        .onPreferenceChange(CompareIndependentMeasurementKey.self) { measured in
            didMeasure(measured)
        }
        .onScrollPhaseChange { _, phase in
            guard reading.current, isCurrent() else { return }
            switch phase {
            case .interacting, .decelerating:
                if !reading.user {
                    beginUserScroll()
                    reading.user = true
                    userPhase(true)
                }
            case .idle:
                if reading.user, let latest = reading.latestMeasurement { didMeasure(latest) }
                reading.user = false
                userPhase(false)
            default: break
            }
        }
        #if os(macOS)
        .background {
            CompareWheelRegion {
                guard reading.current, isCurrent() else { return }
                beginUserScroll()
                reading.wheelUntil = ProcessInfo.processInfo.systemUptime + 0.25
                beganWheel()
            }
            .allowsHitTesting(false)
        }
        #endif
        .onChange(of: jumpRevision) {
            guard reading.current, isCurrent(), let jump = currentJump(), reading.lastJump != jump.id else { return }
            place(jump)
        }
        .onChange(of: peer) {
            guard reading.current, isCurrent(), let peer, !reading.user,
                  ProcessInfo.processInfo.systemUptime > reading.wheelUntil,
                  pending?.command.origin != .jump || pending?.stamp == reading.settledStamp else { return }
            place(peer)
        }
        .onChange(of: renderingKey) {
            guard reading.current, isCurrent(), !reading.user else { return }
            if let pending, pending.command.origin == .jump, pending.stamp != reading.settledStamp { return }
            if let anchor = reading.lastAnchor, let semantic = CompareBookmarkAnchor(verse: anchor.verse) {
                place(.init(anchor: semantic, origin: .restore))
            }
        }
        .task(id: scope) {
            reading.current = false
            reading.lastAnchor = nil
            reading.latestMeasurement = nil
            reading.settledStamp = nil
            reading.acknowledgedCorrection = nil
            reading.user = false
            reading.wheelUntil = 0
            pending = nil
            await Task.yield()
            guard !Task.isCancelled, isCurrent() else { return }
            reading.current = true
            if let jump = currentJump(), reading.lastJump != jump.id {
                place(jump)
            } else if let anchor = initialAnchor() {
                place(.init(anchor: anchor, origin: .restore))
            } else if let verse = rows.first?.verseNum,
                      let anchor = CompareBookmarkAnchor(verse: verse) {
                let top = CompareIndependentScrollCommand(anchor: anchor, origin: .restore)
                place(top, atStart: true)
            }
        }
        .task(id: pending?.stamp) {
            guard let placement = pending, placement.correction != nil else { return }
            // The updated placement stamp asks the row to publish another
            // layout sample. Wait until SwiftUI processes that change before
            // retrying a point command that the ID placement may supersede.
            await Task.yield()
            guard !Task.isCancelled, reading.current, isCurrent(),
                  pending?.stamp == placement.stamp else { return }
            reading.acknowledgedCorrection = placement.stamp
            if let measured = reading.latestMeasurement { didMeasure(measured) }
        }
        .onDisappear {
            reading.current = false
        }
    }

    private func measurement(for verse: Int, geometry: GeometryProxy) -> CompareIndependentMeasurements {
        let frame = geometry.frame(in: .named(coordinate))
        guard frame.minY.isFinite, frame.height.isFinite, frame.height > 0 else { return .init() }
        let row = CompareIndependentRowFrame(verse: verse, minY: frame.minY, height: frame.height)
        let top = row.crossesTop || (0...32).contains(row.minY) ? row : nil
        let target = pending.flatMap {
            $0.command.anchor.verse == verse ? CompareIndependentMeasurements.Target(stamp: $0.stamp, row: row) : nil
        }
        return .init(top: top, target: target)
    }

    private func place(_ command: CompareIndependentScrollCommand, atStart: Bool = false) {
        if command.origin == .jump { reading.lastJump = command.id }
        // SwiftUI's logical ID jump materializes the requested lazy row. The
        // exact correction, when supported by fresh measurements, follows it.
        reading.user = false
        reading.wheelUntil = 0
        reading.settledStamp = nil
        reading.acknowledgedCorrection = nil
        pending = Placement(command: command, atStart: atStart)
        if atStart {
            position.scrollTo(edge: .top)
        } else {
            position.scrollTo(id: command.anchor.verse, anchor: .top)
        }
    }

    private func beginUserScroll() {
        if pending != nil { pending = nil }
        reading.settledStamp = nil
        reading.acknowledgedCorrection = nil
    }

    private func layoutFingerprint(width: CGFloat) -> String {
        if let fingerprint = reading.fingerprint, fingerprint.key == renderingKey,
           fingerprint.width == width, fingerprint.scale == displayScale {
            return fingerprint.value
        }
        let key = JSON.stableJSON([.string(JSString(renderingKey)), .number(Double(width)), .number(Double(displayScale))])
        let fingerprint = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        reading.fingerprint = (renderingKey, width, displayScale, fingerprint)
        return fingerprint
    }


    private func didMeasure(_ measured: CompareIndependentMeasurements) {
        guard reading.current, isCurrent(), let content = measured.content,
              content.frame.width > 0, content.frame.width.isFinite, content.frame.minY.isFinite,
              content.frame.height.isFinite, content.viewportHeight.isFinite,
              displayScale > 0, displayScale.isFinite else { return }
        if let jump = currentJump(), jump.id != reading.lastJump {
            place(jump)
            return
        }
        reading.latestMeasurement = measured
        let origin = content.frame
        let fingerprint = layoutFingerprint(width: origin.width)
        if pending != nil, position.isPositionedByUser {
            beginUserScroll()
        }
        if var placement = pending {
            guard let target = measured.target, target.stamp == placement.stamp,
                  let native = reading.nativeViewport, native.offset.isFinite, native.end.isFinite else { return }
            let tolerance = 1 / displayScale
            let current = -origin.minY
            let rowCrop = -target.row.minY
            // SwiftUI can publish an estimated frame for a lazy row before the
            // ID request reaches it. A point request needs a live viewport
            // sample, and the initial ID needs to reach the top or a scroll edge.
            guard abs(current - native.offset) <= max(1, tolerance) else { return }
            if placement.corrections == 0, !placement.atStart, abs(rowCrop) > max(2, tolerance) {
                let visible = target.row.minY < content.viewportHeight
                    && target.row.minY + target.row.height > 0
                let atLeadingRow = target.row.verse == rows.first?.verseNum
                    && native.offset <= tolerance && (0...32).contains(target.row.minY)
                guard visible, native.offset >= native.end - tolerance || atLeadingRow else { return }
            }
            if let last = placement.correction,
               abs(last.fromOffset - native.offset) <= tolerance,
               abs(last.fromCrop - rowCrop) <= tolerance {
                guard reading.acknowledgedCorrection == placement.stamp else { return }
            }
            let cropCorrection = placement.command.anchor.precision?.correction(
                layout: fingerprint, rowHeight: Double(target.row.height), currentCrop: Double(rowCrop))
            let relativeCorrection = cropCorrection ?? Double(-rowCrop)
            // Native offset and row geometry now describe the same placement.
            // Adding the remaining row delta corrects for lazy-layout drift.
            let proposed = placement.atStart ? 0 : native.offset + CGFloat(relativeCorrection)
            let requested = min(native.end, max(0, proposed))
            if proposed.isFinite, abs(relativeCorrection) > Double(tolerance),
               abs(requested - native.offset) > tolerance, placement.corrections < 3 {
                placement.corrections += 1
                placement.correction = Correction(fromOffset: native.offset, fromCrop: rowCrop)
                placement.stamp = UUID()
                reading.acknowledgedCorrection = nil
                position.scrollTo(y: requested)
                pending = placement
                return
            }
            guard placement.stamp != reading.settledStamp else { return }
            reading.settledStamp = placement.stamp
            // Keep the target measurable for later lazy re-estimation. A newer
            // command, scope change or genuine user scroll drops this placement.
            publish(measured.top ?? target.row, fingerprint: fingerprint, origin: placement.command.origin)
            return
        }
        guard let row = measured.top, origin.minY <= 1 / displayScale else { return }
        if reading.user || position.isPositionedByUser
            || ProcessInfo.processInfo.systemUptime <= reading.wheelUntil {
            publish(row, fingerprint: fingerprint, origin: .user)
        } else if reading.lastAnchor == nil {
            publish(row, fingerprint: fingerprint, origin: .restore)
        }
    }

    private func publish(_ row: CompareIndependentRowFrame, fingerprint: String, origin: CompareIndependentScrollOrigin) {
        let crop = (-row.minY * displayScale).rounded() / displayScale
        let precision = CompareBookmarkPrecision(crop: Double(crop), rowHeight: Double(row.height), layout: fingerprint)
        guard let anchor = CompareBookmarkAnchor(verse: row.verse, precision: precision),
              anchor != reading.lastAnchor || origin == .peer else { return }
        reading.lastAnchor = anchor
        observe(anchor, origin)
    }
}

/// A persisted Compare column. Keep the raw object so older clients retain their metadata.
struct CompareColumn: Identifiable {
    let id: Int
    let record: JSObject
    let text: String
    let book: String
    let chapter: Int

    init?(id: Int, record: JSObject, anchor: BibleState) {
        guard let text = record["textId"]?.stringValue?.string else { return nil }
        self.id = id
        self.record = record
        self.text = text.lowercased()
        book = record["bookId"]?.stringValue?.string ?? anchor.bookId
        chapter = record["chapter"]?.numberValue.flatMap(Int.init(exactly:))
            ?? ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: self.text)
    }

    init(id: Int, text: String, anchor: BibleState) {
        var record = JSObject()
        record["textId"] = .string(JSString(text))
        record["bookId"] = .string(JSString(anchor.bookId))
        record["chapter"] = .number(Double(ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: text)))
        self.id = id
        self.record = record
        self.text = text
        book = anchor.bookId
        chapter = ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text)
    }

    func mappedVerse(_ verse: Int, from source: BibleState) -> Int? {
        guard let mapped = PsalmSuperscription.verseCounterpart(source.bookId, chapter: source.chapter, verse: verse,
                                                               from: source.translation, to: text) else { return verse }
        return mapped.chapter == chapter ? mapped.verse : nil
    }

    func follows(_ anchor: BibleState) -> Bool {
        !isPinned && book == anchor.bookId &&
            chapter == ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text)
    }

    var isPinned: Bool { record["nativePinnedPassage"]?.boolValue == true }

    var legacyScrollVerse: Int? {
        record["scrollPos"]?.objectValue?["verseNum"]?.numberValue.flatMap(Int.init(exactly:))
    }

    static func followPassageChange(_ value: JSValue?, from old: BibleState, to new: BibleState) -> JSValue? {
        // Keep saved followers aligned during reader navigation while Compare is off.
        guard old.bookId != new.bookId || old.chapter != new.chapter || old.translation != new.translation,
              let records = value?.arrayValue else { return value }
        return .array(records.enumerated().map { index, value in
            guard var record = value.objectValue,
                  let column = CompareColumn(id: index, record: record, anchor: old),
                  !column.isPinned else { return value }
            guard column.follows(old) else {
                // Legacy records imply independence when they differ from the anchor.
                record["nativePinnedPassage"] = .bool(true)
                return .object(record)
            }
            let chapter = ChapterMap.mapChapter(new.bookId, new.chapter, from: new.translation, to: column.text)
            if column.book != new.bookId || column.chapter != chapter {
                record["bookId"] = .string(JSString(new.bookId))
                record["chapter"] = .number(Double(chapter))
                record.remove("scrollPos")
            }
            return .object(record)
        })
    }

    static func resolved(in state: JSObject) -> [CompareColumn] {
        let saved = state["compareColumns"]?.arrayValue ?? []
        let anchor = BibleState(state)
        let valid = saved.enumerated().compactMap { index, value in
            value.objectValue.flatMap { CompareColumn(id: index, record: $0, anchor: anchor) }
        }
        if !valid.isEmpty { return valid }
        return [
            CompareColumn(id: 0, text: anchor.translation, anchor: anchor),
            CompareColumn(id: 1, text: anchor.translation == "lxx" ? "kjva" : "lxx", anchor: anchor)
        ]
    }

    var bookmarkColumn: CompareBookmarkColumn? {
        guard let id = CompareViewports.columnID(in: record),
              let destination = CompareBookmarkDestination(textID: text, bookID: book, chapter: chapter) else { return nil }
        return CompareBookmarkColumn(id: id, destination: destination)
    }

    var historyKey: String { destinationKey + (isPinned ? ":pinned" : "") }

    var destinationKey: String { "\(text):\(book):\(chapter)" }

    static func passageKey(_ state: BibleState, _ columns: [CompareColumn]) -> String {
        let destinations = columns.map { "\($0.id):\($0.historyKey)" }.joined(separator: ",")
        return "\(state.translation)|\(state.bookId)|\(state.chapter)|\(destinations)"
    }

    var label: String {
        "\(Reference.readerChapterLabel(book, chapter, textId: text)) · \(textInfo(text).short)"
    }
}

#if os(macOS)
struct ComparePresentationConfiguration: Equatable {
    let passage: String
    let syncScrolling: Bool

    init(state: JSObject, columns: [CompareColumn]) {
        passage = CompareColumn.passageKey(BibleState(state), columns)
        syncScrolling = state["compareSyncScroll"]?.boolValue ?? true
    }
}
#endif

private struct CompareSelectionCell: Hashable {
    let column: Int
    let book: String
    let chapter: Int
    let verse: Int
}

private struct CompareSelectionBounds: PreferenceKey {
    static var defaultValue: [CompareSelectionCell: [Anchor<CGRect>]] { [:] }
    static func reduce(value: inout [CompareSelectionCell: [Anchor<CGRect>]], nextValue: () -> [CompareSelectionCell: [Anchor<CGRect>]]) {
        value.merge(nextValue(), uniquingKeysWith: +)
    }
}

struct CompareSelectedPassage: Equatable {
    let column: Int
    let destination: String
    let edition: ChapterEdition
    var scope: String { "\(column)|\(destination)|\(edition.key)" }
}

/// Match the incoming reader intent and history visit independently of the
/// loaded chapter, which can stay mounted when history restores an older selection.
private struct CompareReaderSelectionIntent: Equatable {
    let edition: ChapterEdition
    let verse: Int?
    let selection: Set<Int>
    let historyRevision: UUID?
}

struct CompareSelectionSnapshot: Equatable {
    let passage: String
    let readerVerse: Int?
    let readerSelection: Set<Int>
    let target: CompareSelectedPassage?
    let selection: ReaderVerseSelection
}

struct CompareView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.displayScale) private var displayScale
    let tabId: String
    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var scriptureTypeScale = 1.0
    #endif

    private var hiddenAnnotations: Set<String> {
        Set((app.findTab(tabId)?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string })
    }

    private var hideSuppliedWords: Bool { hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords) }

    private var scriptureFontSize: Double {
        #if os(iOS)
        app.fontSize * scriptureTypeScale
        #else
        app.fontSize
        #endif
    }

    private var prefersStackedComparison: Bool {
        #if os(iOS)
        dynamicTypeSize.isAccessibilitySize
        #else
        false
        #endif
    }
    @State private var rows: [Int: [Int: ChapterVerseRow]] = [:]
    @State private var independentRows: [Int: [ChapterVerseRow]] = [:]

    private struct ColumnBook: Hashable {
        let book: String
        let edition: String

        init(_ column: CompareColumn) {
            book = column.book
            edition = column.text
        }
    }

    @State private var chapterNumbers: [ColumnBook: [Int]] = [:]
    private struct EditionChapter: Hashable {
        let text: String
        let book: String
        let chapter: Int

        init(_ row: ChapterVerseRow, text: String) {
            self.text = text
            book = row.bookId
            chapter = row.chapter
        }
    }

    private struct TagChapter: Hashable {
        let book: String
        let chapter: Int

        init(_ row: ChapterVerseRow) {
            book = row.bookId
            chapter = row.chapter
        }
    }

    @State private var chapterTags: [TagChapter: [Int: [TagLite]]] = [:]
    @State private var chapterNoteCounts: [EditionChapter: [Int: Int]] = [:]
    @State private var chapterPersonalLinks: [EditionChapter: Set<Int>] = [:]
    @State private var chapterHighlights: [EditionChapter: [Int: [Highlight]]] = [:]
    @State private var loadedPassage: String?
    @State private var eligibleComparisonEditions = Set<String>()
    @State private var compareWidth: CGFloat = 0
    @State private var compareHeight: CGFloat = 0
    @State private var compareSelection = ReaderVerseSelection()
    @State private var selectedPassage: CompareSelectedPassage?
    @State private var copiedSelection = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(macOS)
    @FocusState private var selectionHasKeyboardFocus: Bool
    @State private var presentationOwner = UUID()
    @State private var presentationFocus: PresentationFocus?

    private struct PresentationFocus {
        let target: CompareSelectedPassage
        let anchor: ReadingAnchor?
    }
    #endif
    @State private var editingColumn: CompareColumn?
    @State private var tagging: VerseTagTarget?
    @State private var independentVisibleVerses: [Int: Int] = [:]
    @State private var independentScrollCommands: [Int: CompareIndependentScrollCommand] = [:]
    @State private var visibleStackedVerses: [Int: Set<Int>] = [:]
    @State private var scrollingColumn: Int?
    #if os(macOS)
    @State private var wheelDriver: (deadline: TimeInterval, column: Int)?
    #endif
    @State private var lastScrolledColumn: Int?
    @State private var visibleAlignedVerses: Set<Int> = []
    @State private var columnViewportArrival: ColumnViewportArrival?
    @State private var arrivingAlignedAnchor: (passage: String, verse: Int)?
    @State private var arrivingAlignedOffset: (passage: String, offset: CGFloat)?
    @State private var arrivingIndependentAnchors: (passage: String, anchors: [Int: CompareBookmarkAnchor])?
    @State private var sharedScrollPosition = ScrollPosition()
    @State private var restoredSharedScroll: SharedViewportScope?
    @State private var sharedUserScroll: SharedViewportScope?
    @State private var sharedMeasuredOffset: (scope: SharedViewportScope, offset: CGFloat)?
    @State private var sharedCoordinateSpace = UUID()
    @State private var sharedPrecision = SharedPrecisionReading()
    @State private var sharedPrecisionPlacement: SharedPrecisionPlacement?
    #if os(macOS)
    @State private var sharedWheelDriver: (scope: SharedViewportScope, deadline: TimeInterval)?
    #endif

    private struct ViewportScope: Equatable {
        let passage: String
        let historyRevision: UUID?
    }

    private struct SharedViewportScope: Equatable {
        let viewport: ViewportScope
        let layout: ComparisonLayout
        let configuration: CompareActiveVisitContext?

        var key: String { "\(layout.rawValue)|\(viewport.passage)" }
    }

    private struct SharedViewportTaskScope: Equatable {
        let viewport: SharedViewportScope
        let ready: Bool
    }

    private struct SharedRowAddress: Equatable {
        let verse: Int
        var columnID: UUID?
    }

    private struct SharedRowFrame: Equatable {
        let address: SharedRowAddress
        let scope: SharedViewportScope
        let minY: CGFloat
        let height: CGFloat

        var crossesTop: Bool { minY <= 0 && minY + height > 0 }
    }

    private struct SharedMeasurements: Equatable {
        struct Content: Equatable {
            let scope: SharedViewportScope
            let originY: CGFloat
        }

        struct Target: Equatable {
            let stamp: UUID
            let row: SharedRowFrame
        }

        var content: Content?
        var top: SharedRowFrame?
        var target: Target?
    }

    private struct SharedMeasurementKey: PreferenceKey {
        static let defaultValue = SharedMeasurements()

        static func reduce(value: inout Value, nextValue: () -> Value) {
            let next = nextValue()
            if let content = next.content { value.content = content }
            if let target = next.target { value.target = target }
            if let row = next.top {
                if let top = value.top {
                    if row.crossesTop ? (!top.crossesTop || row.minY > top.minY)
                        : (!top.crossesTop && row.minY < top.minY) {
                        value.top = row
                    }
                } else {
                    value.top = row
                }
            }
        }
    }

    private struct SharedNativeViewport: Equatable {
        let offset: CGFloat
        let end: CGFloat
        let size: CGSize
        let topInset: CGFloat
        let bottomInset: CGFloat

        init(_ geometry: ScrollGeometry) {
            topInset = geometry.contentInsets.top
            bottomInset = geometry.contentInsets.bottom
            offset = max(0, geometry.contentOffset.y + topInset)
            size = geometry.containerSize
            end = max(0, geometry.contentSize.height + topInset + bottomInset - size.height)
        }
    }

    private struct SharedNativeSample: Equatable {
        let scope: SharedViewportScope
        let viewport: SharedNativeViewport
    }

    private struct SharedPrecisionPlacement: Equatable {
        let scope: SharedViewportScope
        let anchor: CompareBookmarkAnchor
        var stamp = UUID()
        var attempts = 0
    }

    @MainActor private final class SharedPrecisionReading {
        var native: SharedNativeSample?
        var measured: SharedMeasurements?
        var userOffset: CGFloat?
        var acknowledgedStamp: UUID?
        var fingerprint: (key: String, value: String)?
    }

    private struct ViewportTaskScope: Equatable {
        let viewport: ViewportScope
        let ready: Bool
    }

    private func viewportScope(_ passage: String) -> ViewportScope {
        ViewportScope(passage: passage, historyRevision: historyRevision(for: passage))
    }

    private func isCurrentViewport(_ scope: ViewportScope, layout: ComparisonLayout) -> Bool {
        scope == viewportScope(scope.passage) && isCurrentLoadedLayout(layout, passage: scope.passage)
    }

    private func sharedViewportScope(_ passage: String, layout: ComparisonLayout) -> SharedViewportScope {
        SharedViewportScope(viewport: viewportScope(passage), layout: layout,
                            configuration: app.compareVisitContext(for: tabId, layout: layout))
    }

    private func isCurrentSharedViewport(_ scope: SharedViewportScope) -> Bool {
        isCurrentViewport(scope.viewport, layout: scope.layout)
            && scope.configuration == app.compareVisitContext(for: tabId, layout: scope.layout)
    }
    #if os(macOS)
    @State private var columnDragToken = UUID()
    @State private var nativeColumnDrag = CompareColumnDragController()
    @State private var columnDropTarget: Int?
    @State private var liftedColumn: Int?
    @State private var columnWeights: [Int: CGFloat] = [:]
    @State private var resizeStart: [Int: CGFloat]?
    #endif

    private struct VerseTagTarget: Identifiable {
        let id = UUID()
        let range: TagRange
        let label: String
    }
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }
    var columns: [CompareColumn] {
        CompareColumn.resolved(in: app.findTab(tabId)?.state ?? JSObject())
    }

    private var syncScrolling: Bool {
        app.findTab(tabId)?.state["compareSyncScroll"]?.boolValue ?? true
    }

    private func canShowIndependentPanes(width: CGFloat, count: Int) -> Bool {
        #if os(iOS)
        count > 1
        #else
        guard count > 1, !prefersStackedComparison else { return false }
        return width >= CGFloat(count) * 260
        #endif
    }

    private typealias ComparisonLayout = CompareActiveVisitContext.Layout

    private struct ColumnViewportArrival {
        let viewport: ViewportScope
        var passage: String { viewport.passage }
        let verses: [Int: Int]
        let independent: [Int: CompareBookmarkAnchor]
        let preferredColumns: [Int]
        let alignedVerse: Int?
        let alignedOffset: CGFloat?
    }

    private func comparisonLayout(_ columns: [CompareColumn], source: BibleState, width: CGFloat,
                                  syncing: Bool? = nil) -> ComparisonLayout {
        let following = columns.allSatisfy { $0.follows(source) }
        #if os(iOS)
        // Compact screens keep real columns; horizontal overflow supplies their
        // reading width instead of changing the comparison into stacked texts.
        return following && (syncing ?? syncScrolling) ? .aligned : .independent
        #else
        if canShowIndependentPanes(width: width, count: columns.count), !(syncing ?? syncScrolling) || !following {
            return .independent
        }
        return following ? .aligned : .stacked
        #endif
    }

    #if os(iOS)
    private var phoneColumnMinimum: CGFloat { dynamicTypeSize.isAccessibilitySize ? 280 : 180 }

    private func phoneCanvasWidth(count: Int, viewport: CGFloat) -> CGFloat {
        max(viewport, CGFloat(count) * phoneColumnMinimum + CGFloat(max(0, count - 1)) * 12 + 24)
    }

    private func phoneColumnWidth(count: Int) -> CGFloat {
        let count = max(1, count)
        return (phoneCanvasWidth(count: count, viewport: compareWidth) - 24 - CGFloat(count - 1) * 12) / CGFloat(count)
    }
    #endif

    var body: some View {
        let st = state, cols = columns
        let passage = passageKey(st, cols)
        GeometryReader { geometry in
            if loadedPassage != passage {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let visible = cols.filter { availableColumnIDs.contains($0.id) }
                VStack(spacing: 0) {
                    TipView(CompareTip()).padding(.horizontal, 12).padding(.top, 8)
                    unavailableColumns(cols)
                    if visible.isEmpty {
                        ContentUnavailableView("Choose a Passage", systemImage: "book",
                                               description: Text("These saved chapters are unavailable in their editions."))
                    } else {
                        #if os(iOS)
                        ScrollView(.horizontal) {
                            Group {
                                if comparisonLayout(visible, source: st, width: geometry.size.width) == .aligned {
                                    alignedComparison(st, visible, passage: passage)
                                } else {
                                    independentPanes(visible, passage: passage, compact: true)
                                }
                            }
                            .frame(width: phoneCanvasWidth(count: visible.count, viewport: geometry.size.width))
                            .frame(maxHeight: .infinity)
                        }
                        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                        #else
                        switch comparisonLayout(visible, source: st, width: geometry.size.width) {
                        case .independent:
                            independentPanes(visible, passage: passage, compact: geometry.size.width < CGFloat(visible.count) * 260)
                        case .stacked:
                            stackedIndependentComparison(st, visible, passage: passage)
                        case .aligned:
                            alignedComparison(st, visible, passage: passage)
                        }
                        #endif
                    }
                }
            }
        }
        #if os(macOS)
        .background { CompareDragCanvas(controller: nativeColumnDrag) }
        .onChange(of: presentation, initial: true) { _, value in
            guard value == presentation else { return }
            if let value {
                if app.comparePresentation != value { app.comparePresentation = value }
            } else {
                clearPresentation()
            }
        }
        .onDisappear { clearPresentation() }
        .onChange(of: presentationAnchor) { _, anchor in
            if let presentationFocus, presentationFocus.anchor != anchor { self.presentationFocus = nil }
        }
        #endif
        .onChange(of: app.activeTab?.id == tabId, initial: true) { _, active in
            if active { materializeBookmarkColumns() }
        }
        .onChange(of: app.findTab(tabId)?.state["compareColumns"]) {
            materializeBookmarkColumns()
        }
        .task(id: Set(cols.map(ColumnBook.init))) {
            let books = Set(cols.map(ColumnBook.init))
            var numbers = chapterNumbers.filter { books.contains($0.key) }
            for book in books where numbers[book] == nil {
                let installed = await app.bible.chapterNumbers(book.book, textId: book.edition)
                guard !Task.isCancelled else { return }
                numbers[book] = installed
            }
            guard !Task.isCancelled else { return }
            chapterNumbers = numbers
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: {
            compareWidth = $0.width
            compareHeight = $0.height
        }
        .overlayPreferenceValue(CompareSelectionBounds.self) { bounds in
            selectionOutlines(bounds)
        }
        .overlay(alignment: .bottom) {
            if !comparisonSelectedRows.isEmpty {
                GeometryReader { geometry in
                    comparisonSelectionBar
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, geometry.safeAreaInsets.bottom)
                        #if os(iOS)
                        .padding(.bottom, ReaderFloatingControls.bottomPadding * 2)
                        #endif
                }
            }
        }
        .onChange(of: CompareReaderSelectionIntent(edition: ChapterEdition(st), verse: st.verse,
                                                  selection: selectedVerses(in: st), historyRevision: historyRevision(for: passage))) { _, _ in
            guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible, loadedPassage == passage else { return }
            let current = BibleState(tab.state)
            let columns = CompareColumn.resolved(in: tab.state)
            guard current.compareMode, passageKey(current, columns) == passage else { return }
            #if os(macOS)
            presentationFocus = nil
            #endif
            restoreComparisonSelection(current, columns: columns, passage: passage)
        }
        .onChange(of: app.scriptureJumpRequest?.revision) {
            guard let jump = app.scriptureJumpRequest, jump.tabID == tabId,
                  jump.chapter == ChapterEdition(st), loadedPassage == passage else { return }
            compareSelection = ReaderVerseSelection()
            selectedPassage = nil
            seedComparisonSelection(st, columns: cols)
            #if os(macOS)
            if let target = selectedPassage, let column = selectionColumn {
                presentationFocus = PresentationFocus(target: target, anchor: readingAnchor(in: column, source: st))
            } else {
                presentationFocus = nil
            }
            #endif
            rememberComparisonSelection()
        }
        .onChange(of: viewportScope(passage)) { previous, current in
            guard current == viewportScope(passage) else { return }
            resetViewportTracking()
            if previous.passage != current.passage {
                compareSelection = ReaderVerseSelection()
                selectedPassage = nil
            }
            #if os(macOS)
            presentationFocus = nil
            #endif
            if current.historyRevision != nil {
                columnViewportArrival = nil
                arrivingAlignedAnchor = nil
                arrivingAlignedOffset = nil
                arrivingIndependentAnchors = nil
                arrivingStackedAnchor = nil
            }
            if columnViewportArrival?.passage != passage { columnViewportArrival = nil }
            if arrivingAlignedAnchor?.passage != passage { arrivingAlignedAnchor = nil }
            if arrivingAlignedOffset?.passage != passage { arrivingAlignedOffset = nil }
            if arrivingIndependentAnchors?.passage != passage { arrivingIndependentAnchors = nil }
            if arrivingStackedAnchor?.passage != passage { arrivingStackedAnchor = nil }
        }
        .onChange(of: loadedComparisonLayout) { _, layout in
            guard let layout else { return }
            if isCurrentLoadedPassage(passage) {
                app.rememberCompareVisitLayout(for: tabId, layout: layout)
            }
            if layout != .aligned {
                arrivingAlignedAnchor = nil
                arrivingAlignedOffset = nil
            }
            if layout != .independent { arrivingIndependentAnchors = nil }
            if layout != .stacked { arrivingStackedAnchor = nil }
        }
        #if os(iOS)
        .toolbar {
            if ownsCurrentCompareToolbar(passage) {
                ToolbarItem(placement: .topBarTrailing) {
                    manageTranslations(st, cols)
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .tint(.accentColor)
                        .accessibilityAddTraits(.isSelected)
                }
            }
        }
        #endif
        #if os(macOS)
        .toolbar {
            if ownsMacToolbar(passage) {
                ToolbarItem { manageTranslations(st, cols) }
            }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($selectionHasKeyboardFocus)
        .onCopyCommand {
            comparisonShare.map { [NSItemProvider(object: $0.formattedText as NSString)] } ?? []
        }
        #endif
        .sheet(item: $editingColumn) { column in
            NavigationStack {
                PassagePicker(textId: column.text, currentBook: column.book, currentChapter: column.chapter, onPick: { passage in
                    changePassage(for: column.id, text: passage.textId, book: passage.bookId, chapter: passage.chapter)
                    editingColumn = nil
                }, compact: true)
                .navigationTitle("Choose Column Chapter")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { editingColumn = nil }
                    }
                }
            }
            #if os(macOS)
            .frame(minWidth: 800, minHeight: 540)
            #endif
        }
        .sheet(item: $tagging) { target in
            TagPickerView(ranges: [target.range], label: target.label, kind: "verses")
        }
        .task(id: passage) { await load(st, cols, passage: passage) }
        .task(id: "\(loadedPassage ?? "")|\(app.highlightsRevision)") {
            let chapters = displayedVersesByChapter(cols).keys
            chapterHighlights = Dictionary(uniqueKeysWithValues: chapters.map { key in
                (key, (try? app.highlights?.chapter(key.book, key.chapter, textId: key.text)) ?? [:])
            })
        }
        .task(id: "\(loadedPassage ?? "")|\(app.notesRevision)") {
            let displayed = displayedVersesByChapter(cols)
            chapterNoteCounts = Dictionary(uniqueKeysWithValues: displayed.map { key, verses in
                let counts = (try? app.notes?.coveringVerseCounts(key.book, key.chapter, verses: verses, textId: key.text)) ?? [:]
                return (key, counts)
            })
            chapterPersonalLinks = Dictionary(uniqueKeysWithValues: displayed.keys.map { key in
                let references = try? app.notes?.crossReferences(bookId: key.book, chapter: key.chapter, textId: key.text)
                let linked = references?.byVerse.filter { !$0.value.isEmpty }.keys.map { $0 } ?? []
                let mentioned = references?.indirectByVerse.keys.map { $0 } ?? []
                return (key, Set(linked + mentioned))
            })
        }
        .task(id: "\(loadedPassage ?? "")|\(app.tagsRevision)") {
            let aligned = rows.values.flatMap { $0.values }
            let independent = independentRows.values.flatMap { $0 }
            let chapters = Set((aligned + independent).map(TagChapter.init))
            chapterTags = Dictionary(uniqueKeysWithValues: chapters.map { key in
                (key, (try? app.verseTags?.forChapter(key.book, key.chapter).verseTags) ?? [:])
            })
        }
    }

    private func displayedVersesByChapter(_ columns: [CompareColumn]) -> [EditionChapter: Set<Int>] {
        var chapters: [EditionChapter: Set<Int>] = [:]
        for column in columns {
            let verses = independentRows[column.id] ?? rows.values.compactMap { $0[column.id] }
            for row in verses {
                chapters[EditionChapter(row, text: column.text), default: []].insert(row.verseNum)
            }
        }
        return chapters
    }

    private func manageTranslations(_ st: BibleState, _ cols: [CompareColumn]) -> some View {
        let passage = passageKey(st, cols)
        let additions = availableTexts.filter { text in
            loadedPassage == passage && eligibleComparisonEditions.contains(text.id)
                && !cols.contains { $0.text == text.id && $0.follows(st) }
        }
        return Menu {
            #if os(iOS)
            Button("Exit Compare", systemImage: "rectangle") { exitCompareKeepingColumns(st, columns: cols) }
            Divider()
            #endif
            if canShowIndependentPanes(width: compareWidth, count: cols.count) {
                Toggle("Sync Scrolling", isOn: Binding(get: { syncScrolling }, set: { enabled in
                    setSyncScrolling(enabled)
                }))
            }
            Menu("Add Translation", systemImage: "plus") {
                ForEach(additions) { text in
                    Button(text.name) { setColumns(cols + [CompareColumn(id: (cols.last?.id ?? -1) + 1, text: text.id, anchor: st)]) }
                }
            }
            .disabled(cols.count >= 4 || additions.isEmpty)
            Button("Add Another Passage…", systemImage: "book.badge.plus") {
                editingColumn = cols.first { !availableColumnIDs.contains($0.id) }
                    ?? CompareColumn(id: (cols.map(\.id).max() ?? -1) + 1, text: st.translation, anchor: st)
            }
            .disabled(cols.count >= 4 && cols.allSatisfy { availableColumnIDs.contains($0.id) })
            Menu("Change Column Passage", systemImage: "book") {
                ForEach(cols) { column in
                    Button(column.label) { editingColumn = column }
                }
            }
            Menu("Column Navigation", systemImage: "pin") {
                ForEach(cols) { column in
                    let pinned = column.isPinned || !column.follows(st)
                    Button {
                        setPinned(!pinned, for: column)
                    } label: {
                        Label(pinned ? "Follow Main Passage · \(column.label)" : "Pin \(column.label)",
                              systemImage: pinned ? "pin.slash" : "pin")
                    }
                    .disabled(pinned && !eligibleComparisonEditions.contains(column.text))
                }
            }
            Button {
                setColumns(Array(cols.reversed()))
            } label: {
                Label(cols.count == 2 ? "Swap Columns" : "Reverse Column Order",
                      systemImage: "arrow.left.arrow.right")
            }
            .disabled(cols.count < 2)
            Menu(closeColumnTitle(count: cols.count), systemImage: "xmark") {
                ForEach(cols) { column in
                    Button("Column \(column.id + 1) · \(column.label)") {
                        closeColumn(column, in: passage)
                    }
                }
            }
            .disabled(cols.isEmpty)
            Section("Open in Reader") {
                ForEach(cols.filter { availableColumnIDs.contains($0.id) }) { column in
                    Button(column.label) { setColumns([column]) }
                }
            }
        } label: {
            Label("Manage Translations", systemImage: "rectangle.split.3x1")
                #if os(iOS)
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
                #endif
        }
        .clickableCursor()
        .help("Add a translation or open one in the reader")
    }

    private func exitCompareKeepingColumns(_ source: BibleState, columns: [CompareColumn]) {
        guard ownsCurrentCompareToolbar(passageKey(source, columns)) else { return }
        if !comparisonSelectedRows.isEmpty {
            openComparisonSelection()
            return
        }
        if let column = columns.first(where: { $0.text == source.translation && $0.follows(source) }),
           let reading = readingAnchor(in: column, source: source), reading.chapter == source.chapter {
            let edition = ChapterEdition(source)
            app.scriptureReadingPositions[tabId, default: [:]][edition.key] =
                ScriptureReadingPosition(offset: 0, verse: reading.verse, selectedVerses: selectedVerses(in: source))
        }
        app.update(tabId) { $0.state.remove("compareMode") }
    }

    private func ownsCurrentCompareToolbar(_ passage: String) -> Bool {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible else { return false }
        let current = BibleState(tab.state)
        return current.compareMode && passageKey(current, CompareColumn.resolved(in: tab.state)) == passage
    }

    private func setSyncScrolling(_ enabled: Bool) {
        guard enabled != syncScrolling else { return }
        preserveSyncLayoutTransition(syncing: enabled)
        app.update(tabId, recordHistory: false) { tab in
            tab.state["compareSyncScroll"] = .bool(enabled)
        }
    }

    private func passageKey(_ state: BibleState, _ columns: [CompareColumn]) -> String {
        CompareColumn.passageKey(state, columns)
    }

    private func selectedVerses(in state: BibleState) -> Set<Int> {
        var reader = state
        reader.compareMode = false
        let selected = Set(app.readerSelectedVerses(in: tabId, state: reader))
        // Explicit location commands may retain an older empty native array.
        // Clear Selection clears verse itself, so this cannot resurrect it.
        return selected.isEmpty ? state.verse.map { [$0] } ?? [] : selected
    }

    private func comparisonGrid(_ st: BibleState, _ cols: [CompareColumn], passage: String) -> some View {
        let available = availableColumnIDs
        let scope = sharedViewportScope(passage, layout: .aligned)
        #if os(macOS)
        let space = compareWidth - 48 - 18 * CGFloat(cols.count - 1)
        #endif
        #if os(iOS)
        let spacing: CGFloat = 12
        #else
        let spacing: CGFloat = 18
        #endif
        return LazyVStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: spacing) {
                ForEach(cols) { c in
                    Group {
                        #if os(iOS)
                        VStack(alignment: .leading, spacing: 2) {
                            independentHeader(c, columns: cols, compact: true)
                            let chapters = Set(rows.values.compactMap { $0[c.id]?.chapter }).sorted()
                            if chapters.count > 1 {
                                Text(chapters.map { Reference.readerChapterLabel(c.book, $0, textId: c.text) }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                                    .padding(.horizontal, 2)
                            }
                        }
                        #else
                        HStack {
                            alignedColumnHeading(c, available: available.contains(c.id))
                            columnActions(c, columns: cols)
                        }
                        #endif
                    }
                    #if os(macOS)
                    .frame(width: columnWidth(c, columns: cols, space: space), alignment: .leading)
                    .modifier(columnDragBehavior(c, dimsSource: false))
                    .overlay(alignment: .trailing) {
                        if let next = nextColumn(after: c, in: cols) {
                            columnDivider(c, next, columns: cols, space: space).offset(x: 15)
                        }
                    }
                    #else
                    .frame(width: phoneColumnWidth(count: cols.count), alignment: .leading)
                    #endif
                }
            }
            Divider()
            ForEach(rows.keys.sorted(), id: \.self) { v in
                HStack(alignment: .firstTextBaseline, spacing: spacing) {
                    ForEach(cols) { c in
                        comparisonText(v, text: c, state: st)
                            #if os(macOS)
                            .frame(width: columnWidth(c, columns: cols, space: space), alignment: .leading)
                            #else
                            .frame(width: phoneColumnWidth(count: cols.count), alignment: .leading)
                            #endif
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(v)
                .background { sharedRowMeasurement(.init(verse: v), scope: scope) }
                .onScrollVisibilityChange(threshold: 0.2) { visible in
                    trackAlignedVerse(v, scope: scope, visible: visible)
                }
                .onDisappear {
                    trackAlignedVerse(v, scope: scope, visible: false)
                }
            }
        }
        #if os(iOS)
        .padding(12)
        #else
        .padding(24)
        #endif
    }

    private func stackedComparison(_ state: BibleState, _ columns: [CompareColumn], passage: String) -> some View {
        let available = availableColumnIDs
        let scope = sharedViewportScope(passage, layout: .aligned)
        return LazyVStack(alignment: .leading, spacing: 14) {
            // Headers share one container: as siblings their column ids (0, 1, …) collided with the verse rows'
            // `.id(verse)` and verse 1 vanished, leaving a gap under the headers.
            VStack(alignment: .leading, spacing: 14) {
                ForEach(columns) { text in
                    HStack {
                        alignedColumnHeading(text, available: available.contains(text.id))
                        columnActions(text, columns: columns)
                    }
                    #if os(macOS)
                    .modifier(columnDragBehavior(text, dimsSource: false))
                    #endif
                }
            }
            .id("compare-headers")
            ForEach(rows.keys.sorted(), id: \.self) { verse in
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                    ForEach(columns.filter { available.contains($0.id) }) { text in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Text(textInfo(text.text).short)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Spacer(minLength: 4)
                                if let row = rows[verse]?[text.id] {
                                    comparisonVerseControls(row, column: text)
                                }
                            }
                            comparisonText(verse, text: text, state: state, showsControls: false, dimsDragSource: false)
                        }
                        #if os(macOS)
                        .modifier(columnDragBehavior(text))
                        #endif
                    }
                }
                .id(verse)
                .background { sharedRowMeasurement(.init(verse: verse), scope: scope) }
                .onScrollVisibilityChange(threshold: 0.2) { visible in
                    trackAlignedVerse(verse, scope: scope, visible: visible)
                }
                .onDisappear {
                    trackAlignedVerse(verse, scope: scope, visible: false)
                }
            }
        }
        .padding(16)
    }

    private var availableColumnIDs: Set<Int> {
        Set(independentRows.filter { !$0.value.isEmpty }.keys).union(rows.values.flatMap { $0.keys })
    }

    private var loadedComparisonLayout: ComparisonLayout? {
        let source = state
        let columns = self.columns
        guard source.compareMode, loadedPassage == passageKey(source, columns) else { return nil }
        let available = availableColumnIDs
        let visible = columns.filter { available.contains($0.id) }
        return comparisonLayout(visible, source: source, width: compareWidth)
    }

    @ViewBuilder private func unavailableColumns(_ columns: [CompareColumn]) -> some View {
        let unavailable = columns.filter { !availableColumnIDs.contains($0.id) }
        if !unavailable.isEmpty {
            VStack(spacing: 4) {
                ForEach(unavailable) { column in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(column.label).font(.callout.weight(.medium))
                            Text("This edition has no chapter here.").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Button("Choose Passage") { editingColumn = column }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                        Button("Remove Unavailable Column", systemImage: "xmark") {
                            let remaining = columns.filter { $0.id != column.id }
                            if !remaining.isEmpty, remaining.allSatisfy({ !availableColumnIDs.contains($0.id) }) {
                                // Keep the repair UI instead of opening another
                                // unavailable saved chapter as a single reader.
                                let records = CompareViewports.repairColumnIDs(in: remaining.map(\.record))
                                app.update(tabId) { $0.state["compareColumns"] = .array(records.map(JSValue.object)) }
                            } else {
                                setColumns(remaining)
                            }
                        }
                        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            Divider()
        }
    }

    private func alignedColumnHeading(_ column: CompareColumn, available: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            columnPassageButton(column, title: textInfo(column.text).name)
            let chapterNames = Set(rows.values.compactMap { $0[column.id]?.chapter }).sorted().map {
                Reference.readerChapterLabel(column.book, $0, textId: column.text)
            }
            if chapterNames.count > 1 {
                Text(chapterNames.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !available {
                Text("Passage unavailable in this edition")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func materializeBookmarkColumns() {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible,
              BibleState(tab.state).compareMode else { return }
        var configured = tab.state
        if configured["compareColumns"]?.arrayValue?.contains(where: {
            $0.objectValue?["textId"]?.stringValue != nil
        }) != true {
            var records = CompareColumn.resolved(in: configured).map { JSValue.object($0.record) }
            records.append(contentsOf: configured["compareColumns"]?.arrayValue ?? [])
            configured["compareColumns"] = .array(records)
        }
        let repaired = CompareViewports.repairColumnIDs(in: configured)
        guard let columns = repaired["compareColumns"], columns != tab.state["compareColumns"] else { return }
        app.update(tabId, recordHistory: false) { $0.state["compareColumns"] = columns }
    }

    private func independentVisitKey(_ column: CompareColumn, passage: String) -> AppModel.CompareIndependentVisitKey? {
        column.bookmarkColumn.map { .init(passage: passage, column: $0) }
    }

    private func initialIndependentAnchor(_ column: CompareColumn, scope: ViewportScope) -> CompareBookmarkAnchor? {
        app.rememberCompareVisitLayout(for: tabId, layout: .independent)
        app.resolveIndependentCompareJump(for: tabId)
        let rows = independentRows[column.id] ?? []
        let key = columnScrollKey(column.id, passage: scope.passage)
        let cached = app.compareColumnScrollVerses[tabId]?[key]
        let visit = independentVisitKey(column, passage: scope.passage).flatMap {
            app.compareIndependentVisitPositions[tabId]?[$0]
        }
        let durable = column.bookmarkColumn.flatMap {
            app.compareBookmarkPosition(for: tabId, scope: .independent($0))
        }
        let arrival = arrivingIndependentAnchors?.passage == scope.passage
            ? arrivingIndependentAnchors?.anchors[column.id] : nil
        if arrival != nil { arrivingIndependentAnchors?.anchors.removeValue(forKey: column.id) }
        func checked(_ anchor: CompareBookmarkAnchor?) -> CompareBookmarkAnchor? {
            guard let anchor, rows.contains(where: { $0.verseNum == anchor.verse }) else { return nil }
            return anchor
        }
        func semantic(_ verse: Int?) -> CompareBookmarkAnchor? {
            checked(verse.flatMap { CompareBookmarkAnchor(verse: $0) })
        }
        let selectedVisit: CompareViewports.IndependentVisit
        let historyLayout = app.compareHistoryRestore?.layout
        if scope.historyRevision != nil, app.compareHistoryRestore?.sourceJump == nil,
           historyLayout == nil || historyLayout == .independent {
            selectedVisit = .history(checked(visit) ?? semantic(cached))
        } else if let identity = column.bookmarkColumn, let activeVisit = app.compareActiveVisit(for: tabId) {
            let anchor = activeVisit[identity]
            selectedVisit = .active(checked(anchor) ?? semantic(anchor.flatMap { correspondingVerse($0.verse, in: column) }))
        } else {
            selectedVisit = .ordinary
        }
        let fallback = checked(visit) ?? semantic(cached)
            ?? semantic(selectedRows(in: column, source: state).first?.verseNum)
            ?? semantic(column.legacyScrollVerse.flatMap { correspondingVerse($0, in: column) })
        return CompareViewports.independentPosition(visit: selectedVisit, arrival: checked(arrival),
                                                    durable: checked(durable), fallback: fallback)
    }

    private func observeIndependentAnchor(_ anchor: CompareBookmarkAnchor, column: CompareColumn,
                                          scope: ViewportScope, origin: CompareIndependentScrollOrigin) {
        guard ownsIndependentColumn(column, scope: scope) else { return }
        if origin == .user, app.scriptureJumpRequest?.tabID == tabId {
            app.scriptureJumpRequest = nil
        }
        let verse = anchor.verse
        let previous = independentVisibleVerses[column.id]
        if previous != verse { independentVisibleVerses[column.id] = verse }
        let key = columnScrollKey(column.id, passage: scope.passage)
        app.compareColumnScrollVerses[tabId, default: [:]][key] = verse
        if let visit = independentVisitKey(column, passage: scope.passage) {
            app.rememberCompareIndependentVisit(anchor, for: tabId, key: visit)
            if origin != .restore {
                app.recordCompareActiveVisitPane(anchor, for: tabId, column: visit.column)
            }
            if origin == .user || origin == .peer {
                app.recordCompareBookmark(for: tabId, scope: .independent(visit.column), anchor: anchor)
            }
        }
        guard origin == .user, previous != verse, syncScrolling, drivesScrollSync(column.id) else { return }
        for destination in columns where destination.id != column.id && destination.book == column.book {
            guard let mapped = PsalmSuperscription.synchronizedVerse(column.book, chapter: column.chapter, verse: verse,
                                from: column.text, destinationChapter: destination.chapter, to: destination.text),
                  let match = correspondingVerse(mapped, in: destination),
                  independentVisibleVerses[destination.id] != match,
                  let target = CompareBookmarkAnchor(verse: match) else { continue }
            independentScrollCommands[destination.id] = .init(anchor: target, origin: .peer)
        }
    }

    private func ownsIndependentColumn(_ column: CompareColumn, scope: ViewportScope) -> Bool {
        isCurrentViewport(scope, layout: .independent)
            && columns.contains { $0.id == column.id && $0.historyKey == column.historyKey
                && $0.bookmarkColumn == column.bookmarkColumn }
    }

    private func independentRenderingKey(compact: Bool) -> String {
        let properties: JSValue = [
            "compare-independent-layout-1", .number(scriptureFontSize), .number(Double(app.lineSpacing)),
            .string(JSString(app.scriptureFontFamily)), .bool(compact), .bool(state.showStrongs), .bool(showVerseNumbers),
            .array(hiddenAnnotations.sorted().map { .string(JSString($0)) }),
            app.wordReplacerEnabled ? app.wordReplacerRuleSet.stored : .bool(false),
        ]
        return JSON.stableJSON(properties)
    }

    private func sharedRenderingKey(_ scope: SharedViewportScope) -> String? {
        guard compareWidth.isFinite, compareHeight.isFinite, compareWidth > 0, compareHeight > 0 else { return nil }
        let available = columns.filter { availableColumnIDs.contains($0.id) }
        #if os(macOS)
        let compact = scope.layout == .aligned && compareWidth < CGFloat(available.count) * 280 + 60
        let weights = available.map { JSValue.number(Double(columnWeights[$0.id] ?? 1)) }
        #else
        let compact = true
        let weights = [JSValue.number(Double(phoneColumnMinimum))]
        #endif
        return JSON.stableJSON([
            .string(JSString(independentRenderingKey(compact: compact))),
            .number(Double(compareWidth)), .number(Double(compareHeight)),
            .array(available.map { .number(Double($0.id)) }), .array(weights),
        ])
    }

    private func sharedRowMeasurement(_ address: SharedRowAddress, scope: SharedViewportScope) -> some View {
        GeometryReader { geometry in
            let frame = geometry.frame(in: .named(sharedCoordinateSpace))
            let row = SharedRowFrame(address: address, scope: scope, minY: frame.minY, height: frame.height)
            let valid = frame.minY.isFinite && frame.height.isFinite && frame.height > 0
            let top = valid && (row.crossesTop || (0...32).contains(row.minY)) ? row : nil
            let target = sharedPrecisionPlacement.flatMap { placement -> SharedMeasurements.Target? in
                guard valid, placement.scope == scope, placement.anchor.verse == address.verse,
                      placement.anchor.columnID == address.columnID else { return nil }
                return .init(stamp: placement.stamp, row: row)
            }
            Color.clear.preference(key: SharedMeasurementKey.self, value: .init(top: top, target: target))
        }
        .allowsHitTesting(false)
    }

    private func sharedLayoutFingerprint(_ scope: SharedViewportScope, native: SharedNativeViewport) -> String? {
        guard native.size.width > 0, native.size.width.isFinite, native.size.height > 0, native.size.height.isFinite,
              native.topInset.isFinite, native.bottomInset.isFinite, displayScale > 0, displayScale.isFinite,
              let rendering = sharedRenderingKey(scope) else { return nil }
        let key = JSON.stableJSON([
            "compare-shared-crop-1", .string(JSString(scope.layout.rawValue)), .string(JSString(rendering)),
            .number(Double(native.size.width)), .number(Double(native.size.height)),
            .number(Double(native.topInset)), .number(Double(native.bottomInset)), .number(Double(displayScale)),
        ])
        if let fingerprint = sharedPrecision.fingerprint, fingerprint.key == key { return fingerprint.value }
        let fingerprint = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        sharedPrecision.fingerprint = (key, fingerprint)
        return fingerprint
    }

    private func coherentSharedGeometry(_ scope: SharedViewportScope) -> (SharedNativeViewport, SharedMeasurements)? {
        guard displayScale > 0, displayScale.isFinite,
              let sample = sharedPrecision.native, sample.scope == scope, let measured = sharedPrecision.measured,
              let content = measured.content, content.scope == scope, sample.viewport.offset.isFinite else { return nil }
        let error = content.originY + sample.viewport.offset
        let tolerance = max(1, 1 / displayScale)
        guard abs(error) <= tolerance || abs(error - sample.viewport.topInset) <= tolerance else { return nil }
        return (sample.viewport, measured)
    }

    private func measuredSharedAnchor(_ scope: SharedViewportScope) -> CompareBookmarkAnchor? {
        guard let (native, measured) = coherentSharedGeometry(scope), let row = measured.top, row.scope == scope,
              let fingerprint = sharedLayoutFingerprint(scope, native: native) else { return nil }
        let crop = (-row.minY * displayScale).rounded() / displayScale
        guard let precision = CompareBookmarkPrecision(crop: Double(crop), rowHeight: Double(row.height), layout: fingerprint) else { return nil }
        return CompareBookmarkAnchor(verse: row.address.verse, columnID: row.address.columnID, precision: precision)
    }

    private func correctSharedCrop(_ scope: SharedViewportScope) {
        guard var placement = sharedPrecisionPlacement, placement.scope == scope, restoredSharedScroll == scope,
              isCurrentSharedViewport(scope), let precision = placement.anchor.precision,
              let (native, measured) = coherentSharedGeometry(scope), let target = measured.target,
              target.stamp == placement.stamp, target.row.scope == scope,
              native.end.isFinite, let fingerprint = sharedLayoutFingerprint(scope, native: native) else { return }
        if sharedScrollPosition.isPositionedByUser || isSharedUserScroll(scope) {
            sharedPrecisionPlacement = nil
            return
        }
        let row = target.row
        // A lazy row outside the actual viewport may still have an estimated frame.
        guard row.minY < native.size.height, row.minY + row.height > 0,
              sharedPrecision.acknowledgedStamp == placement.stamp else { return }
        let crop = -row.minY
        guard let correction = precision.correction(layout: fingerprint, rowHeight: Double(row.height), currentCrop: Double(crop)) else {
            sharedPrecisionPlacement = nil
            return
        }
        let tolerance = 1 / displayScale
        let requested = min(native.end, max(0, native.offset + CGFloat(correction)))
        guard abs(correction) > Double(tolerance), abs(requested - native.offset) > tolerance, placement.attempts < 3 else {
            sharedPrecisionPlacement = nil
            return
        }
        placement.attempts += 1
        placement.stamp = UUID()
        sharedPrecision.acknowledgedStamp = nil
        sharedScrollPosition.scrollTo(y: requested)
        sharedPrecisionPlacement = placement
    }


    private func saveSharedBookmark(_ scope: SharedViewportScope) {
        guard restoredSharedScroll == scope, isCurrentSharedViewport(scope),
              let context = scope.configuration, let bookmarkScope = context.sharedBookmarkScope else { return }
        let semantic: CompareBookmarkAnchor?
        switch scope.layout {
        case .aligned:
            semantic = visibleAlignedVerses.min().flatMap { verse in
                rows[verse] != nil ? CompareBookmarkAnchor(verse: verse) : nil
            }
        case .stacked:
            semantic = topStackedVerse(in: columns).flatMap(stackedBookmark)
        case .independent:
            return
        }
        let measuredOffset = sharedMeasuredOffset.flatMap { $0.scope == scope ? $0.offset : nil }
        let atStart = measuredOffset == 0
        let precise = atStart ? nil : measuredSharedAnchor(scope)
        let anchor = precise ?? semantic
        if atStart || precise != nil { sharedPrecision.userOffset = nil }
        guard let visit = atStart ? CompareViewports.SharedVisit.empty : anchor.map(CompareViewports.SharedVisit.position) else { return }
        if app.scriptureJumpRequest?.tabID == tabId { app.scriptureJumpRequest = nil }
        let coordinate: AppModel.CompareSharedCoordinate?
        if case .position = visit, let offset = measuredOffset, let rendering = sharedRenderingKey(scope) {
            coordinate = .init(rendering: rendering, offset: offset)
        } else {
            coordinate = nil
        }
        app.rememberSharedCompareVisit(visit, for: tabId, context: context, coordinate: coordinate, updateActive: true)
        if let anchor { app.recordCompareBookmark(for: tabId, scope: bookmarkScope, anchor: anchor) }
    }

    private func rememberSharedVisit(_ visit: CompareViewports.SharedVisit, scope: SharedViewportScope,
                                     coordinate: AppModel.CompareSharedCoordinate? = nil, updateActive: Bool = false) {
        guard let context = scope.configuration else { return }
        app.rememberSharedCompareVisit(visit, for: tabId, context: context, coordinate: coordinate, updateActive: updateActive)
    }

    private func placeSharedAnchor(_ anchor: CompareBookmarkAnchor, scope: SharedViewportScope,
                                   proxy: ScrollViewProxy, coordinate: AppModel.CompareSharedCoordinate? = nil,
                                   updateActive: Bool = false) -> Bool {
        let compatible = coordinate.flatMap { $0.rendering == sharedRenderingKey(scope) ? $0 : nil }
        switch scope.layout {
        case .aligned:
            guard rows[anchor.verse] != nil else { return false }
            if let compatible { sharedScrollPosition.scrollTo(y: compatible.offset) }
            else { scrollAligned(to: anchor.verse, proxy: proxy) }
        case .stacked:
            guard let target = stackedTarget(for: anchor) else { return false }
            if let compatible { sharedScrollPosition.scrollTo(y: compatible.offset) }
            else { proxy.scrollTo(target, anchor: .top) }
        case .independent:
            return false
        }
        sharedPrecisionPlacement = compatible == nil && anchor.precision != nil
            ? SharedPrecisionPlacement(scope: scope, anchor: anchor) : nil
        sharedPrecision.userOffset = nil
        if updateActive {
            sharedMeasuredOffset = nil
            app.compareScrollOffsets[tabId]?.removeValue(forKey: scope.key)
        }
        rememberSharedVisit(.position(anchor), scope: scope, coordinate: compatible, updateActive: updateActive)
        return true
    }

    private func placeSharedJump(_ verse: Int, scope: SharedViewportScope, proxy: ScrollViewProxy) {
        resetSharedScrollDrivers()
        let anchor: CompareBookmarkAnchor?
        switch scope.layout {
        case .aligned:
            anchor = rows[verse] != nil ? CompareBookmarkAnchor(verse: verse) : nil
        case .stacked:
            let visible = columns.filter { availableColumnIDs.contains($0.id) }
            anchor = stackedSelectionTarget(in: visible, state: state, explicitVerse: verse).flatMap(stackedBookmark)
        case .independent:
            return
        }
        let visit = anchor.map(CompareViewports.SharedVisit.position) ?? .empty
        if let context = scope.configuration {
            app.stageSharedCompareVisit(visit, for: tabId, context: context, resolvingJump: true)
        }
        if let anchor, placeSharedAnchor(anchor, scope: scope, proxy: proxy) { return }
        sharedScrollPosition.scrollTo(edge: .top)
    }

    private func placeSelectedSharedVisit(_ scope: SharedViewportScope, proxy: ScrollViewProxy) -> Bool {
        let active = scope.configuration.flatMap { app.compareSharedActiveVisit(for: tabId, context: $0) }
        let unconfiguredJump = scope.configuration == nil && isCurrentCompareJump(state) ? state.verse : nil
        let explicitVerse = app.pendingCompareJump(for: tabId) ?? unconfiguredJump
        if let explicitVerse {
            placeSharedJump(explicitVerse, scope: scope, proxy: proxy)
            return true
        }
        if let visit = active {
            switch visit {
            case .position(let anchor):
                let coordinate = scope.configuration.flatMap {
                    app.compareSharedCoordinate(for: tabId, context: $0, anchor: anchor)
                }
                if placeSharedAnchor(anchor, scope: scope, proxy: proxy, coordinate: coordinate) { return true }
            case .empty:
                break
            }
        } else if scope.viewport.historyRevision == nil || app.compareHistoryRestore?.layout != nil {
            return false
        }
        sharedScrollPosition.scrollTo(edge: .top)
        rememberSharedVisit(.empty, scope: scope)
        return true
    }

    private func topStackedVerse(in columns: [CompareColumn]) -> StackedVerseTarget? {
        for column in columns {
            if let verse = visibleStackedVerses[column.id]?.min(),
               independentRows[column.id]?.contains(where: { $0.verseNum == verse }) == true {
                return StackedVerseTarget(columnID: column.id, verse: verse)
            }
        }
        return nil
    }

    private func scrollAligned(to verse: Int, proxy: ScrollViewProxy) {
        #if os(iOS)
        // The first row follows the column headers. Restoring that row at the
        // viewport edge would scroll the headers and opening lines under chrome.
        if verse == rows.keys.min() {
            sharedScrollPosition.scrollTo(edge: .top)
            return
        }
        #endif
        proxy.scrollTo(verse, anchor: .top)
    }

    private func alignedComparison(_ state: BibleState, _ columns: [CompareColumn], passage: String) -> some View {
        let scope = sharedViewportScope(passage, layout: .aligned)
        return ScrollViewReader { proxy in
            restoredCompareScroll(scope, initialJump: {
                if placeSelectedSharedVisit(scope, proxy: proxy) {
                    arrivingAlignedAnchor = nil
                    arrivingAlignedOffset = nil
                } else if let transfer = arrivingAlignedOffset, transfer.passage == passage {
                    arrivingAlignedOffset = nil
                    let anchor = arrivingAlignedAnchor.flatMap { CompareBookmarkAnchor(verse: $0.verse) }
                    arrivingAlignedAnchor = nil
                    if transfer.offset == 0 {
                        // The opening edge includes the headings above the first row.
                        sharedScrollPosition.scrollTo(edge: .top)
                        rememberSharedVisit(.empty, scope: scope)
                    } else {
                        sharedScrollPosition.scrollTo(y: transfer.offset)
                        rememberSharedVisit(anchor.map(CompareViewports.SharedVisit.position) ?? .empty, scope: scope)
                    }
                } else if let bookmark = arrivingAlignedAnchor, bookmark.passage == passage {
                    arrivingAlignedAnchor = nil
                    let target = rows.keys.filter { $0 >= bookmark.verse }.min() ?? rows.keys.max()
                    if let target, let anchor = CompareBookmarkAnchor(verse: target) {
                        _ = placeSharedAnchor(anchor, scope: scope, proxy: proxy)
                    }
                } else if let bookmarkScope = scope.configuration?.sharedBookmarkScope,
                          let bookmark = app.compareBookmarkPosition(for: tabId, scope: bookmarkScope),
                          placeSharedAnchor(bookmark, scope: scope, proxy: proxy) {
                    return
                } else if let verse = self.state.verse, let anchor = CompareBookmarkAnchor(verse: verse),
                          placeSharedAnchor(anchor, scope: scope, proxy: proxy) {
                    return
                } else {
                    sharedScrollPosition.scrollTo(edge: .top)
                    rememberSharedVisit(.empty, scope: scope)
                }
            }) {
                #if os(iOS)
                comparisonGrid(state, columns, passage: passage)
                #else
                if prefersStackedComparison || compareWidth < CGFloat(columns.count) * 280 + 60 {
                    stackedComparison(state, columns, passage: passage)
                } else {
                    comparisonGrid(state, columns, passage: passage)
                }
                #endif
            }
            .onChange(of: app.scriptureJumpRequest?.revision) {
                guard restoredSharedScroll == scope, isCurrentSharedViewport(scope), isCurrentCompareJump(self.state),
                      let verse = self.state.verse else { return }
                placeSharedJump(verse, scope: scope, proxy: proxy)
            }
            .onChange(of: state.showStrongs) { _, enabled in
                // A fixed pixel offset points at a different verse after inline
                // numbers add lines. Capture the old visible row before layout.
                guard let verse = alignedReflowVerse(),
                      (app.compareScrollOffsets[tabId]?[scope.key] ?? 0) > 1 else { return }
                let jumpRevision = app.scriptureJumpRequest?.revision
                Task { @MainActor in
                    await Task.yield()
                    guard self.state.compareMode, app.scriptureJumpRequest?.revision == jumpRevision,
                          self.state.showStrongs == enabled,
                          isCurrentSharedViewport(scope), restoredSharedScroll == scope else { return }
                    resetSharedScrollDrivers()
                    if let anchor = CompareBookmarkAnchor(verse: verse) {
                        _ = placeSharedAnchor(anchor, scope: scope, proxy: proxy, updateActive: true)
                    }
                }
            }
        }
    }

    private func alignedReflowVerse() -> Int? {
        if let target = selectedPassage, let focus = compareSelection.focus,
           let row = rows.keys.sorted().first(where: { key in
               guard let row = rows[key]?[target.column] else { return false }
               return row.bookId == target.edition.book && row.chapter == target.edition.chapter && row.verseNum == focus
           }), visibleAlignedVerses.contains(row) {
            return row
        }
        return visibleAlignedVerses.min()
    }

    private func restoredCompareScroll<Content: View>(_ scope: SharedViewportScope,
                                                      initialJump: @escaping () -> Void,
                                                      @ViewBuilder content: () -> Content) -> some View {
        let taskScope = SharedViewportTaskScope(viewport: scope, ready: isCurrentSharedViewport(scope))
        return ScrollView {
            content().background {
                GeometryReader { geometry in
                    let origin = geometry.frame(in: .named(sharedCoordinateSpace)).minY
                    Color.clear.preference(key: SharedMeasurementKey.self,
                        value: .init(content: .init(scope: scope, originY: origin)))
                }
                .allowsHitTesting(false)
            }
        }
            .coordinateSpace(name: sharedCoordinateSpace)
            .contentMargins(.bottom, comparisonActionClearance, for: .scrollContent)
            .scrollPosition($sharedScrollPosition)
            .onScrollGeometryChange(for: SharedNativeSample.self) {
                SharedNativeSample(scope: scope, viewport: SharedNativeViewport($0))
            } action: { _, sample in
                guard isCurrentSharedViewport(scope) else { return }
                sharedPrecision.native = sample
                guard restoredSharedScroll == scope else { return }
                let offset = sample.viewport.offset
                sharedMeasuredOffset = (scope, offset)
                app.compareScrollOffsets[tabId, default: [:]][scope.key] = offset
                if isSharedUserScroll(scope) {
                    sharedPrecision.userOffset = offset
                    saveSharedBookmark(scope)
                }
                correctSharedCrop(scope)
            }
            .onPreferenceChange(SharedMeasurementKey.self) { measurement in
                guard isCurrentSharedViewport(scope), measurement.content?.scope == scope else { return }
                sharedPrecision.measured = measurement
                correctSharedCrop(scope)
                if let userOffset = sharedPrecision.userOffset, userOffset == sharedPrecision.native?.viewport.offset,
                   coherentSharedGeometry(scope) != nil {
                    saveSharedBookmark(scope)
                }
            }
            #if os(macOS)
            .background {
                CompareWheelRegion {
                    guard restoredSharedScroll == scope, isCurrentSharedViewport(scope) else { return }
                    sharedPrecisionPlacement = nil
                    sharedWheelDriver = (scope, ProcessInfo.processInfo.systemUptime + 0.25)
                }
                .allowsHitTesting(false)
            }
            #endif
            .onScrollPhaseChange { _, phase in
                guard restoredSharedScroll == scope, isCurrentSharedViewport(scope) else { return }
                if phase == .interacting || phase == .decelerating {
                    sharedPrecisionPlacement = nil
                    sharedUserScroll = scope
                } else if phase == .idle, sharedUserScroll == scope {
                    sharedUserScroll = nil
                    sharedPrecision.userOffset = sharedPrecision.native?.viewport.offset
                    saveSharedBookmark(scope)
                }
            }
            .task(id: taskScope) {
                guard taskScope.ready, isCurrentSharedViewport(scope) else { return }
                app.rememberCompareVisitLayout(for: tabId, layout: scope.layout)
                restoredSharedScroll = nil
                resetSharedScrollDrivers()
                await Task.yield()
                guard !Task.isCancelled, isCurrentSharedViewport(scope) else { return }
                initialJump()
                restoredSharedScroll = scope
            }
            .task(id: sharedPrecisionPlacement?.stamp) {
                guard let placement = sharedPrecisionPlacement, placement.scope == scope else { return }
                await Task.yield()
                guard !Task.isCancelled, sharedPrecisionPlacement?.stamp == placement.stamp,
                      restoredSharedScroll == scope, isCurrentSharedViewport(scope) else { return }
                sharedPrecision.acknowledgedStamp = placement.stamp
                correctSharedCrop(scope)
            }
    }

    private func resetSharedScrollDrivers() {
        sharedUserScroll = nil
        sharedPrecisionPlacement = nil
        sharedPrecision.userOffset = nil
        sharedPrecision.acknowledgedStamp = nil
        #if os(macOS)
        sharedWheelDriver = nil
        #endif
    }

    private func isSharedUserScroll(_ scope: SharedViewportScope) -> Bool {
        #if os(macOS)
        if let sharedWheelDriver, sharedWheelDriver.scope == scope,
           ProcessInfo.processInfo.systemUptime <= sharedWheelDriver.deadline { return true }
        #endif
        return sharedUserScroll == scope
    }

    private func isCurrentLoadedPassage(_ passage: String) -> Bool {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible, loadedPassage == passage else { return false }
        let current = BibleState(tab.state)
        return current.compareMode && passageKey(current, CompareColumn.resolved(in: tab.state)) == passage
    }

    private func isCurrentLoadedLayout(_ layout: ComparisonLayout, passage: String) -> Bool {
        isCurrentLoadedPassage(passage) && loadedComparisonLayout == layout
    }

    private func trackAlignedVerse(_ verse: Int, scope: SharedViewportScope, visible: Bool) {
        guard isCurrentSharedViewport(scope) else { return }
        if visible {
            visibleAlignedVerses.insert(verse)
        } else {
            visibleAlignedVerses.remove(verse)
        }
        if restoredSharedScroll == scope, isSharedUserScroll(scope) {
            saveSharedBookmark(scope)
        }
    }

    private func independentPanes(_ columns: [CompareColumn], passage: String, compact: Bool) -> some View {
        #if os(macOS)
        let space = compareWidth - 12 * CGFloat(columns.count - 1)
        let spacing: CGFloat = 0
        #else
        let spacing: CGFloat = 12
        #endif
        let scope = viewportScope(passage)
        let renderingKey = independentRenderingKey(compact: compact)
        let taskScope = ViewportTaskScope(viewport: scope, ready: isCurrentLoadedLayout(.independent, passage: passage))
        return HStack(spacing: spacing) {
            ForEach(columns) { column in
                VStack(spacing: 0) {
                    independentHeader(column, columns: columns, compact: compact)
                        .padding(.horizontal, compact ? 4 : 12)
                    Divider()
                    CompareIndependentViewport(
                        rows: independentRows[column.id] ?? [], compact: compact, bottomMargin: comparisonActionClearance,
                        renderingKey: renderingKey, scope: taskScope,
                        jumpRevision: app.scriptureJumpRequest?.revision,
                        currentJump: {
                            let source = self.state
                            guard let request = app.scriptureJumpRequest, isCurrentCompareJump(source) else { return nil }
                            app.resolveIndependentCompareJump(for: tabId)
                            guard let target = independentJumpTarget(column, source: source),
                                  let anchor = CompareBookmarkAnchor(verse: target) else { return nil }
                            return .init(id: request.revision, anchor: anchor, origin: .jump)
                        },
                        peer: independentScrollCommands[column.id],
                        isCurrent: { ownsIndependentColumn(column, scope: scope) },
                        initialAnchor: { initialIndependentAnchor(column, scope: scope) },
                        observe: { observeIndependentAnchor($0, column: column, scope: scope, origin: $1) },
                        userPhase: { scrolling in
                            if scrolling {
                                scrollingColumn = column.id
                                lastScrolledColumn = column.id
                            } else if scrollingColumn == column.id {
                                scrollingColumn = nil
                            }
                        },
                        beganWheel: {
                            #if os(macOS)
                            wheelDriver = (ProcessInfo.processInfo.systemUptime + 0.25, column.id)
                            lastScrolledColumn = column.id
                            #endif
                        }
                    ) { row in
                        independentVerseRow(row, column: column, compact: compact,
                                            selected: selectionNumbers(in: column).contains(row.verseNum))
                    }
                    .id(column.bookmarkColumn)

                }
                #if os(macOS)
                .frame(width: columnWidth(column, columns: columns, space: space))
                .frame(maxHeight: .infinity)
                .modifier(columnDragBehavior(column, dimsSource: false))
                #else
                .frame(width: phoneColumnWidth(count: columns.count))
                .frame(maxHeight: .infinity)
                .overlay(alignment: .trailing) {
                    if column.id != columns.last?.id {
                        Rectangle().fill(.separator).frame(width: 1).offset(x: 6)
                    }
                }
                #endif
                #if os(macOS)
                if let next = nextColumn(after: column, in: columns) {
                    columnDivider(column, next, columns: columns, space: space)
                }
                #endif
            }
        }
        #if os(iOS)
        .padding(.horizontal, 12)
        #endif
    }

    private func independentJumpTarget(_ column: CompareColumn, source: BibleState) -> Int? {
        guard column.follows(source), let verse = source.verse,
              let mapped = mappedVerse(verse, in: column, source: source) else { return nil }
        return correspondingVerse(mapped, in: column)
    }

    private func drivesScrollSync(_ column: Int) -> Bool {
        #if os(macOS)
        if let wheelDriver, ProcessInfo.processInfo.systemUptime <= wheelDriver.deadline {
            return wheelDriver.column == column
        }
        #endif
        return scrollingColumn == column
    }

    private func columnScrollKey(_ id: Int, passage: String) -> String {
        passage + "|column:\(id)"
    }

    private func correspondingVerse(_ verse: Int, in column: CompareColumn) -> Int? {
        guard let rows = independentRows[column.id] else { return nil }
        return rows.last(where: { $0.verseNum <= verse })?.verseNum ?? rows.first?.verseNum
    }

    @State private var arrivingStackedAnchor: (passage: String, target: StackedVerseTarget)?

    private struct StackedVerseTarget: Hashable {
        let columnID: Int
        let verse: Int
    }

    private func stackedBookmark(_ target: StackedVerseTarget) -> CompareBookmarkAnchor? {
        guard let id = columns.first(where: { $0.id == target.columnID })?.bookmarkColumn?.id else { return nil }
        return CompareBookmarkAnchor(verse: target.verse, columnID: id)
    }

    private func stackedTarget(for bookmark: CompareBookmarkAnchor) -> StackedVerseTarget? {
        guard let id = bookmark.columnID, let column = columns.first(where: { $0.bookmarkColumn?.id == id }),
              independentRows[column.id]?.contains(where: {
                  $0.verseNum == bookmark.verse && $0.bookId == column.book && $0.chapter == column.chapter
              }) == true else { return nil }
        return StackedVerseTarget(columnID: column.id, verse: bookmark.verse)
    }

    private func stackedIndependentComparison(_ state: BibleState, _ columns: [CompareColumn], passage: String) -> some View {
        let scope = sharedViewportScope(passage, layout: .stacked)
        return ScrollViewReader { proxy in
            restoredCompareScroll(scope, initialJump: {
                if placeSelectedSharedVisit(scope, proxy: proxy) {
                    arrivingStackedAnchor = nil
                } else if let bookmark = arrivingStackedAnchor, bookmark.passage == passage,
                          let anchor = stackedBookmark(bookmark.target), placeSharedAnchor(anchor, scope: scope, proxy: proxy) {
                    arrivingStackedAnchor = nil
                } else if let bookmarkScope = scope.configuration?.sharedBookmarkScope,
                          let bookmark = app.compareBookmarkPosition(for: tabId, scope: bookmarkScope),
                          placeSharedAnchor(bookmark, scope: scope, proxy: proxy) {
                    return
                } else if let column = columns.first(where: { $0.id == lastScrolledColumn }),
                          let verse = app.compareColumnScrollVerses[tabId]?[columnScrollKey(column.id, passage: passage)],
                          let anchor = stackedBookmark(StackedVerseTarget(columnID: column.id, verse: verse)),
                          placeSharedAnchor(anchor, scope: scope, proxy: proxy) {
                    return
                } else if let target = stackedSelectionTarget(in: columns, state: self.state),
                          let anchor = stackedBookmark(target), placeSharedAnchor(anchor, scope: scope, proxy: proxy) {
                    return
                } else {
                    sharedScrollPosition.scrollTo(edge: .top)
                    rememberSharedVisit(.empty, scope: scope)
                }
            }) {
                independentComparison(columns, scope: scope)
            }
            .onChange(of: app.scriptureJumpRequest?.revision) {
                guard restoredSharedScroll == scope, isCurrentSharedViewport(scope), isCurrentCompareJump(self.state),
                      let verse = self.state.verse else { return }
                placeSharedJump(verse, scope: scope, proxy: proxy)
            }
            .onChange(of: state.showStrongs) { _, enabled in
                guard let target = topStackedVerse(in: columns), (app.compareScrollOffsets[tabId]?[scope.key] ?? 0) > 1 else { return }
                let jumpRevision = app.scriptureJumpRequest?.revision
                Task { @MainActor in
                    await Task.yield()
                    guard self.state.compareMode, app.scriptureJumpRequest?.revision == jumpRevision,
                          self.state.showStrongs == enabled,
                          isCurrentSharedViewport(scope), restoredSharedScroll == scope else { return }
                    resetSharedScrollDrivers()
                    if let anchor = stackedBookmark(target) {
                        _ = placeSharedAnchor(anchor, scope: scope, proxy: proxy, updateActive: true)
                    }
                }
            }
            .onScrollPhaseChange { old, new in
                guard old != .idle, new == .idle, isCurrentSharedViewport(scope), restoredSharedScroll == scope else { return }
                for (id, verses) in visibleStackedVerses {
                    if let verse = verses.min() {
                        app.compareColumnScrollVerses[tabId, default: [:]][columnScrollKey(id, passage: passage)] = verse
                    }
                }
            }
        }
    }

    private func stackedSelectionTarget(in columns: [CompareColumn], state: BibleState, explicitVerse: Int? = nil) -> StackedVerseTarget? {
        let preferred = columns.filter { $0.text == state.translation } + columns.filter { $0.text != state.translation }
        for column in preferred {
            if let explicitVerse {
                if column.follows(state), let mapped = mappedVerse(explicitVerse, in: column, source: state),
                   independentRows[column.id]?.contains(where: { $0.verseNum == mapped }) == true {
                    return StackedVerseTarget(columnID: column.id, verse: mapped)
                }
                continue
            }
            let selected = selectedRows(in: column, source: state)
            let focused = state.verse.flatMap { mappedVerse($0, in: column, source: state) }
            if let row = selected.first(where: { $0.verseNum == focused }) ?? selected.first {
                return StackedVerseTarget(columnID: column.id, verse: row.verseNum)
            }
        }
        return nil
    }

    private func independentComparison(_ columns: [CompareColumn], scope: SharedViewportScope) -> some View {
        LazyVStack(alignment: .leading, spacing: 12, pinnedViews: [.sectionHeaders]) {
            ForEach(columns) { column in
                Section {
                    stackedVerses(column, scope: scope)
                } header: {
                    independentHeader(column, columns: columns)
                        .background(.regularMaterial, in: .rect(cornerRadius: 10))
                }
            }
        }
        .padding(16)
    }

    private func independentHeader(_ column: CompareColumn, columns: [CompareColumn], compact: Bool = false) -> some View {
        HStack {
            columnPassageButton(column, title: column.label, compact: compact)
            columnActions(column, columns: columns)
        }
        .padding(.horizontal, compact ? 2 : 8)
    }

    private func columnPassageButton(_ column: CompareColumn, title: String, compact: Bool = false) -> some View {
        HStack(spacing: 4) {
            Button {
                editingColumn = column
            } label: {
                Group {
                    if compact {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(textInfo(column.text).short).font(.subheadline.weight(.semibold))
                            Text(Reference.readerChapterLabel(column.book, column.chapter, textId: column.text))
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                    } else {
                        Label(title, systemImage: "book").font(.subheadline.weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity, minHeight: controlSize, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("Change passage for \(column.label)")
            .help("Change column passage")
        }
        #if os(macOS)
        .modifier(columnDragBehavior(column))
        #endif
    }

    #if os(macOS)
    private func columnDragBehavior(_ column: CompareColumn, dimsSource: Bool = true) -> CompareColumnDragModifier {
        CompareColumnDragModifier(controller: nativeColumnDrag, payload: columnDragPayload(column),
                                  lifted: dimsSource && liftedColumn == column.id,
                                  targeted: liftedColumn != nil && liftedColumn != column.id && columnDropTarget == column.id,
                                  began: { payload in
                                      liftedColumn = columns.first(where: { columnDragPayload($0) == payload })?.id
                                  },
                                  ended: { liftedColumn = nil; columnDropTarget = nil },
                                  targeting: { targeted in
                                      if targeted, liftedColumn != nil { columnDropTarget = column.id }
                                      else if columnDropTarget == column.id { columnDropTarget = nil }
                                  },
                                  receive: { items in
                                      guard app.activeTab?.id == tabId, state.compareMode else { return false }
                                      let current = columns
                                      guard let item = items.first,
                                            let source = current.first(where: { item == columnDragPayload($0) }),
                                            let target = current.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }) else { return false }
                                      let moved = moveColumn(source, to: target, in: current)
                                      liftedColumn = nil
                                      columnDropTarget = nil
                                      return moved
                                  })
    }

    private func columnDragPayload(_ column: CompareColumn) -> String {
        "\(columnDragToken)|\(column.id)|\(column.historyKey)"
    }

    private func nextColumn(after column: CompareColumn, in columns: [CompareColumn]) -> CompareColumn? {
        guard let index = columns.firstIndex(where: { $0.id == column.id }), index + 1 < columns.count else { return nil }
        return columns[index + 1]
    }

    private func columnWidth(_ column: CompareColumn, columns: [CompareColumn], space: CGFloat) -> CGFloat {
        let total = columns.reduce(CGFloat.zero) { $0 + (columnWeights[$1.id] ?? 1) }
        let extra = max(0, space - 180 * CGFloat(columns.count))
        return 180 + extra * (columnWeights[column.id] ?? 1) / max(total, 1)
    }

    private func columnDivider(_ left: CompareColumn, _ right: CompareColumn, columns: [CompareColumn], space: CGFloat) -> some View {
        Rectangle()
            .fill(Color(nsColor: .separatorColor))
            .frame(width: 1)
            .frame(width: 12)
            .frame(minHeight: controlSize)
            .contentShape(.rect)
            .pointerStyle(.columnResize)
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { gesture in
                    if resizeStart == nil { resizeStart = columnWeights }
                    resizeColumns(left, right, by: gesture.translation.width, columns: columns, space: space,
                                  baseline: resizeStart ?? [:])
                }
                .onEnded { _ in resizeStart = nil })
            .accessibilityLabel("Resize \(left.label) and \(right.label)")
            .accessibilityValue("\(Int(columnWidth(left, columns: columns, space: space))) and \(Int(columnWidth(right, columns: columns, space: space))) points")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: resizeColumns(left, right, by: 24, columns: columns, space: space, baseline: columnWeights)
                case .decrement: resizeColumns(left, right, by: -24, columns: columns, space: space, baseline: columnWeights)
                @unknown default: break
                }
            }
            .help("Drag to resize these columns")
    }

    private func resizeColumns(_ left: CompareColumn, _ right: CompareColumn, by delta: CGFloat,
                               columns: [CompareColumn], space: CGFloat, baseline: [Int: CGFloat]) {
        let extra = space - 180 * CGFloat(columns.count)
        guard extra > 0 else { return }
        let total = columns.reduce(CGFloat.zero) { $0 + (baseline[$1.id] ?? 1) }
        let leftWeight = baseline[left.id] ?? 1
        let pair = leftWeight + (baseline[right.id] ?? 1)
        let nextLeft = min(max(leftWeight + delta * total / extra, 0.02), pair - 0.02)
        columnWeights[left.id] = nextLeft
        columnWeights[right.id] = pair - nextLeft
    }
    #endif

    @discardableResult
    private func moveColumn(_ column: CompareColumn, to target: Int, in current: [CompareColumn]) -> Bool {
        guard let source = current.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }),
              current.indices.contains(target), source != target else { return false }
        var reordered = current
        reordered.insert(reordered.remove(at: source), at: target)
        setColumns(reordered)
        return true
    }

    private func moveColumn(_ column: CompareColumn, by delta: Int) {
        let current = columns
        let visible = current.filter { availableColumnIDs.contains($0.id) }
        guard let source = visible.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }),
              visible.indices.contains(source + delta),
              let target = current.firstIndex(where: { $0.id == visible[source + delta].id }) else { return }
        moveColumn(column, to: target, in: current)
    }

    private func selectedRows(in column: CompareColumn, source: BibleState) -> [ChapterVerseRow] {
        guard column.follows(source), let available = independentRows[column.id] else { return [] }
        let numbers = Set(selectedVerses(in: source).compactMap { mappedVerse($0, in: column, source: source) })
        return available.filter { numbers.contains($0.verseNum) }
    }

    private func mappedVerse(_ verse: Int, in column: CompareColumn, source: BibleState) -> Int? {
        column.mappedVerse(verse, from: source)
    }

    @ViewBuilder private func stackedVerses(_ column: CompareColumn, scope: SharedViewportScope) -> some View {
        if let verses = independentRows[column.id], !verses.isEmpty {
            let selected = selectionNumbers(in: column)
            ForEach(verses, id: \.verseNum) { row in
                let isSelected = selected.contains(row.verseNum)
                independentVerseRow(row, column: column, compact: false, selected: isSelected)
                    .id(StackedVerseTarget(columnID: column.id, verse: row.verseNum))
                    .background {
                        if let id = column.bookmarkColumn?.id {
                            sharedRowMeasurement(.init(verse: row.verseNum, columnID: id), scope: scope)
                        }
                    }
                    .onScrollVisibilityChange(threshold: 0.2) { visible in
                        trackStackedVerse(row.verseNum, columnID: column.id, scope: scope, visible: visible)
                    }
                    .onDisappear {
                        trackStackedVerse(row.verseNum, columnID: column.id, scope: scope, visible: false)
                    }
            }
        } else {
            Text("No Text in This Passage").foregroundStyle(.secondary)
        }
    }

    private func trackStackedVerse(_ verse: Int, columnID: Int, scope: SharedViewportScope, visible: Bool) {
        guard isCurrentSharedViewport(scope) else { return }
        if visible {
            visibleStackedVerses[columnID, default: []].insert(verse)
        } else {
            visibleStackedVerses[columnID]?.remove(verse)
        }
        if restoredSharedScroll == scope, isSharedUserScroll(scope) {
            saveSharedBookmark(scope)
        }
    }

    @ViewBuilder private func independentVerseRow(_ row: ChapterVerseRow, column: CompareColumn,
                                                   compact: Bool, selected: Bool) -> some View {
        if compact {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if showVerseNumbers { independentVerseButton(row, column: column, selected: selected, compact: true) }
                comparisonVerseBody(row, column: column, state: state, showsControls: false)
            }
            .anchorPreference(key: CompareSelectionBounds.self, value: .bounds) { anchor in
                [CompareSelectionCell(column: column.id, book: row.bookId, chapter: row.chapter, verse: row.verseNum): [anchor]]
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if showVerseNumbers { independentVerseButton(row, column: column, selected: selected) }
                comparisonVerseBody(row, column: column, state: state)
            }
        }
    }

    private func independentVerseButton(_ row: ChapterVerseRow, column: CompareColumn, selected: Bool, compact: Bool = false) -> some View {
        Button {
            selectComparisonVerse(row, column: column)
        } label: {
            Text(row.chapter == column.chapter ? row.readerVerseLabel : "\(row.chapter):\(row.readerVerseLabel)")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(minWidth: compact ? 22 : controlSize, minHeight: compact ? 28 : controlSize)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .optionHover()
        .accessibilityLabel("Select verse \(row.readerVerseLabel), \(textInfo(column.text).name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help("Select verse \(row.readerVerseLabel) · \(textInfo(column.text).short)")
    }
    @ViewBuilder private func comparisonVerseActions(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        let label = row.readerReferenceLabel(textId: column.text)
        let clipboard = app.verseClipboard(textId: column.text, hiddenAnnotations: hiddenAnnotations)
        let copyVerse = {
            Clipboard.copy(clipboard.passage(label, rows: [row]))
            AccessibilityNotification.Announcement("Verse copied").post()
        }
        Button("Copy Verse", systemImage: "doc.on.doc", action: copyVerse)
        Button("Copy Reference", systemImage: "number") {
            Clipboard.copy(clipboard.reference(label))
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        if let url = DeepLink.nativeDevPassageURL(bookId: row.bookId, chapter: row.chapter,
                                                  verse: row.verseNum, textId: column.text) {
            Button("Copy Native Dev Link", systemImage: "link") {
                Clipboard.copy(url.absoluteString)
                AccessibilityNotification.Announcement("Verse link copied").post()
            }
        }
        Menu("Highlight Verse", systemImage: "highlighter") {
            ForEach(highlightColors, id: \.self) { color in
                Button(color.capitalized, systemImage: "circle.fill") {
                    app.highlightVerses([row], color: color, textID: column.text, copy: copyVerse)
                }
            }
        }
        if chapterHighlights[EditionChapter(row, text: column.text)]?[row.verseNum]?.isEmpty == false {
            Button("Remove Highlights", systemImage: "eraser", role: .destructive) {
                try? app.highlights?.remove(bookId: row.bookId, chapter: row.chapter,
                                            verse: row.verseNum, textId: column.text)
            }
        }
        Divider()
        Button("Add Note", systemImage: "square.and.pencil") {
            let title = row.readerReferenceLabel(textId: column.text)
            app.newNote(verseRef: "\(row.bookId).\(row.chapter).\(row.verseNum)", textId: column.text, title: title)
        }
        Button("Verse Notes", systemImage: "note.text") {
            openReader(row, in: column, inspector: "notes")
        }
        Button("Tag Verse…", systemImage: "tag") {
            let verse = Double(row.verseNum)
            let range = TagRange(bookId: row.bookId, chapter: Double(row.chapter), spans: [(verse, verse)])
            tagging = VerseTagTarget(range: range, label: comparisonVerseReference(row, column: column))
        }
        Button("Cross References", systemImage: "arrow.triangle.branch") {
            openReader(row, in: column, inspector: "crossrefs")
        }
        Button("Open in Reader", systemImage: "book.pages") { openReader(row, in: column) }
        Button("Open in New Tab", systemImage: "plus.square") {
            app.openScripture(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum, textId: column.text)
        }
    }

    private func comparisonVerseReference(_ row: ChapterVerseRow, column: CompareColumn) -> String {
        let label = row.readerReferenceLabel(textId: column.text)
        return editionMarkedReference(label, textId: column.text)
    }

    private func comparisonVerseBody(_ row: ChapterVerseRow, column: CompareColumn, state: BibleState, showsControls: Bool = true, dimsDragSource: Bool = true) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                VerseRowView(row: row.hidingTextAnnotations(hiddenAnnotations, textId: column.text), textId: column.text, showStrongs: state.showStrongs,
                             highlights: chapterHighlights[EditionChapter(row, text: column.text)]?[row.verseNum] ?? [],
                             fontSize: scriptureFontSize, lineSpacing: app.lineSpacing,
                             replacer: app.wordReplacerEnabled, rules: app.wordReplacerRules, family: app.scriptureFontFamily, hideSuppliedWords: hideSuppliedWords,
                             originalText: row.text)
                    #if os(iOS)
                    // A normal tap selects the verse; native long-press text selection and
                    // inline Strong's links retain their own gestures.
                    .simultaneousGesture(TapGesture().onEnded { selectComparisonVerse(row, column: column) })
                    #endif
                    .environment(\.openURL, strongsAction(for: row, textId: column.text))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contextMenu { comparisonVerseActions(row, column: column) }
            }
            if showsControls { comparisonVerseControls(row, column: column) }
        }
        #if os(macOS)
        .modifier(columnDragBehavior(column, dimsSource: dimsDragSource))
        #endif
        .anchorPreference(key: CompareSelectionBounds.self, value: .bounds) { anchor in
            [CompareSelectionCell(column: column.id, book: row.bookId, chapter: row.chapter, verse: row.verseNum): [anchor]]
        }
    }

    @ViewBuilder private func comparisonVerseControls(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        let count = chapterNoteCounts[EditionChapter(row, text: column.text)]?[row.verseNum] ?? 0
        let tags = chapterTags[TagChapter(row)]?[row.verseNum] ?? []
        let hasLinks = chapterPersonalLinks[EditionChapter(row, text: column.text)]?.contains(row.verseNum) == true
        if count > 0 || !tags.isEmpty || hasLinks {
            Button {
                openReader(row, in: column, inspector: "notes")
            } label: {
                Label("Study Details", systemImage: "circle.fill")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 5))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: controlSize, minHeight: controlSize)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("Study details for \(comparisonVerseReference(row, column: column))")
            .help("View notes, tags and related passages")
        }
        #if os(iOS)
        VerseActionsMenu(label: "Actions for \(comparisonVerseReference(row, column: column))") {
            comparisonVerseActions(row, column: column)
        }
        #endif
    }

    private func openReader(_ row: ChapterVerseRow, in column: CompareColumn, inspector: String? = nil) {
        openReader(ResolvedPassage(textId: column.text, bookId: row.bookId,
                                  chapter: row.chapter, verse: row.verseNum), inspector: inspector)
    }

    private func openReader(_ passage: ResolvedPassage, inspector: String? = nil, readingVerse: Int? = nil) {
        app.update(tabId) { tab in
            var reader = BibleState(tab.state)
            reader.compareMode = false
            reader.bookId = passage.bookId
            reader.chapter = passage.chapter
            reader.translation = passage.textId
            reader.verse = passage.verse
            reader.endVerse = passage.endVerse
            if inspector != nil { reader.rightPanelOpen = true }
            tab.state = reader.merged(into: tab.state)
            if let inspector, let panel = InspectorTool(rawValue: inspector) {
                StudyPanelSlots.focus(panel, in: &tab.state)
            }
            tab.state.remove("compareColumns")
            tab.state.remove("endChapter")
            tab.state["nativeSelectedVerses"] = passage.savedSelection
            tab.title = Reference.readerChapterLabel(passage.bookId, passage.chapter, textId: passage.textId)
        }
        if let tab = app.findTab(tabId) {
            let chapter = ChapterEdition(BibleState(tab.state))
            if passage.verse != nil {
                app.requestScriptureJump(in: tabId, to: chapter)
            } else if let readingVerse {
                app.scriptureReadingPositions[tabId, default: [:]][chapter.key] =
                    ScriptureReadingPosition(offset: 0, verse: readingVerse)
            }
        }
        app.recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                         verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    @ViewBuilder private func comparisonText(_ verse: Int, text column: CompareColumn, state: BibleState, showsControls: Bool = true, dimsDragSource: Bool = true) -> some View {
        if let row = rows[verse]?[column.id] {
            #if os(iOS)
            independentVerseRow(row, column: column, compact: true,
                                selected: selectionNumbers(in: column, chapter: row.chapter).contains(row.verseNum))
            #else
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if showVerseNumbers {
                    independentVerseButton(row, column: column, selected: selectionNumbers(in: column, chapter: row.chapter).contains(row.verseNum))
                }
                comparisonVerseBody(row, column: column, state: state, showsControls: showsControls, dimsDragSource: dimsDragSource)
            }
            #endif
        } else {
            Text("—").foregroundStyle(.tertiary)
        }
    }

    private func strongsAction(for row: ChapterVerseRow, textId: String) -> OpenURLAction {
        OpenURLAction { url in
            guard url.scheme == "strongs" else { return .systemAction }
            let id = String(url.absoluteString.dropFirst("strongs:".count))
            app.inspectStrongs(id, in: tabId, textId: textId, bookId: row.bookId, chapter: row.chapter, verse: row.verseNum)
            return .handled
        }
    }

    private var controlSize: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    private func columnActions(_ column: CompareColumn, columns: [CompareColumn]) -> some View {
        let pinned = column.isPinned || !column.follows(state)
        let configuredColumns = self.columns
        let passage = passageKey(state, configuredColumns)
        return Menu {
            Button {
                editingColumn = column
            } label: {
                Label("Change Passage", systemImage: "book")
            }
            // Per-column chapter stepping (original CompareView column ‹ ›); only this column moves.
            Button { stepColumn(column, by: -1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
                .disabled(adjacentChapter(to: column, by: -1) == nil)
            Button { stepColumn(column, by: 1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
                .disabled(adjacentChapter(to: column, by: 1) == nil)
            Divider()
            Button("Move Earlier", systemImage: "arrow.backward") { moveColumn(column, by: -1) }
                .disabled(columns.first?.id == column.id)
            Button("Move Later", systemImage: "arrow.forward") { moveColumn(column, by: 1) }
                .disabled(columns.last?.id == column.id)
            Divider()
            Button {
                setPinned(!pinned, for: column)
            } label: {
                Label(pinned ? "Follow Main Passage" : "Pin Passage",
                      systemImage: pinned ? "pin.slash" : "pin")
            }
            .disabled(pinned && !eligibleComparisonEditions.contains(column.text))
            Button {
                setColumns([column])
            } label: {
                Label("Open in Reader", systemImage: "book.pages")
            }
            Divider()
            Button {
                closeColumn(column, in: passage)
            } label: {
                Label(closeColumnTitle(count: configuredColumns.count), systemImage: "xmark")
            }
        } label: {
            Label("Actions for \(column.label)", systemImage: "ellipsis.circle")
                .labelStyle(.iconOnly)
                .foregroundStyle(.secondary)
                .frame(minWidth: controlSize, minHeight: controlSize)
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton).clickableCursor()
        #if os(macOS)
        .menuIndicator(.hidden)
        #else
        .hoverEffect(.highlight)
        #endif
        .help("Column actions")
    }

    private func closeColumnTitle(count: Int) -> String {
        count <= 2 ? "Close Column and Exit Compare" : "Close Column"
    }

    private func closeColumn(_ column: CompareColumn, in passage: String) {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible else { return }
        let source = BibleState(tab.state)
        let columns = CompareColumn.resolved(in: tab.state)
        guard source.compareMode, passageKey(source, columns) == passage,
              let closing = columns.first(where: { $0.id == column.id && $0.historyKey == column.historyKey }) else { return }
        let remaining = columns.filter { $0.id != closing.id }
        // Older workspaces can open Compare with one saved column.
        setColumns(remaining.isEmpty ? [closing] : remaining)
    }

    private var selectionColumn: CompareColumn? {
        guard let target = selectedPassage else { return nil }
        return columns.first { $0.id == target.column && $0.historyKey == target.destination }
    }

    private func selectionRows(in column: CompareColumn, chapter: Int) -> [ChapterVerseRow] {
        let candidates = (independentRows[column.id] ?? []) + rows.keys.sorted().compactMap { rows[$0]?[column.id] }
        var seen = Set<Int>()
        return candidates.filter { $0.bookId == column.book && $0.chapter == chapter && seen.insert($0.verseNum).inserted }
            .sorted { $0.verseNum < $1.verseNum }
    }

    private var comparisonSelectedRows: [ChapterVerseRow] {
        guard let target = selectedPassage, let column = selectionColumn,
              compareSelection.scope == target.scope else { return [] }
        return selectionRows(in: column, chapter: target.edition.chapter).filter { compareSelection.verses.contains($0.verseNum) }
    }

    private func selectionNumbers(in column: CompareColumn, chapter: Int? = nil) -> Set<Int> {
        guard let target = selectedPassage, column.id == target.column, column.historyKey == target.destination,
              target.edition.chapter == (chapter ?? column.chapter) else { return [] }
        return compareSelection.verses
    }

    private func selectComparisonVerse(_ row: ChapterVerseRow, column: CompareColumn) {
        let source = state
        let columns = self.columns
        guard source.compareMode, loadedPassage == passageKey(source, columns),
              columns.contains(where: { $0.id == column.id && $0.historyKey == column.historyKey }) else { return }
        let target = CompareSelectedPassage(column: column.id, destination: column.historyKey,
                                           edition: ChapterEdition(book: row.bookId, chapter: row.chapter, text: column.text))
        #if os(macOS)
        let extend = NSEvent.modifierFlags.contains(.shift)
        #else
        let extend = false
        #endif
        compareSelection.toggle(row.verseNum, scope: target.scope,
                                ordered: selectionRows(in: column, chapter: row.chapter).map(\.verseNum), extend: extend)
        selectedPassage = target
        copiedSelection = false
        #if os(macOS)
        selectionHasKeyboardFocus = true
        presentationFocus = compareSelection.verses.isEmpty ? nil : PresentationFocus(
            target: target, anchor: readingAnchor(in: column, source: state))
        #endif
        rememberComparisonSelection()
    }

    private var comparisonActionClearance: CGFloat {
        comparisonSelectedRows.isEmpty ? 0 : ReaderFloatingControls.selectionHeight + 12
    }

    private var comparisonSelectionLabel: String {
        guard let target = selectedPassage else { return "" }
        let numbers = Set(comparisonSelectedRows.flatMap {
            PsalmSuperscription.readerVerseNumbers($0.verseNum, bookId: $0.bookId, chapter: $0.chapter, textId: target.edition.text)
        })
        let spans = consecutiveVerseRuns(numbers).map { $0.count == 1 ? "\($0.lowerBound)" : "\($0.lowerBound)-\($0.upperBound)" }
        return "\(Reference.readerChapterLabel(target.edition.book, target.edition.chapter, textId: target.edition.text)):\(spans.joined(separator: ", "))"
    }

    private var comparisonShare: SharedVerseSelection? {
        let rows = comparisonSelectedRows
        guard let target = selectedPassage, !rows.isEmpty else { return nil }
        return SharedVerseSelection(label: clipboardSelectionLabel(rows, textId: target.edition.text), rows: rows,
                                    clipboard: app.verseClipboard(textId: target.edition.text, hiddenAnnotations: hiddenAnnotations))
    }

    private var comparisonSelectionRange: TagRange? {
        guard let target = selectedPassage, !comparisonSelectedRows.isEmpty else { return nil }
        return TagRange(bookId: target.edition.book, chapter: Double(target.edition.chapter),
                        spans: consecutiveVerseRuns(compareSelection.verses).map { (Double($0.lowerBound), Double($0.upperBound)) })
    }

    private func copyComparisonSelection() {
        guard let share = comparisonShare else { return }
        Clipboard.copy(share.formattedText)
        copiedSelection = true
        AccessibilityNotification.Announcement("Verses copied").post()
    }

    private func openComparisonSelection(inspector: String? = nil) {
        guard let target = selectedPassage, !comparisonSelectedRows.isEmpty else { return }
        let groups = consecutiveVerseRuns(compareSelection.verses)
        let contiguous = groups.count == 1 ? groups.first : nil
        openReader(ResolvedPassage(textId: target.edition.text, bookId: target.edition.book, chapter: target.edition.chapter,
                                   verse: contiguous?.lowerBound ?? compareSelection.focus ?? comparisonSelectedRows.first?.verseNum,
                                   endVerse: contiguous.flatMap { $0.count > 1 ? $0.upperBound : nil },
                                   verseGroups: groups.count > 1 ? groups : []), inspector: inspector)
    }

    private func noteForComparisonSelection() {
        guard let target = selectedPassage else { return }
        let refs = consecutiveVerseRuns(compareSelection.verses).map {
            "\(target.edition.book).\(target.edition.chapter).\($0.lowerBound)" + ($0.count > 1 ? "-\($0.upperBound)" : "")
        }.joined(separator: ",")
        let links = comparisonSelectedRows.compactMap { row -> String? in
            guard let url = DeepLink.nativeDevPassageURL(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
                                                       textId: target.edition.text) else { return nil }
            return "[\(row.readerReferenceLabel(textId: target.edition.text))](\(url.absoluteString))"
        }
        app.newNote(verseRef: refs, textId: target.edition.text, title: comparisonSelectionLabel, content: links.joined(separator: "\n\n"))
    }

    private func clearComparisonSelection() {
        compareSelection = ReaderVerseSelection()
        selectedPassage = nil
        #if os(macOS)
        presentationFocus = nil
        #endif
        copiedSelection = false
        app.update(tabId, recordHistory: false) { tab in
            var reader = BibleState(tab.state)
            reader.verse = nil
            reader.endVerse = nil
            tab.state = reader.merged(into: tab.state)
            tab.state.remove("nativeSelectedVerses")
            tab.state.remove("endChapter")
        }
        rememberComparisonSelection()
    }

    private func isCurrentCompareJump(_ state: BibleState) -> Bool {
        guard let jump = app.scriptureJumpRequest else { return false }
        return jump.tabID == tabId && jump.chapter == ChapterEdition(state)
            && jump.revision != app.resolvedSharedCompareJumpRevision
            && loadedPassage == passageKey(state, columns)
    }

    private func historyRevision(for passage: String) -> UUID? {
        guard let restore = app.compareHistoryRestore,
              restore.tabID == tabId, restore.passage == passage else { return nil }
        return restore.revision
    }

    private func rememberComparisonSelection() {
        let source = state
        let passage = passageKey(source, columns)
        guard source.compareMode, loadedPassage == passage else { return }
        app.compareSelections[tabId] = CompareSelectionSnapshot(passage: passage, readerVerse: source.verse,
                                                               readerSelection: selectedVerses(in: source),
                                                               target: selectedPassage, selection: compareSelection)
    }

    private func comparisonActionRow(compact: Bool) -> some View {
        HStack(spacing: ReaderFloatingControls.actionSpacing) {
            Button(copiedSelection ? "Copied" : "Copy Verses", systemImage: copiedSelection ? "checkmark" : "doc.on.doc",
                   action: copyComparisonSelection)
                .buttonStyle(VerseActionButtonStyle())
                .help("Copy selected verses with their edition reference")
            Menu {
                ForEach(highlightColors, id: \.self) { color in
                    Button(color.capitalized, systemImage: "circle.fill") {
                        guard let target = selectedPassage else { return }
                        app.highlightVerses(comparisonSelectedRows, color: color, textID: target.edition.text,
                                            copy: { copyComparisonSelection() })
                    }
                }
                Button("Remove Highlights", systemImage: "eraser") {
                    guard let target = selectedPassage else { return }
                    for row in comparisonSelectedRows {
                        try? app.highlights?.remove(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum, textId: target.edition.text)
                    }
                }
            } label: {
                Image(systemName: "highlighter").modifier(VerseActionControlAppearance()).accessibilityLabel("Highlight")
            }
            .modifier(VerseActionMenuChrome()).help("Highlight selected verses")
            #if os(macOS)
            if !compact {
            Button("Tag Verses", systemImage: "tag") { tagComparisonSelection() }
                .buttonStyle(VerseActionButtonStyle()).help("Tag selected verses")
            Divider().frame(height: 16)
            Button("Add Note", systemImage: "square.and.pencil", action: noteForComparisonSelection)
                .buttonStyle(VerseActionButtonStyle()).help("Add a note for selected verses")
            Button("Cross References", systemImage: "arrow.triangle.branch") { openComparisonSelection(inspector: "crossrefs") }
                .buttonStyle(VerseActionButtonStyle()).help("Open cross references for this edition’s selection")
            }
            #endif
            Menu {
                if let share = comparisonShare {
                    Button("Copy Reference", systemImage: "number") {
                        Clipboard.copy(share.reference)
                    }
                }
                #if os(macOS)
                if compact {
                    Button("Tag Verses", systemImage: "tag") { tagComparisonSelection() }
                    Button("Add Note", systemImage: "square.and.pencil", action: noteForComparisonSelection)
                    Button("Cross References", systemImage: "arrow.triangle.branch") { openComparisonSelection(inspector: "crossrefs") }
                }
                #else
                Button("Tag Verses", systemImage: "tag") { tagComparisonSelection() }
                Button("Add Note", systemImage: "square.and.pencil", action: noteForComparisonSelection)
                Button("Cross References", systemImage: "arrow.triangle.branch") { openComparisonSelection(inspector: "crossrefs") }
                #endif
                Button("Open in Reader", systemImage: "book.pages") { openComparisonSelection() }
                if let share = comparisonShare {
                    ShareLink(item: share, preview: SharePreview(share.reference)) { Label("Share Selected Verses", systemImage: "square.and.arrow.up") }
                }
            } label: {
                Image(systemName: "ellipsis").modifier(VerseActionControlAppearance()).accessibilityLabel("More Verse Actions")
            }
            .modifier(VerseActionMenuChrome()).help("More verse actions")
            Divider().frame(height: 16)
            Button("Clear Selection", systemImage: "xmark", action: clearComparisonSelection)
                .buttonStyle(VerseActionButtonStyle())
                #if os(macOS)
                .keyboardShortcut(.cancelAction)
                #endif
                .help("Clear verse selection")
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var comparisonSelectionBar: some View {
        ViewThatFits(in: .horizontal) {
            comparisonActionRow(compact: false)
            comparisonActionRow(compact: true)
        }
        .padding(.horizontal, ReaderFloatingControls.surfaceHorizontalPadding)
        .padding(.vertical, ReaderFloatingControls.surfacePadding)
        #if os(macOS)
        .glassEffectCompat()
        #else
        .tint(.primary)
        .glassEffectCompat(interactive: true, backingOpacity: ReaderFloatingControls.dockBackingOpacity)
        #endif
        .padding(.horizontal, 8)
        .padding(.bottom, ReaderFloatingControls.bottomPadding)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selected \(comparisonSelectionLabel), \(selectedPassage.map { textInfo($0.edition.text).name } ?? "")")
        .task(id: copiedSelection) {
            guard copiedSelection else { return }
            do { try await Task.sleep(for: .seconds(1)); copiedSelection = false } catch { }
        }
    }

    private func tagComparisonSelection() {
        guard let range = comparisonSelectionRange else { return }
        tagging = VerseTagTarget(range: range, label: comparisonSelectionLabel)
    }

    private func selectionRectangles(_ bounds: [CompareSelectionCell: [Anchor<CGRect>]], geometry: GeometryProxy) -> [CGRect] {
        guard let target = selectedPassage, let column = selectionColumn else { return [] }
        #if os(macOS)
        if liftedColumn == target.column { return [] }
        #endif
        let ordered = selectionRows(in: column, chapter: target.edition.chapter).map(\.verseNum)
        let visible = bounds.filter { $0.key.column == target.column && $0.key.book == target.edition.book && $0.key.chapter == target.edition.chapter }
        let available = Set(visible.keys.map(\.verse))
        let obstacles = bounds.filter { $0.key.column != target.column }.values.flatMap { $0.map { geometry[$0] } }
        return readerSelectionRuns(compareSelection.verses, in: ordered, available: available).flatMap { group in
            let rectangles = group.flatMap { verse in
                visible[CompareSelectionCell(column: target.column, book: target.edition.book, chapter: target.edition.chapter, verse: verse), default: []].map { geometry[$0] }
            }
            return readerJoinedSelectionRectangles(rectangles, obstacles: obstacles).map {
                $0.insetBy(dx: -ReaderFloatingControls.outlinePadding, dy: -ReaderFloatingControls.outlinePadding)
            }
        }
    }

    private func selectionOutlines(_ bounds: [CompareSelectionCell: [Anchor<CGRect>]]) -> some View {
        GeometryReader { geometry in
            let rectangles = selectionRectangles(bounds, geometry: geometry)
            TimelineView(.animation(minimumInterval: 1.0 / 15, paused: reduceMotion || rectangles.isEmpty)) { clock in
                let phase = reduceMotion ? 0 : -clock.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 7)
                ForEach(Array(rectangles.enumerated()), id: \.offset) { _, rect in
                    RoundedRectangle(cornerRadius: ReaderFloatingControls.outlineRadius)
                        .fill(Color.accentColor.opacity(ReaderFloatingControls.fillOpacity))
                        .overlay {
                            RoundedRectangle(cornerRadius: ReaderFloatingControls.outlineRadius)
                                .strokeBorder(Color.accentColor.opacity(ReaderFloatingControls.outlineOpacity),
                                              style: StrokeStyle(lineWidth: 1, dash: [4, 3], dashPhase: phase))
                        }
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                }
            }
        }
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func allowsSameNumberAlignment(from edition: String, to anchor: BibleState) -> Bool {
        // Brenton Joel 3 is a verified excerpt of KJV Joel 2. The remaining KJV verses belong to Brenton Joel 2.
        if anchor.bookId == "JOL", anchor.chapter == 3, ChapterMap.isLxx(anchor.translation), ChapterMap.isKjv(edition) {
            return false
        }
        return true
    }

    private func comparisonChapter(book: String, chapter: Int, edition: String) async -> [ChapterVerseRow] {
        let rows = await app.bible.queryChapter(book, chapter, textId: edition)
        return PsalmSuperscription.apply(rows, textId: edition, bookId: book, chapter: chapter)
    }

    func load(_ st: BibleState, _ cols: [CompareColumn], passage: String) async {
        var out: [Int: [Int: ChapterVerseRow]] = [:]
        var independent: [Int: [ChapterVerseRow]] = [:]
        for column in cols {
            guard !Task.isCancelled else { return }
            independent[column.id] = await comparisonChapter(book: column.book, chapter: column.chapter, edition: column.text)
        }
        let eligible = await app.bible.comparisonEditions(forBook: st.bookId, chapter: st.chapter, from: st.translation,
                                                        candidates: availableTexts.map(\.id))
        guard !Task.isCancelled else { return }
        // Available following columns can still form a grid if an unavailable
        // pinned column remains in the saved configuration.
        let canAlign = cols.allSatisfy { $0.follows(st) || independent[$0.id]?.isEmpty != false }
        for column in cols where canAlign && column.follows(st) {
            let edition = column.text
            var chapters = ChapterMap.equivalentChapters(st.bookId, st.chapter, from: st.translation, to: edition)
            if ChapterMap.isLxx(st.translation), ChapterMap.isKjv(edition) {
                if st.bookId == "JON", st.chapter == 2 { chapters.insert(1, at: 0) }
                if st.bookId == "MAL", st.chapter == 3 { chapters.append(4) }
            } else if st.bookId == "JON", st.chapter == 1,
                      ChapterMap.isKjv(st.translation), ChapterMap.isLxx(edition) {
                chapters.append(2)
            }

            for chapter in chapters {
                guard !Task.isCancelled else { return }
                let chapterRows = chapter == column.chapter
                    ? independent[column.id] ?? []
                    : await comparisonChapter(book: st.bookId, chapter: chapter, edition: edition)
                for row in chapterRows {
                    if let mapped = PsalmSuperscription.verseCounterpart(st.bookId, chapter: chapter, verse: row.verseNum,
                                                                from: edition, to: st.translation) {
                        if mapped.chapter == st.chapter { out[mapped.verse, default: [:]][column.id] = row }
                    } else if chapter == column.chapter,
                              allowsSameNumberAlignment(from: edition, to: st),
                              PsalmSuperscription.verseCounterpart(st.bookId, chapter: st.chapter, verse: row.verseNum,
                                                          from: st.translation, to: edition) == nil {
                        out[row.verseNum, default: [:]][column.id] = row
                    }
                }
            }
        }
        // The aligned grid already shows the gap as an empty LXX cell. Independent panes
        // carry the notice on the next available verse, as in the standalone reader.
        for column in cols where column.text == "lxx" && MissingLxxVerses.eligible(bookId: column.book, chapter: column.chapter) {
            guard !Task.isCancelled else { return }
            guard let lxx = independent[column.id], !lxx.isEmpty else { continue }
            let kjv: [ChapterVerseRow]
            if let counterpart = cols.first(where: { $0.text == "kjva" && $0.book == column.book && $0.chapter == column.chapter }),
               let existing = independent[counterpart.id] {
                kjv = existing
            } else {
                kjv = await app.bible.queryChapter(column.book, column.chapter, textId: "kjva")
            }
            independent[column.id] = MissingLxxVerses.annotate(lxx, comparingTo: kjv)
        }
        // Read the current selection intent instead of the task's old capture.
        let arrival = state
        guard !Task.isCancelled, arrival.compareMode, passageKey(arrival, columns) == passage else { return }
        chapterHighlights = [:]
        chapterNoteCounts = [:]
        chapterPersonalLinks = [:]
        chapterTags = [:]
        rows = out
        independentRows = independent
        eligibleComparisonEditions = Set(eligible)
        applyColumnViewportArrival(for: passage, source: arrival, columns: cols)
        loadedPassage = passage
        restoreComparisonSelection(arrival, columns: cols, passage: passage)
    }

    private func restoreComparisonSelection(_ arrival: BibleState, columns cols: [CompareColumn], passage: String) {
        compareSelection = ReaderVerseSelection()
        selectedPassage = nil
        var restoredSelection = false
        if let saved = app.compareSelections[tabId], saved.passage == passage,
           saved.readerVerse == arrival.verse, saved.readerSelection == selectedVerses(in: arrival) {
            if let target = saved.target,
               let column = cols.first(where: { $0.id == target.column && $0.historyKey == target.destination
                   && $0.text == target.edition.text && $0.book == target.edition.book }) {
                let available = selectionRows(in: column, chapter: target.edition.chapter)
                selectedPassage = target
                compareSelection.restore(saved.selection, scope: target.scope, ordered: available.map(\.verseNum))
                restoredSelection = true
            } else if saved.target == nil {
                restoredSelection = true
            }
        }
        if !restoredSelection { seedComparisonSelection(arrival, columns: cols) }
        rememberComparisonSelection()
    }

    private func seedComparisonSelection(_ st: BibleState, columns cols: [CompareColumn]) {
        if let column = cols.first(where: { $0.text == st.translation && $0.book == st.bookId && $0.chapter == st.chapter }) {
            let available = selectionRows(in: column, chapter: st.chapter)
            let selected = selectedVerses(in: st).intersection(available.map(\.verseNum))
            if !selected.isEmpty {
                let target = CompareSelectedPassage(column: column.id, destination: column.historyKey, edition: ChapterEdition(st))
                selectedPassage = target
                compareSelection.replace(scope: target.scope, verses: selected, focus: st.verse, ordered: available.map(\.verseNum))
            }
        }
    }

    private func setPinned(_ pinned: Bool, for column: CompareColumn) {
        let anchor = state
        var record = column.record
        if pinned {
            record["nativePinnedPassage"] = .bool(true)
        } else {
            record.remove("nativePinnedPassage")
            record["bookId"] = .string(JSString(anchor.bookId))
            let chapter = ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: column.text)
            record["chapter"] = .number(Double(chapter))
            if column.book != anchor.bookId || column.chapter != chapter { record.remove("scrollPos") }
        }
        guard let updated = CompareColumn(id: column.id, record: record, anchor: anchor) else { return }
        setColumns(columns.map { $0.id == column.id ? updated : $0 })
    }

    private func adjacentChapter(to column: CompareColumn, by delta: Int) -> Int? {
        guard let numbers = chapterNumbers[ColumnBook(column)],
              let index = numbers.firstIndex(of: column.chapter),
              numbers.indices.contains(index + delta) else { return nil }
        return numbers[index + delta]
    }

    private func stepColumn(_ column: CompareColumn, by delta: Int) {
        guard app.activeTab?.id == tabId,
              let current = columns.first(where: { $0.id == column.id && ColumnBook($0) == ColumnBook(column) }),
              let destination = adjacentChapter(to: current, by: delta) else { return }
        changePassage(for: current.id, text: current.text, book: current.book, chapter: destination)
        #if os(iOS)
        readerNavigationFeedback()
        #endif
    }

    private func changePassage(for id: Int, text: String, book: String, chapter: Int) {
        let anchor = state
        if !columns.contains(where: { $0.id == id }) {
            var record = JSObject()
            record["textId"] = .string(JSString(text))
            record["bookId"] = .string(JSString(book))
            record["chapter"] = .number(Double(chapter))
            record["nativePinnedPassage"] = .bool(true)
            if let column = CompareColumn(id: id, record: record, anchor: anchor) { setColumns(columns + [column]) }
            return
        }
        let updated = columns.compactMap { column -> CompareColumn? in
            guard column.id == id else { return column }
            var record = column.record
            record["textId"] = .string(JSString(text))
            record["bookId"] = .string(JSString(book))
            record["chapter"] = .number(Double(chapter))
            if book != column.book || chapter != column.chapter || text != column.text {
                record.remove("scrollPos")
                if book != anchor.bookId || chapter != ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text) {
                    record["nativePinnedPassage"] = .bool(true)
                }
            }
            return CompareColumn(id: id, record: record, anchor: anchor)
        }
        setColumns(updated)
    }

    private func readerPassage(for column: CompareColumn, source: BibleState) -> ResolvedPassage {
        var passage = ResolvedPassage(textId: column.text, bookId: column.book, chapter: column.chapter, verse: nil)
        guard loadedPassage == passageKey(source, columns), column.follows(source), let first = source.verse,
              columns.contains(where: { $0.id == column.id && $0.destinationKey == column.destinationKey }) else { return passage }

        let aligned = selectedVerses(in: source).sorted().compactMap { rows[$0]?[column.id] }
        let mapped = aligned.isEmpty ? selectedRows(in: column, source: source) : aligned
        let mappedFocus = mappedVerse(first, in: column, source: source)
        let anchor = rows[first]?[column.id] ?? mapped.first { $0.verseNum == mappedFocus } ?? mapped.first
        guard let anchor else { return passage }
        passage.bookId = anchor.bookId
        passage.chapter = anchor.chapter
        passage.verse = anchor.verseNum
        let group = consecutiveVerseRuns(Set(mapped.filter {
            $0.bookId == anchor.bookId && $0.chapter == anchor.chapter
        }.map(\.verseNum)))
        if group.count == 1, let range = group.first, range.lowerBound == anchor.verseNum {
            if range.upperBound > anchor.verseNum { passage.endVerse = range.upperBound }
        } else if !group.isEmpty {
            passage.verseGroups = group
        }
        return passage
    }

    private struct ReadingAnchor: Equatable {
        let chapter: Int
        let verse: Int
    }

    private func readingAnchor(in column: CompareColumn, source: BibleState) -> ReadingAnchor? {
        let passage = passageKey(source, columns)
        guard loadedPassage == passage else { return nil }
        let visible = columns.filter { availableColumnIDs.contains($0.id) }
        let layout = comparisonLayout(visible, source: source, width: compareWidth)
        return readingAnchor(in: column, passage: passage, layout: layout)
    }

    private func readingAnchor(in column: CompareColumn, passage: String, layout: ComparisonLayout) -> ReadingAnchor? {
        if layout == .aligned {
            guard let top = visibleAlignedVerses.min() else { return nil }
            let mapped = rows.keys.filter { rows[$0]?[column.id] != nil }
            let key = mapped.filter { $0 >= top }.min() ?? mapped.max()
            return key.flatMap { rows[$0]?[column.id] }.map { ReadingAnchor(chapter: $0.chapter, verse: $0.verseNum) }
        }
        let key = columnScrollKey(column.id, passage: passage)
        let saved = app.compareColumnScrollVerses[tabId]?[key]
            ?? column.legacyScrollVerse.flatMap { correspondingVerse($0, in: column) }
        let verse: Int?
        if layout == .independent {
            verse = independentVisibleVerses[column.id] ?? saved
        } else {
            verse = visibleStackedVerses[column.id]?.min() ?? saved ?? independentRows[column.id]?.first?.verseNum
        }
        return verse.map { ReadingAnchor(chapter: column.chapter, verse: $0) }
    }

    #if os(macOS)
    private func ownsMacToolbar(_ renderedPassage: String) -> Bool {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible else { return false }
        let current = BibleState(tab.state)
        return current.compareMode && passageKey(current, CompareColumn.resolved(in: tab.state)) == renderedPassage
    }

    private var presentationColumn: CompareColumn? {
        guard let tab = app.activeTab, tab.id == tabId, tab.tabType == .bible else { return nil }
        let source = BibleState(tab.state)
        let columns = CompareColumn.resolved(in: tab.state)
        guard source.compareMode, loadedPassage == passageKey(source, columns) else { return nil }
        let visible = columns.filter { availableColumnIDs.contains($0.id) }
        if let target = selectedPassage, compareSelection.scope == target.scope, !compareSelection.verses.isEmpty,
           let column = visible.first(where: { $0.id == target.column && $0.historyKey == target.destination }) {
            return column
        }
        return visible.first { $0.text == source.translation && $0.book == source.bookId && $0.chapter == source.chapter }
            ?? visible.first
    }

    private var presentationAnchor: ReadingAnchor? {
        presentationColumn.flatMap { readingAnchor(in: $0, source: state) }
    }

    private var presentation: AppModel.ComparePresentation? {
        guard let column = presentationColumn, let tab = app.activeTab else { return nil }
        let anchor = readingAnchor(in: column, source: state)
        let selected = selectedPassage.flatMap { target in
            target.column == column.id && target.destination == column.historyKey && compareSelection.scope == target.scope
                && !compareSelection.verses.isEmpty ? target : nil
        }
        let hasExplicitFocus = selected != nil && presentationFocus?.target == selected && presentationFocus?.anchor == anchor
        let edition = (hasExplicitFocus || anchor == nil ? selected?.edition : nil)
            ?? ChapterEdition(book: column.book, chapter: anchor?.chapter ?? column.chapter, text: column.text)
        let verses = selected?.edition == edition ? compareSelection.verses : []
        return AppModel.ComparePresentation(owner: presentationOwner, tabID: tabId,
            configuration: ComparePresentationConfiguration(state: tab.state, columns: columns),
            columnID: column.id, columnDestination: column.historyKey, edition: edition, verses: verses,
            focus: hasExplicitFocus ? compareSelection.focus : anchor?.verse ?? (verses.isEmpty ? nil : compareSelection.focus))
    }

    private func clearPresentation() {
        if app.comparePresentation?.owner == presentationOwner { app.comparePresentation = nil }
    }
    #endif

    func setColumns(_ cols: [CompareColumn]) {
        #if os(macOS)
        columnWeights = Dictionary(uniqueKeysWithValues: cols.enumerated().map { ($0.offset, columnWeights[$0.element.id] ?? 1) })
        resizeStart = nil
        #endif
        if cols.isEmpty {
            app.update(tabId) {
                $0.state.remove("compareMode")
                $0.state.remove("compareColumns")
            }
            return
        }
        if cols.count == 1, let column = cols.first {
            if selectedPassage?.column == column.id, selectedPassage?.destination == column.historyKey,
               !comparisonSelectedRows.isEmpty {
                openComparisonSelection()
                return
            }
            let source = state
            var passage = readerPassage(for: column, source: source)
            let anchor = passage.verse == nil ? readingAnchor(in: column, source: source) : nil
            if let anchor { passage.chapter = anchor.chapter }
            openReader(passage, readingVerse: anchor?.verse)
            return
        }
        let remappedSelection = preserveReadingPositions(for: cols)
        app.update(tabId) { tab in
            let records = CompareViewports.repairColumnIDs(in: cols.map(\.record))
            tab.state["compareColumns"] = .array(records.map(JSValue.object))
        }
        // update records the outgoing history entry from the old selection.
        if let remappedSelection { app.compareSelections[tabId] = remappedSelection }
        let currentColumns = columns
        let source = state
        let passage = passageKey(source, currentColumns)
        if columnViewportArrival?.passage == passage, isCurrentLoadedPassage(passage) {
            applyColumnViewportArrival(for: passage, source: source, columns: currentColumns)
            if remappedSelection != nil { restoreComparisonSelection(source, columns: currentColumns, passage: passage) }
        }
    }

    private func preserveReadingPositions(for next: [CompareColumn]) -> CompareSelectionSnapshot? {
        let previous = columns
        let anchor = state
        let reindexed = next.enumerated().compactMap { CompareColumn(id: $0.offset, record: $0.element.record, anchor: anchor) }
        guard reindexed.count == next.count else { return nil }
        let oldPassage = passageKey(anchor, previous)
        let newPassage = passageKey(anchor, reindexed)
        let before = previous.compactMap(\.bookmarkColumn)
        let after = reindexed.compactMap(\.bookmarkColumn)
        let stableReorder = before.count == previous.count && after.count == reindexed.count
            && Set(before.map(\.id)).count == before.count && Set(after) == Set(before) && before != after
        guard oldPassage != newPassage || stableReorder else { return nil }

        var remappedSelection: CompareSelectionSnapshot?
        if let selection = selectedPassage,
           let index = next.firstIndex(where: { $0.id == selection.column && $0.historyKey == selection.destination }) {
            let column = reindexed[index]
            let target = CompareSelectedPassage(column: column.id, destination: column.historyKey, edition: selection.edition)
            remappedSelection = CompareSelectionSnapshot(passage: newPassage, readerVerse: anchor.verse,
                                                         readerSelection: selectedVerses(in: anchor),
                                                         target: target, selection: compareSelection)
        } else if selectedPassage != nil {
            remappedSelection = CompareSelectionSnapshot(passage: newPassage, readerVerse: anchor.verse,
                                                         readerSelection: selectedVerses(in: anchor),
                                                         target: nil, selection: ReaderVerseSelection())
        }

        guard isCurrentLoadedPassage(oldPassage) else { return remappedSelection }
        let available = availableColumnIDs
        let visible = previous.filter { available.contains($0.id) }
        let previousLayout = comparisonLayout(visible, source: anchor, width: compareWidth)
        let survivors = visible.compactMap { column -> (CompareColumn, CompareColumn)? in
            guard let index = next.firstIndex(where: { $0.id == column.id && $0.destinationKey == column.destinationKey }) else {
                return nil
            }
            return (column, reindexed[index])
        }
        let pureReorder = previous.count == next.count && next.allSatisfy { column in
            previous.contains { $0.id == column.id && $0.destinationKey == column.destinationKey }
        }
        let destination = ViewportScope(passage: newPassage, historyRevision: nil)
        columnViewportArrival = captureColumnViewport(from: oldPassage, to: destination, layout: previousLayout,
            survivors: survivors, preservingAlignedOffset: pureReorder)
        return remappedSelection
    }

    private func preserveSyncLayoutTransition(syncing: Bool) {
        let source = state
        let passage = passageKey(source, columns)
        guard isCurrentLoadedPassage(passage) else { return }
        let visible = columns.filter { availableColumnIDs.contains($0.id) }
        let previous = comparisonLayout(visible, source: source, width: compareWidth)
        let next = comparisonLayout(visible, source: source, width: compareWidth, syncing: syncing)
        guard previous != next else { return }
        columnViewportArrival = captureColumnViewport(from: passage, to: viewportScope(passage), layout: previous,
            survivors: visible.map { ($0, $0) }, preservingAlignedOffset: false)
        resetViewportTracking()
        applyColumnViewportArrival(for: passage, source: source, columns: visible, destinationLayout: next)
    }

    private func resetViewportTracking() {
        independentVisibleVerses = [:]
        independentScrollCommands = [:]
        visibleStackedVerses = [:]
        visibleAlignedVerses = []
        scrollingColumn = nil
        lastScrolledColumn = nil
        #if os(macOS)
        wheelDriver = nil
        sharedWheelDriver = nil
        #endif
        sharedScrollPosition = ScrollPosition()
        restoredSharedScroll = nil
        sharedUserScroll = nil
        sharedMeasuredOffset = nil
        sharedPrecisionPlacement = nil
        sharedPrecision.native = nil
        sharedPrecision.measured = nil
        sharedPrecision.userOffset = nil
        sharedPrecision.acknowledgedStamp = nil
    }

    private func captureColumnViewport(from oldPassage: String, to destination: ViewportScope, layout: ComparisonLayout,
                                       survivors: [(source: CompareColumn, target: CompareColumn)],
                                       preservingAlignedOffset: Bool) -> ColumnViewportArrival {
        var independentAnchors: [Int: Int] = [:]
        var preciseArrivals: [Int: CompareBookmarkAnchor] = [:]
        var preferredColumns: [Int] = []
        for (source, target) in survivors {
            guard let reading = readingAnchor(in: source, passage: oldPassage, layout: layout),
                  reading.chapter == target.chapter else { continue }
            independentAnchors[target.id] = reading.verse
            if layout == .independent {
                if source.bookmarkColumn == target.bookmarkColumn,
                   let key = independentVisitKey(source, passage: oldPassage),
                   let anchor = app.compareIndependentVisitPositions[tabId]?[key],
                   anchor.verse == reading.verse {
                    preciseArrivals[target.id] = anchor
                }
                if source.id == lastScrolledColumn {
                    preferredColumns.insert(target.id, at: 0)
                } else {
                    preferredColumns.append(target.id)
                }
            } else if layout == .stacked, visibleStackedVerses[source.id]?.isEmpty == false {
                preferredColumns.append(target.id)
            }
        }
        let alignedScope = sharedViewportScope(oldPassage, layout: .aligned)
        let alignedOffset = sharedMeasuredOffset.flatMap { $0.scope == alignedScope ? $0.offset : nil }
        return ColumnViewportArrival(viewport: destination, verses: independentAnchors,
            independent: preciseArrivals, preferredColumns: preferredColumns,
            alignedVerse: layout == .aligned ? visibleAlignedVerses.min() : nil,
            alignedOffset: layout == .aligned && preservingAlignedOffset ? alignedOffset : nil)
    }

    private func applyColumnViewportArrival(for passage: String, source: BibleState, columns: [CompareColumn],
                                            destinationLayout: ComparisonLayout? = nil) {
        guard let arrival = columnViewportArrival, arrival.viewport == viewportScope(passage) else { return }
        columnViewportArrival = nil
        arrivingIndependentAnchors = nil
        arrivingAlignedAnchor = nil
        arrivingAlignedOffset = nil
        arrivingStackedAnchor = nil
        if app.pendingCompareJump(for: tabId) != nil { return }
        if app.compareVisitContext(for: tabId, layout: .independent) == nil,
           let jump = app.scriptureJumpRequest, jump.tabID == tabId, jump.chapter == ChapterEdition(source),
           jump.revision != app.resolvedSharedCompareJumpRevision { return }
        let available = availableColumnIDs
        let visible = columns.filter { available.contains($0.id) }
        let verses = arrival.verses.filter { id, verse in
            independentRows[id]?.contains(where: { $0.verseNum == verse }) == true
        }
        for (id, verse) in verses {
            app.compareColumnScrollVerses[tabId, default: [:]][columnScrollKey(id, passage: passage)] = verse
        }
        switch destinationLayout ?? comparisonLayout(visible, source: source, width: compareWidth) {
        case .independent:
            let anchors = verses.compactMapValues { CompareBookmarkAnchor(verse: $0) }.merging(
                arrival.independent.filter { verses[$0.key] == $0.value.verse }
            ) { _, precise in precise }
            if !anchors.isEmpty { arrivingIndependentAnchors = (passage, anchors) }
        case .aligned:
            let key = "aligned|" + passage
            if let offset = arrival.alignedOffset {
                arrivingAlignedOffset = (passage, offset)
            }
            if let verse = arrival.alignedVerse ?? alignedViewportVerse(for: arrival.preferredColumns,
                                                                       verses: verses, columns: visible, source: source) {
                if arrival.alignedOffset == nil { app.compareScrollOffsets[tabId]?.removeValue(forKey: key) }
                arrivingAlignedAnchor = (passage, verse)
            }
        case .stacked:
            let id = arrival.preferredColumns.first { verses[$0] != nil }
                ?? visible.first(where: { verses[$0.id] != nil })?.id
            if let id, let verse = verses[id] {
                app.compareScrollOffsets[tabId]?.removeValue(forKey: "stacked|" + passage)
                arrivingStackedAnchor = (passage, StackedVerseTarget(columnID: id, verse: verse))
            }
        }
    }

    private func alignedViewportVerse(for preferredColumns: [Int], verses: [Int: Int], columns: [CompareColumn],
                                      source: BibleState) -> Int? {
        for id in preferredColumns {
            guard let column = columns.first(where: { $0.id == id }), column.book == source.bookId,
                  let verse = verses[id] else { continue }
            let counterpart = PsalmSuperscription.verseCounterpart(column.book, chapter: column.chapter, verse: verse,
                                                                  from: column.text, to: source.translation)
            if let counterpart, counterpart.chapter != source.chapter { continue }
            let key = counterpart?.verse ?? verse
            // The loaded grid validates same-number alignment when there is no mapped counterpart.
            if let row = rows[key]?[id], row.bookId == column.book, row.chapter == column.chapter,
               row.verseNum == verse { return key }
        }
        return nil
    }
}

#if os(macOS)
/// Native drag lifetime controls the source placeholder, including cancelled
/// drags. The passage preview is independent of the source's opacity.
private struct CompareColumnDragModifier: ViewModifier {
    let controller: CompareColumnDragController
    let payload: String
    let lifted: Bool
    let targeted: Bool
    let began: (String) -> Void
    let ended: () -> Void
    let targeting: (Bool) -> Void
    let receive: ([String]) -> Bool

    func body(content: Content) -> some View {
        content
            .opacity(lifted ? 0.16 : 1)
            .background(targeted ? Color.accentColor.opacity(0.08) : .clear, in: .rect(cornerRadius: 9))
            .contentShape(.interaction, .rect)
            .background { CompareDragRegion(controller: controller, payload: payload) }
            .gesture(CompareColumnPan(controller: controller, began: began, ended: ended))
            .dropDestination(for: String.self) { items, _ in _ = receive(items) }
            .dropConfiguration { _ in
                DropConfiguration(operation: controller.activePayload != nil && controller.activePayload != payload ? .move : .forbidden)
            }
            .onDropSessionUpdated { session in
                switch session.phase {
                case .entering, .active: targeting(controller.activePayload != nil && controller.activePayload != payload)
                case .exiting, .ended(_), .dataTransferCompleted: targeting(false)
                @unknown default: targeting(false)
                }
            }
    }
}

/// Identify the wheel's pane before SwiftUI publishes either scroll position.
private struct CompareWheelRegion: NSViewRepresentable {
    let onWheel: () -> Void

    func makeNSView(context: Context) -> Region { Region() }
    func updateNSView(_ view: Region, context: Context) { view.onWheel = onWheel }
    static func dismantleNSView(_ view: Region, coordinator: Void) { view.stopMonitoring() }

    final class Region: NSView {
        var onWheel: (() -> Void)?
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopMonitoring()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                if let self, event.window === window,
                   visibleRect.contains(convert(event.locationInWindow, from: nil)) {
                    onWheel?()
                }
                return event
            }
        }

        func stopMonitoring() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}
#endif
