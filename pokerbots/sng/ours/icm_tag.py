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

import bisect
import math
import random
from itertools import combinations

from engine.game import Call, Check, Fold, RaiseTo
from sng.ours.icm_exact import allin_call_need       # imported here: never inside a timed decision

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
    bet_discount=0.5,   # opponent's bet/raise: our equity x this (their range is stronger)
    steal_bonus=0.55,
    steal_max_behind=5,
    steal_sym=0.5,       # also RAISE the open bar vs seats that do not fold: bar x (1 + steal_sym x (1 - 2f))  # use the fold-to-steal read when at most this many players are behind
    reshove_bb=24.0,
    read_alpha=0.5,      # per-seat raise-rate read: raiser range_k x (base_pfr / their pfr)^alpha
    base_pfr=0.12,
    raiser_discount=1.0, # postflop: equity x this when an opponent still in raised preflop
    raise_eq=99.0,       # postflop: raise a bet when RAW equity >= this (and adjusted equity beats the
                         # price); the adjusted-equity bar below can never fire (equity x 0.6 <= 0.6 < 0.77)
    bluff_bonus=0.4,     # postflop: bet half pot with prob bluff_bonus x (2 x opponents' fold-to-bet - 1)
    bluff_max_opp=2,     # ... only with at most this many opponents in the hand
    pf_chart=0,          # 1: at <= pf_max_bb use the ICM push/fold equilibrium charts (sng/ours/pushfold.py)
    pf_max_bb=15.0,      #    for first-in shoves and for calling a lone all-in
    pf_file="",          #    chart file cache/sng/pushfold_<pf_file>.json ("" = equilibrium for the payouts)
    cap_risk=0.0,        # near the hand cap: risk premium + cap_risk x (my stack / average - 1)
    cap_window=25,
    steal_floor=0.0,     # the steal factor never cuts the open / shove bar below this share (0 = no floor)
    vs3b=0.0,            # > 0: my open re-raised: the re-raiser holds the top vs3b x (their re-raise
    vs3b_prior=0.05,     #   rate vs opens, prior 5%) of hands, as random-hand count (never tighter); 0 = off
    resteal_rel=0.35,    # > 0: facing a lone open at <= resteal_rel_bb, re-shove the top
    resteal_rel_bb=28.0, #   resteal_rel x (opener's open rate) of hands (f3_exploiter's rule); 0 = off.
                         #   0.35 validated on fresh seeds (results/sng_restealrel_validate.md)
    push_steal=0.5,      # short-stack shoves use this share of the steal factor (fold read); 0 = off.
                         #   0.5 validated on fresh seeds (results/sng_pushsteal_validate.md)
    behind_k=0.2,        # facing a preflop raise: extra random hands per opponent still to act
                         #   (callers / re-raisers count 0.8 each); 0.8 = the old rule (everyone
                         #   alike). 0.2 validated on fresh seeds (results/sng_behindk_validate.md)
    cbet_size=0.5,       # flop continuation bet, x pot
    bluff_size=0.5,      # read-based bluff bet, x pot
    hu_risk=1.0,         # risk premium x this with 2 players left (heads-up ICM is linear in chips)
    cap_fade=0,          # > 0: risk premium x min(1, hands_left / cap_fade) (the cap pays ICM of the stacks)
    risk_payout=1,       # 1: scale `risk` by the payout shape: x min(1, flatness / 0.5), where flatness =
                         #   1 - (1st's share of the points); winner-take-all -> 0, top-3 50/30/20 -> 1
    hu_open_mult=0.6,    # heads-up tables (2 players dealt in): open_mult becomes this (0 = off)
    hu_range_k=2.0,      # heads-up tables: a raiser's range_k (before the read) becomes this (0 = off)
    sh_open_mult=0.0,    # 3-4 players dealt in: open_mult becomes this (0 = off)
    sh_range_k=0.0,      # 3-4 players dealt in: a raiser's range_k becomes this (0 = off)
    icm_call=1,          # 1: all-in calls (one all-in opponent, no other caller) need the exact ICM
                         #   break-even equity (sng/ours/icm_exact.py) + icm_margin, instead of
                         #   pot odds + call_margin + the risk premium
    icm_margin=0.02,
    pev=0,               # 1: first-in shoves at <= pev_bb by an EV model with fold equity
                         #   (calling widths per seat behind, equity vs each caller's range,
                         #   ICM risk premium on the loss) instead of the fixed equity bar
    pev_bb=15.0,
    pev_margin=0.0,      # shove if the EV (in big blinds) exceeds this
    pev_loose=1.0,       # scale every calling width (1 = approximate Nash widths)
    pev_risk=1.0,        # scale the ICM risk premium charged on a called shove
    resteal=0,           # 1: facing a lone open (no callers, opener not all-in) at resteal_lo..resteal_hi bb,
                         #   re-shove when the fold-equity EV (big blinds) > resteal_margin
    resteal_lo=10.0,
    resteal_hi=25.0,
    resteal_margin=0.0,
    resteal_cw=0.6,      # the opener calls a re-shove with this share of a first-in shove's calling width
    resteal_wake=0.3,    # players still to act wake up with this share of their calling width
    resteal_risk=0.25,   # scale of the ICM risk premium charged on a called re-shove
    range_map=0.65,      # equity vs one hand from the top-c share of hands ~ equity vs
                         #   k = 1 + range_map x log2(0.5 / c) random hands (pev, resteal)
    rk_floor=1.2,        # facing a raise: the raiser counts as at least this many random hands
    agg_alpha=0.0,       # postflop: discount a bet less from seats that bet often when checked to:
                         #   discount -> discount + (1 - discount) x agg_alpha x excess aggression
    base_agg=0.35,       # ... the bet-when-checked-to rate that counts as normal
    agg_raise=99.0,      # postflop: raise a bet from a seat whose bet-when-checked-to rate >= agg_seat
                         #   when RAW equity >= this (99 = off)
    agg_seat=0.6,
    station_size=0.0,    # postflop value bet: bet_frac + station_size x (1 - 2 x opponents' fold-to-bet)
    thin_value=0.0,      # postflop: value bar - thin_value x (1 - 2 x opponents' fold-to-bet), vs stations       # ... in the last this many hands       # the raise rate at which a raiser counts as exactly range_k     # facing a raise with a 3-bet hand: shove (not 3-bet) at or below this stack    # lower the open bar by up to this much vs seats that fold to steals
)


