# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-19T07:52Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 16 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 75 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 75 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 34.9% (of 75 merged) | 13.9% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 75 | 58 |
| 9b | Closed unmerged | How much waste? | 1 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 111744 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| accuracy | 39197 | 39.1% |
| app | 1869 | 8.1% |
| data-sources | 1560 | 5.3% |
| categorize | 1357 | 94.1% |
| planning | 872 | 2.3% |
| detection | 704 | 8.8% |
| config | 591 | 25.2% |
| lib | 561 | 4.5% |
| detectors | 526 | 4.8% |
| lib/jane-agent | 464 | 3% |
| e2e | 452 | 7.7% |
| lib/import | 441 | 1.4% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 67 |
| unknown / unknown | 8 |

## Holdout scenarios

Last run 2026-11-18T14:34Z on `e5714b2d`: 9 of 18 passed.

## Daily canary task

No run recorded yet.
