# Table wiki-link compatibility investigation — 2026-11-19

Status: reproducible ambiguity; no identity normalization or production data edits made.

The actual Electron ProseMirror schema/serializer/parser from12176065 generated these outputs from table cells whose visible text was Alias and whose wikilink mark had the supplied title. This is synthetic document data, not exported personal notes. The native combined-format increment does not modify Electron source.

```json
[
  {
    "title": "Target",
    "source": "| Link | Other |\n| --- | --- |\n| [[Target\\|Alias]] | Value |",
    "roundTripTargets": [
      "Target"
    ]
  },
  {
    "title": "Target\\",
    "source": "| Link | Other |\n| --- | --- |\n| [[Target\\|Alias]] | Value |",
    "roundTripTargets": [
      "Target"
    ]
  },
  {
    "title": "Path\\Name",
    "source": "| Link | Other |\n| --- | --- |\n| [[Path\\Name\\|Alias]] | Value |",
    "roundTripTargets": [
      "Path\\Name"
    ]
  },
  {
    "title": "Target\\\\",
    "source": "| Link | Other |\n| --- | --- |\n| [[Target\\\\|Alias]] | Value |",
    "roundTripTargets": [
      "Target\\"
    ]
  }
]
```

The title Target and the distinct title ending in one literal backslash produce identical serialized bytes. The legacy GFM parser consumes that backslash as a table escape before the wiki-link rule sees it. Two trailing backslashes become one after parsing. An internal backslash in Path\Name survives. Native alias extraction currently retains the trailing escape in its target; simply stripping it would match ordinary legacy GFM parsing but could redirect a distinct literal-backslash title. Saved Markdown alone cannot distinguish the collision.

Reproduction: build a schema doc with a table_header row Link/Other and a table_cell row Alias/Value; Alias carries schema.marks.wikilink.create({title}). serializeToMarkdown(doc), parseMarkdown(source), collect wikilink attrs.title. Probe files `/tmp/berean-legacy-table-wiki-probe.ts`, `.cjs`, `-run.cjs`, `.json`. First direct Node run failed because the parser imports browser-dependent modules. The second used an isolated in-memory JSDOM window/document/localStorage; output above was produced, then the lingering process was interrupted. It neither read nor wrote the app's library. The bundler also warned that import.meta is unavailable in CJS in an unrelated Kokoro import; no speech worker was invoked.

Next: add a source-context link model that distinguishes source bytes, displayed label and resolution candidates. Validate tables and ordinary paragraphs separately, including existing notes whose titles end in backslashes. A migration must not silently rename note identities or pick another note merely to mimic a lossy legacy parser. Keep destination resolution explicit when multiple existing identities match possible interpretations. Raw title-addressed links and already stored Markdown must remain unchanged until that policy is implemented and verified.
