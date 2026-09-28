# Service Extraction Guide (Phase 1/3)

How an `electron/ipc/<domain>.ts` handler module becomes a shared service in
`src/platform/services/<domain>Service.ts` plus a thin IPC delegate. The reference conversion is
`electron/ipc/bible.ts` → `src/platform/services/bibleService.ts` (+ its contract test). Copy that
pattern exactly.

## Rules

1. **SQL is moved verbatim.** Same strings, same column lists, same `ORDER BY`/`LIMIT`, same
   `INSERT OR IGNORE`/`OR REPLACE`. Do not "improve" queries. If a query is built dynamically,
   keep the builder logic. Use `placeholders(n)` from `DatabaseAdapter.ts` for `IN (...)` lists.
2. **Result shapes are unchanged.** Whatever the IPC handler returned (row objects, `{ success:
   true }`, `null`, arrays) the service returns identically, so `src/types/electron.d.ts` and every
   renderer call site keep working. Preserve `?? null` / `?? []` conventions.
3. **Async mechanics.**
   - `db.prepare(sql).all(a, b)` → `await db.all<T>(sql, [a, b])`
   - `db.prepare(sql).get(a)` → `await db.get<T>(sql, [a])`
   - `db.prepare(sql).run(a)` → `await db.run(sql, [a])` (returns `{ changes, lastInsertRowid }`)
   - `db.exec(sql)` → `await db.exec(sql)`
   - `db.transaction(() => { … })()` → `await db.transaction(async (tx) => { … })` and every
     statement inside uses `tx`, not `db`. Only await `tx.*` inside the callback (no other awaits).
   - Reused prepared statements (`const upd = db.prepare(...)` then `upd.run()` in a loop) → call
     `tx.run(sql, params)` in the loop; the adapter caches statements by SQL text.
   - `.pluck()` / `.raw()` / `.iterate()` are not used in the codebase; if you meet one, stop and report.
4. **No Node, no Electron.** Services import only from `src/**`. `randomUUID` → `ctx.uuid()`;
   `Date.now()` → `ctx.now()`; `is.dev` → `ctx.isDev`; `console.*`/`log.*` → `ctx.log.*`.
   Shared helpers already in `src/lib` (e.g. `numberWords`, `translationChapterMap`, `parseRef`)
   are imported from there, never from `electron/`.
5. **Databases come from the context.** `getBereanDb()` → `ctx.userDb`; `getTextDb(id)` →
   `await ctx.textDb(id)` (may be null); `getHebrewDb()`/`getGreekDb()` → `await ctx.lexiconDb('H'|'G')`;
   a module that opened its own `new Database(<data/x.db>)` → `await ctx.dataDb('cross_references' | 'tske_refs')`.
6. **Side effects that are not DB logic stay in the Electron handler**, wrapped around the
   service call: `BrowserWindow.getAllWindows()` broadcasts (now: `ctx.events.emit('data:changed', …)`
   in the service; electron/servicesHost.ts turns that into `notes:changed`/`studyTrail:dataChanged`
   for other windows), vault file operations (`moveNoteToVaultTrash` etc.), dialogs, `fs`.
   For every mutating method the service emits `ctx.events.emit('data:changed', { entity, id, op })`
   with `entity` from docs/mobile/icloud.md §5 naming (`note`, `note_folder`, `note_version`,
   `highlight`, `verse_tag`, `verse_tag_member`, `tag_edge`, `workspace`, `playlist`,
   `playlist_item`, `history`, `setting`, `trail_session`, `trail_node`, `trail_connection`,
   `trail_note`, `trail_tag`, `trail_collapse`, `pdf`, `pdf_highlight`, `youtube_user`, `ai_chat`).
7. **The IPC handler becomes one line per channel**: `ipcMain.handle('x:y', (e, ...args) =>
   withSender(e.sender.id, () => services().x.y(...args)))` — `withSender` only where the old
   handler excluded the sender from a broadcast; plain `services().x.y(...)` otherwise. Keep the
   channel names, argument order and defaults exactly. Keep any `try/catch` → return-shape the old
   handler had (e.g. returning `{ success: false, error }`).
8. **Sync exports used by desktop-only modules** (`aiLookup.ts`, `bgImport.ts`, `eSwordImport.ts`,
   `vault.ts`) keep working: leave the old synchronous helper functions in the electron file with a
   `/** @deprecated — desktop-only sync path, removed when <consumer> goes async */` comment. Do not
   convert their consumers in this lane. Do not leave *handlers* on the old code.
9. **Contract test per service** in `src/platform/services/__tests__/<domain>Service.contract.test.ts`
   using `makeContext()` / `memoryDb()` / `fixtureTextDb()` / `realDataDb()` from
   `src/platform/db/__tests__/testDb.ts`. For user-DB services, create the tables the service needs
   with the exact `CREATE TABLE` SQL from `electron/db/berean.ts` (copy the statements for those
   tables into the test's `beforeAll` — the shared migration runner arrives in a later lane).
   Cover every public method at least once, including the empty/null paths and one transaction
   rollback where the old code used `db.transaction`.
10. **Verification before you report:** `npm run typecheck` (must be clean), `npx vitest run
    src/platform electron/ipc/__tests__` (must be green — the existing electron tests mock the old
    `../../db/*` modules and must still pass; if one breaks because it imported a sync helper you
    removed, restore the helper), and `npx vitest run` in full at the end of your lane.

## What the service module looks like

```ts
import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

export interface HighlightRow { /* exact DB row shape */ }

export function createHighlightsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function getChapter(bookId: string, chapter: number, textId = 'kjva') { /* verbatim SQL */ }
  async function toggle(params: ToggleParams) {
    return db().transaction(async (tx) => { /* … */ })
    // then: ctx.events.emit('data:changed', { entity: 'highlight', id, op: 'upsert' })
  }
  return { getChapter, toggle, remove }
}
export type HighlightsService = ReturnType<typeof createHighlightsService>
```

Export row/param types the IPC file needs. Keep JSDoc comments from the original next to the code
they describe (they carry bug history).
