# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-24T10:22Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 21 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 57 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 7 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 7 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 7% (of 7 merged) | 13.5% |
| 7 | Proof-of-fix rate | Are fixes real? | no data | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 7 | 45 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 8873 | 111744 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 1573 | 6.9% |
| lib/jane-agent | 1377 | 3.8% |
| data-sources | 1186 | 4% |
| categorize | 1069 | 9.9% |
| lib/import | 585 | 4.3% |
| app | 537 | 17.9% |
| lib/plaid | 526 | 0% |
| detection | 457 | 6.3% |
| planning | 326 | 4.3% |
| profile | 318 | 13.5% |
| config | 264 | 23.9% |
| detectors | 258 | 9.7% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.330 | 7 |

## Holdout scenarios

Last run 2026-11-23T16:32Z on `d1deb506`: 11 of 18 passed.

## Daily canary task

No run recorded yet.
