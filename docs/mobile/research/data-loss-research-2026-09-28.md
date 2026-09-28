# Data-Loss Threat Model Research — iCloud Drive Ubiquity Container Sync

Date: 2026-09-28
Scope: Berean's file-journal sync design (NOT CloudKit). Each device writes only
`Documents/sync/v1/devices/<deviceId>/{journal-*.jsonl, manifest.json, snapshot-*.json}`
inside the app's iCloud Drive ubiquity container. iOS uses NSFileCoordinator +
NSMetadataQuery(NSMetadataQueryUbiquitousDocumentsScope) + startDownloadingUbiquitousItem.
macOS (Electron) reads/writes the same container via plain `fs`. Local cache is
SQLite (berean.db) in Application Support, merged via hybrid logical clock.

Many current DocC pages on developer.apple.com serve JS shells to non-browser
fetchers, so where noted I pulled Apple's own `tutorials/data/.../*.json`
payload (same authored content, different delivery) or an archived static
Apple doc (TN2336, QA1809). Anything not traceable to an Apple source is
marked UNCONFIRMED.

---

## 1. Dataless files / eviction (`.icloud` placeholders)

**Source:** Apple Support "Optimize Mac Storage" guidance; Apple Developer
Docs, `startDownloadingUbiquitousItem(at:)`.

**Behavior:** With Optimize Storage on, the OS may evict least-recently-used
local copies of iCloud Drive files under disk pressure, leaving a dataless
placeholder that downloads on demand. "The system evicts local copies only
once the disk genuinely starts filling, and in an order it chooses itself,
starting with files you have not opened in the longest time."
`startDownloadingUbiquitousItem(at:)`: "If a cloud-based file or directory
has not been downloaded yet, calling this method starts the download
process." `evictUbiquitousItem(at:)` removes a local copy programmatically.

**Implication for Berean:** A device's own journal files can be evicted from
local disk while the app is not running. Plain `fs.readFileSync` (macOS) or
an uncoordinated read (iOS) against an evicted file can return an
empty/partial dataless stub instead of real content unless the app first
calls `startDownloadingUbiquitousItem` and polls
`ubiquitousItemDownloadingStatus` until current. This is a genuine
data-corruption risk for the merge logic if not defensively coded.

---

## 2. Upload status (`ubiquitousItemIsUploaded`)

**Source:** Apple Developer Docs, `URLResourceValues.ubiquitousItemIsUploaded`.

**Behavior:** "A Boolean value that indicates whether data is present in the
cloud for the item" (iOS 8+/macOS 10.10+). False means the local append has
not propagated to iCloud servers yet — an unbounded window under poor
connectivity, Low Power Mode, or background limits during which a
locally-committed append exists on only one device.

**Implication for Berean:** A journal append is unrecoverable-if-lost until
`ubiquitousItemIsUploaded` is true. Local write completion should not be
treated as "synced"; surface upload state (`ubiquitousItemUploadingError`)
before letting the user uninstall or wipe the device.

---

## 3. NSMetadataQuery foreground/background limitations

**Source:** Apple Developer Docs, `NSMetadataQuery`.

**Behavior:** Fetched content: "a query that you perform against Spotlight
metadata," gathering phase then live-update phase, 1.0s default notification
batching. UNCONFIRMED from a primary source this pass: the commonly reported
claim that live updates pause while the app is backgrounded/suspended on
iOS — widely corroborated on developer forums, but no Apple-authored
sentence pinned down here. Verify against the iCloud Design Guide / relevant
WWDC session text before relying on it.

**Implication for Berean:** If true, iOS may not learn about a peer's new
journal file while backgrounded — restart the query on foreground rather
than assuming background awareness. Affects merge freshness; stale merges
plus device loss can look like data loss to the user.

---

## 4. NSFileVersion conflicts — can a single-writer file conflict?

**Source:** Apple TN2336, "Handling version conflicts in the iCloud
environment."

**Behavior:** "In the iCloud environment, it is possible that a user,
accidentally or not, saves changes to the same file, or creates files with
the same name, from multiple devices... these actions likely, or even
inevitably, lead to conflicts." Conflicts require coordinated writes from
**multiple peers** to the same path.

