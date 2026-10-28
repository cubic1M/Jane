# Adaptation drill log

## Prepared variants (a -> b..g)
All bots were written knowing these seven specs, so this part of the drill mostly
measures the spec: each variant is one `GameSpec(...)` of 3–8 lines in
`engine/variants.py`, and **no bot module changed for any of them**. The per-variant
compute cost on the day is the only real difference between approaches:

| approach | code change per variant | compute before it can play |
|---|---|---|
| equity | 0 lines | ~0.4 s per-spec preflop profile at first `new_match` |
| balanced | 0 lines | ~0.3–0.6 s per-spec preflop model at first `new_match` |
| adaptive | 0 lines | as balanced |
| preflop_cfr | 0 lines | a training run (5/15/30 min); 1 min already gives a usable policy |
| full_cfr | 0 lines | a training run (15/30/60 min); quality still rising at 60 min |

## Hold-out variants (never shown to the bot authors)
Drill run as on the day: write the spec, run `python3 dayof.py --variant X`, then
train the CFR bots for 5 minutes each, then a short duplicate round-robin
(3–4 pairs x 1000 hands). The machine was fully loaded by other experiments
(4–5 processes on 4 cores) during the drill, so wall times are pessimistic.

| | h_plo5 | i_double_discard | j_3street |
|---|---|---|---|
| rules | 5 hole cards, exactly 2, **pot-limit** | 4 hole, 2 face-up discards (flop, turn), **ante**, 50bb | **3 streets**: preflop, 4-card flop, river |
| spec | 3 lines | 6 lines | 3 lines |
| bot code changed | 0 lines (all 5 bots) | 0 lines | 0 lines |
| `dayof.py` (rules, conformance x5 bots, timing, strength) | 87 s, GO | 112 s, GO | 35 s, GO |
| preflop CFR 5-min run | OK: 123,489 classes -> 50 buckets (33 s), matrix 227 s, 52.6k iters | OK: 16,432 classes -> 50 buckets, 47.4k iters | OK: 169 classes, 24.8k iters |
| full CFR 5-min run | OK but slow: setup 97 s (134k-class table), **151 iterations** | 410 iterations | 1,909 iterations |
| worst decision time (any bot) | 10 ms | 22 ms | 7 ms |

Duplicate results on the hold-outs, bb/hand for the row bot, mean ± 95% CI
(h: 4 pairs, i/j: 3 pairs; small samples, so most cells are within noise):

| row vs | balanced | adaptive | equity | preflop_cfr@5m | full_cfr@5m | station |
|---|---|---|---|---|---|---|
| **h_plo5** balanced | — | n/a | +1.18 ± 0.60 | +0.10 ± 0.45 | +0.15 ± 0.73 | +3.24 ± 0.48 |
| h preflop_cfr@5m | −0.10 ± 0.45 | n/a | +1.00 ± 0.75 | — | +0.47 ± 0.87 | +3.50 ± 0.24 |
| h full_cfr@5m | −0.15 ± 0.73 | n/a | −0.02 ± 0.92 | −0.47 ± 0.87 | — | +2.06 ± 0.29 |
| **i_double_discard** balanced | — | −0.23 ± 0.32 | +1.97 ± 1.02 | +0.23 ± 1.18 | −0.34 ± 0.11 | +7.35 ± 0.82 |
| i adaptive | +0.23 ± 0.32 | — | +2.56 ± 1.16 | +0.48 ± 0.89 | −0.51 ± 0.45 | +11.17 ± 1.49 |
| i preflop_cfr@5m | −0.23 ± 1.18 | −0.48 ± 0.89 | +1.35 ± 1.08 | — | +0.02 ± 0.91 | +6.17 ± 1.15 |
| i full_cfr@5m | +0.34 ± 0.11 | +0.51 ± 0.45 | +0.86 ± 0.78 | −0.02 ± 0.91 | — | +4.48 ± 0.72 |
| **j_3street** balanced | — | +0.27 ± 0.62 | +1.31 ± 0.63 | −0.20 ± 0.73 | −0.17 ± 0.50 | +2.07 ± 0.31 |
| j adaptive | −0.27 ± 0.62 | — | +1.81 ± 0.25 | −0.12 ± 0.64 | −0.08 ± 0.26 | +5.13 ± 0.44 |
| j preflop_cfr@5m | +0.20 ± 0.73 | +0.12 ± 0.64 | +1.39 ± 0.18 | — | −0.01 ± 0.18 | +2.33 ± 0.41 |
| j full_cfr@5m | +0.17 ± 0.50 | +0.08 ± 0.26 | +0.67 ± 0.60 | +0.01 ± 0.18 | — | +1.19 ± 0.71 |

What the drill changed in the tooling (fixes made because of it):
* `dayof.py` now flags a CFR bot that is silently playing its fallback ("OK but NO POLICY").
* `engine/variants.py` got a `DAY_VARIANTS` slot so a day-of spec is one tuple entry.
