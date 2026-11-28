# Getting Started checklist (U15) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; iPhone VERIFIED (sim); Mac built.**

- Port of `TasksPanel.tsx`: the same 22 tasks in 8 groups (First Steps … Advanced). Progress uses the original's persisted `completedStepIds` setting with the original `"<task>:<step>"` keys (a task is done when all its steps are), so a future sync agrees with the old apps.
- Native detection when the checklist opens: Bible tab (open-passage), non-KJV text (change-translation), Strong's shown, Back available (history), Lexicon tab (lexicon + Strong's lookup), Compare, Compare + study panel, study panel, Search tab, Strong's search, YouTube video, more than one session, verse note, general note, Welcome note opened, any highlight. The rest (PiP, new window, cross-references, settings, vault) are marked by hand — swipe (iPhone) or right-click (Mac) → Mark as Done / Not Done.
- Not shown automatically (the original's floating panel); open it from Mac Go → Getting Started Checklist, iPhone More → Study Tools → Getting Started, or Settings → About → Getting Started Checklist… (both). This complements Replay Getting Started (onboarding).
- Vault task explains it isn't available yet (vault sync not ported).
- Verified on sim: 3 of 22 detected on open; swipe → Done stored `enable-strongs:bible`, `enable-strongs:toggle`; bug found & fixed — rows didn't redraw after a mark (read through an untracked function); now computed once per body.
