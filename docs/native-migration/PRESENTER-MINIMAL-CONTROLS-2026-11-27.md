# Presenter minimal controls — November27 evening

Owner asks for no visible Presenter text and minimal, easy controls, preferably bottom-right. Existing scene already has a hidden titlebar and bottom-right glass; retain native traffic lights and the Window menu name. Remove the redundant content navigationTitle and separate noninteractive status circle. Pause/Resume now exposes its Following/Paused state as an accessibility value. Keep the zoom capsule and one circular Pause/Resume control, 16pt from bottom/right. Enlarge each zoom hit target to32×36pt, percentage reset at least42×36pt; no extra labels or toolbar band.

Source ownership: Codex owns PresenterView.swift only; no AppModel/window-state change. Read-only helper reviewed original window parity and Presenter; DX05 per-window implementation is deferred while handling this direct owner request. Preserve the Equatable PresenterZoom payload and existing text-size storage/follow/freeze behavior. No iOS/shared source, data, signing or sync change.

Verification pending: owner Mac build, real isolated Mac UI zoom/Pause/Resume/title/reflow. Prior app sourcebab93109 has424 passing tests and all3 owner builds. The current change is reversible view layout and needs rendered checks rather than mirrored unit tests. Physical iPhone install is outside this task.
