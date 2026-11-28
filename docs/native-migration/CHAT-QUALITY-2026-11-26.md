# Messages folder compatibility

This follow-up builds on the CC-04 folder and reply work in `d778c4b2`. Folder rename now locks the database for writing before reading source folder membership. Another connection cannot move a conversation between that read and the update. Change events are emitted after commit.

Folder names use the original ECMAScript trim and whitespace rules and the 60-unit UTF-16 limit. If truncation splits a surrogate pair, the stored UTF-8 uses the replacement character. The source folder is looked up by its exact stored name so pre-existing longer names remain reachable for rename and removal. Stored folders are changed only by explicit user actions.

Verified in the isolated `native/codex-chat-quality-20261126` worktree. The tests cover ECMAScript whitespace, a 31-emoji input, a split surrogate, and exact lookup of a previously stored long name. A two-connection test confirms the second writer receives `SQLITE_BUSY` before commit and can write afterward. Node’s SQLite text binding agreed with the legacy formula for the four Unicode boundary examples.

The final Release package run passed **394 tests in 96 suites** with read-only corpus links and an isolated build directory. The first build stopped at debug-symbol generation. Retrying with the native Swift build system reached the tests and exposed a missing local `build/apple` fixture directory. Creating that directory enabled the final pass. Evidence is in `/private/tmp/berean-chat-quality-vpFkNd/final-release.log`. Verification covers the service and disposable test databases. App builds and UI verification are part of integration.
