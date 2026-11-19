# Reader tap intent regression checks

Run from the repository root on macOS:

```sh
xcrun swiftc apple/Shared/ReaderVerse.swift scripts/native/reader-taps/main.swift -o /tmp/berean-reader-tap-intent
/tmp/berean-reader-tap-intent
```

These checks cover rapid accumulation across different verses, targeted deselection,
same-verse word double-taps, long-press, movement/scroll cancellation, existing native
selection handles, marker-to-body transitions and whitespace. They exercise the same
pure intent state used by the iPhone passive touch observer. They do not replace
simulator/device interaction checks for UIKit gesture ordering or native edit menus.

Also covers visual selection adjacency across combined records with gaps in stored IDs,
while retaining breaks for unselected rows and actual rows lacking layout.

The same harness checks body-position anchors through Strong's on/off reflow:
inline links and chips are excluded, visible words retain their UTF-16 offsets,
and emoji/combining characters and malformed ranges are covered. This checks
mapping correctness; native layout and viewport behavior require app interaction.