**Implication for Berean:** Since each device writes only its own
per-device folder, no two devices ever contend on the same path, so the
design should not generate `NSFileVersion` conflicts under normal operation.
Caveat (reasoned, not stated explicitly by TN2336): if the same deviceId is
ever reused by two physically different installs writing concurrently (e.g.
a restored backup that inherited the original device's id — see §11), that
reintroduces the multiple-writer-same-path scenario and conflicts become
possible. Verify deviceId uniqueness at first launch after every restore.

---

## 5. Atomic / coordinated writes (NSFileCoordinator)

**Source:** Apple Developer Docs, `NSFileCoordinator`.

**Behavior:** "...before your code to perform those actions executes, the
file coordinator lets registered file presenter objects perform any tasks
that they might require to ensure their own integrity." Also: "If your app
or extension enters the background with an active file presenter, it may be
terminated by the system in order to prevent deadlock on that file." Each
coordinator instance is single-thread use.

**Implication for Berean:** iOS journal I/O must go through
`NSFileCoordinator` (already the stated design), and any `NSFilePresenter`
must be deregistered on background / re-registered on foreground. The
macOS/Electron side using plain `fs` is **not** coordinated with the iCloud
daemon the same way; an uncoordinated `fs.write` racing the daemon's own
read/upload of the same file is a plausible torn-write source. UNCONFIRMED:
no citable Apple sentence found this pass on uncoordinated POSIX access
specifically under macOS iCloud Drive — flagged as the top follow-up read
(File System Programming Guide / iCloud Design Guide macOS sections,
`NSFilePresenter` for CoreServices).

---

## 6. App deletion — does it delete iCloud Drive container data?

**Source:** Apple Support (Manage iCloud storage, support.apple.com/108922)
plus consistent real-world reports (Apple Support Communities, MacRumors
Forums); no single developer.apple.com sentence found stating the rule
abstractly, but practical behavior is consistently reported.

**Behavior:** Deleting the app removes the local sandbox but does **not**
delete the app's iCloud Drive container contents from iCloud or other
devices. Data persists until the user explicitly deletes it via the Files
app ("Select, choose folder(s), Delete") or Settings → [Apple ID] → iCloud →
Manage Storage → app → Delete Documents & Data. Community reports also
describe deleted app folders "resurrecting" for a period — a sync-timing
artifact, not documented intended behavior.

**Implication for Berean:** Uninstalling one device does **not** purge that
device's journal files from iCloud — good for data-loss resistance (history
survives uninstall) but means stale device folders accumulate in iCloud
indefinitely unless pruned. Uninstall/reinstall must NOT be treated as
"start fresh" — a reinstall will still see, and should correctly merge, the
old device's journal history unless the user separately deleted it via
Manage Storage.

---

## 7. Signing out of iCloud

**Source:** Apple Support, "If you sign out of your Apple Account settings
on Mac"; "Sign out of your Apple Account and iCloud on your devices"
(support.apple.com/en-us/104958).

**Behavior:** On sign-out, macOS asks whether to keep local copies of iCloud
Drive documents. Without a kept copy: "your documents and data stored in
iCloud are removed from your Mac." With a kept copy: "iCloud no longer keeps
them up to date with changes on your other devices," and files move to a
local "iCloud Drive (Archive)" folder — exiting the ubiquity container
entirely as an ordinary, no-longer-syncing copy. Other signed-in devices
retain full access to the live iCloud copy.

