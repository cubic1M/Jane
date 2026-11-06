# Gates and hooks

Agents build nearly all of Jane, and agents edit or game tests when tests stand in their way. So the proof sits in checks a pull request can't rewrite, and a founder holds what a pull request may not do alone. The code is `.github/scripts/gates/` and `.claude/hooks/`; the rules' tests are `src/gates/`. None of it installs anything.

## In CI

| Gate | What it does | Blocks? |
| --- | --- | --- |
| Accuracy baselines only rise | `src/accuracy/baseline.json` and `src/accuracy/csv/baseline.json`: any score that got worse, left the file, or stopped being a number fails. Errors and counts (`dollarError`, `extraRows`) count as worse when they rise. | No, it's a flag (founder, 11-06) |
| Protected files | A change to `.claude/**`, `.mcp.json`, the workflows `ci`, `gates`, `merge-train` and `rerun-flaky`, `.github/scripts/**`, `src/config/advice.ts`, the two tests that read the baselines, `vitest.config.*`, `src/test-setup/**`, the scripts that decide how many tests run and whether a migration is safe (`scripts/test-scope*.mjs`, `scripts/check-migrations.mjs`, `scripts/migration-gate-core.mjs`, `scripts/check-ratchets.mjs`), the `scripts` in `package.json`, or `SUITE_RUNS_WITHOUT_BYPASS` in `src/config/deny-by-default.ts` going from true back to false. Names are matched in lower case, and `.claude` and `.mcp.json` count in any folder, since a Mac's disk finds `.CLAUDE/x` at `.claude/x`. | No, it's a flag (founder, 11-06) |
| Proof of fix | On a fix PR, the PR's tests run against the base commit's source and must fail on what they check, then against the PR's source and must pass. | Yes |
| Weakened tests | An `expect` line deleted or replaced by a weaker check, a test newly skipped, or a test file deleted or renamed so it no longer runs. Shows as a warning, in the run's summary and in one PR comment. To find them: `gh search prs --repo cubic1M/Jane "Worth a look"`. | No, it's a flag |
| Sensitive files | Any other file under `.github/`, `src/lib/advice-mode.ts`, `src/lib/guardrails.ts`, `tsconfig*.json`, `.gitleaks.toml`, `CLAUDE.md`, `AGENTS.md`, the rest of `src/config/deny-by-default.ts`, the scanners' and lint rules (`.semgrep/**`, `eslint.config.*`, `.dependency-cruiser.*`, `knip.json`, `stryker.config.*`), `src/security/**`, `src/config/access-map.ts`, `scripts/rls-protect.mjs`, and the database doors (`src/lib/system-db.ts`, `src/lib/db-scoped.ts`, `src/lib/rls*.ts`). Same warning and comment. These change often, and blocking them would hold up other work while no founder can approve, so `src/lib/advice-mode.ts` returning true is caught by a person reading the flag, not by the gate. | No, it's a flag |

**Where they run.** `ci.yml`'s `gates` job feeds the required "Lint, typecheck and unit tests", so it blocks today. It takes its scripts from the base commit, so a PR can't rewrite the rules, but a PR could edit `ci.yml` itself. `gates.yml` runs the same static gates under `pull_request_target`, which GitHub always runs from main's copy, so a PR can't touch it: it reads the PR's files as text and never runs them. Its check blocks once a founder adds it to main's ruleset. Workflow edits count as protected files, so the first of the two catches the second.

**What's a fix.** A branch named `nd/*` or `fix/*`, the `fix` label, a title starting `fix:`, or a `Proof-of-fix:` line in the PR's body. A PR on such a branch that isn't a fix says `Proof-of-fix: none, <reason>` in its body (rerun the job; there's no need to push). The marking is honest work, not a wall: an unmarked fix isn't checked.

**Failing only because the code is new doesn't count.** A test of a function the PR adds fails on the base commit as "not a function", which shows nothing about a bug. Test the behaviour through something that exists on both sides. Checked on 25 merged debugger PRs (#1200-#1224): 23 proved themselves, one was test-only so had nothing to prove, and one (#1206) tested only its new helper. Median 4 seconds of test time here, slowest 108. On GitHub the whole job took 7-17 seconds on a PR that isn't a fix, 23 on a fix with a unit test, 49 with a database, and 110 on the slowest of those 25.

**The access proof's own tests** (`*.proof.test.ts`) aren't run by this gate: `vitest.config.mts` leaves them out of a normal run, and they have a job of their own.

**A test that needs a database** gets one started for it, the same way as the unit job, so most fixes don't pay for that.

**A run started by hand** reports on its commit, so it judges every open PR from this repo with that commit, whatever branch it was started on.

## No approvals (founder, 11-06)

The baseline and protected-file gates used to block until a founder approved the PR from a login of their own. The founder found that too much to run day to day, so since 11-06 they flag instead: the PR's run lists what changed and leaves a warning on it, and the PR merges like any other. `core.mjs` still has `founderApproval`, unused, if blocking is ever wanted back.

## Claude Code hooks

`.claude/settings.json` turns on two hooks. A session picks them up when it starts.

- **`deny.mjs`, before every tool call.** Refuses pushes to main, force pushes, hand deploys (`vercel deploy`, `--prod`, `promote`, `rollback`, `rm`), `gh pr update-branch`, `gh pr merge --admin`, a session approving a PR, `gh pr checkout` (it would run that PR's hooks and test config here), changing `FOUNDER_LOGINS` or the ruleset, reading or writing `.env*` (not `.env.example`), and changing `src/config/advice.ts`. Each refusal says what to do instead.
  - Rebasing your own branch stays open, in one form: `git push --force-with-lease=<branch>:<sha> origin <branch>`. A bare `--force-with-lease` is refused, since it trusts a tracking ref any session may have moved.
  - For a local server, pass settings on the command line or use `dev-localdb` in `.claude/launch.json`, not a `.env.local`.
- **`stop-check.mjs`, when a session ends its turn.** On the files the branch changed: `eslint`, `prettier --check`, the tests that import those files directly, and `tsc` if the incremental cache is warm (the first stop warms it in the background). A failure goes back to the session once. It has a 170-second budget, kills whatever runs over and says so, and does nothing if the code hasn't changed since its last clean run.
  - It runs the repo's lint config, test config and tests, so it runs only on this repo's branches: not on a detached HEAD, a branch that follows a fork, or one that follows `refs/pull/*`. It passes on a short list of environment variables (no tokens, no `DATABASE_URL`).
  - That doesn't make a stranger's code safe. A checkout replaces the hook file itself, and `HOME` still reaches the machine's logins. Read a stranger's PR with `gh pr diff`.
  - **Measured on this 308,000-line repo** (2026-11-03, a laptop at load average about 45): 0.4s with nothing changed; 5-11s on the first stop, while the typecheck warms up in the background (about 90s); 21-25s after that, including with a change to `src/config/detection.ts` or `src/lib/db.ts`; 54-82s when an exported type changes and `tsc` has to recheck what uses it.
  - **It doesn't use `vitest related`.** That follows imports all the way: one small rule file reached 832 test files and took 105s on 6 cores. So a break only a distant test would see waits for CI.

These are guardrails against a slip, not walls: a script can do anything they refuse. CI is the control.

**Drop the Stop hook** if first-push CI failures haven't fallen after two weeks.
