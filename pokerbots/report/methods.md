# Methods (appendix to REPORT.md)

## Environment
Python 3.13 + NumPy only (no PyPI access in the study container, so no pytest,
numba, scipy or Cython). That is also the most portable choice for the day.
4 cores (Xeon 2.3 GHz), 15 GB RAM. All experiment processes single-threaded
(`OMP_NUM_THREADS=1`), at most 4 at a time.

## Engine (`engine/`)
* `spec.py`: `GameSpec`: deck ranks, hole cards, `any`/`exactly K` showdown usage,
  board cards per street, `DiscardRule`s (street, count, to board or muck, face up
  or down, order), hand-category order, ace-low straight, blinds, ante, stack, stack
  reset, heads-up only, hands per match, no-limit/pot-limit, per-decision and
  per-match time limits. Validated on construction.
* `evaluator.py`: vectorised NumPy evaluator for any number of cards; bit-mask
  tables per spec (straights incl. short-deck A-6-7-8-9, category order), a 5-card
  perfect-index table for Omaha-style "exactly 2". About 0.7 µs/hand in batches of 200.
  Tested against an independent brute-force evaluator on thousands of random hands
  in every variant, plus targeted tests for every category, kickers, ties, wheel,
  board-plays, Omaha flush/quads traps and short-deck rankings.
* `game.py`: hand state machine: blinds/antes, NL/PL raise rules (min-raise = last
  raise or BB, max = effective stack), discards (to board or muck, order), showdown.
  Observations are frozen copies per decision; opponent's hidden cards and face-down
  discards never appear in them (tested).
* `match.py`: N hands, positions alternate, per-hand deck = f(deal_seed, hand), so
  (A,B) + (B,A) with one seed is a duplicate pair. Illegal action / exception /
  per-decision timeout = fold; match clock exhausted = fold everything after.
* `equity.py`: spec-aware Monte Carlo equity used by every bot: honours future
  board cards, future discards (to board: random card; to muck: hindsight best
  keep, symmetric), Omaha usage, short deck; common random numbers across discard
  options; `ms_per_sample()` so bots size work by time, not sample counts.
* `conformance.py`: every bot must pass: every variant, vs random-legal and vs
  itself, both seats, no illegal action/exception, no decision > 2 s.

## Bots (`bots/`), all spec-driven, none hard-codes a variant
| # | registry name | approach | key facts |
|---|---|---|---|
| 1 | `equity` | MC equity + pot odds + fixed thresholds, no mixing | preflop percentile vs a per-spec equity distribution |
| 2 | `balanced` | equity vs an action-narrowed opponent range, soft (mixed) thresholds, semi-bluffs, 0.5/1 pot + all-in | 60 params, 24 marked adjustable |
| 3 | `adaptive` | balanced + opponent stats (VPIP/PFR, fold-to-bet by size, aggression, check-raise, showdown strength by line), Beta-shrunk, min sample 30, bounded knob moves | memory ~330 observations |
| 4 | `preflop_cfr@<budget>` | full-width DCFR on preflop (169 suit classes for 2 cards, 50 equity buckets for 3+), terminal = pot × bucket-vs-bucket equity matrix (realisation IP 1.0/OOP 0.92), balanced postflop | converges in seconds; budget buys matrix accuracy |
| 5 | `full_cfr@<budget>` | chance-sampled vectorised MCCFR (DCFR 1.5/0/2) over all streets, 16/10/10/10 equity buckets, bet 0.5/1 pot, pot raise, all-in, 3–4 raise cap, pseudo-harmonic translation | 1–4 iterations/s × 1024 deals |
| 4+3 | `adaptive_cfr@<budget>` | preflop CFR + adaptive postflop; switches preflop to the adaptive bot's play when the opponent model is confident the opponent is extreme preflop | added mid-study (see REPORT §5) |
| 6 | `push` | all-in every hand | sanity opponent |
| 7 | `station`, `maniac` | always call; raise big 70% | robustness opponents |
| – | `random_legal` | uniform random legal action incl. odd sizes | conformance + dummy |
| – | `+lp` suffix | lead protection wrapper: fold out when the lead cannot be lost by folding every remaining hand; late catch-up variance when far behind | `scoring="chips"` disables it |

Bots 2, 3, 4 and 5 were written by separate subagents against the frozen engine
interface; each had to pass the conformance check and its own unit tests
(`bots/tests/`, 100+ tests) before it was accepted. Cheating audit: no bot reads
engine state, the deck or the opponent object (grep + code review); the adaptive
bot reads opponent cards only from showdown results.

## Experimental design
* **Duplicate pairs.** Unit of analysis = one duplicate pair: the same deal seed
  played twice with seats swapped (2 × 1000 hands). Bots' own RNG seeds depend on
  the seat, so two identical bots score exactly 0 (verified). All pairings use the
  same deal seeds (10000..10009), so every pairing sees the same card sequences.
* **Round-robin.** 6 candidates × 7 variants, 10 duplicate pairs (= 20 matches of
  1000 hands) per pairing, plus every candidate vs the 4 dummies. 2730 duplicate pairs
  = 5.46 M hands.
* **Statistics.** Mean bb/hand over pairs, 95% CI = t(n−1) × sd/√n. Summary rows
  average per-opponent means with equal weight; their CI combines per-opponent
  standard errors (opponents treated as independent). "Bold" = CI excludes 0.
  Match win/loss counts are also reported (relevant if the tournament scores
  matches won rather than chips).
* **Timing.** Single process on an otherwise idle machine, each bot × variant:
  vs random-legal (odd spots) and vs balanced (realistic spots); mean, p99, max;
  counts over 100 ms / 500 ms / 2 s; projected seconds per 1000-hand match.
* **CFR budgets.** Checkpoints of one wall-clock-budgeted run (setup included);
  abstract-game exploitability (full CFR: sampled best response, held-out lower
  bound and in-sample upper-biased estimate; preflop CFR: exact BR on the abstract
  game) + real-game duplicate results vs `equity` and `balanced` (10 pairs each).
* **Robustness.** A `Miswired` wrapper corrupts only what the bot believes (the
  engine still enforces the true rules): blind order flipped (a), Omaha "exactly 2"
  read as "any" (d), short-deck rankings read as standard (e), 20bb game run with
  the 100bb spec (f), face-up board discard read as a face-down muck discard (c).
  Metric: bugged bot vs its own clean version, 6 pairs.
* **Lead protection.** X+lp vs X (same bot), 60 pairs = 120 matches per bot;
  by symmetry the baseline is 50% match wins and 0 bb/hand.
* **Adaptation drill.** (a→b..g) Spec lines and bot code changed. Plus three
  hold-out variants never shown to the bot authors (5-card PLO; 4 hole cards with
  two face-up discards and an ante at 50bb; 3 betting rounds with a 4-card flop),
  run exactly as the day-of procedure (`dayof.py` + 5-minute CFR runs).

## Reductions (what was cut to fit the machine)
* Full-game CFR: 60-minute runs only on variants a and c; 30 minutes on b, d, e, f, g.
  Round-robin uses the 30-minute checkpoints everywhere.
* Preflop CFR: 30 minutes on a and c, 15 minutes elsewhere; round-robin uses 15m.
* CFR strength-vs-time head-to-heads on variants a and c only.
* Robustness: 6 pairs per cell (not 10).
* Multiway is not supported (`players_per_hand` must be 2); a multiway variant would
  need engine work on the day.
* The container restarted once mid-run; all experiments are resumable and resumed.
* CFR wall-clock budgets ran with 3–5 processes on 4 cores, so iteration counts
  (reported) are a better measure of compute than minutes.
