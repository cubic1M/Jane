# Poker bot approach study: which bot to bring to a 60-minute, unknown-variant tournament

Everything here is reproducible with `./run_all.sh` (or `make all`; `make quick` for a
smoke run). Full tables: `report/tables.md`. Every duplicate pair behind them:
`results/pairs.csv`. Methods, engine and bot details: `report/methods.md`.
Adaptation drill: `report/drill_log.md`. Day-of tool: `dayof.py`.

## 0. Round 3 supersedes the heads-up study: the real format is an 8-bot sit-and-go

The tournament is **No Limit: A Bot Building Tournament** (Sequoia, OpenAI, Citadel
Securities). Its official rules (§8, `report/dayof_sng.md`) are not heads-up:
* 8 bots per table, 2,000 chips, blinds 10/20 rising every 25 hands, to the last bot
  or 200 hands;
* points by finishing place, ICM for survivors at the cap;
* **1 ms per decision** in Python, auto-fold on a timeout;
* six scored rounds, weighted 1 to 6.

Sections 1–7 below remain a valid study of heads-up play, but **the bot to bring is
`icm_tag` from `sng/`** (§8). The heads-up CFR work does not transfer: it is
heads-up only and far too slow for 1 ms.

## 1. Recommendation for heads-up play (round 2, §7)

**Bring `champion`: full-game CFR (`bots/full_cfr.py`) that hands a hand to the
adaptive bot only when the opponent shows a measured weak-bot signature (it almost
never folds to bets, or it shoves preflop constantly).** Registry name `champion`.
On the day, train its CFR half for ~15 minutes on all cores (`dayof.py --train-full 15
--workers N`). Until that policy exists and passes `dayof.py` + `replay_check.py`,
submit **balanced**.

The evidence, on fresh card seeds never used for any design or tuning (§7a):

| vs six independently written "strong team" bots (all variants) | champion | full CFR | balanced | adaptive |
|---|---|---|---|---|
| mean bb/hand | **+0.47 ± 0.09** | +0.39 ± 0.08 | +0.12 ± 0.12 | −0.12 ± 0.16 |
| matches won | **67%** | 66% | 45% | 43% |
| worst single opponent | −0.23 | −0.22 | −0.79 | **−3.28** |
| vs weak dummies (station/push/maniac) | +8.2 | +2.0 | +4.6 | +10.9 |

* **Why not adaptive any more.** Round 1 recommended it. In round 1 it was tested
  against our own bots and dummies only. Against independently written strong bots,
  an opponent-modelling exploiter beats it by 3.3–3.7 bb/hand, because its model can
  be baited. Use it only if you know the field is weak.
* **Why the CFR half.** Full CFR is the only approach that is non-negative against
  every realistic opponent on every variant tested, including Omaha. It gets most of
  its strength from ~15 minutes of training (§3).
* **Why the gate.** It adds +6 bb/hand against bots that never fold, and it never
  opened against any of the six strong bots, so it costs nothing there (champion ≥
  full CFR against every one of them).
* **Fall back to balanced** (zero training; 45% matches won, but never crushed) if:
  - the CFR policy is not ready and verified by about minute 40;
  - the variant is very expensive to evaluate, so training gets few iterations (watch
    the training log; under ~1,000 iterations treat it as unverified);
  - **the rules mapping is not proven by `replay_check.py`.** A mis-mapped rule costs
    CFR 1.3–2.4 bb/hand vs 0–0.7 for the heuristics (§2h).
* **If our engine cannot express the variant** (multiway, draw, hi-lo, stud): after
  the engine change, `equity` is the quickest bot to make legal, then balanced.
* **Scoring.** If matches are ranked by wins (as in the rehearsal), add lead
  protection: `champion@15m+lp`. It gave +7.5 to +17.5 points of match win rate in
  §2g. If ranked by total chips, leave it off.

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

Two bots were designed after seeing round-robin results:
* `adaptive_cfr`: preflop CFR + adaptive. It was in the round-robin and was no better
  than adaptive (§2c).
* `hybrid`: full CFR by default, the adaptive bot for whole hands once the opponent
  model is confident (any exploit score ≥ 0.35). It was evaluated **only on fresh
  seeds (20000+) the round-robin never used**, together with its two parents on the
  same seeds, so the design cannot have been fitted to these cards.

Setup: 10 duplicate pairs × 2 × 1000 hands per cell, variants a, c, d, e, g.

