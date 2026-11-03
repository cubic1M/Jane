# Day card: No Limit regional (print this)

**Format:**
- 8-bot sit-and-gos: 2,000 chips, blinds from 10/20, +1 level every 25 hands, stop at 200 hands (ICM pays the survivors).
- **1 ms per decision**; a timeout or error = check, else fold.
- Rounds T1–T6 at minutes 60, 80, 100, 120, 140, 160, weighted 1–6. **T4–T6 = 71% of the score.**
- Resubmit at most every 5 minutes; each round freezes the bot active at its start.

**Before the event:**
- [ ] Ask the organisers in writing: may we bring code we wrote beforehand? Written notes? AI tools after the build phase?
- [ ] Laptop: `git pull`, `./run_tests.sh` green (8 suites, about 3 min).

## Minute 0–10: read, do not type

Fill in each line:
- [ ] Variant: deck, hole cards, board, **hand ranking**, betting limit, antes →
- [ ] Point table (which order is it listed in?) →
- [ ] Blind schedule (all levels; antes from which level?) →
- [ ] Agent interface: class name, method, Observation fields, Action constructor →
- [ ] **Raise-to or raise-by?** Stack includes current bet? Pot includes current bets? →
- [ ] Card spelling (`T` or `10`?), suit letters, seat numbering, how busted / folded players show →
- [ ] Single-file submission? Allowed imports? `__init__` time limit? One process per table? →
- [ ] How the 1 ms is measured (does first-call setup count? GC?) →

## Plan A: our code allowed (rehearsed: 8 minutes from kit to verified submission)

1. Rules → `sng/presets.py` (one entry: card rules `GameSpec`, blinds, antes, points 1st-first).
2. Strength table. **12 card variants are already in git** (`cache/sng/strength_*.npz`):
   hold'em, short deck (both rankings), flush > full house, six-plus ranking on 52 cards,
   3 hole cards (any / exactly 2), Omaha 4 (exactly 2 / any), PLO5, no river, a 4-card flop.
   A table is matched by card rules, not by name. Otherwise:
   `python3 -m sng.ours.build_tables --variant <v> --minutes 4 --workers 4`.
   **Discard or draw variant** (players throw or replace cards):
   - play `icm_any` instead of `icm_tag`;
   - build its table by simulating the variant: `python3 -m sng.ours.anyvar --spec <module:SPEC> --seconds 120`;
   - bundle with `--any-table cache/sng/any_<sig>.json`;
   - in the adapter, answer discard requests with the bot's `Discard(cards)`.
   Four shapes are prebuilt: discard to the board, face-down discards, hold'em with a 0–1 draw, five-card draw.
   `icm_any` leaves the heads-up ranges and exact-ICM calls off: they helped hold'em, but not most
   discard presets. Add `hu_open_mult=0.6;hu_range_k=2.0` and `icm_call=1` as tuner candidates
   (five-card draw liked the heads-up ranges). On an Omaha-like discard variant, try `push_steal=0` first
   (−2.2 there, not significant; +2.7 on five-card draw).
