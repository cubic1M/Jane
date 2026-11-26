# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-26T08:51Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 23 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 12 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 12 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 12 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 4.5% (of 12 merged) | 13.1% |
| 7 | Proof-of-fix rate | Are fixes real? | no data | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 12 | 39 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 150411 | 121637 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| categorize | 3444 | 0.8% |
| lib | 3126 | 5.4% |
| lib/jane-agent | 1895 | 7.9% |
| config | 1852 | 1% |
| scripts | 1522 | 0.2% |
| app | 1271 | 8% |
| holdouts | 1017 | 0% |
| ops | 628 | 0% |
| detection | 577 | 7.8% |
| accuracy | 473 | 0.6% |
| data-sources | 467 | 5.6% |
| lib/invariants | 394 | 3% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-sonnet-5-5 / 2.1.330 | 8 |
| not recorded | 2 |
| unknown / unknown | 2 |

## Holdout scenarios

Last run 2026-11-25T16:03Z on `9246dd0c`: 10 of 18 passed.

## Daily canary task

No run recorded yet.
