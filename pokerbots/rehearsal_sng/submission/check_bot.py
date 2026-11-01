"""Invariant-checking wrapper of bot.py (rehearsal only, not a submission)."""
import atexit, importlib.util, os, sys
_spec = importlib.util.spec_from_file_location("realbot", os.path.join(os.path.dirname(__file__), "bot.py"))
_m = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_m)
BAD = {"n": 0, "pot": 0, "chips": 0, "legal": 0, "hole": 0}
atexit.register(lambda: print("[check]", BAD, file=sys.stderr))


class Bot(_m.Bot):
    def decide(self, o):
        ob = self._obs(o)
        BAD["n"] += 1
        if ob.pot != sum(s.committed for s in ob.seats):
            BAD["pot"] += 1
        if sum(s.stack + s.committed for s in ob.seats) != 16000:
            BAD["chips"] += 1
        lg = ob.legal
        if lg.can_raise and not (lg.min_raise_to <= lg.max_raise_to == ob.my_stack + ob.my_bet):
            BAD["legal"] += 1
        if len(ob.hole) != 2 or any((c >> 2) < 4 for c in ob.hole + ob.board):
            BAD["hole"] += 1
        return super().decide(o)
