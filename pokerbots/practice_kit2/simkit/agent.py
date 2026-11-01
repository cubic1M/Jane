"""Calling a bot: loading, the JSON round trip, and the clock.

Every call to a bot function goes through BotAgent._call:

    clock starts
      state  -> json.dumps -> json.loads -> your function
      result -> json.dumps -> json.loads
    clock stops

so the 1 ms decision budget includes serialising the state you are given
and the reply you return.  A reply that is not JSON-serialisable (a set,
a numpy integer, NaN, ...) is an error.

Locally a slow bot is not interrupted: the call finishes, is measured, and
the reply is thrown away if it was over the limit.
"""

import importlib.util
import itertools
import json
import time

from .rules import INIT_TIME_LIMIT_MS, TIME_LIMIT_MS

_counter = itertools.count()


def load_module_from_path(path):
    """Import a bot file as a brand-new module (no state shared)."""
    name = f"_pokerbot_{next(_counter)}"
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Stats:
    def __init__(self):
        self.decisions = 0
        self.errors = 0
        self.timeouts = 0
        self.total_ms = 0.0
        self.slowest_ms = 0.0
        self.init_ms = 0.0
        self.init_failures = 0
        self.messages = []

    def note(self, msg):
        if len(self.messages) < 20:
            self.messages.append(msg)

    def merge(self, other):
        self.decisions += other.decisions
        self.errors += other.errors
        self.timeouts += other.timeouts
        self.total_ms += other.total_ms
        self.slowest_ms = max(self.slowest_ms, other.slowest_ms)
        self.init_ms = max(self.init_ms, other.init_ms)
        self.init_failures += other.init_failures
        for m in other.messages:
            self.note(m)


class BotAgent:
    """One bot in one seat at one table.

    loader: zero-argument callable returning a fresh module-like object with
    get_action and optionally init / on_hand_end.  It is called once per
    table, inside the init clock.
    """

    def __init__(self, name, loader, time_limit_ms=TIME_LIMIT_MS,
                 init_time_limit_ms=INIT_TIME_LIMIT_MS, enforce_time=True):
        self.name = name
        self.loader = loader
        self.time_limit_ms = time_limit_ms
        self.init_time_limit_ms = init_time_limit_ms
        self.enforce_time = enforce_time
        self.stats = Stats()
        self.module = None
        self.sitting_out = False
        self.last_issue = None

    @classmethod
    def from_file(cls, name, path, **kw):
        return cls(name, lambda: load_module_from_path(path), **kw)

    # -- lifecycle -------------------------------------------------------
    def start(self, config):
        """Load the module and call init(config).  False = sits out."""
        self.sitting_out = False
        t0 = time.perf_counter_ns()
        err = None
        try:
            self.module = self.loader()
            if not callable(getattr(self.module, "get_action", None)):
                raise AttributeError("bot has no get_action(state) function")
            init = getattr(self.module, "init", None)
            if init is not None:
                init(json.loads(json.dumps(config)))
        except Exception as e:  # noqa: BLE001 - any bot failure
            err = f"init error: {type(e).__name__}: {e}"
        ms = (time.perf_counter_ns() - t0) / 1e6
        self.stats.init_ms = max(self.stats.init_ms, ms)
        if err is None and self.enforce_time and ms > self.init_time_limit_ms:
            err = f"init took {ms:.1f} ms (limit {self.init_time_limit_ms} ms)"
        if err is not None:
            self.stats.init_failures += 1
            self.stats.note(err)
            self.sitting_out = True
            return False
        return True

    # -- calls -------------------------------------------------------------
    def _call(self, fn, payload):
        t0 = time.perf_counter_ns()
        err = None
        reply = None
        try:
            arg = json.loads(json.dumps(payload))
            out = fn(arg)
            reply = json.loads(json.dumps(out, allow_nan=False))
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
        ms = (time.perf_counter_ns() - t0) / 1e6
        return reply, ms, err

    def decide(self, state):
        """get_action(state); None means 'use the default' (timeout/error)."""
        self.last_issue = None
        if self.sitting_out:
            self.last_issue = "sitting out (init failed)"
            return None
        reply, ms, err = self._call(self.module.get_action, state)
        st = self.stats
        st.decisions += 1
        st.total_ms += ms
        st.slowest_ms = max(st.slowest_ms, ms)
        where = f"hand {state.get('hand_number')} {state.get('street')}"
        if err is not None:
            st.errors += 1
            self.last_issue = f"error: {err}"
            st.note(f"{where}: {self.last_issue}")
            return None
        if self.enforce_time and ms > self.time_limit_ms:
            st.timeouts += 1
            self.last_issue = f"timeout {ms:.3f} ms"
            st.note(f"{where}: {self.last_issue}")
            return None
        return reply

    def invalid(self, state, msg):
        """The engine rejected a reply that arrived in time."""
        self.stats.errors += 1
        self.last_issue = f"invalid: {msg}"
        self.stats.note(f"hand {state.get('hand_number')} "
                        f"{state.get('street')}: {self.last_issue}")

    def hand_end(self, summary):
        if self.sitting_out:
            return
        fn = getattr(self.module, "on_hand_end", None)
        if fn is None:
            return
        _, ms, err = self._call(fn, summary)
        if err is not None:
            self.stats.errors += 1
            self.stats.note(f"hand {summary.get('hand_number')} on_hand_end "
                            f"error: {err}")
        elif self.enforce_time and ms > self.time_limit_ms:
            self.stats.timeouts += 1
            self.stats.note(f"hand {summary.get('hand_number')} on_hand_end "
                            f"timeout {ms:.3f} ms")
