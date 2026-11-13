# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-13T07:12Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 10 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 32 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 32 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 6% (of 32 merged) | 13.1% |
| 7 | Proof-of-fix rate | Are fixes real? | 90% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 4 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 32 | 32 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 231634 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| planning | 12674 | 3.3% |
| lib/jane-agent | 10078 | 2.7% |
| lib | 7349 | 2.9% |
| app | 5457 | 20% |
| detectors | 3395 | 5.5% |
| config | 2771 | 2.9% |
| lib/investments | 2323 | 3% |
| lib/practice | 2224 | 9.7% |
| lib/insurance | 1922 | 1.4% |
| lib/news | 1033 | 1.4% |
| lib/market | 931 | 2.3% |
| components | 761 | 13.1% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 18 |
| not recorded | 9 |
| unknown / unknown | 5 |

## Holdout scenarios

Last run 2026-11-12T14:05Z on `180fd801`: 12 of 18 passed.

## Daily canary task

No run recorded yet.
