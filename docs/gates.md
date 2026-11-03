# Gates and hooks

Agents build nearly all of Jane, and agents edit or game tests when tests stand in their way. So the proof sits in checks a pull request can't rewrite, and a founder holds what a pull request may not do alone. The code is `.github/scripts/gates/` and `.claude/hooks/`; the rules' tests are `src/gates/`. None of it installs anything.

## In CI

| Gate | What it does | Blocks? |
| --- | --- | --- |
| Accuracy baselines only rise | `src/accuracy/baseline.json` and `src/accuracy/csv/baseline.json`: any score that got worse, or left the file, fails. So does a larger `ALLOWED_DROP` in the tests that read them. Errors and counts (`dollarError`, `extraRows`) count as worse when they rise. | Yes, unless a founder labels the PR |
| Protected files | A change to `.claude/**`, `.mcp.json`, `.github/workflows/**`, `.github/scripts/**` or `src/config/advice.ts` fails. | Yes, unless a founder labels the PR |
| Proof of fix | On a fix PR, the PR's tests run against the base commit's source and must fail on what they check, then against the PR's source and must pass. | Yes |
| Weakened tests | An `expect` line deleted or replaced by a weaker check, a test newly skipped, or a test file deleted. Shows as a warning, in the run's summary and in one PR comment. To find them: `gh search prs --repo cubic1M/Jane "Test lines weakened"`. | No, it's a flag |

**Where they run.** `ci.yml`'s `gates` job feeds the required "Lint, typecheck and unit tests", so it blocks today. It takes its scripts from the base commit, so a PR can't rewrite the rules, but a PR could edit `ci.yml` itself. `gates.yml` runs the same static gates under `pull_request_target`, from the base branch's own copy of the workflow, which a PR can't touch: it reads the PR's files as text and never runs them. Its check blocks once a founder adds it to main's ruleset. Workflow edits count as protected files, so the first of the two catches the second.

**What's a fix.** A branch named `nd/*` or `fix/*`, the `fix` label, a title starting `fix:`, or a `Proof-of-fix:` line in the PR's body. A PR on such a branch that isn't a fix says `Proof-of-fix: none, <reason>` in its body (rerun the job; there's no need to push). The marking is honest work, not a wall: an unmarked fix isn't checked.

**Failing only because the code is new doesn't count.** A test of a function the PR adds fails on the base commit as "not a function", which shows nothing about a bug. Test the behaviour through something that exists on both sides. Checked on 25 merged debugger PRs (#1200-#1224): 23 proved themselves, one was test-only so had nothing to prove, and one (#1206) tested only its new helper. Median 3 seconds of test time, slowest 108.

**A test that needs a database** gets one started for it, the same way as the unit job, so most fixes don't pay for that.

## The founder's label

`founder-approved` lets a PR past the baseline and protected-file gates. It counts only if the latest time it went on was by a login in the `FOUNDER_LOGINS` repository variable, that login didn't open the PR, and no commit is newer than the label. Agents never apply it, and the deny hook refuses the attempt.

## Claude Code hooks

`.claude/settings.json` turns on two hooks. A session picks them up when it starts.

- **`deny.mjs`, before every tool call.** Refuses pushes to main, force pushes, hand deploys (`vercel deploy`, `--prod`, `promote`, `rollback`, `rm`), `gh pr update-branch`, `gh pr merge --admin`, applying the founder's label, changing `FOUNDER_LOGINS` or the ruleset, reading or writing `.env*` (not `.env.example`), and changing `src/config/advice.ts`. Each refusal says what to do instead.
  - Rebasing your own branch stays open, in one form: `git push --force-with-lease=<branch>:<sha> origin <branch>`. A bare `--force-with-lease` is refused, since it trusts a tracking ref any session may have moved.
  - For a local server, pass settings on the command line or use `dev-localdb` in `.claude/launch.json`, not a `.env.local`.
- **`stop-check.mjs`, when a session ends its turn.** On the files the branch changed: `eslint`, `vitest related`, and `tsc` if the incremental cache is warm (the first stop warms it in the background). A failure goes back to the session once. It has a 170-second budget, skips anything that doesn't fit and says so, and does nothing if the code hasn't changed since its last clean run. It drops `DATABASE_URL`.

These are guardrails against a slip, not walls: a script can do anything they refuse. CI is the control.

**Drop the Stop hook** if first-push CI failures haven't fallen after two weeks.
