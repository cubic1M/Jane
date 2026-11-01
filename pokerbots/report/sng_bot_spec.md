# Bot spec for a from-scratch rebuild (plan B)

Use this if prepared code may not be brought to the event. Everything here is knowledge
rather than code: what to build, in what order, which numbers to use, and which tests
catch the bugs that cost the most. The reference implementation is
`sng/ours/icm_tag.py`; parameter values come from the tuner (`results/sng_tune/`).

## Order of work (minutes from the start of the build)

1. **0–10. Safe bot first.** It must never time out and never raise an error:
   - fold when facing a bet, check when free;
   - shove the top 10% of hands when at 10bb or less.

   Wrap `act` in try/except so an error returns check-or-fold. Submit it.
2. **10–25. Preflop strength table.** Monte Carlo equity of the 169 hold'em classes
   against k = 1..7 random hands. Use the kit's simulator or evaluator, about 3,000
   deals per class, vectorised. Save it to a file and load it at import, never inside
   `act`. For a variant with other cards, build it for that deck and ranking.
3. **25–40. Decision rules (below), then submit.**
4. **40+. Postflop strength.** A coarse table keyed by made-hand class, draw class and
   street, filled by Monte Carlo. Or, as a stopgap, made-hand rules: top pair or better
   bets, a draw calls if pot odds allow, otherwise check or fold.

## Decision rules (`icm_tag`)

Let `eq(k)` be the equity against k random hands, `bb` the big blind, `eff` the
effective stack in big blinds.

* **Preflop, no raise yet.**
  - Let `k` be the players still to act, plus limpers.
  - Open-raise to 2.5bb (+1bb per limper) if `eq(k) ≥ open_mult / (k + 1)`.
  - Lower that bar against blinds that fold to steals: the per-table fold-to-steal
    count can bring it down by up to 25%.
  - At `eff ≤ push_bb`, shove instead of raising, with the bar scaled by
    `0.75 + 0.25 · eff / push_bb` (shorter = wider). Fold everything else.
* **Facing a raise.**
  - The raiser counts as `range_k ≈ 4` random hands (+0.8 per extra player).
  - 3-bet (shove when `eff ≤ 2 · push_bb`) if equity ≥ `threebet_eq`.
  - Otherwise call only if equity ≥ pot odds + `call_margin`, plus the ICM premium
    `risk · (1 + 0.15 · players busted)` when the call risks 40% or more of the stack.
* **Postflop.**
  - Equity is against the players still in. Multiply it by `bet_discount ≈ 0.6` for
    each bet or raise on this street.
  - Bet 65% of the pot at equity ≥ `value_eq`.
  - C-bet the flop half-pot heads-up as the preflop raiser, `cbet` of the time.
  - Call at pot odds + margin (+ ICM premium for big calls). Raise only very strong
    hands.

## Tuned parameter values (blend field; beats the previous values in all 6 validation cells)

| parameter | value | meaning |
|---|---|---|
| open_mult | 1.07 | open if equity vs the k players behind ≥ 1.07/(k+1) |
| open_size | 2.0 bb | +1 bb per limper |
| steal_bonus | 0.55 | lower the open bar by up to 55% vs players behind who fold to opens |
| steal_max_behind | 5 | use that read with up to 5 players behind (blinds only when ≤ 2) |
| push_bb | 9 | shove-or-fold at or below 9bb effective |
| push_mult | 1.00 | shove bar 1.00/(k+1), scaled 0.75–1.0 by depth |
| range_k | 4.0 | a raiser = 4 random hands (+0.8 per extra player in) |
| call_margin | 0.06 | equity needed above pot odds |
| threebet_eq | 0.62 | 3-bet / re-shove (re-shove at ≤ 24bb) |
| risk | 0.10 | ICM premium on big calls at 8 left, +15% per busted player |
| value_eq | 0.62 | postflop value-bet bar |
| bet_discount | 0.6 | multiply equity by 0.6 per bet/raise faced this street |
| cbet | 0.55 | heads-up flop c-bet frequency, half pot |
| bet_frac | 0.65 | value bet size (pot fraction) |

## The numbers that mattered most (paired tables, 400–600 per cell)

* Calling tightness is the biggest lever. Treating the raiser as 4 random hands
  instead of 2.5 was worth +8.8 points per table, and a 6% calling margin +5.4.
* Second tuning, on a blend of fields: open smaller (2bb) and wider, push/fold from 9bb,
  and steal against any folding table. That was +4 to +15 over the first tuning on every
  field, most on tight fields (mirror +15, strong +10).
* Stealing wider against blinds that fold was worth +5.6. Bots that time out auto-fold,
  so they are the easiest seats to steal from.
* Monte Carlo bots that compare against random hands call too much and finish last.
  A bot that only ever folds still scores near average: survival is paid.

## Ten tests that catch the expensive bugs

1. Every decision under 0.3 ms (p99) on the laptop. Measure it; do not assume it.
2. The first decision of a table is not slow: tables load at import or table start.
3. An exception in `act` returns check-or-fold, never a crash.
4. Raise amounts: raise-to vs raise-by matches the kit's API (check it against their simulator).
5. Pot-limit maximum respected if the variant is pot-limit.
6. Short all-in: the bot handles "call only" when it cannot re-raise.
7. Heads-up blind order once only two players are left.
8. Stack in big blinds uses the current level's big blind (blinds rise every 25 hands).
9. The bot never folds when checking is free.
10. 500 local tables against the kit's sample bots: 0 errors, 0 timeouts, and points above average.
