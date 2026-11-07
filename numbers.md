# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-07T06:32Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 4 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 38 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 96 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 96 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | no data (of 96 merged) | no data |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 5 | 3 |
| 9a | Merged with no founder approval | How autonomous? | 96 | 83 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 252531 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 49 |
| not recorded | 41 |
| unknown / unknown | 6 |

## Holdout scenarios

Last run 2026-11-06T13:18Z on `1f66f4a7`: 11 of 18 passed.

## Daily canary task

No run recorded yet.
