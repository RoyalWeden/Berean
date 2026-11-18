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
