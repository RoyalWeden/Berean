import Foundation

func expect(_ result: @autoclosure () -> Bool, _ message: String) {
    if !result() { fatalError(message) }
}
let origin = CGPoint.zero
var intent = ReaderBodyTapIntent()
var selected = Set<Int>()
func apply(_ completion: ReaderBodyTapIntent.Completion?) {
    guard let completion else { return }
    if !selected.insert(completion.verse).inserted { selected.remove(completion.verse) }
}
// Rapid taps in different verses must accumulate, even when UIKit transiently
// reports a word range spanning two different verse targets.
for (index, verse) in [1, 2, 5].enumerated() {
    let time = Double(index) * 0.1
    intent.begin(verse: verse, point: origin, time: time, hasNativeSelection: false)
    expect(intent.rejectsNativeSelection(at: time + 0.02), "Cross-verse taps are verse intent")
    apply(intent.finish(point: origin, time: time + 0.04, hasNativeSelection: true))
}
expect(selected == [1, 2, 5], "Rapid cross-verse taps must preserve every selection")
intent.begin(verse: 2, point: origin, time: 1, hasNativeSelection: false)
apply(intent.finish(point: origin, time: 1.04, hasNativeSelection: false))
expect(selected == [1, 5], "One tap deselects only the targeted verse")

intent.begin(verse: 2, point: origin, time: 1.1, hasNativeSelection: false)
expect(!intent.rejectsNativeSelection(at: 1.12), "Same-verse double-tap allows native word selection")
expect(intent.finish(point: origin, time: 1.15, hasNativeSelection: true) == nil, "Native handles must not be replaced with whole-verse selection")

intent.reset()
intent.begin(verse: 1, point: origin, time: 2, hasNativeSelection: false)
expect(!intent.rejectsNativeSelection(at: 2.5), "Long-press belongs to UIKit")
expect(intent.finish(point: origin, time: 2.8, hasNativeSelection: true) == nil, "Long-press must not toggle a verse on release")
intent.begin(verse: 1, point: origin, time: 3, hasNativeSelection: false)
intent.move(to: CGPoint(x: 0, y: 12))
expect(!intent.rejectsNativeSelection(at: 3.1), "Scrolling must cancel verse intent")
expect(intent.finish(point: CGPoint(x: 0, y: 12), time: 3.15, hasNativeSelection: false) == nil, "Scroll release cannot toggle a verse")

intent.begin(verse: 1, point: origin, time: 4, hasNativeSelection: true)
expect(intent.finish(point: origin, time: 4.1, hasNativeSelection: true) == nil, "Existing native handles retain their interaction")
intent.marker(verse: 1, point: origin, time: 5)
intent.begin(verse: 1, point: origin, time: 5.1, hasNativeSelection: false)
expect(intent.rejectsNativeSelection(at: 5.12), "A number tap is not the first half of a body word double-tap")
expect(intent.finish(point: origin, time: 5.15, hasNativeSelection: true)?.verse == 1, "Marker-to-body remains a verse action")

intent.begin(verse: 3, point: origin, time: 6, hasNativeSelection: false)
intent.cancel()
expect(intent.finish(point: origin, time: 6.1, hasNativeSelection: false) == nil, "Cancellation must not leave a pending toggle")
intent.begin(verse: nil, point: origin, time: 7, hasNativeSelection: false)
expect(intent.finish(point: origin, time: 7.1, hasNativeSelection: false) == nil, "Whitespace is not a verse")
intent.reset()
intent.begin(verse: 1, point: origin, time: 8, hasNativeSelection: false)
_ = intent.finish(point: origin, time: 8.04, hasNativeSelection: false)
intent.begin(verse: 1, point: CGPoint(x: 40, y: 0), time: 8.1, hasNativeSelection: false)
expect(intent.rejectsNativeSelection(at: 8.12), "Distant taps in a long verse are not a word double-tap")
intent.reset()
intent.begin(verse: 7, point: origin, time: 9, hasNativeSelection: false)
expect(intent.rejectsNativeSelection(at: 9.4), "A slower deliberate tap still belongs to the verse")
expect(!intent.rejectsNativeSelection(at: 9.5), "The native long-press threshold remains available")
expect(intent.finish(point: origin, time: 9.4, hasNativeSelection: false)?.verse == 7, "Do not require unusually fast finger release")
print("Reader tap intent passed: rapid accumulation, deselection, word double-tap, long-press, scroll, handles, markers, cancellation")

// A combined source record must not split a visually adjacent selection.
let displayedOrder = [1, 2, 3, 4, 6, 7]
let availableRows = Set(displayedOrder)
expect(readerSelectionRuns([4, 6], in: displayedOrder, available: availableRows) == [[4, 6]], "Adjacent combined4–5 +6 share one outline")
expect(readerSelectionRuns([4, 7], in: displayedOrder, available: availableRows) == [[4], [7]], "An unselected visible row breaks the outline")
expect(readerSelectionRuns([4, 5, 6], in: [4, 5, 6], available: [4, 6]) == [[4], [6]], "An actual row with missing layout must still break the outline")
expect(readerSelectionRuns([4, 5, 6], in: [4, 5, 6], available: [4, 5, 6]) == [[4, 5, 6]], "Available selected rows can bridge a group")
expect(readerSelectionRuns([99], in: displayedOrder, available: availableRows).isEmpty, "Stale absent IDs must not create outlines")
expect(readerSelectionRuns([], in: displayedOrder, available: availableRows).isEmpty, "Empty selection has no groups")
print("Reader selection adjacency passed: combined rows, visible gaps, missing layout, blank bridges, absent IDs")
