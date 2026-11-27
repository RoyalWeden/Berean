import Foundation

// This probe accepts an explicit scalar vocabulary, not a general tokenizer.json
// reader. The model's tokenizer assets and ONNX session are not loaded here.
private struct InputFixture: Decodable {
    struct Sample: Decodable {
        let phonemes: String
        let voice: Voice
        let speed: Float
    }

    let vocabulary: [String: Int64]
    let boundaryID: Int64
    let unknownID: Int64
    let maximumTokenCount: Int
    let samples: [Sample]

    func modelInputs(styles: [Voice: Data]) throws -> [ModelInputs] {
        guard maximumTokenCount >= 2 else { throw ProbeError.invalidVocabulary }
        var scalarIDs: [Unicode.Scalar: Int64] = [:]
        for (token, id) in vocabulary {
            guard token.unicodeScalars.count == 1, let scalar = token.unicodeScalars.first else {
                throw ProbeError.invalidVocabulary
            }
            scalarIDs[scalar] = id
        }
        return try samples.map { sample in
            var ids = [boundaryID]
            ids.append(contentsOf: sample.phonemes.unicodeScalars.prefix(maximumTokenCount - 1).map {
                scalarIDs[$0] ?? unknownID
            })
            // The original tokenizer truncates after adding both boundary tokens.
            if ids.count < maximumTokenCount { ids.append(boundaryID) }
            guard let style = styles[sample.voice] else { throw ProbeError.invalidStyle(sample.voice) }
            return ModelInputs(ids: ids, styleBits: try voiceStyleBits(style, for: ids.count), speed: sample.speed)
        }
    }
}

private enum Voice: String, CaseIterable, Decodable {
    case heart = "af_heart"
    case emma = "bf_emma"
}

private enum ProbeError: Error {
    case invalidArguments
    case invalidVocabulary
    case invalidStyle(Voice)
    case invalidStyleSize
}

private struct ModelInputs: Encodable {
    let ids: [Int64]
    let styleBits: [UInt32]
    let speed: Float
}

private func voiceStyleBits(_ bytes: Data, for tokenCount: Int) throws -> [UInt32] {
    let rowCount = 510
    let styleWidth = 256
    let elementSize = MemoryLayout<UInt32>.size
    let rowSize = styleWidth * elementSize
    guard bytes.count == rowCount * rowSize else { throw ProbeError.invalidStyleSize }
    let row = min(rowCount - 1, max(0, tokenCount - 2))
    return bytes.withUnsafeBytes { buffer in
        (0..<styleWidth).map { index in
            let offset = row * rowSize + index * elementSize
            return UInt32(littleEndian: buffer.loadUnaligned(fromByteOffset: offset, as: UInt32.self))
        }
    }
}

private func run() throws {
    guard CommandLine.arguments.count == 2 else { throw ProbeError.invalidArguments }
    let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let styles = try Dictionary(uniqueKeysWithValues: Voice.allCases.map { voice in
        let file = folder.appendingPathComponent(voice.rawValue).appendingPathExtension("bin")
        return (voice, try Data(contentsOf: file))
    })
    let fixture = try JSONDecoder().decode(InputFixture.self, from: FileHandle.standardInput.readDataToEndOfFile())
    FileHandle.standardOutput.write(try JSONEncoder().encode(fixture.modelInputs(styles: styles)))
}

try run()
