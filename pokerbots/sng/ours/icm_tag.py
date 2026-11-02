"""icm_tag: a tight-aggressive sit-and-go bot built for the 1 ms limit.

Every decision is a few table lookups (sng.ours.strength) and comparisons:
  * preflop: open-raise with hands whose equity vs the players still to act clears a
    position-dependent bar; at <= push_bb big blinds shove-or-fold instead;
  * facing a raise: the raiser counts as `range_k` random hands (raises are strong);
    call / 3-bet / shove by pot odds plus an ICM risk premium that grows as fewer
    players remain (chips lost cost more than chips won in a points-by-place game);
  * postflop: equity vs the opponents still in, discounted when they bet or raise;
    value-bet strong hands, c-bet heads-up as the aggressor, call by pot odds.
  * per-table reads: each seat's fold-to-steal rate; steal wider against folders
    (which includes bots that time out and auto-fold).
All parameters live in PARAMS and can be overridden from the bot name.
"""
from __future__ import annotations

import random

from engine.game import Call, Check, Fold, RaiseTo

PARAMS = dict(
    open_mult=1.07,      # open if equity >= open_mult / (players to act + 1)
    open_size=2.0,       # open-raise to this many big blinds (+1 per limper)
    push_bb=9.0,        # shove-or-fold at or below this effective stack (bb)
    push_mult=1.00,      # shove if equity >= push_mult / (players to act + 1) (scaled by stack)
    range_k=4.0,         # a raiser's range ~ this many random hands
    call_margin=0.06,    # extra equity needed above pot odds to call
    threebet_eq=0.62,    # 3-bet (or shove when short) if equity vs the raiser range clears this
                         # (NB: vs range_k=4 random hands even AA is ~0.56, so this alone never fires)
    threebet_rel=2.6,    # ... or if equity x (range_k + 1) clears this (2.4 ~ KK+, 2.2 ~ QQ+, 2.0 ~ JJ+)
    risk=0.10,           # ICM risk premium on all-in calls at 8 players left (grows as players bust)
    value_eq=0.62,       # postflop: bet for value above this (adjusted) equity
    cbet=0.55,           # c-bet frequency heads-up as the preflop aggressor
    bet_frac=0.65,       # postflop bet size (fraction of pot)
    bet_discount=0.6,   # opponent's bet/raise: our equity x this (their range is stronger)
    steal_bonus=0.55,
    steal_max_behind=5,
    steal_sym=0.5,       # also RAISE the open bar vs seats that do not fold: bar x (1 + steal_sym x (1 - 2f))  # use the fold-to-steal read when at most this many players are behind
    reshove_bb=24.0,
    read_alpha=0.5,      # per-seat raise-rate read: raiser range_k x (base_pfr / their pfr)^alpha
    base_pfr=0.12,
    raiser_discount=1.0, # postflop: equity x this when an opponent still in raised preflop
    bluff_bonus=0.4,     # postflop: bet half pot with prob bluff_bonus x (2 x opponents' fold-to-bet - 1)
    bluff_max_opp=2,     # ... only with at most this many opponents in the hand
    pf_chart=0,          # 1: at <= pf_max_bb use the ICM push/fold equilibrium charts (sng/ours/pushfold.py)
    pf_max_bb=15.0,      #    for first-in shoves and for calling a lone all-in
    cap_risk=0.0,        # near the hand cap: risk premium + cap_risk x (my stack / average - 1)
    cap_window=25,       # ... in the last this many hands       # the raise rate at which a raiser counts as exactly range_k     # facing a raise with a 3-bet hand: shove (not 3-bet) at or below this stack    # lower the open bar by up to this much vs seats that fold to steals
)


