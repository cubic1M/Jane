# Day-of plan (60 minutes), updated after round 2

Rehearsed on the clock (§7b): rules to a verified submission took 7.5 minutes. Two
people is ideal: **A** owns the rules and the bot, **B** owns the tournament protocol
adapter.

| time | who | step | done when |
|---|---|---|---|
| 0–5 | A | Read the rules. Copy the closest spec in `engine/variants.py`, edit it, add it to `DAY_VARIANTS`. Put the time limits and the hand count in the spec. Watch for: which seat is which blind, who acts first postflop, who discards first and where the card goes (board / dead face up / muck), exactly-K usage, stack in chips vs bb, pot- vs no-limit, scoring (chips or matches). | spec written |
| 5–8 | A | `python3 dayof.py --variant <name> --bots balanced,champion@15m_w4 --train-full 15 --workers <cores>`. **Read section A of the output against the announcement line by line.** Section A ends with a LIBRARY line. If it says **same game as full_<v>_15m_w4.pkl** (possibly "with every chip amount xk"), `champion@15m_w4` already plays a trained policy: stop the background training, and take the minute-35 switch as soon as the adapter is proven (minute 20). Otherwise training runs in the background (checkpoints at 5 and 15 minutes); a LIBRARY "nearest" that differs only in a field you may have misread is a cue to re-read the rules. | GO for balanced |
| 5–20 | B | Wire the tournament API to our `Observation`. If it is the MIT skeleton, edit `PROTOCOL` in `tournament/mit_adapter.py`. If it is JSON over pipes, edit `tournament/stdio_json_adapter.py`. Otherwise copy one of them (three translations: state → Observation, our Action → their action, hand end → HandResult). The adapter prints `[adapter]` warnings on blind, stack, pot, hole-card or hand-end mismatches; there must be none. stdout carries only protocol answers. | 300 local hands vs their sample bot, 0 warnings, 0 illegal |
| 20 | B | **Prove the mapping:** run their server/engine with our bot and write a hand log; `python3 tournament/replay_check.py <log> <variant>` must report every hand identical (adapt `parse_log` to their log format if needed). | 100% hands match |
| 20 | A+B | **Submit `balanced`** (`+lp` if scoring is matches won) through the adapter. Safe entry. | submitted |
| 20–35 | A | When the 15-minute checkpoint exists: `python3 dayof.py --variant <name> --quick --bots champion@15m_w<N>` (time limits from the spec), and check the iteration count in `dayof_train_full_<name>.log`. Then run 300 local hands through the adapter. | GO, no "NO POLICY", 0 illegal |
| 35–40 | A+B | **Switch the submission to `champion@15m_w<N>`** (`+lp` if matches won), unless a fallback rule in §1 applies. | submitted |
| 40–50 | A+B | Final local run through the adapter with the real time limits: adapter log clean; time per 1000 hands under half the clock; slowest decision under half the per-decision limit. | |
| 50–60 | | Buffer. Freeze. No parameter changes in the last 10 minutes. | |

Files that change on the day:
* `engine/variants.py`: one `GameSpec` (3–10 lines).
* The adapter's `PROTOCOL` (or a new adapter file copied from one of the two).
* Generated: `cache/cfr/full_<name>_<M>m_w<N>.pkl` (not needed when the LIBRARY line
  reports the same game: the bot finds the library policy under the new spec name).

Files that do not change: the rest of `engine/`, `bots/`, `experiments/`, `dayof.py`.

Fallbacks:
* CFR checkpoint late, iterations low, or any doubt about the mapping → stay on
  balanced.
* The engine cannot express the variant (multiway, draws, hi-lo, stud) → change
  `engine/` first, then `equity` (fewest assumptions), then balanced.
* Adapter not clean by minute 35 → submit `equity` or `balanced` through the simplest
  adapter that passes. `equity` ignores position and history, so a blind or history
  mapping bug cannot hurt it.
