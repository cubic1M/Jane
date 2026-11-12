# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-12T07:41Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 9 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 0 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | no data (of 0 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 13.1% (of 0 merged) | 19.5% |
| 7 | Proof-of-fix rate | Are fixes real? | no data | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 4 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 0 | 22 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | no data | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/jane-agent | 10475 | 8.1% |
| lib | 1988 | 12.2% |
| planning | 1097 | 0.7% |
| app | 1042 | 57.3% |
| detectors | 938 | 15.2% |
| lib/plaid | 424 | 44.6% |
| config | 410 | 9% |
| e2e | 261 | 55.6% |
| .github | 199 | 10.6% |
| profile | 97 | 18.6% |
| lib/insurance | 90 | 1.1% |
| detection | 78 | 10.3% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |

## Holdout scenarios

Last run 2026-11-11T13:02Z on `51064758`: 9 of 18 passed.

## Daily canary task

No run recorded yet.
