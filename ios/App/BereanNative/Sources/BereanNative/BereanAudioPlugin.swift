import Foundation
import AVFoundation
import MediaPlayer
import Capacitor

/// Audio session + lock-screen / Control Centre integration for Read Aloud (docs/mobile:
/// Phase 16). The speech itself is synthesised in the WebView (Web Speech → AVSpeechSynthesizer);
/// this plugin owns what a web page cannot: the `.playback` audio session (so reading continues
/// with the screen locked and ducks nothing it should not), the Now Playing card, and the remote
/// commands (play / pause / toggle / next / previous) which are forwarded to JavaScript as
/// `command` events so the store's playback actions run.
@objc(BereanAudioPlugin)
public class BereanAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanAudioPlugin"
    public let jsName = "BereanAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivateSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNowPlaying", returnType: CAPPluginReturnPromise),
    ]

    private var commandsInstalled = false
    private var targets: [Any] = []

    @objc func activateSession(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
            installCommands()
            call.resolve()
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }

    @objc func deactivateSession(_ call: CAPPluginCall) {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    @objc func setNowPlaying(_ call: CAPPluginCall) {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = call.getString("title") ?? "Berean"
        info[MPMediaItemPropertyArtist] = call.getString("artist") ?? "Read Aloud"
        info[MPMediaItemPropertyAlbumTitle] = call.getString("album") ?? "Berean"
        if let dur = call.getDouble("duration") { info[MPMediaItemPropertyPlaybackDuration] = dur }
        if let pos = call.getDouble("position") { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos }
        info[MPNowPlayingInfoPropertyPlaybackRate] = (call.getBool("isPlaying") ?? false) ? (call.getDouble("rate") ?? 1.0) : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        call.resolve()
    }

    @objc func clearNowPlaying(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    private func installCommands() {
        if commandsInstalled { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ name: String) {
            command.isEnabled = true
            targets.append(command.addTarget { [weak self] _ in
                self?.notifyListeners("command", data: ["command": name])
                return .success
            })
        }
        bind(center.playCommand, "play")
        bind(center.pauseCommand, "pause")
        bind(center.togglePlayPauseCommand, "toggle")
        bind(center.nextTrackCommand, "next")
        bind(center.previousTrackCommand, "previous")
        bind(center.stopCommand, "stop")
        center.seekForwardCommand.isEnabled = false
        center.seekBackwardCommand.isEnabled = false
        center.changePlaybackPositionCommand.isEnabled = false
    }
}
