# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-21T07:39Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 18 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 213 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 39 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 39 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 10.1% (of 39 merged) | 13.5% |
| 7 | Proof-of-fix rate | Are fixes real? | 93.3% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 5 |
| 9a | Merged with no founder approval | How autonomous? | 39 | 58 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 238484 | 86106 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 1665 | 5.6% |
| app | 1600 | 21.3% |
| lib/jane-agent | 1301 | 6.9% |
| lib/evidence | 1111 | 4.8% |
| planning | 1009 | 3.2% |
| e2e | 963 | 7.1% |
| categorize | 927 | 29.4% |
| scripts | 828 | 0% |
| insights | 715 | 6% |
| config | 618 | 4.7% |
| detectors | 441 | 15.4% |
| data-sources | 417 | 10.8% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 39 |

## Holdout scenarios

Last run 2026-11-20T14:28Z on `18ede269`: 9 of 18 passed.

## Daily canary task

No run recorded yet.
