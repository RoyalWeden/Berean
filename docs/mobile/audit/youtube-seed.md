# Audit — `data/youtube_seed.db` (developer decision Q3)

Measured 2026-09-21 on the seed shipped with desktop 0.6.19 (`SEED_VERSION = 2`).

## Size

| Table / index | Rows | Bytes (dbstat) | Share |
|---|---|---|---|
| `youtube_transcript_segments` | 2,700,386 | 189,394,944 | 96.4 % |
| `youtube_videos` (+ `idx_yt_published`, `idx_yt_handle`) | 11,097 | 6,684,672 | 3.4 % |
| `youtube_transcripts` (+ autoindex) | 5,977 | 389,120 | 0.2 % |
| `youtube_sync` | 62 | 12,288 | — |
| **File** | | **196,485,120** | |

Segments: average text length 34 chars, max 139; every one of the 5,977 transcripts is
`lang = 'en'`, `source = 'tactiq'`, `error IS NULL`. Videos per channel: top five 1,001 / 1,000 /
1,000 / 948 / 509; 62 channels in total.

## How the seed is used today (desktop)

- `electron/db/berean.ts` `mergeYouTubeSeed`: once per `SEED_VERSION` (setting
  `youtubeSeedVersion`), ATTACHes the seed and `INSERT OR IGNORE`s all four tables into
  `berean.db`; the FTS5 index `youtube_transcripts_fts` (external content, triggers) is filled by
  the segment inserts. berean.db therefore grows by ~190 MB + FTS on first launch.
- Reads (shared `youtubeService`): `loadAll` (videos), `getTranscript(videoId)` (segments by
  video, ordered by `start_ms`), `getTranscriptStatus` (which videos have transcripts),
  `searchTranscripts` (FTS5 `MATCH` grouped by video). Stars / positions are user data
  (`youtube_user`, synced — see `icloud.md` §5).
- Writes: `youtube:fetchTranscripts` / `clearTranscripts` / `buildSeed` are **dev-only**
  (`is.dev` guard — preserved on every platform, R143); production never fetches.

## Decision (D-007) and artefacts

`scripts/data/split-youtube-seed.mjs` derives from the seed, without touching it:

| Artefact | Content | Size | Ships how |
|---|---|---|---|
| `data/youtube_index.db` | `youtube_videos`, `youtube_sync`, `youtube_transcripts` (metadata), `meta(seed_version, generated_at)` | ~7 MB | bundled in the iOS app (`scripts/ios/bundled-dbs.txt`), merged into berean.db on first launch like desktop's seed |
| `data/youtube_transcripts/<handle>.db` × 62 | that channel's `youtube_transcripts` + `youtube_transcript_segments` (+ index on `video_id, start_ms`), `meta` | 0.2–19 MB each, ~190 MB total | release assets; downloaded per channel on demand (Phase 17), sha256-verified, merged into berean.db |
| `data/youtube_transcripts/manifest.json` | `format`, `seedVersion`, `index {bytes, sha256}`, `packs[] {channelHandle, channelName, file, bytes, sha256, videos, segments}` | 12 KB | bundled with the app **and** published next to the packs (the app compares versions) |

Desktop is unchanged. Everything under `data/youtube_transcripts/` and `data/youtube_index.db`
is generated (gitignored with the other `data/*.db`); regenerate after `youtube:buildSeed`.
