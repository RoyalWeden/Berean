# Supplied words in native red-letter verses

KJVA John 3:5 stores `!water{G5204} !and{G2532} *of{} !the{} !Spirit,{G4151}` in `data/kjva.db`. The asterisk marks the second “of” as italic. The native display now colors it red like the surrounding words while retaining the italics.

The KJVA render projection fills red across a run of visible italic words when both neighboring ordinary words are explicitly red in the same verse. Tokens with no plain text do not count as neighbors. At verse edges and beside non-red ordinary text, supplied words keep their source color. The supplied-word visibility setting still removes the same words.

The change applies to the native reader and the rich verse rendering used in Compare. Parsing, study tokens, copied text, Strong’s numbers, and replacement rules keep the original behavior.

The Release package run passed 397 tests in 96 suites. The tests confirm the rendered text, token count, and Strong’s references for John 3:5 and cover consecutive supplied words, invisible tokens, verse edges, narrator text, and the hide-supplied setting. The full-corpus display and parser golden tests passed. The log is at `/private/tmp/berean-supplied-red-fw5W6r/full-release-rerun.log`. Native app visual verification is part of integration.
