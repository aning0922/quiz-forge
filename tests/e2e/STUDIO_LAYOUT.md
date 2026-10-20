# Coherent Studio visual measurements

Root production E2E `9986afc` failed at P3D's `r3-confirmed-fixed-receipt` screenshot, after the writer had received the real 201/r3 receipt. `AppendRevisionPanel` independently refreshes its current-base facts after showing the immutable receipt; this removes/replaces paragraphs. The old helper did `.all() → isVisible() → evaluate(getComputedStyle)` across browser calls and received NaN. This is distinct from the prior summary-history and empty-source height races.

Playwright 1.64's local `Locator.evaluate` implementation first resolves an ElementHandle with `waitForSelector(state: attached)` and then invokes its evaluation. A node can detach between those operations. The real Chromium counterexample in `tests/browser/studio-layout.ts` completes a DOM replacement at that exact handoff, delegates to the original ElementHandle evaluation, and observes `isConnected=false`, native `getComputedStyle(...).fontSize=""`, and `parseFloat=NaN`. It never fabricates the computed style/NaN, and restores the temporary isolated-test method hook before testing the fix. The production failure did not record its node's connected flag; the controlled probe demonstrates the same failure mechanism supported by the actual refresh lifecycle.

`sampleStudioLayout` queries the document and collects visibility, fonts, target dimensions, receipt/link positions and optional overlay order in one synchronous browser evaluate. There is no await or retained node handle in that browser turn; only numeric evidence crosses back to Node. Unexpected detached nodes fail, and finite-number assertions still reject NaN. `assertStudioLayout` retains font ≥16 px, target height ≥44 px, consumer target width ≥44 px, receipt clear/link gap ≥16 px, and badge-above-caption order. Missing/duplicate required clear controls or overlays reject. Visible `display:contents` paragraph text retains a Range-based font check.

Caller scopes remain explicit:

| Caller                | Font scope                                   | Target scope                                | Additional existing check                                                 |
| --------------------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| P3D revisions         | visible `main p`                             | `main button/a/select/summary`, height 44   | applied receipt gap 16                                                    |
| P3E internal versions | visible `main p/pre/dd`                      | same native targets, height 44              | existing full PNG assertions                                              |
| P3C preview           | visible `[data-preview-state] p`             | page role-buttons, height 44                | approval badge above scene caption                                        |
| Consumer              | no added font rule                           | `main button/a/select`, width and height 44 | raw-token DOM guard unchanged                                             |
| Drafts                | the `main` wrapper, font 16                  | page role-buttons, height 44                | prior semantic readiness and strict before/after/PNG dimensions unchanged |
| Validations           | the named validation region wrapper, font 16 | only that region's role-buttons, height 44  | region accessible-name/uniqueness retained                                |

The role-button call sites use their existing native button/input and explicit button-role controls, exclude role overrides and ARIA-hidden/inert ancestors, and are checked against Playwright's actual role-button result in the controlled fixture. Selectors outside each caller's scope are not silently added to its font policy. No live text, credentials, answers or URLs are returned by the sampler. Existing scrolling, screenshot filenames, viewport matrix and complete-image assertions are unchanged.

The specific r3 writer screenshot also waits for its actual current-base revision-3 heading, the end of that reader's loading paragraph, and completion of the local pending read. This does not change the immutable receipt, the other tab's old history anchor, or the original spare request. Earlier test-side semantic waits remain intact; UNKNOWN and error snapshots are not globally drained or forced to succeed. There is no arbitrary sleep, global network-idle condition or retry-until-green.

Run the bounded browser proof without DB, HTTP, Next or 3100:

```sh
pnpm exec tsx tests/browser/studio-layout.ts
```

Evidence: `.cache/p4-studio-layout/1792483744327/result.json` (Chromium 156.0.8078.4). The actual detached-node counterexample fails the old loop; the fresh 16 px paragraph passes the new sampler. A 16/44/16 baseline passes; 15 px text, 43 px target height, 15 px receipt gap, NaN, 15 px P3E `dd`, preview overlay overlap, and 43 px consumer width all reject. Scoped preview/validation fonts and six native/explicit role-button targets match their expected scope. Scoped lint, formatting and full typecheck pass. This is a controlled DOM/layout regression proof, **not** the next actual PG/production E2E. No production source, frozen implementation, runner or retained stopped instance was changed; root must run and report the next complete production suite separately.

## Visibility scope correction after independent review

Independent review found that `089570f`'s CSS visibility plus nonzero rectangle admitted descendants of closed `<details>`. In real Chromium, the visible paragraph/closed paragraph/hidden paragraph fixture returned Playwright visibility `[true,false,false]`, while that first sampler incorrectly collected fonts `[16,15]`; hidden 43 px buttons were admitted by both native-target and role-button modes. This was a test scope regression, not a production UI defect.

The synchronous sampler now uses native `Element.checkVisibility()` followed by computed visibility and nonempty rectangle, matching the installed Chromium Playwright normal-element rule. Native defaults are intentional: opacity and offscreen content-visibility:auto policy are not newly added restrictions. `display:contents` has no own box, so it checks individual child elements/text ranges, guards closed details and content-visibility:hidden ancestors, and does not count hidden child text. The same visibility method is used for fonts, targets, receipt clear/link positions and overlay rectangles. Querying and measuring still occur in one synchronous evaluate; no cross-call handles, numeric coercion, retries or changed thresholds were added.

Correction evidence: `.cache/p4-studio-layout/1792484308063/result.json` (Chromium 156.0.8078.4). The extended browser proof matches Playwright/native visibility `[true,false,false,false,false]` for normal paragraphs; native targets contain only the visible 44 px summary/button, and role targets match the one visible Playwright button. Direct/nested visible contents text at 15 px still rejects; visible child content at 16 px passes; closed/hidden contents text is excluded. Hidden duplicate clear controls and links do not alter the visible receipt, a receipt with only hidden clear controls rejects, and a hidden required overlay rejects. All previous detach/numeric/scope probes still pass. Scoped lint, formatting and full typecheck pass. This bounded DOM proof does not replace root's forthcoming production E2E or visual acceptance.
