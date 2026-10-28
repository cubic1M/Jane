# Poker bot approach study: which bot to bring to a 60-minute, unknown-variant tournament

Everything here is reproducible with `./run_all.sh` (or `make all`; `make quick` for a
smoke run). Full tables: `report/tables.md`. Every duplicate pair behind them:
`results/pairs.csv`. Methods, engine and bot details: `report/methods.md`.
Adaptation drill: `report/drill_log.md`. Day-of tool: `dayof.py`.

## 1. Recommendation

<!-- RECOMMENDATION -->

## 2. Results: round-robin on every variant

6 candidates, 7 variants, 10 duplicate pairs (= 20 matches × 1000 hands, seats
swapped, same card sequences for every pairing) per pairing, plus every candidate
vs 4 dummy opponents: 2,730 duplicate pairs, 5.46 M hands. Numbers are bb/hand for
the row bot, mean ± 95% CI over pairs; **bold** = CI excludes 0. Per-variant matrices
with every pairing and match win-loss counts are in `report/tables.md`.

Variants: **a** NLHE 100bb · **b** NLHE 200bb · **c** 3 hole cards, face-up discard to
the board after the flop (MIT 2026 style, 200bb) · **d** 4 hole cards, exactly 2
(Omaha hands, no-limit) · **e** short deck 6+ · **f** NLHE 20bb · **g** crazy pineapple
(3 cards, face-down discard after the flop).

### 2a. Against the strong field (the other candidates except the naive equity bot)

| bot | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|
| equity (naive) | **−1.71 ± 0.12** | **−2.24 ± 0.14** | **−3.77 ± 0.18** | **−1.20 ± 0.10** | **−1.28 ± 0.09** | **−0.42 ± 0.03** | **−3.92 ± 0.14** |
| balanced | **−0.15 ± 0.10** | −0.05 ± 0.13 | −0.13 ± 0.15 | +0.08 ± 0.11 | **−0.10 ± 0.09** | −0.04 ± 0.04 | −0.06 ± 0.13 |
| adaptive | **−0.11 ± 0.09** | −0.04 ± 0.13 | **+0.18 ± 0.16** | +0.07 ± 0.12 | −0.06 ± 0.10 | **−0.05 ± 0.03** | −0.09 ± 0.10 |
| preflop_cfr@15m | +0.04 ± 0.07 | +0.03 ± 0.15 | −0.09 ± 0.17 | +0.01 ± 0.11 | **−0.14 ± 0.08** | +0.01 ± 0.03 | −0.04 ± 0.11 |
| full_cfr@30m | **+0.21 ± 0.09** | **+0.20 ± 0.15** | +0.11 ± 0.14 | **−0.19 ± 0.12** | **+0.43 ± 0.11** | **+0.09 ± 0.04** | **+0.34 ± 0.10** |
| adaptive_cfr@15m | +0.02 ± 0.10 | −0.13 ± 0.12 | −0.07 ± 0.16 | +0.03 ± 0.12 | **−0.13 ± 0.12** | −0.01 ± 0.03 | **−0.15 ± 0.13** |

### 2b. Against the whole field (other candidates + push, station, maniac, random; equal weight)

| bot | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|
| equity (naive) | +2.20 ± 0.17 | +4.29 ± 0.25 | +3.68 ± 0.23 | +1.43 ± 0.12 | +1.49 ± 0.09 | +0.54 ± 0.04 | +1.87 ± 0.13 |
| balanced | +1.83 ± 0.11 | +3.12 ± 0.20 | +4.05 ± 0.19 | +1.68 ± 0.12 | +1.48 ± 0.09 | +0.56 ± 0.04 | +3.32 ± 0.13 |
| **adaptive** | **+4.29 ± 0.15** | **+7.40 ± 0.35** | **+8.34 ± 0.27** | **+3.21 ± 0.12** | **+3.44 ± 0.12** | **+0.88 ± 0.04** | **+6.58 ± 0.17** |
| preflop_cfr@15m | +1.79 ± 0.09 | +2.37 ± 0.18 | +3.54 ± 0.18 | +1.50 ± 0.12 | +1.56 ± 0.09 | +0.53 ± 0.04 | +3.14 ± 0.10 |
| full_cfr@30m | +1.06 ± 0.11 | +1.69 ± 0.20 | +2.15 ± 0.16 | +0.75 ± 0.13 | +1.11 ± 0.10 | +0.41 ± 0.04 | +1.52 ± 0.09 |
| adaptive_cfr@15m | +3.94 ± 0.13 | +6.42 ± 0.28 | +7.42 ± 0.22 | +3.00 ± 0.12 | +3.21 ± 0.11 | +0.81 ± 0.04 | +6.09 ± 0.15 |

