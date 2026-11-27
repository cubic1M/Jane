# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-27T09:00Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 24 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 74 min | 0 min |
| 2 | Red main | Is delivery blocked? | 66 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 27 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 27 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 5.6% (of 27 merged) | 10.6% |
| 7 | Proof-of-fix rate | Are fixes real? | 0% | 95.5% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 27 | 39 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 470961 | 121637 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 4603 | 4% |
| lib/robinhood | 4159 | 3.5% |
| app | 1718 | 6.4% |
| planning | 1341 | 3.1% |
| e2e | 1082 | 9.4% |
| lib/jane-agent | 486 | 8% |
| components | 419 | 9.8% |
| config | 382 | 3.9% |
| categorize | 372 | 6.5% |
| lib/area-pages | 325 | 8% |
| lib/plaid | 302 | 5.3% |
| detectors | 217 | 8.3% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| not recorded | 18 |
| claude-sonnet-5-5 / 2.1.330 | 9 |

## Holdout scenarios

Last run 2026-11-26T15:42Z on `c55bfc30`: 10 of 18 passed.

## Daily canary task

No run recorded yet.
