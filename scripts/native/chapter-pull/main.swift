// Compile with apple/Shared/ReaderVerse.swift, as in the native CI job.
import Foundation

for (arm, disarm): (CGFloat, CGFloat) in [(112, 88), (112, 92)] {
    var intent = ChapterPullIntent(armDistance: arm, disarmDistance: disarm)
    precondition(intent.update(direction: 1, distance: 200, allowed: true) == nil, "Unstarted/momentum gesture armed")
    intent.begin(atTop: false, atBottom: false)
    precondition(intent.update(direction: 1, distance: 200, allowed: true) == nil, "Ordinary scroll reaching edge armed")
    precondition(intent.finish() == nil)

    intent.begin(atTop: true, atBottom: false)
    precondition(intent.update(direction: 1, distance: 200, allowed: true) == nil, "Wrong edge armed")
    precondition(intent.update(direction: -1, distance: 17, allowed: true) == nil, "Cue appeared too early")
    precondition(intent.update(direction: -1, distance: arm - 1, allowed: true)?.ready == false)
    precondition(intent.update(direction: -1, distance: arm, allowed: true)?.ready == true)
    precondition(intent.update(direction: -1, distance: disarm + 1, allowed: true)?.ready == true, "Ready cue flickered")
    precondition(intent.update(direction: -1, distance: disarm - 1, allowed: true)?.ready == false, "Pull could not be retracted")
    precondition(intent.finish() == nil, "Retracted pull committed")

    intent.begin(atTop: false, atBottom: true)
    precondition(intent.update(direction: 1, distance: arm, allowed: true)?.ready == true)
    precondition(intent.finish() == 1)
    precondition(intent.finish() == nil, "Gesture committed twice")

    // A short chapter has coincident edges: either fresh pull must work, with
    // exactly one commit even when native pan and scroll callbacks both finish.
    for direction in [-1, 1] {
        intent.begin(atTop: true, atBottom: true)
        precondition(intent.update(direction: direction, distance: arm, allowed: true)?.ready == true)
        precondition(intent.finish() == direction, "Short chapter could not turn in both directions")
        precondition(intent.finish() == nil, "Short chapter finished twice")
    }
    intent.begin(atTop: true, atBottom: true)
    precondition(intent.update(direction: -1, distance: arm, allowed: true)?.ready == true)
    precondition(intent.update(direction: -1, distance: arm, allowed: false) == nil)
    precondition(intent.finish() == nil, "Unavailable destination committed")
    intent.begin(atTop: true, atBottom: false)
    _ = intent.update(direction: -1, distance: arm, allowed: true)
    intent.cancel()
    precondition(intent.finish() == nil, "Cancelled/selection-blocked gesture committed")
}
print("Chapter pull intent passed: fresh edges, thresholds, hysteresis, retraction, cancellation, single commit")
