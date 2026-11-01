import time

from sng.field3.registry import BOTS, make

FAST = [n for n in BOTS if n != "f3_mc_slow"]


class Timed:
    """Wraps a bot and records the CPU and wall time of each act()."""

    def __init__(self, bot):
        self.bot = bot
        self.name = bot.name
        self.cpu = []
        self.wall = []
        self.streets = []
        self.opps = []

    def new_table(self, rules, seat, seed=0):
        self.bot.new_table(rules, seat, seed)

    def act(self, obs):
        w0 = time.perf_counter()
        c0 = time.process_time()
        a = self.bot.act(obs)
        self.cpu.append(time.process_time() - c0)
        self.wall.append(time.perf_counter() - w0)
        self.streets.append(obs.street)
        self.opps.append(sum(1 for s in obs.seats if s.in_hand and not s.folded) - 1)
        return a

    def end_hand(self, info):
        self.bot.end_hand(info) if hasattr(self.bot, "end_hand") else None


def all_bots(rotate=0):
    names = list(BOTS)
    names = names[rotate:] + names[:rotate]
    return names, [make(n) for n in names]