def payout_risk_scale(payouts) -> float:
    """1.0 for payouts at least as flat as top-3 50/30/20; down to 0 for winner-take-all
    (chips are then worth their count, so no ICM premium on risking them)."""
    pay = [float(x) for x in payouts]
    if len(pay) < 2:
        return 1.0
    lo = min(pay)
    rel = [x - lo for x in pay]
    tot = sum(rel)
    if tot <= 0:
        return 1.0
    flat = 1.0 - max(rel) / tot
    return max(0.0, min(1.0, flat / 0.5))


_PCT: dict = {}


def hand_pct_table(spec, S):
    """Sorted equities vs one random hand of every 2-card starting hand of this deck (cached per
    card rules), so a hand's top-share percentile is one bisect. None for non-2-card games."""
    if getattr(spec, "hole_cards", 2) != 2 or getattr(spec, "discards", ()):
        return None
    key = (tuple(spec.deck_ranks), getattr(spec, "category_order", None), getattr(spec, "ace_low_straight", None))
    t = _PCT.get(key)
    if t is None:
        deck = spec.deck                      # a property
        t = _PCT[key] = sorted(S.equity(h, (), 1, spec) for h in combinations(deck, 2))
    return t


class IcmTag:
    name = "icm_tag"
    OVERRIDES: dict = {}          # per-subclass defaults on top of PARAMS (explicit kwargs still win)

    def __init__(self, **kw):
        bad = set(kw) - set(PARAMS)
        if bad:
            raise ValueError(f"unknown icm_tag params {sorted(bad)}")
        self.p = dict(PARAMS, **self.OVERRIDES)
        self.p.update(kw)

    # ---- table lifecycle ------------------------------------------------------------
    def new_table(self, rules, seat, seed=0):
        from sng.ours import strength
        self.rules, self.seat = rules, seat
        self.spec = rules.spec
        self.rng = random.Random(seed)
        self.S = strength
        strength.preload(rules.spec)          # never pay the table load inside a 1 ms decision
        if getattr(rules.spec, "discards", ()):   # ... nor the discard policy's import / setup
            from sng.ours import anyvar, features as F
            anyvar._hc_code(F.get_ctx(rules.spec))
        self._pct = None
        if self.p["resteal_rel"] > 0:
            try:
                self._pct = hand_pct_table(rules.spec, strength)
            except Exception:  # noqa: BLE001  the rule is simply off
                self._pct = None
        self.risk_scale = 1.0
        pays = getattr(rules, "payouts", None)             # a kit's minimal Rules stand-in may lack it
        if self.p["risk_payout"] and pays:
            try:
                self.risk_scale = payout_risk_scale(tuple(pays)[:getattr(rules, "num_players", len(pays))])
            except Exception:  # noqa: BLE001  never fail setup over a payout shape
                self.risk_scale = 1.0
        self.chart = None
        if self.p["pf_chart"]:
            from sng.ours.pushfold_chart import load_chart
            self.chart = load_chart(rules, self.p["pf_file"] or None)
        self.steal_seen = [0] * rules.num_players     # steal attempts faced in the blinds
        self.steal_fold = [0] * rules.num_players
        self.rr_made = [0] * rules.num_players           # re-raised a first open (vs3b read)
        self.aggressor = None                          # seat of the last preflop raiser this hand
        self.dealt = [0] * rules.num_players           # hands seen per seat
        self.pf_faced = [0] * rules.num_players        # postflop bets faced per seat
        self.pf_fold = [0] * rules.num_players         # ... and folded to
        self.pre_raises = [0] * rules.num_players      # hands with a voluntary preflop raise
        self.bet_opp = [0] * rules.num_players         # postflop: checked to (could bet first)
        self.bet_made = [0] * rules.num_players        # ... and bet
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
                for sv, _, kind, _ in acts:                   # everyone checked
                    if kind == "check":
                        self.bet_opp[sv] += 1
                continue
            for sv, _, kind, _ in acts[:first]:            # checked before the first bet
                self.bet_opp[sv] += 1
            bettor = acts[first][0]
            self.bet_opp[bettor] += 1
            self.bet_made[bettor] += 1
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
                elif kind == "raise":
                    self.rr_made[s] += 1


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
        r = self.p["risk"] * self.risk_scale * (1.0 + (8 - left) * 0.15) if left > 1 else 0.0
        hl = getattr(obs, "hands_left", None)
        if self.p["cap_risk"] and hl is not None and hl < self.p["cap_window"] and left > 1:
            live = [sv.stack + sv.committed for sv in obs.seats if sv.in_hand]
            avg = sum(live) / len(live)
            mine = obs.my_stack + obs.seats[obs.seat].committed
            r += self.p["cap_risk"] * (mine / avg - 1.0)
        if left == 2:
            r *= self.p["hu_risk"]
        if self.p["cap_fade"] > 0 and hl is not None:
            r *= min(1.0, max(0, hl) / self.p["cap_fade"])
        return max(0.0, r)

    def _icm_need(self, obs, r):
        """Exact ICM break-even equity for calling the all-in (or my all-in call) of seat r."""
        pays = getattr(self.rules, "payouts", None)
        if not pays:
            return None
        seats = obs.seats
        totals = [None if (s == obs.seat or not sv.in_hand) else sv.stack + sv.committed
                  for s, sv in enumerate(seats)]
        committed = [0 if (s == obs.seat or not sv.in_hand) else sv.committed for s, sv in enumerate(seats)]
        left = sum(1 for sv in seats if sv.in_hand)
        me = seats[obs.seat]
        try:
            return allin_call_need(obs.my_stack + me.committed, me.committed, r, totals, committed,
                                   tuple(pays)[:left])
        except Exception:  # noqa: BLE001  never fail a decision over ICM
            return None

    # approximate Nash calling widths vs a shove, by the caller's effective stack in big blinds
    _CALL_W = ((3, 0.75), (5, 0.55), (8, 0.40), (10, 0.33), (12, 0.28), (15, 0.22), (20, 0.16), (30, 0.11))

    @classmethod
    def _call_width(cls, eff_bb):
        w = cls._CALL_W
        if eff_bb <= w[0][0]:
            return w[0][1]
        for (x0, y0), (x1, y1) in zip(w, w[1:]):
            if eff_bb <= x1:
                return y0 + (y1 - y0) * (eff_bb - x0) / (x1 - x0)
        return w[-1][1]

    def _k_for_top(self, c):
        """Random-hand count whose equity matches one opponent holding a top-c share of hands.
        (Beating k random hands multiway is harder than beating one strong hand, so this is
        far below the k whose best hand sits at the top-c cut.)"""
        return min(7.0, max(1.0, 1.0 + self.p["range_map"] * math.log2(0.5 / max(c, 1e-3))))

    def _push_ev(self, obs, behind):
        """EV (big blinds) of shoving first-in vs folding: fold equity from each player
        behind (calling width by their stack, scaled by their observed raise rate), equity vs
        a caller's top-c range via _k_for_top, a loss charged the
        ICM risk premium. Only the first caller is modelled."""
        p = self.p
        seats = obs.seats
        bb = obs.big_blind
        if not behind:
            return None
        mine = obs.my_stack + obs.my_bet
        pot = obs.pot
        risk_prem = self._risk(obs) * p["pev_risk"]
        ev, p_reach = 0.0, 1.0
        for j in behind:
            sj = seats[j]
            their = sj.stack + sj.bet
            r_chips = min(mine, their)
            pfr = (self.pre_raises[j] + p["base_pfr"] * 8) / (self.dealt[j] + 8)
            loose = min(1.8, max(0.6, (pfr / p["base_pfr"]) ** 0.5))
            c = min(0.95, max(0.02, self._call_width(r_chips / bb) * loose * p["pev_loose"]))
            eq = self._eq_k(obs, self._k_for_top(c))
            risk = r_chips - obs.my_bet                              # chips I add beyond my blind
            win = pot + min(their, mine) - sj.bet                    # their call joins the pot
            ev_call = eq * win - (1.0 - eq) * risk - risk_prem * (2 * risk + pot)
            ev += p_reach * c * ev_call
            p_reach *= 1.0 - c
        ev += p_reach * pot
        return ev / bb

    def _resteal_ev(self, obs, r, behind):
        """EV (big blinds) of re-shoving over a lone open by seat r vs folding. The opener calls
        with the top call-width share of all hands, i.e. P(call | opened) = width / their open
        rate; players still to act wake up with half their Nash calling width. Equity vs the
        opener's calling range via _k_for_top; a loss is charged
        the ICM risk premium. Only the opener's call is modelled for equity."""
        p = self.p
        seats = obs.seats
        bb = obs.big_blind
        mine = obs.my_stack + obs.my_bet
        sr = seats[r]
        their = sr.stack + sr.bet
        r_chips = min(mine, their)
        open_rate = (self.pre_raises[r] + p["base_pfr"] * 8) / (self.dealt[r] + 8)
        w = self._call_width(r_chips / bb) * p["resteal_cw"]
        p_call = min(1.0, w / max(open_rate, 0.02))
        p_fold_behind = 1.0
        for j in behind:
            sj = seats[j]
            p_fold_behind *= 1.0 - p["resteal_wake"] * self._call_width(min(mine, sj.stack + sj.bet) / bb)
        c = min(0.95, max(0.02, w))
        eq = self._eq_k(obs, self._k_for_top(c))
        pot = obs.pot
        risk = r_chips - obs.my_bet
        win = pot + r_chips - sr.bet
        prem = self._risk(obs) * p["resteal_risk"]
        ev_called = eq * win - (1.0 - eq) * risk - prem * (2 * risk + pot)
        ev_woken = -risk * 0.75                                  # a wake-up behind: mostly lose
        ev = p_fold_behind * ((1.0 - p_call) * pot + p_call * ev_called) + (1.0 - p_fold_behind) * ev_woken
        return ev / bb

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
        dealt = sum(1 for sv in seats if sv.in_hand)
        hu = dealt == 2                                          # a heads-up table, not a folded-to-2 pot
        sh = 3 <= dealt <= 4
        if not raises:
            k = max(1, len(behind))
            limpers = sum(1 for h in obs.history if h[1] == 0 and h[2] == "call")
            om = p["hu_open_mult"] if hu and p["hu_open_mult"] > 0 else p["open_mult"]
            if sh and p["sh_open_mult"] > 0:
                om = p["sh_open_mult"]
            bar = om / (k + 1 + limpers)
            sf = 1.0                                      # steal factor from the fold read
            # steal wider vs blinds that fold
            if not limpers and len(behind) <= p["steal_max_behind"]:
                blinds = [s for s in (obs.sb_seat, obs.bb_seat) if s != obs.seat]   # never my own read
                fr = self._fold_rate(behind if len(behind) > 2 else blinds)
                sf *= 1.0 - p["steal_bonus"] * max(0.0, fr - 0.5) * 2
                if p["steal_sym"] > 0 and fr < 0.5:
                    sf *= 1.0 + p["steal_sym"] * (1.0 - 2 * fr)
                sf = max(sf, p["steal_floor"])
            bar *= sf
            eq = self._eq(obs, k + limpers)
            if not lg.can_raise and lg.can_call:
                # no raise possible (my call is all-in, or everyone else is all-in, e.g. a
                # blind short of chips): only call or fold is left, so decide by pot odds
                call = lg.call_amount
                need = call / (obs.pot + call) + p["call_margin"]
                if call >= obs.my_stack or call > 0.4 * obs.my_stack:
                    need += self._risk(obs)
                return Call() if eq >= need else Fold()
            if p["pev"] and eff_bb <= p["pev_bb"] and lg.can_raise and not limpers:
                ev = self._push_ev(obs, behind)
                if ev is not None:
                    if ev > p["pev_margin"]:
                        return RaiseTo(lg.max_raise_to)
                    if eff_bb <= p["push_bb"]:
                        return lg.passive() if lg.can_check else Fold()
            if eff_bb <= p["push_bb"]:
                scale = 0.75 + 0.25 * eff_bb / p["push_bb"]       # shorter = wider
                pbar = p["push_mult"] * scale / (k + 1 + limpers)
                if p["push_steal"] > 0:
                    pbar *= 1.0 + p["push_steal"] * (sf - 1.0)   # 1: the open bar's steal factor
                if eq >= pbar and lg.can_raise:
                    return RaiseTo(lg.max_raise_to)
                return lg.passive() if lg.can_check else Fold()
            if eq >= bar and lg.can_raise:
                to = (p["open_size"] + limpers) * bb
                self.aggressor = obs.seat
                return RaiseTo(lg.clamp(to))
            return lg.passive() if lg.can_check else Fold()
        # facing a raise
        others = len(in_pot)
        rk = p["hu_range_k"] if hu and p["hu_range_k"] > 0 else p["range_k"]
        if sh and p["sh_range_k"] > 0:
            rk = p["sh_range_k"]
        if p["read_alpha"] > 0:
            r = raises[-1][0]
            pfr = (self.pre_raises[r] + p["base_pfr"] * 8) / (self.dealt[r] + 8)   # shrink to the prior
            rk = min(8.0, max(p["rk_floor"], rk * (p["base_pfr"] / max(pfr, 0.01)) ** p["read_alpha"]))
        if p["vs3b"] > 0 and len(raises) >= 2 and raises[0][0] == obs.seat and raises[-1][0] != obs.seat:
            # my open was re-raised: the re-raiser's range from how often that seat re-raises opens
            r3 = raises[-1][0]
            c = (self.rr_made[r3] + p["vs3b_prior"] * 8) / (self.steal_seen[r3] + 8)
            rk = min(rk, self._k_for_top(c * p["vs3b"]))
        if p["behind_k"] != 0.8:
            r0 = raises[-1][0]
            vol = {h[0] for h in obs.history if h[1] == 0 and h[2] in ("call", "raise")
                   and h[0] not in (r0, obs.seat) and not seats[h[0]].folded}
            kf = rk + len(vol) * 0.8 + max(0, others - 1 - len(vol)) * p["behind_k"]
        else:
            kf = rk + max(0, others - 1) * 0.8
        eq = self._eq_k(obs, kf)
        call = lg.call_amount
        pot = obs.pot
        need = call / (pot + call) + p["call_margin"]
        allin_call = call >= obs.my_stack or any(seats[s].all_in for s in in_pot)
        if allin_call or call > 0.4 * obs.my_stack:
            need += self._risk(obs)
        if p["icm_call"] and allin_call and raises[-1] in obs.history:
            hist = list(obs.history)
            last = len(hist) - 1 - hist[::-1].index(raises[-1])
            r = raises[-1][0]
            if not any(h[1] == 0 and h[2] == "call" and h[0] != obs.seat for h in hist[last + 1:]):
                n_icm = self._icm_need(obs, r)
                if n_icm is not None:
                    need = n_icm + p["icm_margin"]
        if (self._pct is not None and lg.can_raise and len(raises) == 1 and not seats[raises[0][0]].all_in
                and eff_bb <= p["resteal_rel_bb"]
                and not any(h[1] == 0 and h[2] == "call" for h in obs.history if h[0] != obs.seat)):
            # re-shove a lone open with the top resteal_rel x (opener's open rate) of hands
            r0 = raises[0][0]
            o = (self.pre_raises[r0] + p["base_pfr"] * 8) / (self.dealt[r0] + 8)
            o = min(0.7, max(0.04, o))
            t = self._pct
            top = 1.0 - bisect.bisect_left(t, self._eq(obs, 1)) / len(t)
            if top <= max(0.03, p["resteal_rel"] * o):
                return RaiseTo(lg.max_raise_to)
        if (p["resteal"] and lg.can_raise and len(raises) == 1 and not seats[raises[0][0]].all_in
                and p["resteal_lo"] <= eff_bb <= p["resteal_hi"]
                and not any(h[1] == 0 and h[2] == "call" for h in obs.history if h[0] != obs.seat)):
            ev = self._resteal_ev(obs, raises[0][0], behind)
            if ev is not None and ev > p["resteal_margin"]:
                return RaiseTo(lg.max_raise_to)
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
            disc = p["bet_discount"]
            bettor = next((h[0] for h in reversed(street_acts) if h[2] == "raise"), None) if obs.history else None
            ag = (self.bet_made[bettor] + p["base_agg"] * 6) / (self.bet_opp[bettor] + 6) if bettor is not None else 0.0
            if p["agg_alpha"] > 0:
                if bettor is not None:
                    xs = max(0.0, min(1.0, (ag - p["base_agg"]) / (1.0 - p["base_agg"])))
                    disc = disc + (1.0 - disc) * min(1.0, p["agg_alpha"] * xs)
            eq_adj = eq * (disc ** n_aggr)
            call = lg.call_amount
            need = call / (pot + call) + p["call_margin"]
            if call >= obs.my_stack * 0.5:
                need += self._risk(obs)
            if (p["icm_call"] and k == 1 and bettor is not None
                    and (call >= obs.my_stack or seats[bettor].all_in)):
                n_icm = self._icm_need(obs, bettor)
                if n_icm is not None:
                    need = n_icm + p["icm_margin"]
            if lg.can_raise and (eq_adj >= max(p["value_eq"] + 0.15, need + 0.25)
                                 or (eq >= p["raise_eq"] and eq_adj >= need)
                                 or (eq >= p["agg_raise"] and ag >= p["agg_seat"] and eq_adj >= need)):
                return RaiseTo(lg.clamp(obs.my_bet + call + pot))
            if eq_adj >= need:
                return Call()
            return Fold()
        # not facing a bet
        vbar = p["value_eq"]
        if p["thin_value"] > 0 and opp:
            fr = (sum(self.pf_fold[s] for s in opp) + 1.0) / (sum(self.pf_faced[s] for s in opp) + 2.0)
            vbar -= p["thin_value"] * max(0.0, 1.0 - 2 * fr)
        if eq >= vbar and lg.can_raise:
            frac = p["bet_frac"]
            if p["station_size"] > 0 and opp:
                fr = (sum(self.pf_fold[s] for s in opp) + 1.0) / (sum(self.pf_faced[s] for s in opp) + 2.0)
                frac += p["station_size"] * max(0.0, 1.0 - 2 * fr)
            return RaiseTo(lg.clamp(frac * pot))
        if (k == 1 and self.aggressor == obs.seat and lg.can_raise
                and self.rng.random() < p["cbet"] and obs.street == 1):
            return RaiseTo(lg.clamp(p["cbet_size"] * pot))
        if p["bluff_bonus"] > 0 and lg.can_raise and 1 <= k <= p["bluff_max_opp"]:
            fr = (sum(self.pf_fold[s] for s in opp) + 1.0) / (sum(self.pf_faced[s] for s in opp) + 2.0)
            if self.rng.random() < p["bluff_bonus"] * max(0.0, 2 * fr - 1):
                return RaiseTo(lg.clamp(p["bluff_size"] * pot))
        return Check()
