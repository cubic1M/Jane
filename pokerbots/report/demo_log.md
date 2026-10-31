# Timed day-of demos (idle 4-core machine)

Two drills of the 60-minute plan. Both games were "announced" under names our
code had never seen. Times are machine time. The person's reading and spec-writing
time comes on top: about 1–2 minutes, based on the rehearsal (§7b).

## A. Library hit: the rehearsal game under a new name (`demo_irish`)

Spec: `K_IRISH.with_(name="demo_irish")`. The game is pot-limit Irish hold'em at
1,500 chips, with 1 s per decision and a 120 s bank. Bots ran through the real
rehearsal server and our JSON adapter.

| step | machine time | result |
|---|---|---|
| `dayof.py --bots balanced,champion@15m_w4,champion@15m_w4+lp` | 88 s | GO. LIBRARY line: same game as `full_k_irish_15m_w4.pkl`. All 3 bots OK; the champion averages 1.9 ms per decision (max 19 ms) |
| server: `champion@15m_w4+lp` vs example bot, 1,000 hands | 4 s | +607 chips (lead protection folds out a won match), 0 illegal, 0 timeouts |
| server: `champion@15m_w4` vs example bot, 2 × 1,000 hands | 15 s each | +87,555 and +84,126 chips (+8.6 bb/hand). Slowest decision 22 ms; 108 s of 120 s bank left |
| server: `champion@15m_w4` vs `balanced` (both through the adapter), 1,000 hands | 27 s | +5,441 chips (+0.54 bb/hand; one match, noisy) |
| `replay_check.py` on all 4 server logs | 2 s | 4,000 / 4,000 hands identical through our engine |
| adapter warnings in stderr | | none |

**The trained champion is ready about 2 minutes after the spec is written.** By the
plan, the earliest switch to the champion moves from minute 35 to about minute 20, when the
adapter has been proven.

## B. Library miss: hold'em at a new chip scale (`demo_nlhe_scaled`)

Spec: `A_NLHE100.with_(name="demo_nlhe_scaled", small_blind=50, big_blind=100,
starting_stack=10000)`. This is the same game as `a_nlhe100`, but chip amounts are part of the
game tree, so the library does not match. `dayof.py` said so and named `a_nlhe100`
as the nearest game, differing only in `small_blind, big_blind, starting_stack`.

| time | step |
|---|---|
| +0 s | `dayof.py --variant demo_nlhe_scaled --bots balanced,champion@15m_w4 --train-full 15 --workers 4` |
| +52 s | dayof GO (balanced is safe to submit); training running in the background |
| +5 min 3 s | 5-minute checkpoint written; `dayof --quick --bots champion@5m_w4` GO in 1 s |
| +15 min 5 s | 15-minute checkpoint written (6,438 iterations, about 7 per second on 4 workers) |
| +15 min 7 s | `dayof --quick --bots champion@15m_w4,champion@15m_w4+lp`: GO in 2 s; 0.2 ms per decision |
| +16 min 21 s | strength check done (6 duplicate pairs × 1,000 hands per opponent, 4 workers) |

Strength of the freshly trained champion, in bb/hand with 95% CI and matches won. The same seeds were
also played on the library game `a_nlhe100`:

| opponent | `demo_nlhe_scaled` (trained on the day) | `a_nlhe100` (library) |
|---|---|---|
| balanced | +0.36 ± 0.31 (8–4) | +0.24 ± 0.21 (8–4) |
| opp_tag | +0.14 ± 0.18 (9–3) | +0.04 ± 0.22 (7–5) |
| opp_exploit | **−0.39 ± 0.27** (3–9) | −0.39 ± 0.37 (3–9) |

The two columns agree, so the day-trained policy is as good as the library one and
the 50/100 chip scale is handled correctly. The loss to `opp_exploit` is not caused by the
scale; it reproduces at library scale. It is the same weakness as in round 2 (§7a:
champion −0.23 ± 0.20 vs opp_exploit over 5 variants). It is the champion's one losing
matchup and the next thing to study.

**A library miss puts the champion's switch about 16 minutes after the spec,
i.e. minute 20–25 of the hour, well inside the plan's minute-35 slot.**

## Tests

`./run_tests.sh` (also `make test`) runs all 5 suites in parallel:

| suite | tests | time |
|---|---|---|
| engine | 41 | 158 s |
| bots | 118 | 174 s |
| opponents | 47 | 92 s |
| tournament | 22 | 4 s |
| rehearsal server | 16 | 7 s |
| **all, in parallel** | **244** | **2 min 54 s wall** (about 7 min one after another) |

Found and fixed during the demo: the library test treated a policy trained on the day
as a library file missing from the manifest, so it would have failed on the day,
right after training. It now checks only the 14 library games.