3. Adapter: copy `rehearsal_sng/adapter.py`, then map their Observation and Action.
4. Bundle. **Read the submission rules first:**
   - banned builtins (`exec`, `compile`, `setattr`, `eval`, `open`)?
   - an import whitelist?
   - a file-size cap?

   - Permissive kit: `python3 -m sng.bundle --adapter adapter.py --variant <table> --out submission/bot.py`.
   - **Restrictive kit** (like practice kit 2: no exec, whitelisted imports, 100 KB):
     `python3 -m sng.bundle_flat --adapter adapter.py --any-table <table.json> --out submission.py`
     (no exec, allowed imports only, only reachable code, about 69 KB).
   - **A file-size cap:** add `--compact` (same decisions, tested: about 51 KB with kit 2's adapter).
     A lean adapter saves a few KB more. **Under about 45 KB, go to Plan B** (it fit kit 3's 32 KB).
   - Templates: `rehearsal_sng/adapter.py` (Agent class, raise-to) and
     `practice_kit2/adapter_kit2.py` (module functions, raise-by, seats renumbered every hand,
     handled with a stable-identity ring; draw protocol).
   - **Always run the kit's local runner, not only its checker.** A file can pass the checker and
     still crash at load: `@dataclass` + `from __future__ import annotations` fails when the kit
     loads the module unregistered. The bot then folds every table.
5. Prove it, all three required:
   - their runner on the bundle: 0 errors;
   - the invariant wrapper (`check_bot.py` pattern): 0 violations;
   - our arena on the preset: `python3 -m sng.arena --preset <p> --candidates icm_tag,pushfold_icm --tables 300`.
6. **Submit by minute ~25.**
7. Minutes 25–160 (validated switches worth adding as tuner candidates on the day:
   `resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5` (it beats tight fields, +5 vs our own copies);
   `call_margin=0.09;range_k=3.2` if 1st takes most points;
   `push_steal=0;steal_bonus=0.3` if the field re-steals (adaptive bots: +3.6 to +4.7 on field 4, −2.0 on all3);
   `resteal_rel=0.5` if the field is tight (+10.7 vs Plan B copies, −1.6 on the hackathon-like field);
   `behind_k=0` if the field is tight (+2.9 vs Plan B copies, +3.4 vs our copies, −2.9 on the default field)):
   - tune: `python3 -m sng.tune --preset <p> --field blend --rounds 3 --tables 500 --accept-se 2 --tag _day` (about 15–25 min per round);
   - validate: `results/sng_validate.sh "icm_tag:<tuned>" --preset <p>`;
   - submit only a paired gain > 2 SE with no field losing.

**Payout-shape profiles (validated on fresh seeds):**
- the risk premium already scales with the point table (pass the real `Rules.payouts`);
- if 1st takes (nearly) everything, also start from `icm_tag:call_margin=0.09;range_k=3.2`, worth +1.6 per table on winner payouts;
- top-3 or flatter: the defaults.

## Plan B: from scratch (rehearsed 4 times: 15, 10, 7, 9 minutes to a verified bot)

- The prompts carry tonight's rules: the rebuilt bot scores 39.7 vs the old Plan B's 34.2 in mixed tables (Plan A 41.4).

- Paste the 4 prompts in `report/sng_codex_prompt.md` in order; check each "done when".
- **Submit after prompt 1 (safe bot), again after prompt 3.**
- Between rounds: paired A/B (seeded, time limit raised, ≥ 800 tables, > 2 SE).

## Gotchas that cost points (from 3 rehearsals)

| gotcha | check |
|---|---|
| raise-to vs raise-by; all-in = max raise-to (not stack) | read the Action docs; one hand by hand in the log |
| pot excludes the current street's bets; antes are dead money | invariant: pot = Σ chips in this hand |
| `to_call` may exceed my stack | call amount = min(to_call, stack) |
| point table listed 8th first | write payouts 1st-first |
| adapter's `Rules` without the real point table | set `Rules.payouts` (1st-first): the risk premium scales with its shape (winner-take-all = none) |
| hand ranking changed (e.g. flush > full house, trips > straight) | the strength table must be built with the same order |
| busted players stay in the seat list | players left = count of non-busted |
| heads-up: the button posts the small blind | use their sb/bb seats as given |
| timing counts first-call setup and GC | load tables at import / `__init__`; `gc.freeze()` |
| **our bundle's module names vs theirs** (the kit's `engine.py`!) | the bundle uses the private `_nlb` package (tested) |
| unseeded randomness makes A/B on "same seeds" lie | seed everything; raise the time limit for A/B |
| seats renumbered every hand (button = 0, close up after knockouts) | stable-identity ring keyed from my seat; remove `knocked_out_seats` |
| submission rules ban exec / imports / size | `sng/bundle_flat.py`; check the rules before bundling |
| a file passes the checker but crashes at load | run the kit's runner; no `__future__` annotations with dataclasses |
| `pf_chart=1` in a flat bundle | the flat bundle leaves out the push/fold chart loader: keep `pf_chart=0` (the default) there |
| amounts in big blinds, rounded (e.g. 0.5bb) | convert units; all-in = their max, rounded UP |
| 3+ hole cards with a discard before the flop | key preflop on the 2 cards kept; preflop discard by table equity |
| import whitelist, `open` banned, 32 KB cap | compact digit-string tables; no `hash()` seeds |
| named positions, stable player ids | track opponents by id, not seat |

## Where we stand (current `icm_tag`, fresh seeds)

These are points per table over the strongest bot in each field, from two independent fresh-seed checks
(`results/sng_final_check.md`, 300 tables; `results/sng_final_check2.md`, 400 tables, after the
heads-up and payout changes):

| field | margin, check 1 / check 2 |
|---|---|
| default | +23 / +19 |
| strong | +27 / +32 |
| our own copies (mirror) | +5 / +7 |
| field 3 (written independently) | +10 / +6 / +12.8 |
| field 2 (written independently) | +7 / +1 / +0.8 (tie with `f2_shark`, 800 tables) |
| all three fields, top-3 payouts | +4.5 / +2.3 (not significant) |
| hackathon-like field, all three under winner payouts | tie with `f3_exploiter` (±1) |
| **field 4** (six adaptive bots written blind, the hardest) | mid-pack: 33.5–36.5 per table (fair 34.75); `f3_exploiter` about +11 there |
| **all three fields, after tonight** (`results/sng_standing3.md`) | **first: 61.0 per table**; `f3_exploiter` −7.2, field 4's best −12.8, `f2_shark` −19.9 (all significant) |

Tonight's eight changes, measured together on fresh seeds against the start-of-night bot: **+5.7 per table on
average** over 9 fields, eight significant, none negative: the Plan B field +14.5, our copies +9.2, field 3 +6.7,
winner payouts +6.3, default +4.1, field 4 +3.3 (`results/sng_night_total3.md`).

So we clearly beat our own fields, and beat or tie the best independently written bots. The edge
over a strong independent bot is a few points per table, not a landslide. That is why the day-of
loop (tune on the real rules, validate, resubmit) matters.

## Rules of thumb that held on every field we tested

- **Call tight, but count only who is in:** a raiser = 4 random hands, +0.8 per caller, +0.2 per player still to act (was 0.8 for everyone: +0.7 per table, +1.2 vs the Plan B bot); need pot odds + 6%; ICM premium on big calls.
- **Respect postflop bets:** our equity x 0.5 per bet or raise faced (was 0.6; +1.0 per table on fresh seeds).
- **All-in calls use exact ICM** (break-even from the real stacks and point table, +2%): +0.3 to +2.2 per table.
- **Open small (2bb) and fairly wide; steal more from seats that fold** (the bots that time out fold).
- **Re-shove over wide openers:** facing a lone open at ≤ 28bb, shove the top 35% of the opener's opening range (+2.25 per table; +7 to +8 vs tight fields).
- Push or fold at ≤ 9bb, **wider against blinds that fold** (the steal read on shoves too: +1.45 per table, +5.6 vs the Plan B bot). Re-raise preflop only with AA.
- **Heads-up, open and defend much wider** (open bar 0.6/2, a raiser = 2 random hands): +2 to +12 per heads-up table.
- Surviving pays: even an always-fold bot scores mid-table. Busting early is the costly mistake.
