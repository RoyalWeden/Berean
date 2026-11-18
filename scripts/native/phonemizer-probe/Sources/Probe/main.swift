import Foundation
import libespeak_ng

// Each mode runs in its own process: eSpeak's translator/resource state is global.
guard (3...4).contains(CommandLine.arguments.count) else {
    fatalError("Usage: Probe compile|dictionary|phonemize <temporary-data-root> [en-us|en]")
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

// Retrieval mode never plays audio. This probe calls only TextToPhonemes, not synthesis.
let sampleRate = espeak_Initialize(AUDIO_OUTPUT_RETRIEVAL, 0, destination.path, espeakINITIALIZE_DONT_EXIT)
guard sampleRate > 0, espeak_SetVoiceByName(voice) == EE_OK else {
    fatalError("English phonemizer initialization failed")
}
defer { espeak_Terminate() }
if mode == "dictionary" {
    // SetVoiceByName MUST precede dictionary compilation: the compiler uses translator options.
    var context: espeak_ng_ERROR_CONTEXT?
    let result = espeak_ng_CompileDictionary(resources.appendingPathComponent("dictsource").path + "/",
                                            "en", stdout, 0, &context)
    guard result == ENS_OK else { fatalError("English dictionary compilation failed: \(result)") }
} else if mode == "phonemize" {
    let samples = try JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile())
    let results = samples.map { sample in
        sample.withCString { start -> [String] in
            var pointer: UnsafeRawPointer? = UnsafeRawPointer(start)
            var clauses: [String] = []
            while pointer != nil {
                guard let result = espeak_TextToPhonemes(&pointer, 1, 2) else { break }
                clauses.append(String(cString: result))
            }
            return clauses
        }
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(results))
} else { fatalError("Unknown mode: \(mode)") }