### 2c. Key head-to-heads (bb/hand for the first bot)

| pair | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|
| adaptive vs full_cfr@30m | −0.20 ± 0.20 | −0.13 ± 0.24 | −0.08 ± 0.32 | +0.04 ± 0.33 | **−0.49 ± 0.27** | **−0.11 ± 0.09** | **−0.39 ± 0.19** |
| adaptive vs preflop_cfr@15m | **−0.28 ± 0.15** | −0.11 ± 0.36 | +0.47 ± 0.38 | **+0.24 ± 0.20** | +0.05 ± 0.13 | −0.03 ± 0.03 | −0.11 ± 0.20 |
| adaptive vs balanced | +0.01 ± 0.21 | −0.23 ± 0.23 | +0.09 ± 0.35 | +0.04 ± 0.15 | +0.09 ± 0.16 | −0.03 ± 0.06 | −0.16 ± 0.25 |
| balanced vs full_cfr@30m | −0.25 ± 0.26 | **−0.43 ± 0.37** | −0.22 ± 0.29 | **+0.35 ± 0.25** | **−0.32 ± 0.18** | **−0.13 ± 0.12** | **−0.44 ± 0.24** |
| preflop_cfr@15m vs full_cfr@30m | −0.10 ± 0.17 | −0.04 ± 0.42 | −0.00 ± 0.41 | **+0.31 ± 0.30** | **−0.35 ± 0.25** | −0.02 ± 0.09 | **−0.26 ± 0.23** |
| adaptive_cfr@15m vs adaptive | −0.04 ± 0.29 | −0.31 ± 0.32 | −0.23 ± 0.42 | +0.03 ± 0.35 | −0.10 ± 0.33 | +0.02 ± 0.09 | −0.29 ± 0.26 |

Match counts over all 7 variants (140 matches per pairing): full_cfr beat adaptive
in 94 of 140 matches; adaptive vs preflop_cfr 70–69; adaptive vs balanced 61–79;
full_cfr vs preflop_cfr 77–63.

### 2d. Against the dummy opponents (bb/hand, row bot; mean over the 7 variants)

| bot | push | station | maniac | random |
|---|---|---|---|---|
| equity | +3.1 | +5.4 | +10.4 | +11.3 |
| balanced | +2.7 | +4.5 | +5.3 | +6.5 |
| **adaptive** | **+7.6** | **+12.1** | **+10.6** | **+11.0** |
| preflop_cfr@15m | +1.3 | +5.3 | +4.2 | +6.0 |
| full_cfr@30m | +2.8 | +2.1 | +0.9 | +3.7 |
| adaptive_cfr@15m | +6.6 | +12.2 | +9.3 | +9.2 |

All candidates beat all dummies on every variant (every cell bold in
`report/tables.md`). A side check against an always-min-bet opponent (variants a/c,
3 pairs × 500 hands): balanced +4.0/+8.5, equity +6.0/+7.7, adaptive +8.5/+17.5
bb/hand. Balanced over-folds to small bets; adaptive learns that and fixes it.

### 2e. Out-of-sample check of the late designs (fresh seeds)

<!-- HYBRID -->

### 2f. Timing (single process, idle machine; 200 hands vs random-legal + 200 vs balanced per cell)

| bot | mean ms/decision (range over variants) | worst decision | > 100 ms | > 500 ms | > 2 s | s per 1000-hand match (worst variant) |
|---|---|---|---|---|---|---|
| equity | 1.1 – 2.9 | 13.1 ms (d) | 0 | 0 | 0 | 9 |
| balanced | 2.0 – 3.9 | 10.5 ms (c) | 0 | 0 | 0 | 14 |
| adaptive | 1.8 – 3.6 | 11.1 ms (c) | 0 | 0 | 0 | 13 |
| preflop_cfr@15m | 1.5 – 3.2 | 14.6 ms (a) | 0 | 0 | 0 | 12 |
| full_cfr@30m | 0.2 – 0.8 | 7.4 ms (g) | 0 | 0 | 0 | 2 |
| adaptive_cfr@15m | 1.4 – 3.1 | 20.2 ms (f) | 0 | 0 | 0 | 11 |

