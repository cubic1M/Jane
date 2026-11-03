# Plan B rebuild, rehearsal kit (Six-Plus Hold'em SNG): timed log

Blind rebuild from `report/sng_codex_prompt.md` (prompts 1-4) and the kit
(`rehearsal_sng/kit/`, `rehearsal_sng/README.md`) only. Start: 00:15:15 UTC = minute 0.

## Milestones

| UTC | minute | milestone |
|---|---:|---|
| 00:15:15 | 0.0 | start (read README, prompts, kit) |
| 00:15:35 | 0.3 | **safe bot** (prompt 1): 50 tables, 0 errors, 51.2 pts/table |
| 00:16:00 | 0.8 | `build_tables.py` written, 5 s smoke test OK; 120 s x 2 procs started |
| 00:18:17 | 3.0 | **tables** done: 418,550 deals, 81 preflop classes x k=1..7, 497 postflop keys; checks pass |
| 00:18:39 | 3.4 | **full bot** (prompt 3, written while the tables built): 50 debug tables, 0 errors (after one debug-check bug fix) |
| 00:18:56 | 3.7 | 200 tables `--seed 21`: 76.6 pts/table, 0 errors, p99 0.109 ms |
| 00:19:35 | 4.3 | **verification** (prompt 4 debug mode): 2 x 100 tables with every invariant asserted, 0 failures |
| 00:23:48 | 8.5 | A/B of the 5 listed candidates (800 paired tables each): none kept |
| 00:24:06 | 8.9 | final runs (below) |

Table checks (prompt 2 "done when"): AA is the best class for every k (0.760 vs 1, 0.314 vs 7);
the worst is 76o (0.349 vs 1); equity falls with k for every preflop and postflop key (0 violations).

## Final results (default settings, 1.0 ms limit)

| run | pts/table | places 1st..8th | errors | timeouts | p99 decide |
|---|---:|---|---:|---:|---:|
| 200 tables, `--seed 21`, default opponents (tight,random,pusher) | **77.64** | 128/15/14/22/15/4/2/0 | 0 | 3 / 48,760 | 0.104 ms |
| same, random replaced by the seeded copy | 77.11 | 128/14/18/16/9/8/6/1 | 0 | 6 / 48,333 | 0.100 ms |
| earlier 200 tables, `--seed 21`, default opponents | 76.59 / 79.77 | | 0 | 4 / 2 | 0.109 ms |

Sample bots in the same runs: tight 45.8-48.0, pusher 27.5-27.7, random 19.5-21.8.
`--seed 21` is not exactly reproducible with the default opponents because the kit's
random bot is unseeded (76.6-79.8 over four runs).

Timeouts (about 0.01% of decisions) are machine jitter: profiling showed slow decisions
on preflop spots with 4 history events and no GC run, under the 0.1% the prompt accepts.
p50 is 0.015 ms and the mean 0.025 ms.

## A/B (prompt 4): paired, 800 tables per side

`--seed 100`, opponents `tight,planb2/random_seeded.py,pusher`, `--time-limit-ms 50`;
an A/A run gave identical per-table points. Base = 77.97 pts/table.

| change | diff | 2 SE | verdict |
|---|---:|---:|---|
| OPEN_BAR 1.07 -> 1.18 | +1.07 | 2.66 | reject |
| OPEN_BAR 1.07 -> 0.97 | -0.19 | 2.56 | reject |
| PUSH_DEPTH 9 -> 12 | +0.41 | 1.34 | reject |
| PUSH_DEPTH 9 -> 6 | -0.32 | 1.18 | reject |
| CALL_MARGIN 0.06 -> 0.03 | +1.33 | 1.74 | reject |
| CALL_MARGIN 0.06 -> 0.09 | -1.48 | 1.40 | reject (significantly worse) |

## Ambiguities and how I resolved them

1. **"1326 two-card hands"** for the percentile table is hold'em; the 36-card deck has 630.
   Used all 630 combos; top share = fraction with strictly higher class equity at k=1.