**Implication for Berean:** (a) Sign-out without keeping a copy is a real
local data-loss event on that device; the canonical data typically survives
elsewhere unless this was the only device, in which case it's recoverable
only by signing back into the same account (assuming the account's iCloud
Drive data wasn't separately deleted). (b) Sign-out with a kept copy leaves
a frozen archived duplicate outside the watched path — harmless unless a
user manually copies it back into the live container, which reintroduces
the §4 same-path-multiple-writer risk.

---

## 8. `ubiquityIdentityToken` / account switching

**Source:** Apple Developer Docs, `FileManager.ubiquityIdentityToken`.

**Behavior:** "An opaque token that represents the current user's iCloud
Drive Documents identity." "If iCloud is unavailable or there is no
logged-in user, the value is nil." Compare a stored token to the current one
via `isEqual(_:)` to detect account changes, and observe
`NSUbiquityIdentityDidChangeNotification` for live changes. Caveat:
"Accessing this token does not connect your app to its ubiquity containers"
— a separate `url(forUbiquityContainerIdentifier:)` call is required.

**Implication for Berean:** Snapshot the token at launch and register for
the change notification. On a detected change (different account, or
signed out — token nil), the cached container handle is stale: re-resolve
the container URL rather than continuing to read/write through a cached
path, or risk silently operating against the wrong account's (empty)
container — a correctness bug that looks like data loss to the user.

---

## 9. iCloud Drive disabled / quota exceeded

**Source:** No developer.apple.com primary-source sentence found on exact
quota-exceeded write behavior for the ubiquity container API — UNCONFIRMED
at the "what error is returned" level. Apple Support confirms storage limits
exist and prompts appear when a plan's quota is reached.

**Behavior (reasoned, not directly confirmed):** When quota is exceeded, new
uploads are expected to fail/stall — the local write still succeeds
on-disk (the container is a local folder), but `ubiquitousItemIsUploaded`
stays false and `ubiquitousItemUploadingError` should populate — rather than
silently truncating existing data. This is developer-forum consensus, not a
citable Apple sentence from this pass.

**Implication for Berean:** Journals for a quota-exceeded account can pile
up locally-only, never syncing — an unbounded version of §2's risk window.
Watch `ubiquitousItemUploadingError` and surface a "not syncing" warning
rather than assume eventual convergence. Follow-up read: the archived File
System Programming Guide's "Managing Ubiquitous Content" section.

---

## 10. Advanced Data Protection (ADP)

**Source:** Apple Support, "Advanced Data Protection for iCloud."

**Behavior:** With ADP on, protected categories rise "from 14 to 23,"
explicitly including **iCloud Drive** (plus iCloud Backup, Photos, Notes,
Reminders, Safari Bookmarks, Shortcuts, Voice Memos, Wallet passes,
Freeform). iCloud Drive covers "Pages, Keynote, and Numbers documents, PDFs,
Safari downloads, or any other files manually or automatically saved to
iCloud Drive." Excluded even under ADP: iCloud Mail, Contacts, Calendar.

**Implication for Berean:** The journal files fall under iCloud Drive, so
under ADP they're end-to-end encrypted — Apple cannot decrypt them and has
no server-side recovery path. This raises the stakes of Berean's own local
durability story: under ADP, losing all trusted devices/recovery contact can
mean truly unrecoverable data, with no Apple-side rescue, unlike non-ADP
accounts where Apple retains limited recovery ability for some categories.

---

## 11. Device backup/restore — stale SQLite snapshot after restore

**Source:** No developer.apple.com page states this scenario directly for
sandboxed SQLite stores; reasoned from established backup/restore mechanics
(Application Support is included in device backups) plus the
`identifierForVendor` findings below. Treat the SQLite-restore claim as
architecturally consistent but not directly cited.

**Behavior:** Restoring an iPhone/iPad backup, or a Mac's Application
Support folder via Time Machine/Migration Assistant, reinstates whatever
`berean.db` existed at backup time — potentially materially older than the
device's actual last-synced state. The local SQLite cache "jumps backward"
relative to the ubiquity container journals it may re-discover.

**Device identity:** Per Apple Developer Forums threads (/803718, /770432,
consistent with an Apple-engineering-acknowledged position referenced in
openradar #35746735): `identifierForVendor` is expected to persist across
ordinary backup/restore **to the same physical device** while vendor apps
stay installed, but is **not** guaranteed after restoring onto a
**different physical device** — and real-world reports show it can even
change on same-device restores in some iOS version combinations. Apple's
documented rule is that the OS regenerates the identifier when the last
vendor app is deleted and later reinstalled.

**Implication for Berean:** Two risks: (1) SQLite goes stale — a restore
silently rolls `berean.db` back; the merge must always reconcile against
ubiquity-container journals on next launch rather than trusting the local
cache (this research confirms why that reconciliation is load-bearing, not
optional). (2) deviceId stability — if the per-device folder name derives
from `identifierForVendor` or any OS identifier rather than a value Berean
generates and stores itself in berean.db, a restore can produce identity
drift: the same deviceId reappearing on a different device (§4's conflict
risk) or a device losing its identity and orphaning its own prior history.
**Recommendation: generate and store a random deviceId inside berean.db,
not derived from any Apple platform identifier**, so a restore either
carries the old id forward correctly (if the DB itself was restored) or
forces a deliberate "new device" decision — never a silent collision.

---

## 12. CloudKit concepts mapped to the file-journal design

| CloudKit concept | Source | Documented behavior | File-journal equivalent risk |
|---|---|---|---|
| `serverRecordChanged` / change tags | Standard CloudKit optimistic concurrency (`recordChangeTag`) | CloudKit rejects a save whose tag doesn't match the server's, returning the current record to merge. | Berean has no per-record tag; each device owning its own path avoids the "two writers race on one record" problem by construction — but any future feature where one device rewrites another's journal (e.g. compaction) would need an equivalent guard, which doesn't exist today. |
| Change tokens / `CKError.changeTokenExpired` | Apple Developer Docs, `CKError.Code.changeTokenExpired` | "An error that occurs when the change token expires... When a change token becomes too old or is no longer valid, CloudKit returns this error," requiring a full re-fetch. | Berean's per-device merge cursor is the change-token equivalent. If Berean ever prunes old journal files, a long-offline device with a cursor pointing past a pruned file hits the same failure class and needs a full-resync fallback, just as CloudKit clients implement for `changeTokenExpired`. |
| Zone reset / `CKError.userDeletedZone` | Apple Developer Docs, `CKError.Code.userDeletedZone` | "An error that occurs when the user deletes a record zone using the Settings app... rather than through your app's interface." | Direct analogue: a user manually deleting the app's iCloud Drive folder (§6) is exactly this — silent, out-of-app deletion of all sync state. Detect "container exists but my own device folder/manifest are gone" as distinct from first launch, and warn/rebuild rather than treat it as pristine. |
| Partial failure / `CKError.partialFailure` | Apple Developer Docs, `CKError.Code.partialFailure` | "...you should examine the specific item failures and act on the failed items" via `CKPartialErrorsByItemIDKey`. Also: "In a custom zone, the system processes all items in an operation atomically." | Multi-file updates (e.g. writing a new snapshot + updating manifest) aren't atomic across files the way a CloudKit zone operation is. A crash/eviction mid-update can leave the pair inconsistent — Berean must order such updates itself (write manifest last; manifest is sole source of truth for "current snapshot"). |
| Missed/coalesced push | General CloudKit silent-push behavior; UNCONFIRMED exact wording this pass | CloudKit silent pushes are widely documented as best-effort/coalescable, not guaranteed. | Berean has no push channel at all; NSMetadataQuery (foreground, §3) and on-launch/on-foreground reconciliation are the only "notification" mechanisms — these must be mandatory, not best-effort. |
| `CKAccountChanged` | Fetch attempt 404'd this pass | — | Not needed — §8's `ubiquityIdentityToken` / `NSUbiquityIdentityDidChangeNotification` is the correct, already-confirmed non-CloudKit primitive for account-change handling. |

---

## 13. SQLite durability specifics

**Source:** SQLite official docs (`sqlite.org/wal.html`,
`sqlite.org/pragma.html#pragma_integrity_check`); Apple QA1809 (archived,
Core Data-focused but describes the same underlying SQLite WAL mechanics
Berean's better-sqlite3 store shares).

**Crash/power-loss durability:** "syncing the content to the disk is not
required, as long as the application is willing to sacrifice durability
following a power loss or hard reboot. (Writers sync the WAL on every
transaction commit if PRAGMA synchronous is set to FULL but omit this sync
if PRAGMA synchronous is set to NORMAL.)" With `synchronous=NORMAL`, a
commit can be lost (rolled back cleanly, not corrupted) on power loss;
`FULL` is required for commit-durability across a hard crash.

**Copying a live WAL database without `-wal`:** "If a database file is
separated from its WAL file, then transactions that were previously
committed to the database might be lost, or the database file might become
corrupted. The only safe way to remove a WAL file is to open the database
... then immediately close [it]." QA1809, architecturally identical case:
"Simply making copies of the store file will likely cause data loss and
inconsistency... the transactions recorded in the missing -wal file will be
lost."

**Corruption via file protection while locked:** UNCONFIRMED — no citable
Apple sentence found this pass on iOS Data Protection classes interacting
with SQLite locking specifically. Commonly cited real-world failure mode
(app resumes as a file becomes inaccessible under `NSFileProtectionComplete`
mid-transaction); flagged as a follow-up read (Data Protection guide's File
Protection section) rather than asserted as documented fact.

**Integrity checking:** `PRAGMA integrity_check` does "a low-level
formatting and consistency check," covering out-of-sequence entries,
misformatted records, missing pages, index/constraint errors, freelist
integrity, and mis-used sections; returns `'ok'` if clean. `PRAGMA
quick_check` is "like integrity_check except that it does not verify UNIQUE
constraints and does not verify that index content matches table content,"
running in O(N) vs O(N log N) — cheaper, suitable for a startup check.

**Safe backup mechanisms:** SQLite's Online Backup API "copies the database
page by page through SQLite itself, WAL content included, and is safe to
run against a database that other connections are using." `VACUUM INTO`
"will make a vacuumed copy of a live SQLite database into a separate file"
(requires SQLite ≥ 3.27.0). Both are safe for concurrent use, unlike a raw
filesystem copy of `berean.db` alone.

**Implication for Berean:** (1) Run berean.db with `synchronous=FULL` given
this is study/notes data the user cares about, not disposable cache, or
consciously accept NORMAL's tradeoff. (2) Any export/backup feature that
copies `berean.db` off disk must use `VACUUM INTO`/the backup API, or
atomically include the sidecar `-wal`/`-shm` files — a raw `fs.copyFile`
while the app is running is a documented data-loss/corruption path. (3) A
cheap startup `PRAGMA quick_check`, escalating to full `integrity_check` on
suspicion (especially right after a restore, §11), is a well-documented,
worthwhile safety net.

---

## Summary of UNCONFIRMED items (not verified against an Apple source)

- NSMetadataQuery background-execution limitations — §3
- Uncoordinated `fs` access on macOS racing the iCloud sync daemon — §5
- Exact error/behavior when iCloud storage quota is exceeded mid-write — §9
- SQLite corruption via iOS file-protection-class transitions while locked — §13
- `CKAccountChanged` details (fetch 404'd; §8 covers the needed primitive) — §12