| variant | bot | vs full_cfr | vs adaptive | vs balanced | vs preflop_cfr | mean vs strong 4 | mean vs 4 dummies |
|---|---|---|---|---|---|---|---|
| a | **hybrid** | **−0.20 ± 0.12** | **+0.24 ± 0.16** | +0.14 ± 0.20 | +0.07 ± 0.16 | +0.07 ± 0.07 | +8.11 ± 0.25 |
| a | adaptive | **−0.17 ± 0.10** | — | −0.01 ± 0.19 | −0.05 ± 0.29 | −0.08 ± 0.11 | +8.74 ± 0.27 |
| a | full_cfr | — | **+0.17 ± 0.10** | **+0.14 ± 0.11** | −0.04 ± 0.12 | **+0.09 ± 0.06** | +1.85 ± 0.14 |
| c | **hybrid** | −0.17 ± 0.19 | **+0.38 ± 0.31** | +0.24 ± 0.31 | +0.05 ± 0.33 | **+0.13 ± 0.12** | +16.74 ± 0.60 |
| c | adaptive | **−0.47 ± 0.21** | — | +0.05 ± 0.42 | −0.25 ± 0.28 | **−0.22 ± 0.16** | +17.80 ± 0.60 |
| c | full_cfr | — | **+0.47 ± 0.21** | **+0.36 ± 0.20** | +0.13 ± 0.41 | **+0.32 ± 0.15** | +4.50 ± 0.30 |
| d | **hybrid** | +0.04 ± 0.17 | **−0.31 ± 0.25** | −0.26 ± 0.38 | −0.19 ± 0.19 | **−0.18 ± 0.11** | +6.27 ± 0.30 |
| d | adaptive | **+0.35 ± 0.19** | — | −0.08 ± 0.31 | +0.21 ± 0.40 | +0.16 ± 0.16 | +6.93 ± 0.33 |
| d | full_cfr | — | **−0.35 ± 0.19** | −0.24 ± 0.26 | **−0.31 ± 0.26** | **−0.30 ± 0.12** | +1.65 ± 0.32 |
| e | **hybrid** | **−0.30 ± 0.17** | **+0.41 ± 0.26** | **+0.27 ± 0.18** | **+0.36 ± 0.25** | **+0.19 ± 0.09** | +6.71 ± 0.28 |
| e | adaptive | **−0.48 ± 0.14** | — | −0.01 ± 0.27 | +0.00 ± 0.29 | **−0.16 ± 0.12** | +7.20 ± 0.29 |
| e | full_cfr | — | **+0.48 ± 0.14** | **+0.38 ± 0.19** | **+0.31 ± 0.28** | **+0.39 ± 0.11** | +1.86 ± 0.23 |
| g | **hybrid** | −0.03 ± 0.11 | **+0.41 ± 0.20** | +0.27 ± 0.28 | **+0.40 ± 0.23** | **+0.26 ± 0.09** | +13.09 ± 0.44 |
| g | adaptive | **−0.39 ± 0.20** | — | −0.19 ± 0.25 | +0.02 ± 0.31 | **−0.19 ± 0.13** | +14.05 ± 0.35 |
| g | full_cfr | — | **+0.39 ± 0.20** | **+0.32 ± 0.17** | **+0.43 ± 0.19** | **+0.38 ± 0.10** | +2.88 ± 0.22 |

* **The hybrid is the best compromise everywhere except Omaha.**
  - Against the strong four it is at or near full CFR (+0.07 to +0.26), well above
    adaptive (−0.08 to −0.22).
  - Against the dummies it keeps ~93% of adaptive's winnings, 3.5–4.5× what full CFR
    extracts.
  - Equal-weight whole field (4 strong + 4 dummies), variant a:

    | bot | whole field (bb/hand) |
    |---|---|
    | adaptive | +4.33 |
    | hybrid | +4.09 |
    | full_cfr | +0.97 |

* **It still loses slightly to full CFR (−0.03 to −0.30).** The gate sometimes opens
  against full CFR: its "folds to our preflop raises" score sits near 0.3, close to
  the 0.35 gate, and adaptive is the weaker bot in that matchup. A per-opponent
  calibration of the gate (or a higher gate, e.g. 0.5) is the obvious next test; it
  was not tuned here, to avoid fitting it to these results.
* On Omaha (d), where full CFR is weak (1,820 iterations), the hybrid inherits that
  weakness: hence the fallback rule in §1.

