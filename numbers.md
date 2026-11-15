# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-15T07:07Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 12 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 14 min | 0 min |
| 2 | Red main | Is delivery blocked? | 11 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 67 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 67 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 13.5% (of 67 merged) | 13.1% |
| 7 | Proof-of-fix rate | Are fixes real? | 95.5% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 6 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 67 | 45 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 1737 | 26105 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/market | 9170 | 0.3% |
| config | 5832 | 3.9% |
| app | 5598 | 31.6% |
| lib/area-pages | 4919 | 4.9% |
| planning | 4822 | 3.3% |
| components | 3654 | 43.8% |
| lib | 2518 | 19.9% |
| e2e | 1614 | 24% |
| lib/jane-agent | 1428 | 25% |
| insights | 753 | 2.5% |
| lib/practice | 686 | 10.8% |
| data-sources | 569 | 1.8% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 53 |
| unknown / unknown | 12 |
| not recorded | 2 |

## Holdout scenarios

Last run 2026-11-14T12:29Z on `1a3f5722`: 10 of 18 passed.

## Daily canary task

No run recorded yet.
