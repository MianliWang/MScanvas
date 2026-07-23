---
name: mscanvas-ui-qa
description: Perform rendered functional, visual, responsive and accessibility QA for an MSCanvas UI change. Use before handoff of non-trivial frontend work and for UI regressions.
---

# MSCanvas UI QA

1. Define the exact target flow and expected rendered state.
2. Use the available browser workflow; otherwise use the repository Playwright path and record the fallback.
3. Check page identity, non-blank content, framework overlays, console errors/warnings and asset loading.
4. Exercise the target interaction and verify persistent state, not only clicks.
5. Validate 1366×768, 1920×1080 and a 960×640 constrained window when relevant.
6. Check clipping, panel minimums, focus order, keyboard equivalents, pointer/hover alternatives, loading/empty/error states and status communication.
7. For viewer work, verify linked selections, axes/units, profile/centroid representation and high-frequency interaction responsiveness.
8. For reference-driven work, keep a mismatch ledger and compare screenshots directly.
9. Do not commit temporary screenshots/traces unless requested.
10. Report findings first, then evidence, commands/APIs, what passed and remaining untested risks.
