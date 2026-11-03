# Holdout scenarios

Behaviour checks of Jane through the browser and public HTTP only. Agents can run them but not edit them, so no code gets tuned to them.

All were written blind by a fresh agent, from `CLAUDE.md`, the privacy policy and the running pages, without reading the detection, CSV, guardrail or accuracy code or the end-to-end specs' assertions. All statements are invented.

Run against a production build on a scratch database (`next start -p 4120` with `DEMO_BANK=1 TRY_JANE=1 TRY_STATEMENT=1`):

```
HOLDOUT_URL=http://localhost:4120 npx playwright test --config holdouts/playwright.config.ts
```

Results go to `holdouts-results.json` where you run it. Local servers only; no database access: people come in by the home page's two no-email doors.

**A failure means the app is wrong: fix the app, never this folder.**
