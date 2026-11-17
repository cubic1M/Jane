# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-17T08:26Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 14 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 20 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 133 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 133 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 13.9% (of 133 merged) | 13.5% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 6 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 133 | 58 |
| 9b | Closed unmerged | How much waste? | 1 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 121637 | 26105 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/events | 10623 | 35.9% |
| config | 9511 | 3% |
| planning | 4558 | 3.2% |
| lib | 3629 | 3.1% |
| app | 2673 | 18.2% |
| components | 2376 | 10.7% |
| e2e | 1905 | 13.8% |
| accuracy | 1793 | 6.5% |
| lib/trading-agent | 1717 | 2.4% |
| lib/jane-agent | 1374 | 34.2% |
| lib/paper | 1162 | 2.2% |
| lib/plaid | 1042 | 13.6% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 109 |
| unknown / unknown | 24 |

## Holdout scenarios

Last run 2026-11-16T14:03Z on `fc5f2e60`: 12 of 18 passed.

## Daily canary task

No run recorded yet.
