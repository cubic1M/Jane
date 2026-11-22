# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-22T07:24Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 19 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 17 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 17 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 17% (of 17 merged) | 13.9% |
| 7 | Proof-of-fix rate | Are fixes real? | 0% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 5 |
| 9a | Merged with no founder approval | How autonomous? | 17 | 49 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 371157 | 111744 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| detection | 531 | 21.1% |
| lib | 455 | 9.2% |
| planning | 423 | 14.4% |
| app | 381 | 31.5% |
| lib/jane-agent | 255 | 6.3% |
| detectors | 100 | 9% |
| profile | 80 | 15% |
| lib/digest | 73 | 13.7% |
| config | 60 | 56.7% |
| data-sources | 46 | 0% |
| insights | 30 | 16.7% |
| lib/hub | 23 | 0% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 16 |
| unknown / unknown | 1 |

## Holdout scenarios

Last run 2026-11-21T13:48Z on `3502a763`: 11 of 18 passed.

## Daily canary task

No run recorded yet.
