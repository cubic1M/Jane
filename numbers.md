# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-10T07:42Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 7 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 3 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 3 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 19.5% (of 3 merged) | 63.2% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 4 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 3 | 58 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 1347 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/jane-agent | 61048 | 30.1% |
| app | 18291 | 25.3% |
| lib | 13671 | 8.7% |
| lib/insurance | 12123 | 3.3% |
| planning | 11606 | 2.5% |
| config | 5462 | 13% |
| insights | 3950 | 3% |
| lib/investments | 3026 | 0% |
| data-sources | 2096 | 8.3% |
| e2e | 1716 | 14.3% |
| prisma | 1640 | 25.1% |
| lib/money-movement | 1343 | 0% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 3 |

## Holdout scenarios

Last run 2026-11-09T14:21Z on `4f385887`: 11 of 18 passed.

## Daily canary task

No run recorded yet.
