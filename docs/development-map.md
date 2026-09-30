# Berean development map

A one-screen reminder of the two Berean apps and the commands that matter. Details: links at the end.

## Two apps, never mixed

```
  npm run dev · build:mas:dev · ios:archive:dev         installed Berean (DMG, App Store)
                    ↓                                               ↓
               Berean Dev                                         Berean
                    ↓                                               ↓
           com.berean.app.dev                                com.berean.app
                    ↓                                               ↓
        iCloud.com.berean.app.dev                        iCloud.com.berean.app
```

- They are separate **on purpose**, so development and testing can never touch your real data.
- Different bundle IDs → Berean Dev and Berean can be installed **side by side** on the same Mac or iPhone.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Live development app (Berean Dev) with hot reload. |
| `npm run build:mas:dev` | Packaged Berean Dev for the Mac → `release/mas-dev-arm64/Berean Dev.app`. |
| `npm run ios:archive:dev` | Berean Dev for the iPhone → `ios/App/build/Berean.xcarchive`. |
| `npm run build:mas` | Production Mac App Store build → `release/mas-arm64/Berean.app`. |
| `npm run ios:archive` | Production iPhone archive (TestFlight / App Store). |
| `npm run ios:bump-build` | Raise the iPhone build number — before every TestFlight upload. |
| `npm run tag:stable` | Start a release: asks for the version, commits CHANGELOG + `package.json`, tags and pushes. |

## Which app and data

| What I'm doing | Command / app | Identity | Local data | iCloud |
|---|---|---|---|---|
| Everyday coding | `npm run dev` | Berean Dev | `~/Library/Application Support/Berean-dev` | `iCloud.com.berean.app.dev` |
| Trying the packaged Mac dev app | `build:mas:dev` → Berean Dev.app | Berean Dev | its own sandbox (`~/Library/Containers/com.berean.app.dev`) | `iCloud.com.berean.app.dev` |
| Testing on the iPhone | `ios:archive:dev` → Berean Dev | Berean Dev | on the iPhone | `iCloud.com.berean.app.dev` |
| Using Berean for real | installed Berean | Berean | `~/Library/Application Support/Berean` | `iCloud.com.berean.app` |
| Mac App Store release | `build:mas` | Berean | its own sandbox | `iCloud.com.berean.app` |
| iPhone release | `ios:archive` | Berean | on the iPhone | `iCloud.com.berean.app` |

## ⚠️ Never mix identities

- **Dev** = `com.berean.app.dev` + `iCloud.com.berean.app.dev`. **Production** = `com.berean.app` + `iCloud.com.berean.app`.
- If sync pauses because this device's history isn't in the current container, **leave it paused** — never point it at the other identity's container.
- **A paused sync is always better than two datasets mixed together.**

## `npm run dev` vs `build:mas:dev`

- `npm run dev` = the live Electron development environment. `build:mas:dev` = a packaged Berean Dev app.
- Both are Berean Dev and use the same dev iCloud container — but each has **its own local database and its own device history**.
- So one of them pausing because its history isn't in the dev container is a **safety pause**. It does **not** mean it is using production iCloud.

## Production release

- `npm run tag:stable` bumps the version and pushes a tag; CI then builds the signed DMG for GitHub Releases (auto-update).
- It does **not** upload anything to Apple. Mac App Store and TestFlight builds come from `build:mas` / `ios:archive` and are uploaded separately.
- Production builds always use the production identity.

## Identities

| | Production | Development |
|---|---|---|
| App | Berean | Berean Dev |
| Bundle | `com.berean.app` | `com.berean.app.dev` |
| iCloud | `iCloud.com.berean.app` | `iCloud.com.berean.app.dev` |
| App Group | `group.com.berean.app` | `group.com.berean.app.dev` |
| URL schemes | `berean`, `berean-pdf` | `berean-dev`, `berean-dev-pdf` |

Source of truth: [`config/app-identity.json`](../config/app-identity.json).

## More detail

- [Dev vs production policy](mobile/icloud-lifecycle.md) — §6
- [Mac App Store builds](mac-app-store.md) — §10 is Berean Dev
- [iPhone builds](mobile/ios-build.md) · [TestFlight](mobile/testflight.md)
- [How iCloud sync works](mobile/icloud.md) · [Data safety](mobile/data-safety.md)
