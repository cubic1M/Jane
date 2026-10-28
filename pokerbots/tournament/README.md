# Tournament adapters

`mit_adapter.py` runs any of our bots inside an MIT-Pokerbots-style skeleton
(`get_action(game_state, round_state, active)` with a `previous_state` chain).
Everything protocol-specific is in its `PROTOCOL` dict (street codes, which index
is the small blind). It rebuilds our `Observation` (including the action history our
bots use for range reading and CFR tree tracking), translates the answer back,
replaces any illegal answer with a safe one, and prints one-time self-check
warnings when the mapping looks wrong (blinds, stacks, hole-card count).

* `mit_player.py`: drop-in `player.py` for the skeleton directory
  (`OUR_BOT=adaptive OUR_VARIANT=c_discard3 POKERBOTS_ROOT=/path/to/pokerbots`).
* `mit_e2e.sh /path/to/engine-2026 [bot] [rounds]`: end-to-end run inside the real
  MIT engine (uses `pkrbot_shim.py` if MIT's `pkrbot` is not installed).
* `test_mit_adapter.py`: self-contained unit test with a minimal MIT-style state
  chain written here (no external code), including the blind-mapping self-check.

Tested end to end on MIT engine-2026 (300 rounds each): balanced +8010 and adaptive
+7158 chips vs MIT's sample bot, 0 illegal actions, 0 adapter warnings.
If the tournament uses a different protocol, write the same three translations
(state -> Observation, Action -> their action, round over -> HandResult) and keep
the self-checks.
