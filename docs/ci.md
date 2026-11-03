# CI: what runs when, and how to read it

| When | What runs |
| --- | --- |
| Every PR push | Lint, format, typecheck, the migration gate, the access proof, dependency audit, secret scan, the e2e build (with the bundle-size check), the end-to-end tests tagged `@critical` on a computer, and the unit tests the diff reaches |
| A PR touching something the diff's imports can't show, or too costly to miss | The whole unit suite. `scripts/test-scope-core.mjs` lists these: dependencies, the database schema, config files, `src/config`, env handling, auth, database access, row-level security, `src/security`, guardrails, advice mode, import, workflows and scripts |
| A PR labelled `full-tests` | The whole unit suite, whatever changed |
| A PR labelled `e2e` | The whole unit suite, and every end-to-end test on a computer and a phone. Use it when a PR changes a page people see |
| A PR changing only docs that no test reads | Skips the unit and end-to-end tests. Everything else still runs, and the required checks still report |
| Main | Everything, with end-to-end tests on a computer. Production ships only from a green run here, so a miss on a PR turns main red and can't reach production, but a red main stops every deploy |
| Every night (`e2e-mobile.yml`) | Every end-to-end test on a phone. A failure opens one `mobile-e2e` issue and goes to the top of the flake list, and the debugger owns it. It doesn't stop a deploy, so a phone-only break can ship and be found up to a day later |

A PR also leaves out the tests in `MAIN_ONLY_TESTS` (one file, 11% of the suite's time), unless it
has a full-run label.

Measured on 2026-11-03. Of 30 PR runs that failed in unit tests, the set a PR now runs held the failing
test in 29, and the miss was a date bug that PR didn't cause. Of the last 40 merged PRs, 19 would run
the whole suite, 12 nearly all of it because core modules reach everything, and 9 only a few files,
which is about 22% less unit time.

## Critical tests

About 20 tests carry `@critical` in their title: signing in, access, uploading, the chat, deciding on a
card, deleting an account, and the security headers. Tag one only if a break would stop someone using
Jane or expose their data, and leave out anything on the flake list. `src/config/e2e-critical.test.ts`
holds the size of the set.

## Flake list

A green run says little alone: Playwright tries a test up to 3 times, and `rerun-flaky.yml` re-runs a
failed job once, so a test gets up to 6 attempts. After each CI run, `flake-list.yml` reads the test
reports and records what failed on its first try.

```bash
npm run flakes
```

It's also at <https://github.com/cubic1M/Jane/blob/ci-flakes/FLAKES.md>. Check it before bisecting a red
run. A test high on the list needs a fix, or `test.fixme` with a reason if it can't be fixed soon. The
list keeps only test names, never error text, because the secret scan reads every branch and one fake
key on `ci-flakes` would red every PR.

## Writing an end-to-end test

No fixed sleeps: ESLint refuses `waitForTimeout`. `e2e/waits.ts` has what to use.
