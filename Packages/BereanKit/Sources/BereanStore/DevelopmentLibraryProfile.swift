/// An explicit, bounded debug profile for a separate QA library and preferences.
/// Parsing never accepts a filesystem path or silently falls back after an error.
public struct DevelopmentLibraryProfile: Equatable, Sendable {
    public enum Failure: Error, Equatable { case requiresQALibrary, missingName, repeatedProfile, invalidName }
    public let name: String
    public var directoryName: String { "BereanNativeQA-" + name }
    public var preferencesSuffix: String { "qa." + name }

    public static func parse(arguments: [String]) throws -> Self? {
        let indices = arguments.indices.filter { arguments[$0] == "--qa-profile" }
        guard let index = indices.first else { return nil }
        guard indices.count == 1 else { throw Failure.repeatedProfile }
        guard arguments.contains("--qa-library") else { throw Failure.requiresQALibrary }
        guard arguments.indices.contains(index + 1) else { throw Failure.missingName }
        let name = arguments[index + 1]
        let bytes = Array(name.utf8)
        func alphanumeric(_ byte: UInt8) -> Bool { (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) }
        guard (1...48).contains(bytes.count), let first = bytes.first, alphanumeric(first),
              bytes.allSatisfy({ alphanumeric($0) || $0 == 45 }) else { throw Failure.invalidName }
        // The Mac filesystem may be case-insensitive; the preference domain
        // must resolve to the same profile as its library directory.
        return Self(name: name.lowercased())
    }
}
