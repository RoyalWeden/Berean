import Foundation
import libespeak_ng
import BereanText

// Each mode runs in its own process: eSpeak's translator/resource state is global.
guard (3...4).contains(CommandLine.arguments.count) else {
    fatalError("Usage: Probe compile|dictionary|phonemize|kokoro <temporary-data-root> [en-us|en]")
}
let mode = CommandLine.arguments[1]
let voice = CommandLine.arguments.count == 4 ? CommandLine.arguments[3] : "en-us"
guard ["en-us", "en"].contains(voice) else { fatalError("Unsupported probe voice") }
let destination = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let output = destination.appendingPathComponent("espeak-ng-data", isDirectory: true)
let executableRoot = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
let bundles = try FileManager.default.contentsOfDirectory(at: executableRoot, includingPropertiesForKeys: nil)
guard let resources = bundles.compactMap({ Bundle(url: $0)?.resourceURL }).first(where: {
    FileManager.default.fileExists(atPath: $0.appendingPathComponent("phsource").path)
}) else { fatalError("Missing official eSpeak resource bundle") }

if mode == "compile" {
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    // Refuse to replace an existing resource tree. The runner supplies a fresh temporary root.
    try FileManager.default.copyItem(at: resources.appendingPathComponent("espeak-ng-data"), to: output)
    espeak_ng_InitializePath(destination.path)
    var context: espeak_ng_ERROR_CONTEXT?
    let phonemes = espeak_ng_CompilePhonemeDataPath(22050, resources.appendingPathComponent("phsource").path,
                                                  output.path, stdout, &context)
    guard phonemes == ENS_OK else { fatalError("Phoneme compilation failed: \(phonemes)") }
    let intonation = espeak_ng_CompileIntonationPath(resources.appendingPathComponent("phsource").path,
                                                    output.path, stdout, &context)
    guard intonation == ENS_OK else { fatalError("Intonation compilation failed: \(intonation)") }
    exit(0)
}

// The original wrapper obtains IPA from synthesis tracing. Direct TextToPhonemes
// differs in paragraph stress. Synchronous mode never opens audio output; the
// callback discards internal eSpeak PCM, which is not a Kokoro playback backend.
let sampleRate = espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, destination.path, espeakINITIALIZE_DONT_EXIT)
// The shared English dictionary is compiled against the base English phoneme
// table, as upstream's default CLI does, rather than the American voice overlay.
let initializationVoice = mode == "dictionary" ? "en" : voice
guard sampleRate > 0, espeak_SetVoiceByName(initializationVoice) == EE_OK else {
    fatalError("English phonemizer initialization failed")
}
defer { espeak_Terminate() }
if mode == "dictionary" {
    // SetVoiceByName MUST precede dictionary compilation: the compiler uses translator options.
    var context: espeak_ng_ERROR_CONTEXT?
    let result = espeak_ng_CompileDictionary(resources.appendingPathComponent("dictsource").path + "/",
                                            "en", stdout, 0, &context)
    guard result == ENS_OK else { fatalError("English dictionary compilation failed: \(result)") }
} else if mode == "phonemize" || mode == "kokoro" {
    let samples = try JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile())
    espeak_SetSynthCallback { _, _, _ in 0 }
    func phonemize(_ sample: String) -> [String] {
        guard let trace = tmpfile() else { fatalError("Cannot create temporary phoneme trace") }
        defer { espeak_SetPhonemeTrace(0, nil); fclose(trace) }
        espeak_SetPhonemeTrace(Int32(espeakPHONEMES_IPA), trace)
        let status = sample.withCString { text in
            espeak_Synth(text, sample.utf8.count + 1, 0, POS_CHARACTER, 0, UInt32(espeakCHARS_UTF8), nil, nil)
        }
        guard status == EE_OK, espeak_Synchronize() == EE_OK else { fatalError("Phoneme trace failed") }
        fflush(trace)
        fseek(trace, 0, SEEK_END)
        let count = ftell(trace)
        guard count >= 0, count < 10_000_000 else { fatalError("Invalid phoneme trace size") }
        rewind(trace)
        var bytes = [UInt8](repeating: 0, count: Int(count))
        let read = bytes.withUnsafeMutableBytes { fread($0.baseAddress, 1, $0.count, trace) }
        guard read == bytes.count else { fatalError("Incomplete phoneme trace") }
        return String(decoding: bytes, as: UTF8.self).components(separatedBy: "\n").filter { !$0.isEmpty }
    }
    if mode == "phonemize" {
        FileHandle.standardOutput.write(try JSONEncoder().encode(samples.map(phonemize)))
    } else {
        let results = samples.map { sample in
            let ipa = KokoroEnglish.parts(sample).map { part in
                part.isPunctuation ? part.text : phonemize(part.text).joined(separator: " ")
            }.joined()
            return KokoroEnglish.postprocess(ipa, american: voice == "en-us")
        }
        FileHandle.standardOutput.write(try JSONEncoder().encode(results))
    }
} else { fatalError("Unknown mode: \(mode)") }