No bot comes near a 100 ms per-decision limit on any variant, and all fit a
60-second clock for 1000 hands (MIT's setting) with 4× headroom. The heuristic bots
size their Monte Carlo work from a measured per-spec cost (`ms_per_sample`), so an
expensive variant (5-card PLO: 26 µs/sample vs 2.5 for hold'em) slows them by
only a few ms. One-off per-spec setup at the first `new_match`: 0.3–0.6 s
(balanced/adaptive preflop model).
Per-cell tables: `report/tables.md` (Timing).

### 2g. Lead protection (X+lp vs X, 60 pairs = 120 matches, variant a)

| matchup | matches won (W-L) | win rate | bb/hand |
|---|---|---|---|
| balanced+lp vs balanced | 69–51 | **0.575 ± 0.088** | **−0.55 ± 0.10** |
| adaptive+lp vs adaptive | 81–39 | **0.675 ± 0.084** | **−0.76 ± 0.19** |

Lead protection turns chip EV into match wins: +7.5 to +17.5 points of match win
rate for −0.55 to −0.76 bb/hand. It is a scoring-rule switch, not an improvement:
**on if the tournament ranks by matches won, off if by total chips** (the default
assumption here). (`LeadProtection(bot, scoring="chips")` passes everything through.)

### 2h. Robustness to a rules-mapping bug (bugged bot vs its own clean version, 6 pairs)

| bug (variant) | equity | balanced | adaptive | preflop_cfr | full_cfr | adaptive_cfr |
|---|---|---|---|---|---|---|
| blind order flipped (a) | +0.00 | **−1.03** | **−1.08** | **−1.00** | **−0.38** | **−1.46** |
| Omaha "exactly 2" read as "any" (d) | **−1.15** | **−0.71** | **−0.59** | **−0.61** | −0.26 | **−0.57** |
| short-deck ranking read as standard (e) | **−0.34** | −0.20 | +0.00 | −0.06 | **−1.32** | −0.14 |
| 20bb run with the 100bb spec (f) | +0.00 | +0.01 | +0.04 | −0.02 | −0.14 | +0.02 |
| face-up board discard read as muck (c) | −0.22 | −0.17 | −0.27 | +0.14 | **−2.40** | −0.52 |

(CIs in `report/tables.md`, typically ±0.2–0.6.) No bug caused a crash or an illegal
action for any bot (the engine enforces legality and every bot reads `obs.legal`),
so nothing "collapsed" into folding every hand. But the CFR bot degrades worst when
the card rules are wrong (−1.3 and −2.4 bb/hand: its whole policy was trained on the
wrong game), while the equity-driven bots lose ≤ 0.3 except where the bug changes hand
values directly (Omaha usage). A flipped blind order costs every position-aware bot
about 1 bb/hand; `dayof.py` (narrated hands) and the adapter's blind self-check exist
to catch exactly this.

## 3. CFR strength vs training time

Variant a (NLHE 100bb) and c (3-card discard), checkpoints of one budgeted run.
Exploitability is inside the abstract game (full CFR: held-out lower bound –
in-sample upper-biased estimate; preflop CFR: exact best response). Head-to-head:
10 duplicate pairs × 2 × 1000 hands, fresh seeds.

| variant | approach | budget | iterations | abstract exploitability (mbb/h) | vs equity (bb/h) | vs balanced (bb/h) |
|---|---|---|---|---|---|---|
| a | full_cfr | 1 min | 134 | 590 – 625 | +0.82 ± 0.20 | +0.02 ± 0.20 |
| a | full_cfr | 5 min | 658 | 163 – 261 | +0.72 ± 0.21 | +0.15 ± 0.21 |
| a | full_cfr | 15 min | 1,746 | 82 – 240 | +0.60 ± 0.15 | **+0.29 ± 0.18** |
| a | full_cfr | 30 min | 3,031 | 40 – 218 | +0.70 ± 0.22 | **+0.22 ± 0.16** |
| a | full_cfr | 60 min | 6,426 | 28 – 200 | +0.69 ± 0.19 | +0.18 ± 0.22 |
| a | preflop_cfr | 1 min | 4,712 | 0.013 | +1.24 ± 0.27 | −0.01 ± 0.15 |
| a | preflop_cfr | 5 min | 24,203 | 0.002 | +1.05 ± 0.27 | +0.02 ± 0.19 |
| a | preflop_cfr | 15 min | 73,056 | 0.001 | +1.07 ± 0.34 | **−0.20 ± 0.15** |
| a | preflop_cfr | 30 min | 146,520 | 0.001 | +1.04 ± 0.35 | −0.09 ± 0.23 |
| c | full_cfr | 1 min | 75 | 1331 – 1465 | +1.67 ± 0.65 | **−0.61 ± 0.41** |
| c | full_cfr | 5 min | 388 | 366 – 564 | +2.43 ± 0.51 | +0.09 ± 0.29 |
| c | full_cfr | 15 min | 1,029 | 104 – 401 | +1.82 ± 0.42 | **+0.33 ± 0.26** |
| c | full_cfr | 30 min | 1,760 | 82 – 349 | +2.08 ± 0.43 | +0.07 ± 0.25 |
| c | full_cfr | 60 min | 3,769 | 20 – 342 | +2.06 ± 0.31 | **+0.29 ± 0.26** |
| c | preflop_cfr | 1 min | 7,650 | 0.013 | +3.71 ± 0.51 | −0.01 ± 0.53 |
| c | preflop_cfr | 5 min | 40,597 | 0.000 | +3.50 ± 0.57 | −0.01 ± 0.41 |
| c | preflop_cfr | 15 min | 129,215 | 0.000 | +3.75 ± 0.60 | +0.35 ± 0.33 |
| c | preflop_cfr | 30 min | 264,486 | 0.000 | +3.63 ± 0.73 | +0.29 ± 0.50 |

What the budget buys:
* **Full-game CFR.** Abstract exploitability keeps falling to 60 minutes (590 → 28
  mbb/h lower bound on a), but real-game strength vs balanced is flat from about
  **15 minutes** (+0.29, +0.22, +0.18 on a; +0.33, +0.07, +0.29 on c; all within
  each other's noise). 1 minute is too little on c (−0.61). On this machine pure
  Python manages 1–4 iterations/s (× 1024 sampled deals); the iteration counts above
  are the honest measure of compute. Other 30-minute runs: b 2,256 iterations, d
  1,820, e 3,840, f 7,507, g 2,883: Omaha (d) is where it got least and the only
  variant where it lost to the heuristics.
* **Preflop CFR.** Converges in seconds (the abstract game is ~28 decision nodes ×
  169 classes or 50 buckets); budget only refines the bucket-vs-bucket equity matrix.
  No measurable difference between 1 and 30 minutes. The remaining error is the
  abstraction (equity realisation assumption, postflop by balanced), not CFR.
* Hold-out drill (§4): 5-minute full-CFR runs on unseen variants were within noise of
  balanced on two of three and slightly ahead on the third.

## 4. Adaptation drill

**Prepared variants (a → b…g).** Each variant is one `GameSpec` of 3–8 lines in
`engine/variants.py`; **no bot module changed for any of them** (all bots read the
rules from the spec). The difference between approaches is the compute each needs
before it can play:

| approach | code changed per variant | before it can play a new variant | modules that change |
|---|---|---|---|
| equity, balanced, adaptive | 0 lines | 0.3–0.6 s per-spec profile at first `new_match` | none (only `engine/variants.py`) |
| preflop_cfr, adaptive_cfr | 0 lines | one training run; 1–5 min is enough | none (+ policy file in `cache/cfr/`) |
| full_cfr, hybrid | 0 lines | one training run; ~15 min to plateau, more on costly variants | none (+ policy file) |

**Hold-out variants (never shown to the bot authors; the real test).** Day-of
procedure: write spec → `python3 dayof.py --variant X` → 5-minute CFR runs → short
duplicate round-robin (3–4 pairs). Machine fully loaded during the drill, so wall
times are pessimistic. Details: `report/drill_log.md`.

| | 5-card PLO (pot-limit) | 4 cards, 2 face-up discards + ante, 50bb | 3 betting rounds (4-card flop) |
|---|---|---|---|
| spec | 3 lines | 6 lines | 3 lines |
| bot code changed | 0 (all bots) | 0 | 0 |
| `dayof.py` checks (5 bots) | 87 s, GO | 112 s, GO | 35 s, GO |
| my working time (spec + checks) | ~3 min | ~3 min | ~2 min |
| preflop CFR, 5 min | OK (123k classes → 50 buckets) | OK | OK |
| full CFR, 5 min | 151 iterations (97 s setup) | 410 iterations | 1,909 iterations |
| balanced vs equity | +1.18 ± 0.60 | +1.97 ± 1.02 | +1.31 ± 0.63 |
| full_cfr@5m vs balanced | +0.15 ± 0.73 | **+0.34 ± 0.11** | +0.17 ± 0.50 |

The drill found two tooling gaps, both fixed: `dayof.py` now flags a CFR bot that is
silently playing its fallback, and day-of specs go in a `DAY_VARIANTS` slot.

**Adapter to the tournament's protocol.** The other half of day-of work is
translating the tournament's bot API into our `Observation`. `tournament/mit_adapter.py`
does this for the MIT-Pokerbots skeleton (which many university tournaments reuse),
including action-history reconstruction and self-checks (blind posting, stacks,
hole-card count) that print a warning on a mapping bug. Tested end to end inside
MIT's real engine-2026: balanced +8,010 and adaptive +7,158 chips over 300 hands vs
MIT's sample bot, 0 illegal actions, 0 warnings; plus a self-contained unit test that
a wrong blind mapping is flagged. For a different protocol the same three
translations are needed (the MIT adapter is ~230 lines and took me about 25 minutes
including its end-to-end test; with this one as a template, expect 15–25 minutes);
this is the step most likely to contain a bug, which is why the self-checks exist.

**Unsupported on the day without engine work:** multiway (> 2 players), draw games
(replacing cards), hi-lo or lowball rankings, stud (face-up hole cards). Each needs
engine changes before any bot can play; the evaluator and state machine are small
modules (`engine/evaluator.py` 230 lines, `engine/game.py` 370 lines).

## 5. What surprised me, what is inconclusive, what to test next

Surprises
* **The strong bots are within ~0.2 bb/hand of each other** against good opposition,
  while the spread against weak opposition is 2–5×. Which bot "wins" therefore depends
  more on who else is in the tournament than on poker skill in heads-up equilibrium.
* **The naive equity bot beats balanced and both CFR bots in the whole-field average
  on 100bb and 200bb** (+2.2 vs +1.8 and +4.3 vs +3.1), purely by value-betting the
  station and maniac harder. Balanced, "balanced" by design, leaves that money behind.
* **Full-game CFR's real-game strength plateaus at ~15 minutes** although its abstract
  exploitability keeps falling: the abstraction (10 equity buckets, 2 bet sizes), not
  the solve, is the limit.
* **Preflop CFR gives nothing measurable** over the balanced preflop (head-to-head
  +0.10 on a, within noise) after the balanced bot's defence fixes.
* **The combination adaptive_cfr (preflop CFR + adaptive) is no better than adaptive**
  (−0.04 to −0.31, all within noise). The bot was designed mid-study after seeing half
  the data; its failure is honest evidence that stacking parts is not automatically better.
* **CFR is the least robust to a wrong rules mapping** (−2.4 bb/hand with the discard
  destination wrong), although it is the most robust to a flipped blind order (−0.38).
* **Lead protection is a large effect** (+17.5 points of match win rate for adaptive)
  bought with a large chip cost (−0.76 bb/hand).

Inconclusive (within noise; more pairs needed)
* balanced vs adaptive head-to-head on every variant; adaptive vs full_cfr on a, b, c, d.
* Whether 30 or 60 minutes of full CFR beats 15 in real play.
* Preflop CFR vs balanced on every variant.
* The size of the min-bet leak fix for balanced (`size_factor_min` 0.25): +0.65 bb/h
  on a, none on c, untested elsewhere; not applied.
* Robustness cells have only 6 pairs; differences under ~0.4 bb/hand are noise.
* Adaptive vs other adaptive (opponent-modelling) bots: untested; feedback loops are
  possible. Its model also lags a mid-match style switch by a few hundred hands.

Next with more time
1. Multi-core CFR training (independent samplers merged per checkpoint) and a NumPy or
   C kernel for the bucket computation: iterations/s is the CFR bottleneck.
2. A richer CFR abstraction (draw-aware buckets, more bet sizes) to see if the 15-minute
   plateau moves.
3. A field of other opponent-modelling bots and of deliberately exploitative bots.
4. Fix balanced's small-bet over-folding everywhere and re-run.
5. Multiway support, and a draw-game / hi-lo evaluator, in case the variant needs them.
6. More pairs for the close calls in §2c (20+ pairs per cell).

## 6. Day-of plan (60 minutes)

<!-- DAYOF -->

## Appendix: assumptions and defaults chosen
* Scoring: total chips (lead protection off). If matches are won/lost, switch it on.
* Matches: 1000 hands heads-up, stacks reset each hand, positions alternate; all
  configurable in `GameSpec` (non-reset stacks are supported; multiway is not).
* Time limits: per-decision (checked when the bot returns; late = fold) and per-match
  clock (once spent, the bot folds every remaining decision). All bots tested well
  inside 100 ms per decision.
* Illegal action = fold (some engines check instead; our bots never act illegally
  in 5.46 M round-robin hands: 0 illegal actions, 0 exceptions, 0 timeouts).
* Short deck uses Triton rankings (flush > full house, trips > straight) and blinds,
  not antes. Variant d is no-limit (as specified), not pot-limit; pot-limit is tested
  on the hold-out 5-card PLO.
* Bots cannot see hidden cards or the opponent object: observations are frozen
  per-decision copies (tested), and the bot code was audited for access to engine state.
