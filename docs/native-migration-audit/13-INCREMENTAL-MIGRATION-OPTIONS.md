# 13 — Incremental Migration Options

This compares strategies. It recommends one. **It authorises nothing.** The migration starts only after external review of this audit.

Labels: VERIFIED, INFERRED, UNVERIFIED, BLOCKED. Effort is given only as relative size: no calendar estimate would be honest before the investigations in section 6.

## 1. The facts that decide this

| Fact | Consequence | Source | Label |
|---|---|---|---|
| The iPhone app is already a Swift app hosting a web view, with Swift SQLite, iCloud and ONNX plugins | Screen-by-screen replacement is physically possible on iPhone, and much of the platform layer exists | 02, 09 | VERIFIED |
| The Mac app is Electron: Node main process, 295 IPC channels | No native view can live inside it. There is no gradual path inside the Electron process | 02 | VERIFIED |
| All user state is one SQLite file plus files, not a proprietary store | A native app can open the same database | 04 | VERIFIED |
| Sync is a JSONL journal in iCloud Documents, not CloudKit | Native apps can join the same sync, and old and new devices can coexist, if they are byte-compatible | 05 | VERIFIED |
| Hash drift or cleared bookkeeping makes sync revert edits or resurrect purged notes | Sync compatibility is the most dangerous contract in the project | 05 S1, S2 | VERIFIED (harness) |
| A device that sees a higher schema stops pulling from that peer | Native can't raise the schema during coexistence | 05 S6 | VERIFIED (harness) |
| DMG and MAS share a bundle ID but not a data location | The Mac route depends on distribution, and DMG to sandboxed native needs user consent or an export | 04 §11.2 | VERIFIED |
| `localStorage` holds user-authored settings not in the database | A bridge release of the old apps is needed before the switch | 04 §11.4 | VERIFIED |
| The editor and Read Aloud have no off-the-shelf native equivalent | They need proof by experiment before the plan can be trusted | 09 | INFERRED |
| The data and domain logic is well tested in TypeScript (see 01 for the test count at the final baseline) | That code can generate golden data, so a Swift port can be checked mechanically | 11 | VERIFIED |
| One developer maintains everything | Long dual maintenance is itself a major risk | Repository history | VERIFIED |

## 2. The options

### A. Parallel native apps sharing existing data, built bottom-up

Build a shared Swift package first and prove it against golden data generated from the TypeScript code. Build new native apps beside the existing ones, under Berean Dev identities, opening copies of real databases. Keep the on-disk and sync formats byte-compatible. Ship a native app under the same bundle ID only when it reaches parity, on a platform-by-platform schedule.

### B. Native Mac shell with temporary legacy modules

A SwiftUI and AppKit app hosts existing React screens in `WKWebView`, replacing them one at a time. The Electron main process has to be reimplemented first: every one of those 295 channels needs a Swift equivalent before the first screen works.

### C. Feature-by-feature replacement inside the current apps

On iPhone, a native screen replaces a web screen inside the same app. On Mac this is impossible (see section 1).

### D. Shared Swift domain layer first, adopted by the current apps

Move logic into Swift and have the existing apps call it. The iPhone could, through a plugin. Electron could only through a Node addon, adding a third runtime for a period, and the code would be replaced again later.

### E. Persistence first, then presentation

Build the Swift persistence and sync layer, deploy it in the shipping apps, then build UI on it. This puts the highest-risk layer into production before there is any native app to benefit from it.

### F. One-shot rewrite and switch

Build everything, then replace the apps at once. Rejected for reasons in section 3.

### G. Permanent WebKit wrapper

Excluded by the brief: it isn't native. Listed so nobody arrives at it by drifting.

## 3. Comparison

