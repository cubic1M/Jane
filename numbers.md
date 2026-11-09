# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-09T07:08Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 6 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 0 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | no data (of 0 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 63.2% (of 0 merged) | 63.2% |
| 7 | Proof-of-fix rate | Are fixes real? | no data | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 6 | 5 |
| 9a | Merged with no founder approval | How autonomous? | 0 | 73 |
| 9b | Closed unmerged | How much waste? | 1 | 1 |
| 10 | Tokens per merged PR | Is it affordable? | no data | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 49286 | 59.8% |
| app | 46074 | 65.4% |
| detection | 11333 | 63.1% |
| insights | 9117 | 70.7% |
| planning | 7617 | 71.1% |
| lib/agent | 6956 | 51.7% |
| data-sources | 6322 | 52.2% |
| config | 5974 | 67.3% |
| lib/documents | 5656 | 74.9% |
| lib/plaid | 4140 | 50.5% |
| lib/hubs | 3981 | 69% |
| lib/messaging | 3744 | 100% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |

## Holdout scenarios

Last run 2026-11-08T12:14Z on `4f385887`: 12 of 18 passed.

## Daily canary task

No run recorded yet.