**Day-of budget check: hybrid with the 15-minute CFR policy** (fresh seeds 21000+,
6 pairs per cell, so wider CIs):

| variant | vs adaptive | vs full_cfr@30m | vs balanced | vs station |
|---|---|---|---|---|
| a | +0.36 ± 0.36 | **−0.30 ± 0.24** | +0.14 ± 0.15 | +11.77 ± 1.08 |
| c | −0.27 ± 0.42 | −0.26 ± 0.48 | +0.10 ± 0.31 | +16.98 ± 1.38 |
| e | **+0.63 ± 0.14** | −0.24 ± 0.29 | +0.38 ± 0.38 | +10.97 ± 1.06 |
| g | +0.15 ± 0.36 | +0.07 ± 0.27 | +0.30 ± 0.33 | +16.33 ± 1.12 |

Consistent with the 30-minute hybrid: it points the same way on 3 of 4 variants, but
only e is significant with 6 pairs, and it does no better on c. Honest summary: the
hybrid's edge over adaptive is real but small (a few tenths of a bb/hand), and with a
15-minute policy it is not established on every variant. That is why adaptive is the
base and the hybrid an upgrade taken only when its checks pass.

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
  **The full-CFR + adaptive hybrid does work**: on fresh seeds it beats adaptive by
  +0.24 to +0.41 bb/hand on 4 of 5 variants, because the part being replaced
  (adaptive's play vs sound bots) is exactly where full CFR is stronger.
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

## 7. Round 2: a realistic field, a dress rehearsal, and two debugging passes

Round 1 tested our bots mostly against each other and against dummies. Round 2 asked
what actually wins against the kind of bots other strong teams will bring.

### 7a. The realistic field
Three subagents that never saw `bots/` each wrote two bots "as a strong team would in
60 minutes with Claude" (`opponents/`). All six are spec-driven, pass conformance on
all 11 variants, and beat the dummies:

| bot | style |
|---|---|
| `opp_tag` | tight-aggressive |
| `opp_gtolite` | approximately balanced: mixing, polarized river, minimum-defence frequency, check-raises, light modelling |
| `opp_lag` | loose-aggressive: overbets, barrels |
| `opp_exploit` | opponent-modelling exploiter: probes with small bets, attacks what it finds, switches style when exploited |
| `opp_solver` | small preflop solver plus sound postflop play |
| `opp_quick` | the simple bot a team ships when the hour goes badly |

**Results.** Our four candidates against all six, variants a, c, d, e, g. These deal
seeds (40000+) were never used for any design or tuning; 6 duplicate pairs per cell,
so about 27 pairs per opponent row over the 5 variants. Values are bb/hand.

| mean vs the field | a | c | d | e | g | matches won |
|---|---|---|---|---|---|---|
| **full_cfr@30m** | **+0.33 ± 0.11** | **+1.10 ± 0.22** | **+0.20 ± 0.15** | **+0.22 ± 0.12** | **+0.81 ± 0.10** | **259–101 (72%)** |
| balanced | −0.09 ± 0.11 | +0.93 ± 0.26 | −0.21 ± 0.12 | −0.32 ± 0.15 | +0.92 ± 0.23 | 182–178 (51%) |
| hybrid@30m (gate 0.35) | −0.13 ± 0.12 | +0.44 ± 0.27 | −0.21 ± 0.13 | −0.33 ± 0.11 | +0.47 ± 0.20 | 193–167 (54%) |
| adaptive | −0.30 ± 0.13 | +0.10 ± 0.36 | −0.50 ± 0.13 | −0.68 ± 0.15 | +0.42 ± 0.18 | 173–187 (48%) |

| by opponent (all 5 variants) | adaptive | hybrid (0.35) | full_cfr | balanced |
|---|---|---|---|---|
| opp_tag | −0.35 ± 0.20 | −0.02 ± 0.19 | +0.24 ± 0.17 | −0.22 ± 0.25 |
| opp_gtolite | +0.40 ± 0.28 | +0.30 ± 0.18 | +0.29 ± 0.16 | +0.38 ± 0.26 |
| opp_lag | **−1.03 ± 0.19** | −0.59 ± 0.17 | +0.29 ± 0.17 | −0.59 ± 0.15 |
| opp_exploit | **−3.71 ± 0.63** | **−2.84 ± 0.43** | +0.05 ± 0.20 | −0.85 ± 0.34 |
| opp_solver | +1.46 ± 0.65 | +1.26 ± 0.50 | +0.92 ± 0.31 | +1.31 ± 0.62 |
| opp_quick | +2.09 ± 0.42 | +2.20 ± 0.48 | +1.40 ± 0.30 | +1.46 ± 0.36 |

**This overturns round 1's base recommendation.**
* Full CFR is the only bot that is non-negative against every opponent, and it is best
  on every variant, Omaha included.
* The adaptive bot, best in round 1, is worst here.
  - The independent exploiter beats it by 3.7 bb/hand and the LAG by 1.0.
  - Balanced, the same bot without opponent modelling, loses far less (−0.85, −0.59),
    so it is the modelling itself that gets exploited.
  - Diagnosis: the exploiter's early small-bet probing makes adaptive read it as a
    bluffer. Adaptive then widens its read of the exploiter's raises from the top 35%
    to the top 63% of hands, and calls too wide when the exploiter switches to value.
* Round 1's hybrid inherits this weakness, because its gate (any exploit score ≥ 0.35)
  opens against aggressive bots. Raising the gate to 0.6 or 0.8 did not fix it in an
  early read (5 pairs per cell, stopped once the cause was clear).

**A better gate.** Adaptive's exploit scores, measured against every opponent, separate
weak bots from strong ones cleanly:
* Weak bots: station, maniac, random and opp_quick have a fold-to-bet score F ≤ −0.47;
  the pusher has a preflop-aggression score PA ≈ 0.9.
* Strong bots: every one, including the exploiter (aggression ≈ 0.5), has F ≥ −0.27
  and PA ≤ 0.08.

`hybrid:gate_mode=weak` therefore hands a hand to adaptive only if F ≤ −0.45 or
PA ≥ 0.8; otherwise CFR plays. Results on fresh seeds (50000+) follow.

**Confirmation on fresh seeds (50000+), 30 duplicate pairs per opponent row (6 pairs × 5 variants):**

| opponent | champion (hybrid, weak-bot gate) | full CFR | balanced | adaptive |
|---|---|---|---|---|
| opp_tag | +0.16 ± 0.13 | +0.13 ± 0.14 | −0.28 ± 0.21 | −0.21 ± 0.26 |
| opp_gtolite | +0.16 ± 0.13 | +0.18 ± 0.15 | +0.25 ± 0.26 | +0.43 ± 0.29 |
| opp_lag | +0.18 ± 0.16 | +0.15 ± 0.19 | **−0.64 ± 0.16** | **−0.91 ± 0.16** |
| opp_exploit | −0.23 ± 0.20 | −0.22 ± 0.20 | **−0.79 ± 0.26** | **−3.28 ± 0.49** |
| opp_solver | +0.88 ± 0.27 | +0.93 ± 0.30 | +0.93 ± 0.50 | +1.27 ± 0.62 |
| opp_quick | +1.64 ± 0.39 | +1.16 ± 0.24 | +1.27 ± 0.29 | +2.01 ± 0.43 |
| push | +5.27 ± 1.47 | +2.94 ± 0.61 | +2.87 ± 0.69 | +7.87 ± 1.64 |
| station | +13.02 ± 1.20 | +1.99 ± 0.21 | +5.02 ± 0.54 | +13.36 ± 1.22 |
| maniac | +6.18 ± 1.25 | +1.07 ± 0.50 | +5.91 ± 1.19 | +11.48 ± 2.15 |
| **mean vs the 6 realistic bots** | **+0.47 ± 0.09** | +0.39 ± 0.08 | +0.12 ± 0.12 | −0.12 ± 0.16 |
| mean vs the 3 dummies | +8.16 ± 0.73 | +2.00 ± 0.26 | +4.60 ± 0.47 | +10.90 ± 0.95 |
| matches won vs the 6 realistic bots | **242–118 (67%)** | 238–122 (66%) | 161–199 (45%) | 156–204 (43%) |

By variant (mean vs the 6 realistic bots):

| variant | champion | full CFR | balanced | adaptive |
|---|---|---|---|---|
| a | +0.32 ± 0.17 | +0.25 ± 0.16 | −0.25 ± 0.24 | −0.45 ± 0.40 |
| c | +0.87 ± 0.33 | +0.87 ± 0.29 | +0.45 ± 0.41 | +0.18 ± 0.98 |
| d | +0.02 ± 0.22 | −0.05 ± 0.22 | −0.20 ± 0.20 | −0.35 ± 0.40 |
| e | +0.27 ± 0.19 | +0.18 ± 0.17 | −0.36 ± 0.24 | −0.54 ± 0.44 |
| g | +0.84 ± 0.40 | +0.69 ± 0.25 | +0.98 ± 0.48 | +0.58 ± 0.88 |

The weak-bot gate kept the hybrid at or above full CFR against every strong bot, and
it recovered most of adaptive's winnings against bots that never fold. **`champion` is
the new recommendation (§1).** Caveat: the gate thresholds were set from statistics
measured on these same six bots (seeds 41002), so a strong bot with an unusual
signature, for example one that almost never folds but is not weak, could open it.
The cost would be adaptive-level play against that bot.


### 7b. Timed dress rehearsal
Full log: `report/rehearsal_log.md`.
* An organiser subagent wrote a surprise variant (pot-limit Irish hold'em) and its own
  JSON stdin/stdout server, with 16 planted gotchas kept unseen.
* **Rules to a verified submission took 7.5 minutes.**
* The submission met all of the organiser's pass criteria: 5/5 matches won; 0 illegal
  actions, timeouts or stray lines; about 118 s of the 120 s bank left; slowest
  decision 29 ms.
* All 16 gotchas were handled.
* New day-of tools:
  - `tournament/stdio_json_adapter.py`, a JSON-over-pipes adapter template with
    self-checks;
  - `tournament/replay_check.py`, which replays a server's hand log through our engine
    and proves the spec matches (300/300 hands identical).
* The rehearsal also caught a real bug: a 1.05 s first decision, from a lazily built
  table in the new CFR code. It is fixed and guarded by a latency test.

### 7c. Debugging (two passes plus a fuzzer)
* `experiments/bughunt.py` plays random valid rule variants against every bot and
  checks legality, crashes, chip conservation, hidden-card leaks and evaluator
  agreement. It ran about 820 random variants overnight with **0 failures**. A second
  run (3 workers × 100 minutes, after the policy library was finished) covered **2,457
  more variants with 0 failures**. About a third of its rounds were library games under
  a new name and new time limits, played by `champion@15m_w4`, `champion@15m_w4+lp` or
  `full_cfr@15m_w4`. Such a round fails if the bot does not find its library policy.
  The bots found it all ~1,040 times.
* **Two debugging subagents found 11 real defects, each fixed with a failing-then-
  passing test:**
  - engine: discards-left counts with two rules on a street; equity used the wrong
    pending discard rule;
  - balanced/adaptive: crashed preflop when a variant discards preflop;
  - MIT adapter: discarded cards never recorded; the closing check missed at
    check-check showdowns;
  - JSON adapter: discards after an all-in put on the wrong street; impossible hand
    ends accepted silently;
  - replay check: could miss a mismatch or crash;
  - CFR bot: a discard error lost the pot; lost track of the hand after a wrapper
    resized its raise;
  - `dayof.py`: wrong checkpoint hints, and a crash on spaces in bot names.
* The engine now also hides face-down discards at showdown, as real servers do.

### 7d. Faster CFR training
* A vectorised evaluator for bucketing (`bots/cfr_full/fasteval.py`, bit-identical
  scores) makes bucketing 4–5× faster and single-process training 1.6–1.8× faster.
* A shared-memory multi-process trainer (`--workers N`) is bit-identical to one
  process. Measured on an idle 4-core machine (iterations in 2 minutes, `a_nlhe100`):
  1 worker 282, 2 workers 485 (1.7×), 4 workers 800 (2.8×). So 15 minutes on 4 cores
  is about as many iterations as the old 60-minute single-core run.
* A richer abstraction (20/15/15/15 buckets, E[HS²]) gave no measurable gain at equal
  budget.
* Day-of command:
  `python3 dayof.py --variant X --train-full 15 --workers <cores>`, or directly:
  `python3 -m bots.cfr_full.train --variant X --minutes 15 --workers N --suffix wN`.

### 7e. Pre-trained policy library

To make the day-of CFR policy instant whenever the announced game is one we
anticipated, `experiments/train_library.py` trains full-game CFR for 15 minutes on
4 workers for each of 14 games, and the files are kept in git
(`cache/cfr/full_<v>_15m_w4.pkl`, about 1 MB each, sha256 list in
`cache/cfr/LIBRARY.sha256`):

* the 7 study variants a–g;
* the rehearsal and hold-out variants: Irish PLO (`k_irish`), PLO5, double discard,
  3-street hold'em;
* three likely extras: NLHE at 50 bb and 150 bb, and 4-card PLO (`l_nlhe50`,
  `m_nlhe150`, `n_plo4`).

A policy belongs to a game tree, not a name. `bots/cfr_full/library.py` matches a spec
to a library policy on every field that changes the tree; the name, time limits,
match length and notes are ignored. When `full_<dayname>_15m_w4.pkl` does not exist,
`champion@15m_w4` (and `full_cfr@15m_w4`) loads the matching library policy and says so on
stderr. `dayof.py` section A prints the match. If there is no match, it prints the
three nearest library games and the fields where they differ, which also catches
a misread rule. Any difference in betting, discards, cards or stack depth counts as a
different game, so the bot never plays a policy trained for another tree.

**Chip scale.** A game that equals a library game with every chip amount (blinds,
ante, stack) multiplied by one factor k is the same game. Examples are NLHE 100bb at
50/100 chips, or Irish at 1/2 instead of 5/10. The CFR bot then plays in library
chips (`bots/cfr_full/scaling.py`): chip amounts in each observation are divided by k,
and its raise is multiplied back by k and clamped to the real legal range. Checks:
* Against a calling station, every hand of the scaled game is exactly k× the library
  game's: 300/300 hands at k = 50, 1/5 and 25, on hold'em, Irish and PLO.
* On the demo-B seeds (§7f), the scaled library policy with no training scored +0.38
  vs balanced, +0.09 vs opp_tag and −0.36 vs opp_exploit. The policy trained there for
  15 minutes scored +0.36, +0.14 and −0.39.
* The bug-hunter also tries chip-scaled library games.

Validation (exp `library_check`, fresh seeds 60000+, 6 duplicate pairs × 1000 hands,
`champion@15m_w4` row bot, bb/hand, 95% CI):

| variant | vs `champion@30m` (old single-core) | vs `full_cfr@30m` | matches won |
|---|---|---|---|
| a_nlhe100 | −0.06 ± 0.13 | −0.06 ± 0.13 | 5 of 12 |
| c_discard3 | +0.17 ± 0.23 | +0.17 ± 0.23 | 8 of 12 |

Both differences are within noise, so the new trainer's 15-minute policies are as
strong as the old 30-minute ones; this check cannot rank them. The two columns are
identical because the champion's gate never trips against a strong bot: it then plays
pure full CFR, deal for deal. Decisions take 0.18 ms (hold'em) and 0.95 ms (discard
hold'em) on average, and at most 9 ms.

All 14 are trained. Iterations (×1024 sampled deals) and information sets per 15-minute
policy, with training sharing the machine with tests at times:

| game | iterations | infosets | game | iterations | infosets |
|---|---|---|---|---|---|
| a_nlhe100 | 5,818 | 38,616 | h_plo5 | 4,527 | 37,524 |
| b_nlhe200 | 3,815 | 60,136 | i_double_discard | 2,940 | 18,776 |
| c_discard3 | 3,545 | 60,136 | j_3street | 14,290 | 8,576 |
| d_omaha4x2 | 4,897 | 38,616 | k_irish | 4,020 | 49,044 |
| e_shortdeck | 5,721 | 38,616 | l_nlhe50 | 8,150 | 22,856 |
| f_nlhe20 | 13,784 | 10,552 | m_nlhe150 | 5,193 | 49,176 |
| g_pineapple | 5,363 | 38,616 | n_plo4 | 5,374 | 37,524 |

For a–g every library policy has 1.5–2.7× the iterations of the old single-core
30-minute policy (old: a 3,031, b 2,256, c 1,760, d 1,820, e 3,840, f 7,507,
g 2,883). The lowest count is i_double_discard (2,940): two discard rounds make each
iteration expensive. `bots/tests/test_library.py` checks every listed file:
the hash, that it was trained for the variant in its name, more than 1,000 iterations,
and legal, fast play from both seats.

### 7f. Timed day-of demos (details: `report/demo_log.md`)

| scenario | spec to verified champion | notes |
|---|---|---|
| library hit (rehearsal game, new name), through the real server | **about 2 min** machine time | 4,000/4,000 server hands replay identically; +8.6 bb/hand vs the example bot; 108 s of the 120 s bank left |
| NLHE at 50/100 chips, before chip-scale matching: trained for 15 min on 4 cores | **about 16 min** | `balanced` GO at 52 s; day-trained champion as strong as the library one on the same seeds |
| the same game now (library match up to chip scale, §7e) | **about 2 min** | no training; same strength as the day-trained policy |
| all 244 tests (`./run_tests.sh`, 5 suites in parallel) | 2 min 54 s | all pass |

The champion's one losing matchup remains `opp_exploit` (−0.39 ± 0.27 on hold'em in
this demo; −0.23 ± 0.20 over 5 variants in §7a).

## 8. Round 3: the real format (8-bot sit-and-gos, 1 ms per decision)

Code in `sng/`, plan in `report/dayof_sng.md`.
* **Engine** (`sng/table.py`, 17 tests): multiway no-limit / pot-limit hand engine,
  covering
  - side pots, and short all-in raises that do not reopen the betting;
  - heads-up blind order, antes, knock-outs ranked by stack at the start of the hand;
  - ICM at the 200-hand cap;
  - the 1 ms rule enforced exactly as the rules state: errors and timeouts check,
    otherwise fold.

  It runs 0.3–0.4 ms per hand and reuses the card layer (deck, hole cards, board,
  ranking, limit), so variants are a spec change.
* **Field** (`sng/field/`, written independently, 19 tests): 9 archetypes of
  60-minute student bots: Monte Carlo equity (fixed samples, often over 1 ms; and a
  time-boxed version), Chen-formula TAG, LAG, nit, station, maniac, ICM push/fold, and
  a per-seat adaptive bot. Default weights favour mediocre TAG and Monte Carlo bots.
* **Strength layer** (`sng/ours/strength.py`, 25 tests): equity against 1–7 random
  hands from Monte Carlo-trained lookup tables.
  - Hold'em calls take 1–3 µs preflop and at most 47 µs p99 postflop.
  - Mean error is 0.007 preflop and 0.013–0.018 postflop.
  - Tables for hold'em, short deck and Omaha are in git; a new variant rebuilds in
    about 4 minutes.
* **Arena** (`sng/arena.py`): every candidate plays exactly the same tables (deal
  seed, seat, opponents), so differences are paired.

**Results so far** (default field, synthetic point table 100/65/45/30/20/12/6/0;
34.75 = average seat):

| bot | points/table | top 3 | busts | p99 decision |
|---|---|---|---|---|
| `icm_tag` (tuned) | **60.5 ± 2.7** | 72% | 45% | 0.05 ms |
| field's best, `pushfold_icm` | 50.6 ± 2.7 | 59% | 58% | 0.17 ms |
| Chen TAG | 46.0 ± 2.1 | 60% | 62% | 0.17 ms |
| Monte Carlo vs random hands | 18–28 | | | 2 ms (times out) |

* The first `icm_tag` draft lost to the Chen TAG (−3.0). On paired tables the fix
  was to call far tighter:
  - treat a raiser as about 4 random hands (+8.8);
  - need 6% more equity than pot odds to call (+5.4);
  - discount equity sharply against bets (+3.8, +4.2 more at 0.6).
* In a points-by-place game that pays everyone who survives, not busting is worth
  more than winning hands. Even a bot that always times out and folds scores
  near average.
* Tuning (`sng/tune.py`, 3 rounds, 400 fresh paired tables each) accepted:
  - stealing wider against blinds that fold (+5.6 ± 1.9; the timeout-folders);
  - opening a little wider (+2.9).

  Then it plateaued at about 64 points per table.
* **Robustness** (`results/sng_robust.md`): fresh seeds, 300 paired tables per cell,
  points per table, with `icm_tag`'s gain over each bot shown below. `icm_tag` beats
  all three of the field's best bots **in all 12 field × point-table cells**; 35 of the
  36 differences are significant.

| field | point table | `icm_tag` | vs pushfold_icm | vs adaptive | vs chen_tag |
|---|---|---|---|---|---|
| default | synthetic 100/65/45/30/20/12/6/0 | 62.0 | +10.3 | +12.5 | +13.3 |
| default | top 3 (50/30/20) | 27.3 | +5.6 | +6.4 | +9.0 |
| default | winner takes all | 45.2 | +21.6 | +26.5 | +28.1 |
| default | linear 7..0 | 5.31 | +0.52 | +0.65 | +0.67 |
| strong | synthetic | 58.1 | +15.7 | +18.1 | +21.5 |
| strong | top 3 | 25.0 | +7.8 | +11.3 | +13.5 |
| strong | winner | 40.5 | +20.3 | +29.8 | +32.3 |
| strong | linear | 4.94 | +0.72 | +0.99 | +1.15 |
| weak | synthetic | 64.3 | +12.1 | +11.8 | +11.3 |
| weak | top 3 | 25.1 | +4.8 | +3.4 | +2.2 (n.s.) |
| weak | winner | 39.3 | +18.1 | +17.6 | +20.6 |
| weak | linear | 5.35 | +0.49 | +0.38 | +0.33 |

  The edge is largest against the *strong* field, so it is not only exploiting weak
  bots. It is smallest with top-3 payouts against a weak field. Timing: p99 is
  0.04–0.06 ms. Up to 10 decisions in 300 tables went over 1 ms, only while 4 arena
  workers shared the machine.
* **Variants and blind schedules** (`results/sng_robust2.md`, default field, 300 paired
  tables): `icm_tag` beats all three in all 5 cells, every difference significant.
  - short deck: +21 to +24;
  - Omaha (4 hole cards, exactly 2): +21 to +26;
  - pot-limit: +10 to +18;
  - fast doubling blinds: +6 to +15;
  - slow blinds: +8 to +10.
* **Timed dress rehearsal of the real format** (`report/rehearsal_sng_log.md`). An
  independently written fake kit had six-plus hold'em, antes and its own Agent
  interface, single-file submission, and 15 hidden gotchas.
  - **Kit to verified submission: 8 minutes.**
  - **15/15 gotchas handled.**
  - 21,848 decisions checked for the observation mapping, with 0 violations.
  - +23 points per table over the kit-rules field on our arena.
  - **Bug found and fixed:** our one-file bundle took the module name `engine`, which
    the kit's simulator also uses. Bundled code now lives under a private package
    (`_nlb`), tested in both import orders.
* **Second tuning on a blend of fields** (`results/logs/sng_tune_blend.log`, 4 rounds).
  On the blend field, play rose from 51.6 to about 65 points per table:
  - open smaller and wider (2bb, `open_mult` 1.07);
  - push/fold from 9bb;
  - use the fold-to-steal read against up to 5 players behind.

  **Validated on fresh seeds against the previous values** (`results/sng_validate.md`,
  400 paired tables per cell): positive in all 6 cells, significant in 4.
  - default +4.2 ± 4.2;
  - strong **+10.1**;
  - weak +2.9;
  - mirror **+15.3**;
  - top-3 payouts **+4.1**;
  - rehearsal rules **+4.6**.

  Now the defaults.
* **Plan B measured** (in case prepared code may not be brought; the organisers'
  announcement says "from scratch"). `icm_lite` uses the same decision rules on a strength
  table any team can generate in 2 minutes: preflop classes, and (street, hand category,
  board category). It scores **−4.0 ± 3.6 points per table vs `icm_tag`, and +14 vs the
  field's best**. Rebuild prompts for Codex: `report/sng_codex_prompt.md`.
* **Plan B rehearsed:** a fresh agent with only the fake kit and the prompts built a
  verified bot in 15 minutes, scoring 79.5 points per table vs the kit's bots with 0
  errors. Its 15 ambiguity reports are folded into the prompts.
  - One was a real bug in `icm_tag` too: the absolute 3-bet bar (0.62) could never fire
    against a 4-random-hand range, since AA has only 0.56.
  - The fix is a relative bar, equity × (range + 1) ≥ 2.6, roughly AA only. Validated on
    6 fresh-seed cells: −1.0 to +2.3 (significant only on the mirror field, +2.3); none
    lose. Adopted as a small, sound fix.
* **Third tuning run rejected** (`results/sng_validate_run3_rejected.md`). It pushed
  further in the same direction: open bar 0.97, a wider shove, a steal read up to 7 behind,
  a light per-seat raise-rate read. Each round gained only about 1 SE. On fresh seeds it
  won the mirror field (+9.5) but **lost significantly with top-3 payouts (−2.7 ± 2.5)**
  and was negative on default (−2.5) and strong (−3.6). The blend's mirror share (tight
  copies of our own bot) pulled it towards looser opens. The defaults stay. Lesson: once
  per-round gains are near 1 SE, accepting at 1 SE overfits; on the day use
  `--accept-se 2`.
* The tuner (`sng/tune.py`) is reusable on the day with the real rules as a preset
  (`--preset`), at 10–20 minutes per round. Robustness
  to other fields and point tables is next, since both are guesses until the day.

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
