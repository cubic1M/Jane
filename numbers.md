# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-04T06:57Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 1 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 38 min | 38 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 73 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 73 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | no data (of 73 merged) | no data |
| 7 | Proof-of-fix rate | Are fixes real? | 19.5% | 19.5% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 3 | 3 |
| 9a | Merged with no founder approval | How autonomous? | 73 | 73 |
| 9b | Closed unmerged | How much waste? | 23 | 23 |
| 10 | Tokens per merged PR | Is it affordable? | 0 | 0 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| not recorded | 72 |
| claude-opus-5-5 / 2.1.309 | 1 |

## Holdout scenarios

No run recorded yet.

## Daily canary task

No run recorded yet.
