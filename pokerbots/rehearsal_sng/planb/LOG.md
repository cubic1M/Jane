# Plan B rehearsal log (Six-Plus Hold'em SNG kit)

- 08:34:28  START (first `date` call; log file written 08:35:56). Read kit README, kit/*.py (table_api, cards, config, icm, run_local, engine, sample_bots) and report/sng_codex_prompt.md.
- 08:36:13  PROMPT 1 DONE: safe bot = planb/bot.py ("submitted"). run_local 50 tables seed 1: 0 errors, 0 timeouts, slowest 0.160 ms, avg points 54.49 (fold-bot scores high thanks to the 200-hand cap + ICM split; tight sample bot 52.1).
- 08:39:12  PROMPT 2 DONE: planb/build_tables.py (4 worker processes x 120 s, 783,104 deals) -> planb/tables.txt (567 preflop keys = 81 classes x 7, 504 postflop keys with >= 20 samples). Checks: AA vs 1 = 0.758 (short deck; the 0.85 target is hold'em), 72o does not exist in this deck so used the worst hand 76o vs 1 = 0.348 (~0.35 OK), equity monotone falling in k for every preflop and postflop key.
- 08:43:28  PROMPT 3 DONE: full bot in planb/bot.py (tables embedded by planb/embed_tables.py; parameters as module constants). 200 tables seed 42: avg points 80.65 (tight sample bot as hero on the same seed 52.30, pusher 38.19, random 19.46), 0 errors, 3 timeouts, slowest 2.552 ms, mean 0.026 ms. p99 measured with planb/timing_wrapper.py (local-only harness): p50 0.017-0.019 ms, p99 0.12-0.15 ms, p99.9 ~0.2 ms -> p99 < 0.3 ms OK. Timeouts are VM jitter (see bugs/notes), not slow code paths.
- 08:44:10  PROMPT 4: debug mode (env PLANB_DEBUG=1) asserts every decision: pot (obs.pot + all committed) == chips put in reconstructed from history; all stacks + pot == 16,000; my committed matches history; raise-to within [min_raise_to, max_raise_to] and raise legal. 100 tables seed 7 (limit raised to 1000 ms so asserts are not hidden by timeouts): 0 errors. Sanity: with STARTING_TOTAL deliberately off by 1 the asserts fire (367 errors), so they are live. Repeated on seed 8: 0 errors.
- 08:44-08:49  A/B (800 tables each, seed 1000, opponents tight,planb/random_seeded.py,pusher, --time-limit-ms 1000, PLANB_PARAMS overrides): base 80.94 | push depth 6: 80.89, 12: 80.87 | open bar 0.97: 79.09, 1.18: 81.79 | call margin 0.03: 80.63, 0.09: 79.86. Re-checked open bar 1.18 on seeds 2000/3000 (800 each): 81.86 vs 80.84, 80.81 vs 79.85. Open bar 1.18 is +1.0 pts on 3/3 seed sets (2,400 tables) but that is ~1.5 sigma and measured only against the sample bots -> not "clearly", kept 1.07 (candidate for between-round tuning). All other changes lose or tie -> defaults kept.
- 08:49:42  PROMPT 4 / VERIFICATION DONE. Final: 200 tables seed 42 (default opponents, 1 ms limit): avg points 79.47, avg place 1.94 (1st 133/200), 0 errors, 2 timeouts, slowest 1.731 ms, mean 0.0237 ms; timing harness p99 0.0995 ms, p99.9 0.150 ms. Earlier identical run gave 80.65 / 3 timeouts (runs are not reproducible, see below). 'run_local --tables 5' smoke test passes.

## Files
- bot.py            submission (self-contained; imports os, random, kit cards + table_api only)
- build_tables.py   prompt 2 table builder; tables.txt = its output (783,104 deals)
- embed_tables.py   pastes tables.txt into bot.py between the TABLES markers
- timing_wrapper.py local-only: wraps bot.py and prints p50/p99/p99.9/max decision time
- random_seeded.py  local-only: seeded copy of the kit's random bot, for reproducible A/B

## Prompt problems (ambiguous / wrong for this kit / slowed us down)
1. P1 and P3 say write `submission/bot.py`; this rehearsal needs planb/bot.py (trivial, but a copy/paste of the prompt targets the wrong file).
2. P1 "Agent interface": the class must be named `Bot` (subclass of table_api.Agent); prompt never says the class name.
3. P1/P3 time budget 0.3 ms vs kit limit 1.0 ms: fine as a margin, but the kit runner only reports slowest + mean, not p99, so P3's "p99 < 0.3 ms" cannot be checked with the kit; had to write timing_wrapper.py.
4. P1 "0 timeouts on 50 tables" is not reliably achievable: the VM has ~1-2 ms scheduling spikes on trivial decisions (the kit's own tight_bot also times out on 200 tables; spikes persist with gc disabled and with gc.freeze). Expect 0-4 timeouts per ~50k decisions regardless of code.
5. P1 "nobody has raised": unclear whether limps count (treated limps as not a raise) and the 10 bb test uses stack+committed (README's notion of stack excludes committed).
6. P2 done-when values are hold'em numbers: AA vs 1 is 0.758 in Six-Plus (not 0.85), and 72o does not exist in a 36-card deck (used 76o = 0.348).
7. P2 river board category: "by rank counts if under 5 cards" means flop/turn board categories can never be straight/flush while river ones can; consistent between builder and bot, but the key spaces differ by street. Postflop key is coarse (no top-pair vs bottom-pair, no draws).
8. P2 says nothing about keys with < 20 samples that the bot will look up (e.g. flop straight on a paired board). Added fallback: mean over board categories for (street, my cat, k), then 1/(k+1).
9. P2 runtime: pure-Python evaluate is ~7k deals/s on 4 cores; used multiprocessing (4 workers) to get 783k deals in 120 s. Prompt doesn't say whether parallelism is OK.
10. P3 steal factor: "their fold rate" for several players behind is undefined (mean? product = all fold?). Used the mean of the players behind. "(only the blinds if <= 2 behind)" is redundant: with <= 2 behind those players are the blinds anyway.
11. P3 the bar factor is stated at the "no raise yet" level but only written into the open-raise formula; applied it to both the push bar and the open bar.
12. P3 re-raise threshold 0.62 vs "the raiser = 4 random hands" can never fire in Six-Plus: AA vs 4 random = 0.435 (KK 0.387). Preflop re-raises are dead code; the bot only calls or folds to raises (e.g. QQ folds to a 3-bet when the price is poor).
13. P3 "extra player in the pot" undefined: used opponents still in who called/raised preflop, other than the last raiser (blinds who have not acted not counted).
14. P3 "raise to 3x the last raise": read as 3 x the last raise-to total.
15. P3 "0.6 per raise this street": kit uses "raise" for the first bet too, so a single bet already discounts equity by 0.6 (that is how I implemented it). Ambiguous.
16. P3 ICM premium: preflop "> 40% of my stack" vs postflop ">= 50%"; "my stack" taken as chips behind; all-in calls trigger the premium in both.
17. P3 "players still to act + limpers": players still to act includes the blinds (and an all-in short blind).
18. P4 invariant "stacks plus chips in front sum to the starting total" is wrong as written: it also needs the pot from earlier streets/antes (obs.pot). Used stacks + committed + obs.pot == 16,000.
19. P4 "A/B on the same seeds": the kit's --seed does NOT make runs reproducible because kit/sample_bots/random_bot.py uses an unseeded random.Random() (and any timeout changes the rest of a table). Same seed 42 gave 80.65 and 74.98 and 79.47. Needed a seeded copy of the random bot (planb/random_seeded.py), a fixed seed for my own c-bet RNG, and --time-limit-ms 1000 for A/B. Prompt 3's c-bet "55% of the time" needs an RNG whose seeding the prompt doesn't mention.
20. P4 "keep only if it wins clearly on 400+ tables": SE of the mean is ~1 point per 800 tables, so 400 tables cannot detect the ~1-point effects these knobs have; "clearly" undefined.

## Bugs hit
- None crashed in play (0 errors throughout). Things that bit during the build:
- Unseeded RNGs (my c-bet RNG + kit random bot) made same-seed runs differ by up to 5.7 points; fixed my RNG seed, used a seeded random bot for A/B.
- Timeouts from VM jitter (1.3-2.6 ms spikes on preflop decisions that normally take 0.015 ms); not fixable in bot code (gc.collect/gc.freeze in __init__ tried: no change).
- Wrote the debug invariants together with prompt 3 code (slightly out of order); verified they can fire by breaking a constant.
