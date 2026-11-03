"""Loading a bot file once, and the per-seat clock (README section 5)."""
import importlib.util
import itertools
import os
import time

from . import rules

_counter = itertools.count()


class BotFile:
    """A submission imported once. Several seats may share the module."""

    def __init__(self, path, rules_info=None):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        self.module = None
        self.play = None
        self.load_error = None
        t0 = time.perf_counter_ns()
        try:
            spec = importlib.util.spec_from_file_location(
                f"kit4_bot_{next(_counter)}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            if not callable(getattr(module, "play", None)):
                raise ValueError("no play(view, memory) function")
            if callable(getattr(module, "setup", None)):
                module.setup(rules_info if rules_info is not None else rules_dict())
            self.module, self.play = module, module.play
            if isinstance(getattr(module, "NAME", None), str):
                self.name = module.NAME[:rules.NAME_MAX_CHARS]
        except BaseException as e:   # noqa: BLE001 - a bot may raise anything
            if isinstance(e, KeyboardInterrupt):
                raise
            self.load_error = f"{type(e).__name__}: {e}"
        self.setup_ms = (time.perf_counter_ns() - t0) / 1e6
        if self.load_error is None and self.setup_ms > rules.SETUP_LIMIT_MS:
            self.load_error = (f"import + setup took {self.setup_ms:.0f} ms "
                               f"(limit {rules.SETUP_LIMIT_MS:.0f} ms)")
        if self.load_error is not None:
            self.play = None


def rules_dict(time_limit_ms=rules.TIME_LIMIT_MS):
    from .cards import CATEGORY_NAMES, DECK
    return {
        "variant": rules.VARIANT,
        "deck": list(DECK),
        "hand_ranking": list(CATEGORY_NAMES),      # worst first
        "seats": rules.SEATS,
        "starting_stack": rules.STARTING_STACK,
        "blinds": [list(b) for b in rules.BLINDS],
        "hands_per_level": rules.HANDS_PER_LEVEL,
        "max_hands": rules.MAX_HANDS,
        "points": list(rules.POINTS),
        "ms": time_limit_ms,
        "bench_after": rules.BENCH_AFTER,
    }


class Controller:
    """One seat at one table: its memory dict, its clock and its counters."""

    def __init__(self, bot, time_limit_ms=rules.TIME_LIMIT_MS,
                 enforce=True, bench_after=rules.BENCH_AFTER):
        self.bot = bot
        self.name = bot.name
        self.memory = {}
        self.limit_ns = int(time_limit_ms * 1e6)
        self.enforce = enforce
        self.bench_after = bench_after
        self.decisions = self.errors = self.timeouts = 0
        self.total_ns = self.max_ns = 0
        self.streak = 0
        self.benched = bot.play is None
        self.problems = []
        if bot.play is None:
            self.note(f"bot did not load: {bot.load_error}")

    def note(self, msg):
        if len(self.problems) < 5:
            self.problems.append(msg)

    def act(self, view):
        """Return (raw_reply, outcome); outcome is ok/error/timeout/benched."""
        if self.benched:
            return None, "benched"
        play = self.bot.play
        t0 = time.perf_counter_ns()
        try:
            raw, err = play(view, self.memory), None
        except BaseException as e:   # noqa: BLE001
            if isinstance(e, KeyboardInterrupt):
                raise
            raw, err = None, e
        dt = time.perf_counter_ns() - t0
        self.decisions += 1
        self.total_ns += dt
        self.max_ns = max(self.max_ns, dt)
        where = f"hand {view['hand']} street {view['street']}"
        if self.enforce and dt > self.limit_ns:
            self.timeouts += 1
            self.streak += 1
            self.note(f"{where}: timeout {dt / 1e6:.3f} ms -> fold")
            if self.streak >= self.bench_after:
                self.benched = True
                self.note(f"{where}: benched after {self.streak} timeouts in a row")
            return None, "timeout"
        self.streak = 0
        if err is not None:
            self.errors += 1
            self.note(f"{where}: {type(err).__name__}: {err}")
            return None, "error"
        return raw, "ok"

    def invalid(self, view, raw):
        self.errors += 1
        self.note(f"hand {view['hand']} street {view['street']}: "
                  f"invalid reply {raw!r} (need an int)")
