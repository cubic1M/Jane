# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-23T08:08Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 20 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 287 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 9 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 9 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 10.6% (of 9 merged) | 13.5% |
| 7 | Proof-of-fix rate | Are fixes real? | 0% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 9 | 49 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 382641 | 111744 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| data-sources | 352 | 2.3% |
| lib | 306 | 11.8% |
| detection | 242 | 16.9% |
| app | 190 | 0% |
| lib/events | 159 | 8.2% |
| lib/jane-agent | 152 | 9.2% |
| planning | 147 | 19.7% |
| insights | 119 | 4.2% |
| lib/area-pages | 112 | 21.4% |
| profile | 96 | 18.8% |
| categorize | 48 | 22.9% |
| config | 33 | 30.3% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 9 |

## Holdout scenarios

Last run 2026-11-22T13:36Z on `dcb6660c`: 9 of 18 passed.

## Daily canary task

No run recorded yet.
