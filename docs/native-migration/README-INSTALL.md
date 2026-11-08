# Install the Berean persistent execution package

1. Extract this package. Copy the **Markdown files** into `/Users/roywe/Berean/docs/native-migration/`, preserving filenames.
2. Do **not** replace `/Users/roywe/Berean/CLAUDE.md`. Copy only the text of `CLAUDE_BOOTSTRAP_SNIPPET.md` into its existing instructions, or ask Claude to integrate it non-destructively.
3. Keep the original 18 audits under `docs/native-migration-audit/`.
4. Place or identify the separate **Berean Native Migration Master Specification.docx**, which **was not supplied to the authoring session of this package**, and instruct Claude to read it and reconcile any differences.
5. Open Claude Code in the Berean repository and paste the content of `CLAUDE_START_PROMPT.md`. It authorizes actual work and protects production actions.
6. Commit these operational documents on the established isolated-worktree/PR workflow before extending them. Have Claude initialize the templates from the live Git state. They are currently intentionally uninitialized, not proof of completed work.

**Do not upload or commit any backup bundle, credentials, personal content, user database or real iCloud journal** into these documents or Git.
