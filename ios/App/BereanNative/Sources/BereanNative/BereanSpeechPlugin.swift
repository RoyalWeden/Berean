import Foundation
import AVFoundation
import Capacitor

/// Read Aloud voice engine for the phone (docs/mobile Phase 16): `AVSpeechSynthesizer` with the
/// system voices, driven one utterance (verse) at a time by src/lib/tts/nativeSpeechBackend.ts,
/// which implements the shared `TTSBackend` contract on top of these events:
///   start {id}, boundary {id, charIndex, charLength}, end {id}, cancel {id}
/// Word boundaries come from `willSpeakRangeOfSpeechString`, so verse and word highlighting
/// work exactly as with the Mac's Kokoro engine.
@objc(BereanSpeechPlugin)
public class BereanSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "BereanSpeechPlugin"
    public let jsName = "BereanSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    private lazy var synth: AVSpeechSynthesizer = {
        let s = AVSpeechSynthesizer()
        s.delegate = self
        return s
    }()
    private var ids: [ObjectIdentifier: String] = [:]

    @objc func voices(_ call: CAPPluginCall) {
        let list = AVSpeechSynthesisVoice.speechVoices().map { v -> [String: Any] in
            let quality: String
            switch v.quality {
            case .premium: quality = "Premium"
            case .enhanced: quality = "Enhanced"
            default: quality = "Default"
            }
            return ["id": v.identifier, "name": v.name, "lang": v.language, "quality": quality]
        }
        call.resolve(["voices": list])
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), let id = call.getString("id") else { call.reject("missing text/id"); return }
        let utterance = AVSpeechUtterance(string: text)
        if let voiceId = call.getString("voice"), let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: call.getString("lang") ?? "en-US")
        }
        // AVSpeechUtteranceDefaultSpeechRate (0.5) ≈ 1× for the app's rate scale (0.5…2.0).
        let rate = Float(call.getDouble("rate") ?? 1.0)
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * rate))
        utterance.prefersAssistiveTechnologySettings = false
        ids[ObjectIdentifier(utterance)] = id
        synth.speak(utterance)
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) { synth.pauseSpeaking(at: .word); call.resolve() }
    @objc func resume(_ call: CAPPluginCall) { synth.continueSpeaking(); call.resolve() }
    @objc func stop(_ call: CAPPluginCall) { synth.stopSpeaking(at: .immediate); ids.removeAll(); call.resolve() }
    @objc func status(_ call: CAPPluginCall) { call.resolve(["speaking": synth.isSpeaking, "paused": synth.isPaused]) }

    // MARK: delegate → events

    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didStart u: AVSpeechUtterance) {
        notifyListeners("start", data: ["id": ids[ObjectIdentifier(u)] ?? ""])
    }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange, utterance u: AVSpeechUtterance) {
        notifyListeners("boundary", data: ["id": ids[ObjectIdentifier(u)] ?? "", "charIndex": r.location, "charLength": r.length])
    }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        let id = ids.removeValue(forKey: ObjectIdentifier(u)) ?? ""
        notifyListeners("end", data: ["id": id])
    }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) {
        let id = ids.removeValue(forKey: ObjectIdentifier(u)) ?? ""
        notifyListeners("cancel", data: ["id": id])
    }
}
