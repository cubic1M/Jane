# Timed dress rehearsal (round 2)

An organiser subagent wrote a surprise variant and its own tournament server with an
unfamiliar bot API (`rehearsal/`); its notes listing 16 planted gotchas were kept
out of view (and out of git) until the end. The day-of plan was then run on the clock.

Variant: heads-up **pot-limit Irish hold'em**. 4 hole cards; after the flop is dealt,
each player discards 2 face up as DEAD cards, dealer first; blinds 5/10, 150 bb;
1 s per decision, 120 s bank. Ranked by **matches won**. Protocol: line-delimited JSON
over stdin/stdout, seat 0 = big blind, raises "by", tens written "10".

| time (UTC) | step |
|---|---|
| 09:28:19 | rules + protocol README read; gotchas noted: seat 0 = BB, raise BY, "10", dead face-up discards, dealer discards first, 150 bb = 1500 chips, matches-won scoring → lead protection, stdout is the protocol channel |
| 09:29:00 | `k_irish` spec written in `DAY_VARIANTS` (6 lines) |
| 09:30:13 | `dayof.py` GO (72 s): rules read back correctly; 15-minute full-CFR training started in the background |
| 09:31:12 | new adapter `tournament/stdio_json_adapter.py` written; first live match through the server: 300 hands, 0 illegal, 0 timeouts, +5,961 chips |
| 09:32:11 | `tournament/replay_check.py`: every logged hand replayed through OUR engine with OUR spec: **300/300 identical chip results**, so the rules mapping is exact |
| 09:32:42 | two 1000-hand matches through the server: won both, 0 illegal/timeouts, bank 118.7 s left |
| 09:33:19 | adapter unit tests (6) pass; adapter fixed to take the match length from the server (lead protection needs it) |
| 09:34:03 | 5-minute CFR checkpoint (201 iterations on a loaded machine) |
| 09:34:30 | `dayof.py --bots hybrid@5m+lp` → **NO-GO**: one decision took 1.05 s (limit 1.0 s): a lazy table build in the in-progress CFR speed-up code; reported to that agent |
| 09:35:06 | **decision: submit `adaptive+lp`** (the plan's rule: hybrid only if its checks pass) |
| 09:35:47 | organiser's pass criteria all met (below) |

**Rules to verified submission: 7.5 minutes.**

Organiser's pass criteria for `adaptive+lp`:

| check | expected | result |
|---|---|---|
| illegal / timeouts / auto-played decisions | 0 | 0 / 0 / 0 in all 5 matches |
| stray stdout lines | 0 | 0 |
| handshake | ok | ok |
| time bank left after 1,000 hands; slowest decision | > 30 s; < 0.5 s | ~118 s; 29 ms |
| beats example_bot in all 4 matches (2 seeds × both seats) | yes | 4/4 (+1370, +1628, +1303, +1457) |
| vs maniac (all-ins, still must discard) | no illegal | won, 0 illegal |
| tracebacks in stderr | none | none |

All 16 planted gotchas were handled (1 face-up-but-dead discards, 2 dealer discards
first, 3 timing, 4 bb vs chips, 5 pot limit, 6 matches-won scoring, 7 seat 0 = BB,
8 raise BY incl. history, 9 "10", 10 request id, 11 stdout discipline, 12 ready
handshake, 13 all-in discard requests, 14 time, 15 hand numbers from 1, 16 pot/bets
semantics). Small chip margins in the 1000-hand matches are lead protection folding
out locked matches, which is right for matches-won scoring.

What the rehearsal changed:
* New reusable tools: a JSON-over-pipes adapter template with self-checks, and a
  replay checker that proves a spec matches a server's own hand log.
* Bug found: first-decision latency in the CFR speed-up work (fixed by its author).
* `dayof.py` printed a wrong "how to load" hint for full-CFR training: fixed.
* Lesson: with matches-won scoring, lead protection sacrifices tie-break chips; a
  "lock with a margin of a few stacks" variant is worth testing.
