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
2. Strength table: if the deck and ranking are hold'em, short deck or Omaha it is already in git.
   Otherwise: `python3 -m sng.ours.build_tables --variant <v> --minutes 4 --workers 4`.
3. Adapter: copy `rehearsal_sng/adapter.py`, then map their Observation and Action.
4. Bundle: `python3 -m sng.bundle --adapter adapter.py --variant <table> --out submission/bot.py`.
5. Prove it, all three required:
   - their runner on the bundle: 0 errors;
   - the invariant wrapper (`check_bot.py` pattern): 0 violations;
   - our arena on the preset: `python3 -m sng.arena --preset <p> --candidates icm_tag,pushfold_icm --tables 300`.
6. **Submit by minute ~25.**
7. Minutes 25–160:
   - tune: `python3 -m sng.tune --preset <p> --field blend --rounds 3 --tables 500 --tag _day` (about 15–25 min per round);
   - validate: `results/sng_validate.sh "icm_tag:<tuned>" --preset <p>`;
   - submit only a paired gain > 2 SE with no field losing.

## Plan B: from scratch (rehearsed: 15 minutes to a verified bot)

- Paste the 4 prompts in `report/sng_codex_prompt.md` in order; check each "done when".
- **Submit after prompt 1 (safe bot), again after prompt 3.**
- Between rounds: paired A/B (seeded, time limit raised, ≥ 800 tables, > 2 SE).

## Gotchas that cost points (from 2 rehearsals)

| gotcha | check |
|---|---|
| raise-to vs raise-by; all-in = max raise-to (not stack) | read the Action docs; one hand by hand in the log |
| pot excludes the current street's bets; antes are dead money | invariant: pot = Σ chips in this hand |
| `to_call` may exceed my stack | call amount = min(to_call, stack) |
| point table listed 8th first | write payouts 1st-first |
| hand ranking changed (e.g. flush > full house, trips > straight) | the strength table must be built with the same order |
| busted players stay in the seat list | players left = count of non-busted |
| heads-up: the button posts the small blind | use their sb/bb seats as given |
| timing counts first-call setup and GC | load tables at import / `__init__`; `gc.freeze()` |
| **our bundle's module names vs theirs** (the kit's `engine.py`!) | the bundle uses the private `_nlb` package (tested) |
| unseeded randomness makes A/B on "same seeds" lie | seed everything; raise the time limit for A/B |

## Rules of thumb that held on every field we tested

- **Call tight:** a raiser = 4 random hands; need pot odds + 6%; ICM premium on big calls.
- **Open small (2bb) and fairly wide; steal more from seats that fold** (the bots that time out fold).
- Push or fold at ≤ 9bb. Re-raise preflop only with AA.
- Surviving pays: even an always-fold bot scores mid-table. Busting early is the costly mistake.
