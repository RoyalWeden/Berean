// ── YouTube API key ───────────────────────────────────────────────────────────
// Copy this file to youtube-key.ts and fill in your key.
// youtube-key.ts is listed in .gitignore — never commit the real key.
//
// Get a key at: https://console.cloud.google.com/
//   APIs & Services → Credentials → Create Credentials → API key
//   Enable: YouTube Data API v3
//
// For CI (GitHub Actions), add YOUTUBE_API_KEY as a repository secret:
//   github.com/RoyalWeden/Berean → Settings → Secrets → Actions → New secret
//
// The app runs without a key — YouTube sync/playlist features simply return
// { error: 'no API key' } gracefully when the key is missing or empty.

export const YOUTUBE_API_KEY = ''
