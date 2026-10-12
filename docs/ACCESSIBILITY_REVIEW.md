# Accessibility and responsive visual review

> Last reviewed: 2026-10-12
>
> Scope: the private account-access screen and authenticated Projects, Goals & Milestones workspace.
>
> Status: automated keyboard, semantic, Axe, responsive-layout, and visual-regression checks are implemented and pass both locally and in GitHub-hosted Chromium CI (run `38249868995`). A human screen-reader walkthrough remains **Blocked** in this sandbox because it does not provide NVDA, VoiceOver, TalkBack, or an equivalent assistive-technology environment.

## What is covered automatically

`e2e/accessibility-visual.spec.ts` uses the same isolated API, Vite server, and temporary SQLite database as the browser workflow. It verifies:

- correct account-mode tab semantics, roving keyboard behavior, selected state, and the linked tab panel;
- desktop (`1440×960`) and small-phone (`390×844`) layouts without horizontal overflow;
- the mobile navigation landmark and desktop-rail visibility boundary;
- focus entry, tab wrapping, Escape dismissal, and focus return for quick capture; the task editor shares the same focus-management hook and is exercised by the authenticated workflow;
- Axe scans of populated Goals & Milestones at desktop and mobile widths;
- six checked-in Chromium screenshots, covering account access plus the populated goals surface and goal card at both breakpoints.

Visual snapshot paths are deliberately versioned rather than ignored:

```text
e2e/__visual-baselines__/accessibility-visual.spec/
├── auth-desktop.png
├── auth-mobile.png
├── goals-desktop-top.png
├── goals-card-desktop.png
├── goals-mobile-top.png
└── goals-card-mobile.png
```

The browser job compares these images on every pull request and push. GitHub Actions run `38249868995` installed clean Chromium and passed all four browser tests, including these comparisons. Only refresh a baseline after reviewing the intended visual change:

```bash
npm run test:e2e -- e2e/accessibility-visual.spec.ts --update-snapshots
```

Never use a baseline refresh to hide an unintended regression. The normal test command must pass without the update flag before a change is described as visually verified.

## Findings addressed in this review

| Finding                                                                                                                                                        | Resolution                                                                                                                                                 | Verification                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The mobile header intentionally hides the visible word “Capture,” leaving an icon-only control without a reliable accessible name.                             | The authenticated-shell capture control now has the explicit name **“Capture a task.”**                                                                    | Mobile Axe scan passes; the responsive test invokes the named control.                                         |
| The account mode control exposed `tab` roles without tab-to-panel relationships, roving tab stops, or arrow-key behavior.                                      | It now supplies tab-specific panel IDs, `aria-controls`, paired `aria-labelledby`, selected state, and wraparound Arrow/Home/End navigation.               | Keyboard test asserts the semantic state and focus movement.                                                   |
| Quick capture and task-editor dialogs relied on browser focus behavior; focus could leave the dialog and was not guaranteed to return to the invoking control. | `useDialogFocus` gives both dialogs a deliberate initial focus target, traps Tab/Shift+Tab, supports Escape when not busy, and restores the prior trigger. | Responsive test exercises quick capture; authenticated workflow verifies task-editor initial and return focus. |
| Mobile navigation labels were visually too small for a six-item touch navigation surface.                                                                      | The label size was increased from `8px` to `10px` while retaining 45px minimum item height.                                                                | Reviewed in the mobile visual baseline and no-overflow assertion.                                              |

## Human assistive-technology walkthrough still required

Automated accessibility checks do not reproduce how a person hears or navigates a page with a screen reader. Run the following in a supported desktop or mobile environment before claiming manual accessibility certification:

1. **NVDA + current Chrome/Firefox (Windows):** Navigate account mode tabs with Arrow keys, register/sign in, use landmarks to reach the workspace, open/close both dialogs, and confirm each form control, completion control, and destructive icon button has a meaningful announcement.
2. **VoiceOver + current Safari (macOS/iOS):** Repeat account tabs, page landmarks, mobile navigation, goal progress, milestone completion, and dialog return-focus behavior with VoiceOver navigation enabled.
3. **Responsive visual check:** At 320px, 390px, 768px, 1024px, and 1440px widths, inspect top and bottom navigation, forms, dialogs, error/status text, focus indicators, and zoom at 200%. Confirm no required control is clipped or covered by fixed navigation.
4. Record browser, OS, screen reader/version, viewport, date, issues, and follow-up in this file or the implementation status document. Do not mark a result passed when a control merely appears visually correct.

The automated test run does not replace those steps. It preserves the reviewed semantic and visual behavior until a supported human assistive-technology session can complete them.