2. **"pocket pairs 77+"** (prompt 1) in short deck: kept literally (77-AA; 66 folds).
3. **Board category "by rank counts" under 5 cards**: mapped rank counts onto the kit's
   category numbers (high card 0, pair 1, two pair 2, trips 4, quads 7); no flush/straight
   for 3-4 card boards. River board: kit evaluator.
4. **Prompt 2 "hero = hand 0"**: followed literally (only hand 0 is the hero per deal).
5. **"Players still to act"**: non-folded opponents with status `active` (all-in players
   cannot act, so excluded, even an all-in blind) and no fold/check/call/raise on this street.
   An opponent who acted and now faces a re-raise does not count (literal reading).
6. **"Heads-up tables (2 players dealt in)"**: 2 players not `out`. Only the open bar and
   the raiser's k change; the push bar is unchanged.
7. **Open rate / "raised first in"**: an open is counted when a seat makes the first preflop
   raise with no limper before it; "hands dealt" = seats in the preflop history.
8. **Fold-to-open rate**: for each other seat, its first action after the first raise,
   until someone re-raises; fold counts as a fold.
9. **Re-shove "one open, no callers"**: exactly one raise this street and no call events at
   all (limpers before the raise also disqualify), opener not all-in.
10. **kf**: the raiser is the last raiser; "already called or raised" = other non-folded
    opponents with a call or raise this street; "still to act" as in 5. kf above 7 is
    clamped to 7 for the table lookup and in `equity x (kf+1)`.
11. **"Raise to 3x the last raise-to"**: 3 x the current highest bet on the street.
12. **ICM premium triggers**: preflop when the call puts me all-in or exceeds 40% of my
    chips behind; postflop when the call is >= 50% of chips behind (all-in included).
    "Players left at the table" = players not `out`, me included.
13. **Postflop "x 0.5 per bet or raise this street"**: 0.5^(number of raise events this
    street), at least one when facing a bet.
14. **"The preflop raiser"** = I made the last preflop raise. Order of postflop bet rules:
    value bet (eq >= 0.62) first; then the heads-up flop c-bet (55%); the fold-rate stab
    only applies when the c-bet rule does not (a failed c-bet coin does not fall through).
15. **Postflop fold-to-bet rate**: every postflop action by a seat facing a higher bet
    (fold/call/raise) is a "bet faced".
16. **"Seed any random generator per table"**: a fixed seed in `Bot.__init__` (fresh
    instance per table).
17. **Raise when raising is not legal** (opponents all-in): call if facing a bet, else check.
18. **Debug pot check**: `obs.pot` already holds antes and earlier streets; the history has no
    RETURN events, but an uncalled bet is only returned when nobody with chips can act later,
    so strict equality holds at every decision.
19. **p99 timer and debug flag**: `harness.py` wraps `Bot.decide` (p50/p99/max) and sets
    `bot.DEBUG = True` with `--debug` (no environment variables).
20. **Seeded opponents for A/B**: the kit's random bot has no seed; `random_seeded.py` is a
    copy seeded by a per-process instance counter.

## Bugs found

1. Debug check (prompt 4) failed on the first decision of a new street: the rebuilt
   per-street amounts were only flushed when an event of the new street appeared. Fixed by
   flushing when the last event's street differs from `obs.street`. The bot logic was not
   affected; found in the first 50-table debug run (1,106 assertion errors -> 0).
2. No other bugs: 0 errors over 50 + 200 + 200 + 200 + 200 non-debug tables and 250 debug tables.

## Files

- `bot.py`: the submission (class `Bot`, tables embedded between the TABLES markers)
- `build_tables.py`: Monte Carlo builder (kit evaluator; `python3 planb2/build_tables.py 120 2`)
- `tables_out.py`: its output; `embed_tables.py` pastes it into `bot.py`
- `harness.py`: decide timer (p99) and `--debug`
- `ab.py`, `ab_compare.py`: paired A/B runs; `random_seeded.py`: seeded random opponent