| | Feasible | Complexity | Data safety | Testable | Rollback | Temporary duplication | Long-term cost | Cross-platform |
|---|---|---|---|---|---|---|---|---|
| **A. Parallel, bottom-up** | Yes | High, but staged | **Best**: no real data until proven | **Best**: golden data at every layer | **Best**: old apps untouched until the switch | Largest: two apps maintained | Lowest once done | Shared package serves both |
| **B. Mac shell + WebKit** | Yes, costly | Very high: bridge plus UI | Medium: two writers in one process | Medium | Medium | High, and adds a bridge that's discarded | Risk it never ends | Mac only |
| **C. Screen by screen** | iPhone only | Medium per screen | Medium: JS and Swift writers share the database | Good per screen | Good until data formats move | Each screen is in two stacks for a time | Fine on iPhone | Can't help the Mac |
| **D. Swift domain inside old apps** | iPhone yes, Mac awkward | High | Medium | Good | Medium | Adds a runtime | Throwaway Mac glue | Uneven |
| **E. Persistence first in production** | Yes | High | **Worst**: new sync code on real data with no user benefit | Good | Poor: a bad write syncs everywhere | Low | Fine | Shared |
| **F. Big bang** | Technically | Highest in one step | Poor: everything at once | Poor until the end | Poor | None until release | Fine if it ever ships | Shared |

Data safety decides this. Sync spreads a mistake to every device, so the question is how long a new writer can be kept away from real data while still being tested. Option A keeps it away longest.

## 4. Recommendation (subject to external review)

**Option A, with one borrowing from C.**

**Build:** one Xcode project, two app targets, one shared Swift package, bottom-up in the order in 08 §14. Everything is proved against TypeScript-generated golden data before any UI depends on it.

**Rules that make it safe:**

1. **Old apps first.** Sync defects are fixed before anything else (done for D1-D4 at audit time).
2. **Read before write.** The native layer opens copies read-only until conformance suites pass.
3. **Identity discipline.** Development uses Berean Dev identities and containers. Production identities are touched only at release.
4. **Formats are frozen during coexistence.** Same schema, same hashes, same journal, additive changes only, and old apps must tolerate them.
5. **No native writer on real data or a real sync folder until interoperability tests pass** on a simulated store, then on the Dev container.
6. **A bridge release of the old apps comes first.** It writes `localStorage` to a file, and on Mac offers an export bundle.
7. **Keep the old apps installable and their data untouched** until native has run successfully. Nothing is moved.

**Sync engine, reuse or port:** running the existing TypeScript engine in JavaScriptCore inside the native app has the lowest semantic risk during coexistence (05 §13, 08 §11.4). That would be a temporary JavaScript runtime, acceptable only with a defined removal point. A Swift port must match hashes exactly. The reviewer should decide; see 15.

**Which platform first** is a decision for after the investigations. Arguments, for the reviewer:

- *iPhone first:* the bundle ID and container continue with no access problem, Swift plumbing already exists, and users gain most from dropping the web view on a phone. The risk is that App Store rollback is limited to shipping a newer build.
- *Mac first:* it's the primary study tool, and the app that benefits most from losing Electron (357-364 MB across four processes, measured). The risks are the DMG-versus-MAS split and the fact that the workspace UI is the larger job.

**The borrowing from C:** if the native Mac app takes long, individual iPhone screens could be replaced natively inside the shipping app to deliver value early. Worth considering only for read-only surfaces. It should not delay the shared package.

**Temporary WebKit:** only two uses are justified, each with a removal plan:

| Use | Why | Removal |
|---|---|---|
| YouTube playback | Third-party web content. Likely permanent, and allowed by the brief | Not applicable |
| Notes editor, only if the native editor misses its gates | Protects note fidelity while the native editor matures | Must carry an end date and a native gate in the plan. Not a default |

## 5. What would change this recommendation

| If this is found | Then |
|---|---|
| A Swift Markdown engine can't reach byte stability on real notes | Rework the editor plan first, because it's the largest item |
| Kokoro on a real iPhone is too slow or too hot | Revisit Read Aloud before committing iPhone-first |
| Most Mac users are on DMG and can't be moved cleanly | Consider a non-sandboxed Developer ID native build first |
| Install data says the OS floor can be higher | Simplifies the editor and UI choices |
| Windows users matter | Then Electron can't be retired, and the plan needs a position on that |

## 6. Investigations to run before the plan is finalised

These are experiments, not implementation. Details in 15 and 16.

1. Golden corpus generator from TypeScript: hashes, journal ops, references, Markdown.
2. Structural scan of real notes, by a tool that prints no content.
3. Highlight offset sweep over real data.
4. Kokoro on a physical iPhone: speed, memory, heat, locked screen.
5. Text editor spike: long note, tables, selection, on TextKit 2.
6. Legal review of eSpeak NG in the shipped apps.
