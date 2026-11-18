# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-18T07:53Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 15 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 91 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 49 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 49 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 42.7% (of 49 merged) | 13.9% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 3 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 49 | 49 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 86106 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| accuracy | 60580 | 52.8% |
| lib | 4247 | 4.7% |
| app | 3533 | 29.5% |
| lib/import | 2826 | 8.6% |
| data-sources | 2076 | 9.8% |
| e2e | 1971 | 7.9% |
| lib/activity | 1536 | 2.5% |
| categorize | 1070 | 53.3% |
| detection | 979 | 12.8% |
| lib/jane-agent | 505 | 7.9% |
| config | 490 | 37.8% |
| components | 385 | 11.9% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 49 |

## Holdout scenarios

Last run 2026-11-17T14:55Z on `4e8faa02`: 11 of 18 passed.

## Daily canary task

No run recorded yet.
