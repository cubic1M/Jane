# Day card: No Limit regional (print this)

**Format:**
- 8-bot sit-and-gos: 2,000 chips, blinds from 10/20, +1 level every 25 hands, stop at 200 hands (ICM pays the survivors).
- **1 ms per decision**; a timeout or error = check, else fold.
- Rounds T1–T6 at minutes 60, 80, 100, 120, 140, 160, weighted 1–6. **T4–T6 = 71% of the score.**
- Resubmit at most every 5 minutes; each round freezes the bot active at its start.

**Before the event:**
- [ ] Ask the organisers in writing: may we bring code we wrote beforehand? Written notes? AI tools after the build phase (rule 3.4)? Giving the variant to an AI (rule 6.4)?
- [ ] Laptop: `git pull`, `./run_tests.sh` green (19 suites, about 5 min).

**The bot, in one line each (state on Nov 5):**
- **Hold'em (2 cards, no discards), permissive kit (numpy, multi-module bundle allowed): submit `icm_switch`** = `icm_tag` until our opens get re-raised ≥ 30% of 20+ opens (the lock), then `f9_meta` (warm: it shadows every hand; `icm_switch:b=f7` = the first version, to `f7_balanced`). Fresh seeds, 600 tables x 14 setups: **+1.2 (to f7) / +1.8 (to `f9_meta`) per table vs `icm_tag`, no setup significantly worse**; head to head on 8 more setups `f9_meta` +1.1 over f7; strong tables +3 to +5 (fields 6 / 7, champions, strongest-bots mix, field 9, our own copies), weak / static tables −1 to +0 (n.s.). Bundle: `python3 -m sng.bundle ... --with-switch`, adapter imports `from sng.ours.switch import IcmSwitch` (tests: `sng/tests/test_bundle_switch.py`). Timing (real bundle): with an end-of-hand callback, every decision p99 < 0.2 ms; if end-of-hand work counts inside the next decision (kit-4 style), ~0 over 1 ms before the hand-over and **~0.7% after it** (p99 0.93 ms; bundle 5.8 MB) → if the interface is decision-only and the 1 ms is strict, weigh that against the +1.2.
  Known cost: tight static fields (our field 5) about −1.5 per table (a hand-over on noise); if the room is clearly tight and passive, `icm_tag` is marginally better.
  Expected edge of `icm_switch` over `icm_tag` in a realistic room (our guess: half team bots, a quarter old-style, a quarter strong): about 0 to +1 per table in hold'em, +2 to +4.5 under kit-4 rules; +4 to +7 at strong tables.
