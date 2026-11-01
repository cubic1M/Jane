"""Shared test helpers: puts kit/ on sys.path and provides scripted bots."""

import os
import sys
import time

KIT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if KIT_DIR not in sys.path:
    sys.path.insert(0, KIT_DIR)

from table_api import CHECK, Action, Agent  # noqa: E402


class CallBot(Agent):
    def __init__(self):
        self.seen = []

    def decide(self, obs):
        self.seen.append(obs)
        return Action.check() if CHECK in obs.legal_actions else Action.call()


def script(*actions):
    """Factory for a bot that plays the given actions in order, then check/calls.

    The created instances are appended to factory.instances so tests can look at
    the observations each one received.
    """
    def factory():
        bot = _ScriptBot(list(actions))
        factory.instances.append(bot)
        return bot
    factory.instances = []
    return factory


class _ScriptBot(CallBot):
    def __init__(self, actions):
        super().__init__()
        self.actions = actions

    def decide(self, obs):
        self.seen.append(obs)
        if self.actions:
            return self.actions.pop(0)
        return Action.check() if CHECK in obs.legal_actions else Action.call()


class SlowBot(Agent):
    """Wants to raise all-in every time, but takes too long."""

    def __init__(self, delay_s=0.003):
        self.delay = delay_s

    def decide(self, obs):
        end = time.perf_counter() + self.delay
        while time.perf_counter() < end:
            pass
        return Action.raise_(obs.max_raise_to)


class CrashBot(Agent):
    def decide(self, obs):
        raise RuntimeError("boom")


class BadReturnBot(Agent):
    def __init__(self, value):
        self.value = value

    def decide(self, obs):
        return self.value


def instance(bot):
    """Factory that always hands out the same pre-built instance."""
    return lambda: bot
