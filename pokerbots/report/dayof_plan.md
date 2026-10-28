# Day-of plan (60 minutes)

Two people is ideal: **A** owns rules + bot, **B** owns the tournament protocol
adapter. One person can do it in this order too.

| time | who | step | done when |
|---|---|---|---|
| 0–5 | A | Read the rules. Copy the closest spec in `engine/variants.py`, edit it, add it to `DAY_VARIANTS`. Write down anything the spec cannot express (multiway, draw, hi-lo, stud): those need engine work, so switch to the fallback plan below. | spec written |
| 5–8 | A | `python3 dayof.py --variant <name> --train-full 20` : reads back the rules in plain words, narrates two hands, checks hand-ranking frequencies, conformance + timing for the bots, strength sanity, and starts 20 minutes of full-game CFR training in the background (checkpoints at 5 and 15). **Read section A of the output against the announcement line by line** (blind order, who discards first and where the card goes, exactly-K usage, stack in chips and bb). | GO |
| 5–25 | B | Wire the tournament's bot API to our `Observation` (`tournament/mit_adapter.py` if it is the MIT skeleton: edit `PROTOCOL` only; otherwise copy its three translations). Run their sample engine locally with `OUR_BOT=adaptive`; the adapter prints `[adapter]` warnings on blind/stack/hole-card mismatches: there must be none. | 300 local hands, 0 warnings, 0 illegal |
| 25 | A+B | **Submit adaptive** (no training needed) as soon as the adapter is clean. This is the safe entry. | submitted |
| 25–40 | A | When the 15-minute CFR checkpoint exists: `python3 dayof.py --variant <name> --bots hybrid@15m,adaptive` (conformance + timing with the tournament's time limit in the spec). Switch the submission to `hybrid@15m` only if (1) GO, (2) no `NO POLICY` flag, (3) the variant is not one where CFR is weak (expensive evaluation: Omaha-like, 5+ hole cards; < ~1,000 iterations at the checkpoint, see the training log), and (4) the rules mapping has been double-checked (a wrong mapping costs CFR 1–2.4 bb/hand vs 0–0.3 for adaptive). | decision made |
| 40–50 | A+B | Final local run through the tournament adapter with the chosen bot and the real time limits; check the adapter log is clean and the time per 1000 hands is under half the clock. | |
| 50–60 | | Buffer. Freeze. Do not tune parameters in the last 10 minutes. | |

Files that change on the day:
* `engine/variants.py`: one `GameSpec` (3–10 lines).
* The tournament adapter (`tournament/mit_adapter.py` `PROTOCOL`, or a new adapter
  file written from it).
* Generated, not edited: `cache/cfr/full_<name>_<M>m.pkl`.

Files that do not change: everything else in `engine/` (cards, evaluator, game, match,
equity), all of `bots/`, `experiments/`, `dayof.py`.

Settings to decide from the announcement:
* Scoring by **matches won** → submit `adaptive+lp` (or `hybrid@15m+lp`): +17.5 points
  of match win rate in our test. Scoring by **total chips** → no `+lp`.
* Per-decision limit below ~30 ms or a very tight match clock → the bots already
  shrink their sampling with `time_left`; confirm with `dayof.py` (timing section)
  after putting the limits in the spec.

Fallback plan (variant hostile to the main bot):
* The engine cannot express it (multiway, draws, hi-lo, stud): adapt `engine/` first
  (evaluator or state machine), then `equity` is the bot with the fewest assumptions
  (Monte Carlo equity + pot odds) and the quickest to make work; adaptive/balanced
  next once equity works.
* Evaluation is very expensive (many hole cards): adaptive, no CFR (training gets too
  few iterations; the heuristics size their sampling by time automatically).
* The adapter is not clean by minute 40: submit `equity` or `balanced` through the
  simplest possible adapter (they need only cards, board, pot, stacks, legal actions;
  `equity` does not use position or history at all, so a blind-order bug cannot hurt it).
