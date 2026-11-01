# Day-of plan for the real format (No Limit: 8-bot sit-and-gos)

Source: the official rules page (pokerbot.sequoiacap.com/rules.html, copy of
2026-10-28). Regionals: **Fri Nov 6 Menlo Park, Mon Nov 9 Cambridge, Thu Nov 12
Pittsburgh**, 6:00–9:00 PM; Finals Sun Nov 15 in San Francisco (by invitation). The
Finals use a different variant.

## What the rules fix, and what they leave open

| fixed by the rules | open until the build starts |
|---|---|
| 8 bots per table, 2,000 chips, blinds start 10/20 and rise every 25 hands, end at one bot or 200 hands | the poker variant |
| points by finishing place; survivors at hand 200 share by ICM | the point table (may vary by variant) |
| **1 ms per decision**; an error or timeout checks if possible, else folds | blind amounts after level 1, antes |
| Python, the provided Agent interface, 100 MB maximum, no network | the Agent interface itself |
| bot state resets every table; opponents are anonymous | how the 1 ms is measured (wall/CPU, first call, machine) |
| 6 scored rounds T1–T6, 20 min apart, weights 1–6; resubmit every 5 min; frozen at each round's start | |

## The clock, by weight

| minute | event | share of the final score |
|---|---|---|
| 0 | build starts, variant + kit revealed | |
| 60 | T1 | 1/21 = 5% |
| 80 | T2 | 10% |
| 100 | T3 | 14% |
| 120 | T4 | 19% |
| 140 | T5 | 24% |
| 160 | T6 | 29% |

**The bot at minute 60 is worth 5%. The bots frozen at minutes 120, 140 and 160
are worth 71%.** So: a legal, safe bot early; then measured improvements every
round, each one A/B-tested in our simulator before it is submitted.

## Open question to settle before the event (ask the organisers)

Section 3.3 gives teams "60 minutes to build a Python bot"; 3.4 permits Astra,
Codex and "publicly available documentation"; prepared private code is not
mentioned, the announcement says "from scratch", and 5.4 reserves code review. **Ask
the organisers in writing whether a team may bring code it wrote beforehand.** Also
ask whether AI tools may still be used after the build phase (4.2 allows editing
after it; 3.4 speaks of the build phase).
* If prepared code is allowed: use `sng/` directly (plan A below).
* If not: what transfers is knowledge. The strategy, the parameter values, the
  pitfalls and the tests are written down in this repo. Re-implement the bot in the
  60 minutes with Codex from `report/sng_bot_spec.md` (plan B).

## Plan A (prepared code allowed)

| minute | step |
|---|---|
| 0–10 | Read the variant, the point table, the blind schedule and the Agent interface. Encode the variant: a `GameSpec` (card rules) plus an `SngRules` (blinds, antes, payouts). |
| 10–15 | Start `python3 -m sng.ours.build_tables --variant <v> --minutes 3 --workers <cores>` for the strength tables. |
| 10–25 | Write the adapter from their Agent interface to `SngObservation` (`sng/adapter_template.py`). Check it with their local simulator: 0 errors, 0 timeouts. |
| 25 | **Submit `icm_tag` with the default parameters through the adapter.** |
| 25–55 | Arena: `python3 -m sng.arena --candidates icm_tag,<variants> --tables 2000` against the field mix on the day's rules. Submit the best one. |
| 60–160 | Between rounds: tune (push range, open bar, ICM risk) on paired tables; submit only a paired win at 95%. Re-check the timing (p99 well under 1 ms) before every submit. |

## Plan B (from scratch)

The same timeline, with Codex writing from `report/sng_bot_spec.md`: the decision
rules, the parameter values, and the 10 tests that catch the common bugs. Hand-strength
tables come from the starter kit's simulator, or from a short Monte Carlo built in the
first 15 minutes, cached to a file and loaded at import.
