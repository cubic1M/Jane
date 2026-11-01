# Timed dress rehearsal of the real format (8-bot sit-and-gos)

An organiser subagent wrote a fake starter kit without seeing our code
(`rehearsal_sng/`). It contains:
- a README;
- its own Agent interface (`table_api.Agent`, `decide(obs) -> Action`);
- a multiway simulator with a 1 ms rule, an ICM calculator and sample bots.

Its 15 planted gotchas were kept in `ORGANISER_NOTES.md`, out of git, and read only
after the end.

**Variant:** Six-Plus Hold'em (36 cards; flush > full house; trips > straight;
A-6-7-8-9), antes from level 3, point table 100/70/50/35/25/15/5/0, single-file
submission (`submission/bot.py`, no imports of your own files).

| time (UTC) | step |
|---|---|
| 07:16:18 | kit handed over; README read. Noted: single file only; pot excludes current bets; `committed` = this round, antes excluded; 1-based hands; point table listed 8th first; trips > straight; antes; timing includes lazy setup and GC |
| 07:16–07:17 | wrote `sng/bundle.py`, which bundles our modules, a stand-in for the engine's actions, and the base64 strength table into one file. Wrote the kit adapter (`rehearsal_sng/adapter.py`): rebuilds the hand's committed chips and pot from the kit history, maps cards, statuses and legal actions |
| 07:17:59 | first local run: 30 tables, **84.8 points per table** (average place 1.6), 0 errors, 0 timeouts, slowest 0.58 ms |
| 07:18:12 | 200 tables with a stricter 0.5 ms limit on a loaded machine: 82.6 points, 9 timeouts in ~45,000 decisions (0.02%) |
| 07:18:40 | **bug found:** the bundle registered a module named `engine`, and the kit's simulator is also `engine.py`. It worked only because the kit imported its module first; in the other order the kit's own imports break. Fixed: all bundled code now lives under a private package `_nlb`, with imports rewritten. `sng/tests/test_bundle.py` checks both import orders and that no public module name is taken |
| 07:19:28 | invariant check through the kit runner. **21,848 decisions: pot = sum of committed chips, chips = 16,000, raise bounds, cards (no ranks below 6): 0 violations** |
| 07:19:53 | rehearsal rules encoded as a preset (`sng/presets.py: rehearsal_sixplus`). Arena: icm_tag 74.9 points per table vs pushfold_icm 51.6 and chen_tag 50.8, **+23.4 ± 4.9 paired** |
| 07:23:58 | quick A/B of push depth and ICM risk on these rules: no change significantly better than the defaults, so the defaults stay |

**Kit to verified, tuned submission: 8 minutes.**

## Gotchas (organiser's list, scored after the end)

| # | gotcha | handled | how |
|---|---|---|---|
| 1 | raise-TO, helper named `raise_` | yes | adapter passes raise-to totals |
| 2 | `stack` excludes `committed` | yes | all-in = `max_raise_to`; effective stack = stack + committed |
| 3 | `to_call` not capped by stack | yes | call amount = min(to_call, stack) |
| 4 | `obs.pot` excludes current bets | yes | pot = obs.pot + Σ committed (invariant-checked) |
| 5 | cards `T`, no 2–5 | yes | parse_card; short-deck table |
| 6 | flush > full house, trips > straight, A-6-7-8-9 | yes | `SHORT_DECK_ORDER`, ace-low; the strength table is built for those rules |
| 7 | players indexed by seat, `out` seats stay | yes | in_hand = status != out; players_left counted from statuses |
| 8 | heads-up blind order | yes | kit's sb/bb seats used as given |
| 9 | antes dead, not in committed | yes | hand totals rebuilt from history incl. antes |
| 10 | level boundaries / 1-based hands | yes | the kit's big blind is used as given; hand number −1 |
| 11 | asymmetric illegal fallbacks | yes | never returns check facing a bet; fold → check when free |
| 12 | short all-in does not reopen | yes | `can_raise` from the kit's `legal_actions` |
| 13 | timing includes lazy setup and GC | yes | tables loaded at import; `gc.freeze()` in `__init__` |
| 14 | one process per table in the tournament | yes | everything at import / `__init__`; nothing relies on module state across tables |
| 15 | point table listed 8th first | yes | payouts written 1st-first in the preset and adapter |

**15/15 handled.** The bug that would have cost us was not on the list: a module-name
collision between our bundle and the kit. On the real day a collision could break the
organiser's harness, not just our bot. Now fixed and tested.

## What changes in the day-of plan

* `sng/bundle.py` is the submission step: write the adapter, bundle, then run the
  kit's runner on the bundled file.
* `submission/check_bot.py` (invariant wrapper) is a 2-minute proof of the
  observation mapping. Run it before every submission.
* Encode the day's rules as a preset first, then arena and tuner on it.
