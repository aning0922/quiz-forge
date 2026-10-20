# Draft summary capture readiness

The first production run at root `7ebfca5` failed after the current draft summary link appeared: measured page height 2601, full-page PNG height 3262. The summary mounts `RevisionHistoryPanel`, which independently fetches its fixed history page. The visible summary link does not establish that this child has finished. The preserved production PNG contains the history row, so the old measurement happened before the additional 661 px rendered. This page uses system fonts and has no downloaded font face.

`studio-drafts.visual.ts` now waits for this fixture's actual revision-1 history row, no history loading status, and the enabled history-refresh control before starting `draft-summary` capture. It awaits `document.fonts.ready` at each viewport, disables screenshot animations, and retains the strict PNG-height assertion. It additionally checks page height after capture equals the prior height, and PNG width equals the requested width. No generic network-idle wait, guessed sleep, relaxed comparison or production UI change is used. A history error is not accepted as a ready full summary.

Reproduce without DB, Next, 3100 or the retained failed instance:

```sh
pnpm exec tsx tests/browser/studio-drafts-capture.ts
```

This focused Chromium probe uses the actual `DraftWorkspacePage`, nested history component and HTTP reading clients, with controlled synthetic HTTP on an exclusive ephemeral loopback port. Its exact old helper is read from Git object `7ebfca5` (required locally). The negative control releases the held history response between the old measurement and the actual screenshot, reproducing **2601 → 3262** and the strict old assertion failure. The new helper waits for the real row and passes all four widths. A separate failed history response rejects capture with zero screenshots. The standalone esbuild probe substitutes only the uncalled `node:util` proxy-detection import from the legacy limits module; any attempt to invoke that policy branch throws. Production code/Next configuration is not edited or polyfilled.

Evidence: `.cache/p4-drafts-capture/1792348073835/result.json`, negative PNG, four fixed PNGs, and `history-bottom-qa.png`. Chromium 156.0.8078.4; 320/375/390/430 × 900 CSS px. Fixed PNG heights 3262/2877/2937/2631 all exactly equal both page measurements. The four final history portions were viewed at original resolution and include their last row/footer without cropping. Scoped lint, formatting and complete typecheck passed. This reproduces and checks the UI timing boundary; it is **not** a rerun of the real PG/production E2E. Root must rerun that suite on its own newly prepared instance and confirm the actual outcome; 027 remains stopped and preserved.

## Read-only empty validation detail (second production failure)

Root `8c5e9ea` failed earlier in `read-only-empty`: pre-capture height 2535 and post-capture height 2510. This route is `ValidationDetailPage`, not the summary workspace. It independently mounts `AppendRevisionPanel` and, after validation metadata arrives, `ApplyDraftPanel`; each makes its own draft and Product reads. The first panel's static read-only notice/link can be visible before these reads and local pending initialization finish. Completing a late first-panel read removes its loading paragraph; completing the append Product read also removes a loading paragraph. Per-section metrics demonstrate the ~25.59 px reduction. The preserved production artifacts do not identify which of those requests finished at that exact moment, so the fix covers both independent readers.

`waitForEmptyDraftSource` checks the initial healthy empty source semantically: first-panel refresh enabled, loading/error absent; append empty fact visible, loading/error absent, local preparation no longer unavailable; local append-pending read explicitly empty. `read-only-empty` uses it before capture. The intentional UNKNOWN case also uses it **before** submitting the write, so later UNKNOWN/error messages and original anchors remain screenshot-able; it never waits for a write to become successful. The other two workspace captures (`archived-receipt`, `read-only-unknown`) also include the same independent revision history and now reuse the fixed history readiness. Fixed revision-body capture already waits for its sole body read and is unchanged. No production source or frozen implementation bytes changed; no global status drain or network-idle condition was added.

Run the new specific controlled case with:

```sh
pnpm exec tsx tests/browser/studio-drafts-capture.ts --empty-probe
```

It uses the actual validation-detail page/read clients on a random exclusive loopback port. It holds each of the four independent reads in turn, then releases it only after the actual PNG has been taken and before the exact `903a462` helper's after-height assertion. Three cases reproduce **2535 PNG/pre-height → 2510 after-height**; the append draft read separately demonstrates an increase **2484 → 2510**. All four old cases reject. While the response remains held, screenshot `animations:disabled` leaves height unchanged; font faces=0, font status=loaded, animations=0, and innerWidth/clientWidth=320 before/after. The probe's heading reset matches the actual Tailwind preflight in root's built CSS, avoiding native h3 metrics from being mistaken for this race.

After the fix, all four held-reader cases pass four widths with strict pre-height=post-height=PNG height and PNG width=viewport. Two read-error cases reject with zero screenshots. An actual workspace with an existing read-only pending anchor also captures four widths without clearing/replacing it or issuing any POST. Evidence: `.cache/p4-drafts-capture/1792481996776/result.json`, negative PNGs, 16 fixed empty PNGs, four pending PNGs and `empty-bottom-qa.png`. Four final empty-state panel portions were read at original resolution. Scoped lint/formatting and complete typecheck passed. No DB, 3100 or Next was started; 25de/027 remain stopped and preserved. This is not a replacement for root's next full production E2E run.
