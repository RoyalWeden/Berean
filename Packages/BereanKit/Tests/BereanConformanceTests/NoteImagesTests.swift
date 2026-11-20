import Foundation
import Testing
import BereanNotes

@Suite("note images") struct NoteImagesTests {
    let png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

    @Test func parsesAltWidthAndSource() {
        let text = "Intro\n![Dead Sea Scroll|w320](data:image/png;base64,\(png1x1))\n![plain](https://x/y.png)"
        let images = NoteImages.find(in: text)
        #expect(images.count == 2)
        #expect(images[0].alt == "Dead Sea Scroll" && images[0].width == 320)
        #expect((text as NSString).substring(with: images[0].captionRange) == "Dead Sea Scroll")
        #expect(images[1].alt == "plain" && images[1].width == nil && images[1].source == "https://x/y.png")
        #expect(NoteImages.find(in: "![a|wide](x.png)")[0].alt == "a|wide")
    }

    @Test func decodesOnlySupportedDataURIs() {
        #expect(NoteImages.dataURIBytes("data:image/png;base64,\(png1x1)")?.count == 70)
        #expect(NoteImages.dataURIBytes("data:image/svg+xml;base64,PHN2Zz4=") == nil)
        #expect(NoteImages.dataURIBytes("https://example.com/a.png") == nil)
    }

    @Test func displaySizeClamps() {
        #expect(NoteImages.displaySize(natural: CGSize(width: 1000, height: 500), savedWidth: nil, available: 600) == CGSize(width: 600, height: 300))
        #expect(NoteImages.displaySize(natural: CGSize(width: 1000, height: 500), savedWidth: 320, available: 600) == CGSize(width: 320, height: 160))
        #expect(NoteImages.displaySize(natural: CGSize(width: 100, height: 2000), savedWidth: nil, available: 600, maxHeight: 400) == CGSize(width: 20, height: 400))
    }
}

@Suite("note images — large sources") struct NoteImagesLargeTests {
    @Test func hugeBase64StillMatchesAsImage() {
        let base64 = String(repeating: "QUJDRA==", count: 120_000)   // ~960 KB, like a pasted photo
        let text = "a\n![Big|w300](data:image/png;base64,\(base64))\nb"
        #expect(NoteImages.find(in: text).first?.width == 300)
        let kinds = MarkdownLiveSpans.spans(text).map(\.kind)
        #expect(kinds.contains(.image("Big")))
        #expect(!kinds.contains { if case .link = $0 { true } else { false } })
    }
}

@Suite("note images — masking") struct NoteImagesMaskTests {
    @Test func masksOnlySourcesKeepingLength() {
        let text = "See John 3:16 ![H1234 cap](data:image/png;base64,AAAAH3068G1234==) and H7225."
        let masked = NoteImages.maskingSources(text)
        #expect((masked as NSString).length == (text as NSString).length)
        #expect(masked.contains("H1234 cap") && masked.contains("H7225") && masked.contains("John 3:16"))
        #expect(!masked.contains("H3068") && !masked.contains("base64"))
        #expect(NoteImages.maskingSources("no images here") == "no images here")
    }
}
