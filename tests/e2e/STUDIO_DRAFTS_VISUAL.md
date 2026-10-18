# Draft summary capture readiness

The first production run at root `7ebfca5` failed after the current draft summary link appeared: measured page height 2601, full-page PNG height 3262. The summary mounts `RevisionHistoryPanel`, which independently fetches its fixed history page. The visible summary link does not establish that this child has finished. The preserved production PNG contains the history row, so the old measurement happened before the additional 661 px rendered. This page uses system fonts and has no downloaded font face.

`studio-drafts.visual.ts` now waits for this fixture's actual revision-1 history row, no history loading status, and the enabled history-refresh control before starting `draft-summary` capture. It awaits `document.fonts.ready` at each viewport, disables screenshot animations, and retains the strict PNG-height assertion. It additionally checks page height after capture equals the prior height, and PNG width equals the requested width. No generic network-idle wait, guessed sleep, relaxed comparison or production UI change is used. A history error is not accepted as a ready full summary.

Reproduce without DB, Next, 3100 or the retained failed instance:

```sh
pnpm exec tsx tests/browser/studio-drafts-capture.ts
```

This focused Chromium probe uses the actual `DraftWorkspacePage`, nested history component and HTTP reading clients, with controlled synthetic HTTP on an exclusive ephemeral loopback port. Its exact old helper is read from Git object `7ebfca5` (required locally). The negative control releases the held history response between the old measurement and the actual screenshot, reproducing **2601 → 3262** and the strict old assertion failure. The new helper waits for the real row and passes all four widths. A separate failed history response rejects capture with zero screenshots. The standalone esbuild probe substitutes only the uncalled `node:util` proxy-detection import from the legacy limits module; any attempt to invoke that policy branch throws. Production code/Next configuration is not edited or polyfilled.

Evidence: `.cache/p4-drafts-capture/1792348073835/result.json`, negative PNG, four fixed PNGs, and `history-bottom-qa.png`. Chromium 156.0.8078.4; 320/375/390/430 × 900 CSS px. Fixed PNG heights 3262/2877/2937/2631 all exactly equal both page measurements. The four final history portions were viewed at original resolution and include their last row/footer without cropping. Scoped lint, formatting and complete typecheck passed. This reproduces and checks the UI timing boundary; it is **not** a rerun of the real PG/production E2E. Root must rerun that suite on its own newly prepared instance and confirm the actual outcome; 027 remains stopped and preserved.
