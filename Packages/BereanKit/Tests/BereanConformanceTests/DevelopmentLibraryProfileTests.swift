import Testing
import BereanStore

@Suite struct DevelopmentLibraryProfileTests {
    @Test func profileRequiresExplicitQAAndNeverAcceptsPaths() throws {
        #expect(try DevelopmentLibraryProfile.parse(arguments: ["app"]) == nil)
        #expect(try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library"]) == nil)
        let profile = try #require(try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile", "codex-study-20261119"]))
        #expect(profile.directoryName == "BereanNativeQA-codex-study-20261119")
        #expect(profile.preferencesSuffix == "qa.codex-study-20261119")
        #expect(try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile", "CODEX-STUDY-20261119"]) == profile)
        #expect(try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile", String(repeating: "A", count: 48)])?.name == String(repeating: "a", count: 48))
        #expect(throws: DevelopmentLibraryProfile.Failure.requiresQALibrary) {
            try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-profile", "test"])
        }
        #expect(throws: DevelopmentLibraryProfile.Failure.missingName) {
            try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile"])
        }
        #expect(throws: DevelopmentLibraryProfile.Failure.repeatedProfile) {
            try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile", "a", "--qa-profile", "b"])
        }
        for invalid in ["", "../BereanNative", "/tmp/test", "a/b", "a\\b", ".", "..", "--other-option", "space name", "a.b", "é", String(repeating: "a", count: 49)] {
            #expect(throws: DevelopmentLibraryProfile.Failure.invalidName) {
                try DevelopmentLibraryProfile.parse(arguments: ["app", "--qa-library", "--qa-profile", invalid])
            }
        }
    }
}
