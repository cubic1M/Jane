# Plan B rehearsal log (practice_kit2: Pocket Swap Hold'em)

| time (UTC) | milestone |
|---|---|
| 23:50:23 | start (read kit README, simkit, sample bots, prompts) |
| 23:51:19 | prompt 1 done: safe bot passes check_bot.py; 50 tables, 0 errors, 2 timeouts / 9792 decisions (0.02%, jitter; samples also time out) |
| 23:56:54 | prompt 2 done: build_tables.py ran 120 s on 4 procs (583,850 deals x 8 rotated heroes, all hands draw with the bot's own policy); 1183 preflop keys, 609 postflop keys; AA best for every k; 0 non-monotone k pairs; AA vs 1 = 0.798, 72o vs 1 = 0.429, 32o = 0.385 (draw compresses equities vs plain hold'em's 0.85 / 0.35); tables spliced into planb_bot.py (prompt 5's draw policy + flush-draw key built here, see notes) |
| 23:58:57 | prompt 3 done: full bot. 200 tables (seed 1): 337.3 pts/table, avg place 1.04, 196 wins, 0 errors, 10 timeouts / 50,915 decisions (jitter, incl. on_hand_end), slowest 2.35 ms; p99 (planb/p99.py, 50 tables) action 0.143 ms, draw 0.193 ms, on_hand_end 0.124 ms |
| 23:59:49 | prompt 5 done (draw): choose_discard() enumerates {keep both, drop card A, drop card B}, scores (category, flush/straight-draw, high card if nothing, n discarded); error path stands pat; built into the tables in prompt 2; planb/test_planb.py 16 tests OK; 200 tables 0 errors (see prompt 3 row) |