class IcmTag:
    name = "icm_tag"

    def __init__(self, **kw):
        bad = set(kw) - set(PARAMS)
        if bad:
            raise ValueError(f"unknown icm_tag params {sorted(bad)}")
        self.p = dict(PARAMS, **kw)

    # ---- table lifecycle ------------------------------------------------------------
    def new_table(self, rules, seat, seed=0):
        from sng.ours import strength
        self.rules, self.seat = rules, seat
        self.spec = rules.spec
        self.rng = random.Random(seed)
        self.S = strength
        strength.preload(rules.spec)          # never pay the table load inside a 1 ms decision
        self.chart = None
        if self.p["pf_chart"]:
            from sng.ours.pushfold_chart import load_chart
            self.chart = load_chart(rules)
        self.steal_seen = [0] * rules.num_players     # steal attempts faced in the blinds
        self.steal_fold = [0] * rules.num_players
        self.aggressor = None                          # seat of the last preflop raiser this hand
        self.dealt = [0] * rules.num_players           # hands seen per seat
        self.pf_faced = [0] * rules.num_players        # postflop bets faced per seat
        self.pf_fold = [0] * rules.num_players         # ... and folded to
        self.pre_raises = [0] * rules.num_players      # hands with a voluntary preflop raise
        self._hand = -1

    def end_hand(self, info):
        hist = info["history"]
        # per-seat preflop raise rate (seats that posted or acted were dealt in)
        seen = {h[0] for h in hist if h[1] == 0}
        raised = {h[0] for h in hist if h[1] == 0 and h[2] == "raise"}
        for s in seen:
            self.dealt[s] += 1
            if s in raised:
                self.pre_raises[s] += 1
        # postflop fold-to-bet: after the first bet on a street, each later responder
        for st in sorted({h[1] for h in hist if h[1] > 0}):
            acts = [h for h in hist if h[1] == st]
            first = next((i for i, h in enumerate(acts) if h[2] == "raise"), None)
            if first is None:
                continue
            bettor = acts[first][0]
            for sv, _, kind, _ in acts[first + 1:]:
                if sv == bettor or kind == "raise":
                    break
                self.pf_faced[sv] += 1
                if kind == "fold":
                    self.pf_fold[sv] += 1
        # fold-to-steal: blinds facing a single late-position open and no other caller
        pre = [h for h in hist if h[1] == 0 and h[2] != "post"]
        raises = [h for h in pre if h[2] == "raise"]
        if len(raises) >= 1:
            opener = raises[0][0]
            after = pre[pre.index(raises[0]) + 1:]
            for s, st, kind, amt in after:
                if s == opener:
                    break
                self.steal_seen[s] += 1
                if kind == "fold":
                    self.steal_fold[s] += 1

    def _fold_rate(self, seats):
        num = sum(self.steal_fold[s] for s in seats) + 1.0
        den = sum(self.steal_seen[s] for s in seats) + 2.0
        return num / den

    # ---- helpers ----------------------------------------------------------------------
    def _eq(self, obs, k):
        k = max(1, min(7, int(round(k))))
        return self.S.equity(obs.hole, obs.board, k, self.spec)

    def _eq_k(self, obs, kf):
        """equity vs a fractional number of random hands (interpolated)."""
        lo = max(1, min(7, int(kf)))
        hi = min(7, lo + 1)
        w = min(1.0, max(0.0, kf - lo))
        e_lo = self._eq(obs, lo)
        return e_lo if w == 0 or hi == lo else (1 - w) * e_lo + w * self._eq(obs, hi)

    def _risk(self, obs):
        # premium on putting the stack at risk: larger with fewer players left (bubble / pay jumps)
        left = obs.players_left
        r = self.p["risk"] * (1.0 + (8 - left) * 0.15) if left > 1 else 0.0
        hl = getattr(obs, "hands_left", None)
        if self.p["cap_risk"] and hl is not None and hl < self.p["cap_window"] and left > 1:
            live = [sv.stack + sv.committed for sv in obs.seats if sv.in_hand]
            avg = sum(live) / len(live)
            mine = obs.my_stack + obs.seats[obs.seat].committed
            r += self.p["cap_risk"] * (mine / avg - 1.0)
        return max(0.0, r)

    # ---- decision -----------------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        if getattr(lg, "discard_count", 0):
            return self._discard(obs)
        if obs.hand_number != self._hand:
            self._hand = obs.hand_number
            self.aggressor = None
        if obs.street == 0:
            return self._preflop(obs)
        return self._postflop(obs)

    def _discard(self, obs):
        """Discard/draw phases: the shared policy (sng/ours/anyvar.py); never illegal."""
        from engine.game import Discard
        from sng.ours import features as F
        from sng.ours.anyvar import choose_discard
        lg = obs.legal
        rule = next(iter(self.spec.discards_on_street(obs.street)), None)
        try:
            out = choose_discard(F.get_ctx(self.spec), obs.hole, obs.board, lg.discard_min, lg.discard_count,
                                 bool(rule and rule.draw), bool(rule and rule.to_board))
        except Exception:  # noqa: BLE001
            out = tuple(sorted(obs.hole, key=lambda c: c >> 2)[:lg.discard_min])
        return Discard(out)

    def _preflop(self, obs):
        p, lg = self.p, obs.legal
        bb = obs.big_blind
        seats = obs.seats
        n = len(seats)
        raises = [h for h in obs.history if h[1] == 0 and h[2] == "raise"]
        if not raises and not obs.history:
            # no action history from the kit: a bet above the big blind means a raise
            top = max(range(n), key=lambda s: seats[s].bet)
            if seats[top].bet > bb and top != obs.seat:
                raises = [(top, 0, "raise", seats[top].bet)]
        if raises:
            self.aggressor = raises[-1][0]
        # players still to act after me (not folded, with chips, not yet acted this round)
        acted = {h[0] for h in obs.history if h[1] == 0 and h[2] != "post"}
        order = [(obs.seat + i) % n for i in range(1, n)]
        behind = [s for s in order if seats[s].in_hand and not seats[s].folded and s not in acted
                  and s != obs.seat]
        # the blinds have "acted" by posting but still act; count them if not acted voluntarily
        in_pot = [s for s in range(n) if s != obs.seat and seats[s].in_hand and not seats[s].folded]
        eff = min(obs.my_stack + obs.my_bet,
                  max((seats[s].stack + seats[s].bet for s in in_pot), default=0))
        eff_bb = eff / bb
        if self.chart is not None and eff_bb <= p["pf_max_bb"]:
            a = self.chart.decide(obs, raises, eff_bb)
            if a is not None:
                return a
        if not raises:
            k = max(1, len(behind))
            limpers = sum(1 for h in obs.history if h[1] == 0 and h[2] == "call")
            bar = p["open_mult"] / (k + 1 + limpers)
            # steal wider vs blinds that fold
            if not limpers and len(behind) <= p["steal_max_behind"]:
                fr = self._fold_rate(behind if len(behind) > 2 else [obs.sb_seat, obs.bb_seat])
                bar *= 1.0 - p["steal_bonus"] * max(0.0, fr - 0.5) * 2
                if p["steal_sym"] > 0 and fr < 0.5:
                    bar *= 1.0 + p["steal_sym"] * (1.0 - 2 * fr)
            eq = self._eq(obs, k + limpers)
            if eff_bb <= p["push_bb"]:
                scale = 0.75 + 0.25 * eff_bb / p["push_bb"]       # shorter = wider
                if eq >= p["push_mult"] * scale / (k + 1 + limpers) and lg.can_raise:
                    return RaiseTo(lg.max_raise_to)
                return lg.passive() if lg.can_check else Fold()
            if eq >= bar and lg.can_raise:
                to = (p["open_size"] + limpers) * bb
                self.aggressor = obs.seat
                return RaiseTo(lg.clamp(to))
            return lg.passive() if lg.can_check else Fold()
        # facing a raise
        others = len(in_pot)
        rk = p["range_k"]
        if p["read_alpha"] > 0:
            r = raises[-1][0]
            pfr = (self.pre_raises[r] + p["base_pfr"] * 8) / (self.dealt[r] + 8)   # shrink to the prior
            rk = min(8.0, max(1.2, rk * (p["base_pfr"] / max(pfr, 0.01)) ** p["read_alpha"]))
        kf = rk + max(0, others - 1) * 0.8
        eq = self._eq_k(obs, kf)
        call = lg.call_amount
        pot = obs.pot
        need = call / (pot + call) + p["call_margin"]
        allin_call = call >= obs.my_stack or any(seats[s].all_in for s in in_pot)
        if allin_call or call > 0.4 * obs.my_stack:
            need += self._risk(obs)
        if (eq >= p["threebet_eq"] or eq * (kf + 1) >= p["threebet_rel"]) and lg.can_raise:
            if eff_bb <= p["reshove_bb"]:
                return RaiseTo(lg.max_raise_to)
            last = raises[-1][3]
            self.aggressor = obs.seat
            return RaiseTo(lg.clamp(3 * last))
        if eq >= need:
            return Call() if lg.can_call else Check()
        return lg.passive() if lg.can_check else Fold()

    def _postflop(self, obs):
        p, lg = self.p, obs.legal
        seats = obs.seats
        opp = [s for s in range(len(seats)) if s != obs.seat and seats[s].in_hand and not seats[s].folded]
        k = len(opp)
        eq = self._eq(obs, k)
        if p["raiser_discount"] != 1.0 and any(
                h[1] == 0 and h[2] == "raise" and h[0] in opp for h in obs.history):
            eq *= p["raiser_discount"]
        street_acts = [h for h in obs.history if h[1] == obs.street]
        facing = lg.call_amount > 0
        pot = obs.pot
        if facing:
            n_aggr = sum(1 for h in street_acts if h[2] == "raise") if obs.history else 1
            eq_adj = eq * (p["bet_discount"] ** n_aggr)
            call = lg.call_amount
            need = call / (pot + call) + p["call_margin"]
            if call >= obs.my_stack * 0.5:
                need += self._risk(obs)
            if eq_adj >= max(p["value_eq"] + 0.15, need + 0.25) and lg.can_raise:
                return RaiseTo(lg.clamp(obs.my_bet + call + pot))
            if eq_adj >= need:
                return Call()
            return Fold()
        # not facing a bet
        if eq >= p["value_eq"] and lg.can_raise:
            return RaiseTo(lg.clamp(p["bet_frac"] * pot))
        if (k == 1 and self.aggressor == obs.seat and lg.can_raise
                and self.rng.random() < p["cbet"] and obs.street == 1):
            return RaiseTo(lg.clamp(0.5 * pot))
        if p["bluff_bonus"] > 0 and lg.can_raise and 1 <= k <= p["bluff_max_opp"]:
            fr = (sum(self.pf_fold[s] for s in opp) + 1.0) / (sum(self.pf_faced[s] for s in opp) + 2.0)
            if self.rng.random() < p["bluff_bonus"] * max(0.0, 2 * fr - 1):
                return RaiseTo(lg.clamp(0.5 * pot))
        return Check()