- **Strong room (logs: competent bots, our opens re-raised ≥ 30%; also the finals): resubmit `icm_switch:start=b;back_share=0.22;switch_min=15`** — plays `f9_meta` from hand 1 and hands static tables back to `icm_tag`: strong tables +6 to +16 vs `icm_tag` on fresh seeds (`icm_switch`: +2 to +7), room guess +7 (`icm_switch` +3), but tight tables −8 (field 5) and team bots −4: never against a weak or tight room. With an untimed end-of-hand callback use it as is; **if end-of-hand work counts inside the next decision, add `;f9_min_left=6`** (no ICM while 7-8 players are alive: 0.19% of decisions over 1 ms instead of 18%; costs about 3.6 per table in a mixed room, little at strong tables).
- **Six-plus short deck (ranks 6-A), permissive kit: start with the strong-room option `icm_switch:start=b;back_share=0.22;switch_min=15`** (Nov 5 evening; `;f9_min_left=6` if end-of-hand work counts inside a decision). On short deck its hold'em weak spots disappear: vs `icm_switch` on fresh seeds (`results/sng_sd_strong_check.md`, `results/sng_allbots_check.md`, 400-600 tables each) field 5 +0.3 / −2.0 (two six-plus rule sets), field 10 −2.7, field 3 −1.0 (all n.s.), but the Plan B field **+7.7* / +8.1***, room guess **+5.0***, all-55-bot room **+5.3***: mean +2.6 over 8 setups, none significantly worse. Fresh-seed repeat incl. the decision-only version (`results/sng_sd_strong_fast.md`; exact / `;f9_min_left=6` vs `icm_switch`): Plan B field +9.8* / +26.3*, room guess +7.2* / +7.6*, field 10 +1.5 / −1.3, field 5 −0.8 / −1.1: **`;f9_min_left=6` keeps the edge** (on short deck it is fine even with an untimed end-of-hand callback: same or better than exact in 3 of 4 setups, so when in doubt about the timing model, add it). `icm_switch` (+2.7 vs `icm_tag` over 10 short-deck setups, hands strong tables to `f9_meta`) is the fallback. Same bundle.
- **`icm_switch` in a kit adapter:** swap `IcmTag` for `IcmSwitch` (`from sng.ours.switch import IcmSwitch`), bundle with `--with-switch`, and run the kit's own local runner: `Bot()` must build, 0 errors (rehearsed on the rehearsal kit; the file is ~8 MB with field 9's tables and a strength table — check the kit's size limit).
- **If tables have more than 8 players:** `icm_switch` is safe (field 9 uses chip values until 8 are left; tested at 9-10 players, no setup significantly worse at 6 players or with top-2 / linear / winner-take-all payouts or slow blinds); do not use `icm_switch:b=f7` there (p99 10 ms with 10 players in a decision-only interface).
- **Otherwise submit `icm_tag`** (2-card games, restrictive kit) or **`icm_any`** (discard / draw / Omaha / split-pot / wild games, or when only the flat bundle is allowed). `icm_switch` never hands over outside 2-card high no-limit games without discards (there it is exactly `icm_tag`). `icm_tag`: first by a lot against mixed and weak fields; legal and fast on 2.5M random rule sets (p99 ~0.1-0.3 ms).
- **Its weak spot:** tables of strong players who re-raise wide openers. `icm_tag` defends by itself (the lock); `icm_switch` hands such tables to `f9_meta` (needs the 5.8 MB switch bundle: numpy + field 9's tables); in a restrictive kit (flat bundle, small file cap) only the lock is left. `icm_switch:b=f7` is the first version (hands 52-card tables to `f7_balanced`: +1.2 instead of +1.8 on the 14 setups; same bundle).
- **Between rounds, if the logs show our opens re-raised ≥ 35% by competent players:** resubmit with `rfi_mode=2;rfi_scale=1.3` (or `icm_switch` if not already); if our short shoves keep getting called: `rs_call=3`; on a short deck vs strong re-raisers: `steal_max_behind=3`; a clearly strong field with `icm_switch`: hand over earlier with `icm_switch:rfi_lock_min=15;rfi_lock=0.27` (+0.8 exploration, strong tables +1 to +3).
- **Deploy times rehearsed:** Plan A (our bundle) accepted in 4.5 min on an unseen kit; Plan B (rebuild from `report/sng_codex_prompt.md`) verified in 5 min, scoring the same. Upgrading a working `icm_tag` adapter to `icm_switch` (one import line + `--with-switch` bundle + the kit's local runner): **5 s** of machine time on the rehearsal kit (Nov 5), so writing the adapter is the only real cost.

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

## Which tweak for which variant (everything below is tested; build the any table in 2 min)

| The secret variant changes... | Minimal tweak | Bot |
|---|---|---|
| deck (short deck, removed ranks) | `GameSpec(deck_ranks=...)`; ace-low straight follows the lowest rank | 2 cards: `icm_tag` (or `icm_any` two_card) |
| hand ranking (flush > full house, ...) | `category_order=...` | same |
| hole cards (3-5), Omaha "exactly 2" | `hole_cards=`, `hole_usage="exactly"`, `hole_exact=` | `icm_any` + table (Omaha: `icm_tag` has a finer table) |
| streets / board cards (3-street, 4-card flop) | `board_cards_per_street=(0, 4, 1)` etc. | `icm_any` + table |
| discards / draws (any timing, to board or muck, fixed or variable count) | `discards=(DiscardRule(...),)` | `icm_any` + table |
| **split pots: hi-lo 8-or-better** | `showdown="hilo8"` (presets `holdem_hilo8`, `omaha_hilo8`) | `icm_any` + table |
| **double board** | `showdown="double_board"`, `board_cards_per_street=(0, 6, 2, 2)` (preset `double_board`) | `icm_any` + table |
| **deuces wild** | `showdown="wild2"` (preset `holdem_wild2`; another wild rank: `wild_high(..., wild_rank=r)` in `engine/showdown.py`) | `icm_any` + table |
| a new pot-splitting rule (lowball, ...) | one function in `engine/showdown.py` + its name in `VALID` | `icm_any` + table |
| **fixed-limit betting** | `betting="fixed_limit"` (preset `fixed_limit`; SNG table only) | any (bots clamp to the one legal size) |
| pot-limit | `betting="pot_limit"` | any |
| blinds, antes, stacks, hand cap, players (2-8), points | `SngRules(blinds=, antes=, payouts=, max_hands=, num_players=)` or a preset | any |
| interface (names, units, seats, history format) | adapter from a template (`practice_kit4/adapter_kit4.py`, kit 2, rehearsal) | - |
| **knockout bounties** | `SngRules(bounty=<points>)` (preset `bounty10`); in a bundle set `bounty` on the adapter's `_Rules` (exact-ICM calls then add the bounty when we cover the shover) | `icm_tag` / `icm_any` (`icm_call=1`) |
| not modelled yet: stud (no board), exposed hole cards, jokers / five of a kind | play legally via the adapter; strength model approximate | `icm_any` |

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
   - **The kit's import whitelist:** pass it with `--allow "math,random,..."` (the default is practice
     kit 2's list, which allows `time`; kit 4 banned `time`, `os`, `sys`).
   - **2-card games in a restrictive kit:** the flat bundle's `icm_any` now switches on `icm_tag`'s hold'em rules by itself (`two_card=1`, +1.7 to +1.8 per table on fresh seeds), so Plan A loses little to `icm_tag` there.
   - **Never skip the any-variant table** (without it `icm_any` plays every hand as equal: PLO4 50.9 -> 59.5 per table with it).
   - **No any-variant table yet for the variant's cards?** `python3 -m sng.ours.anyvar --spec
     adapter.py-module:_SPEC --seconds 120` builds `cache/sng/any_<sig>.json` in 2 minutes (kit 4: six-plus).
   - **A file-size cap:** add `--compact` (same decisions, tested: about 51 KB with kit 2's adapter).
     A lean adapter saves a few KB more. **Under about 45 KB, go to Plan B** (it fit kit 3's 32 KB).
   - Templates: `practice_kit4/adapter_kit4.py` (module `play(view, memory)`, reply = chips to ADD,
     fixed seats 1-8, log string, `last_hand` on the next decision; rehearsal 5: accepted in 4.5 min),
     `rehearsal_sng/adapter.py` (Agent class, raise-to) and
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
   `resteal_rel=1.4;resteal_rel_bb=35` if the field is tight (+7 vs Plan B copies and our copies, −0.3 elsewhere);
   `behind_k=0` if the field is tight (+2.9 vs Plan B copies, +3.4 vs our copies, −2.9 on the default field);
   `steal_max_behind=3` if the table is strong and re-raises our opens (fresh seeds: kit-4 six-plus +2.9 to +6.0 on all 6 fields,
   champions +4.4* NLHE / +5.4* kit 4 / +5.1* rehearsal six-plus, mirror +8.7*; but NLHE field 5 −6.3* and the Plan B
   short-deck field −9.0*: never against tight, steal-folding fields);
   `rs_call=3` if the field re-shoves light (hold'em `icm_tag` only; off on `icm_any`) (+7.2 field 6, +3.6 mirror on fresh seeds, −1.1 field 3; head-to-head vs 2 on fresh seeds: field 6 +2.8*, mean over 11 fields +0.03, so only when the field re-shoves light)):
   - tune: `python3 -m sng.tune --preset <p> --field blend --rounds 3 --tables 500 --accept-se 2 --tag _day` (about 15–25 min per round);
     measured 2026-11-04 on kit-4 six-plus rules: one round over every parameter at 300 tables = **21 min wall on 3 workers**
     (59 CPU-min). For a ~20-minute window run **one round with a narrowed `--params` list** (the switches above), or
     fewer tables; three rounds at 500 tables do not fit between rounds. Its pick that day (`steal_max_behind=3`,
     +6.7 ± 2.4 on the tuning seeds) held on fresh kit-4 seeds but not on NLHE field 5 / the Plan B field: a between-rounds option (above), not a default;
   - validate: `results/sng_validate.sh "icm_tag:<tuned>" --preset <p>`;
   - submit only a paired gain > 2 SE with no field losing.

**Payout-shape profiles (validated on fresh seeds):**
- the risk premium already scales with the point table (pass the real `Rules.payouts`);
- if 1st takes (nearly) everything, also start from `icm_tag:call_margin=0.09;range_k=3.2`, worth +1.6 per table on winner payouts;
- top-3 or flatter: the defaults.

## Plan B: from scratch (rehearsed 5 times: 15, 10, 7, 9, 5 minutes to a verified bot)

- The prompts carry tonight's rules: the rebuilt bot scores 39.7 vs the old Plan B's 34.2 in mixed tables (Plan A 41.4).

- Paste the 4 prompts in `report/sng_codex_prompt.md` in order; check each "done when".
- **Submit after prompt 1 (safe bot), again after prompt 3.**
- Between rounds: paired A/B (seeded, time limit raised, ≥ 800 tables, > 2 SE).

## Between rounds (T1 -> T6): read the field, then maybe resubmit

If the organisers release hand histories or results between rounds, measure **how often our first-in
opens got re-raised** (opens re-raised / opens):
- **≤ 25%** (every static field we built: 13-23%): keep the defaults.
- **≥ 35%** (fields 6 and 7: 29-49%; there we finish last at 18-20 per table) **and the re-raisers are
  competent** (they are not maniacs who also shove junk): resubmit with `open_mult=1.6` (field 7 +7.7*,
  field 6 +6.8*, mirror +10.4*; but field 3 −11.5*, all3 −9.1*, field 5 −7.3*: only when the read is clear).
  (The default now does this by itself after 20 attacked opens: `rfi_lock=0.3`.) Or submit **`icm_switch`** (now the first choice on permissive kits, see the top: fresh seeds +1.2 over 14 setups, no significant loss): in the adapter import `from sng.ours.switch import IcmSwitch` instead of `IcmTag`, and bundle with `python3 -m sng.bundle ... --with-switch` (packs `sng.field7` with its tables embedded; tested: `sng/tests/test_bundle_switch.py`; permissive kits only).
   **Stronger, from hand 1: `rfi_mode=2;rfi_scale=1.3`** (position-based opening ranges, on only for a 52-card deck and
  not-top-heavy payouts): field 6 +10.5*, field 7 +10.2*, mirror +13.4*, field 4 +5.6*, but field 5 −9.6*
  (tight static fields that fold to steals): same condition, a clear "our opens get attacked" read.
  A one-way in-table lock (`lock_mult`) could not tell strong attackers from maniacs (default field −5.1*).
- Also check our bust hands: if most are short-stack shoves that got called, the field calls wide: `rs_call=3`.

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
| **field 4** (six adaptive bots written blind) | after `rs_call` (`results/sng_standing4.md`): **42.0 per table, top group**: `f3_exploiter` +2.5 and `f6_checkraiser` +1.1 (not significant), everyone else below (was mid-pack, 33.5–36.5) |
| **field 5** (written blind after tonight's tuning: out of sample) | **first: 60.8 per table** (was 58.1); `f3_exploiter` −13.9, every other bot −18 to −27 (all significant) |
| **all three fields** (`results/sng_standing4.md`) | **first: 61.5 per table**; `f3_exploiter` −7.9, field 6's check-raiser −13.8, field 4's best −18.4 (all significant) |
| hackathon-like field (`results/sng_standing4.md`) | first: 59.0 per table; `f3_exploiter` −1.2 (tie), everyone else −4 to −11 |
| **field 8** (five bots written blind to WIN: equilibrium push/fold, solver ranges, modeller, endgame, ensemble) | 31.1 per table, level with `f3_exploiter` 31.7 / `f7_balanced` 29.9 / `f2_shark` 28.2 (n.s.); a strong field |
| **champions table** (the best bot of every field) | **30.5 per table, mid-to-bottom**: `f7_balanced` +6.6*, `f2_shark` +6.1*; six-plus champions last (`f3_exploiter` +12.6*). Our weak spot: strong players who re-raise our opens |
| **field 6** (postflop specialists written blind; they re-raise wide openers light) | **last: 17.5 per table** (was 14.0 before `rs_call`), busts 92%; `f2_shark` 50.5, the others 30–38. Our known weak spot: if the real field re-raises our opens a lot, try `rs_call=3` and `pev=1` on the day-of tuner |

Today's changes on top (`rs_call`, `rfi_lock`, `icm_any` 2-card mode), measured together against this morning's bot (`results/sng_day2_total_*.md`, 13 fields): **+1.8 per table**, five significant (fields 6/7 +7.3 / +6.5, mirror +5.8, field 2 +2.6, field 4 +2.0), none negative.

Tonight's changes (behind_k, push_steal, the re-shove with its read, exact-ICM calls, heads-up ranges, the payout-aware
risk premium, bet discount 0.5 and `rs_call`), measured together on fresh seeds against the start-of-night bot
(`results/sng_total4_*.md`, 600 paired tables x 11 fields): **+8.2 per table on average**, nine significant, none
negative: the Plan B field +26.8, our copies +15.3, field 4 +10.2, winner payouts +9.6, field 6 +8.1, default +5.2,
field 5 +5.0, hackathon-like +4.4, field 3 +2.9, field 2 +2.3, all3/top-3 +0.2.

So we clearly beat our own fields, and beat or tie the best independently written bots. The edge
over a strong independent bot is a few points per table, not a landslide. That is why the day-of
loop (tune on the real rules, validate, resubmit) matters.

## Rules of thumb that held on every field we tested

- **Call tight, but count only who is in:** a raiser = 4 random hands, +0.8 per caller, +0.2 per player still to act (was 0.8 for everyone: +0.7 per table, +1.2 vs the Plan B bot); need pot odds + 6%; ICM premium on big calls.
- **Respect postflop bets:** our equity x 0.5 per bet or raise faced (was 0.6; +1.0 per table on fresh seeds).
- **All-in calls use exact ICM** (break-even from the real stacks and point table, +2%): +0.3 to +2.2 per table.
- **Open small (2bb) and fairly wide; steal more from seats that fold** (the bots that time out fold).
- **Re-shove over wide openers:** facing a lone open at ≤ 28bb, shove the top 100% × (the opener's open rate) of hands, scaled by how often that opener folds to re-raises (+2.25, then +4.5 more per table; +14 vs tight fields).
- Push or fold at ≤ 9bb, **wider against blinds that fold** (the steal read on shoves too: +1.45 per table, +5.6 vs the Plan B bot). Re-raise preflop only with AA.
- **Heads-up, open and defend much wider** (open bar 0.6/2, a raiser = 2 random hands): +2 to +12 per heads-up table.
- Surviving pays: even an always-fold bot scores mid-table. Busting early is the costly mistake.
- **Call a re-shove of your open from a light re-raiser:** if my open is re-raised all-in, the shover holds the top 2 × (their re-raise rate vs one open) of hands, and the exact-ICM call decides (+1.6 per table over 11 fields, +2.2 field 4, +4.7 field 5, +5.1 field 6; we used to fold 99% of those at ≤ 15 bb). Hold'em bot only: on the discard presets it was −1.2, so `icm_any` keeps it off.
- **Open tighter by position once your opens are attacked:** our first-in rule opens ~34% from every seat; after 20 opens, if ≥ 30% were re-raised (fields 6/7: 29-49%, static fields 13-23%), the bot switches for the rest of the table to position ranges (40% ... 11% by players behind, x 1.3); full 52-card deck and not-top-heavy payouts only (`rfi_lock=0.3`: +4.2* field 6, +3.7* field 7, 13-cell mean +0.9, no significant loss).
- **These hold on other card rules too** (Omaha 4, PLO5, short deck, pineapple, 3-street, NLHE20): switching any of them off never won significantly; the short-shove read and the re-shove help most (−1.1 / −1.2 per table off). No variant needs its own setting for them. On slow variants, paired tables differ by ~±1 per table from timing alone: trust a day-of A/B there only beyond ~2.
