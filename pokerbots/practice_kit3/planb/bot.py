"""Plan B bot for practice kit 3 (Pitch Hold'em: 3 hole cards, discard 1 face up).

Equity tables (PRE, POST, at the end of the file) were built by simulating the
variant (planb/build_tables.py). Amounts in = chips; raises out = "r <x>",
x = street total in big blinds, rounded to 0.5 bb.
"""
import random

DEBUG = False          # set by planb/debug_harness.py, never by env vars

# ---- parameters (prompt 3) ----
PUSH_DEPTH = 9.0       # eff bb at or below which we push or fold unopened pots
PUSH_BASE = 0.75
PUSH_SLOPE = 0.25
OPEN_BAR = 1.07
STEAL_W = 0.55
RAISER_K = 4.0
EXTRA_OPP_K = 0.8
RERAISE = 2.6
RERAISE_ALLIN_EFF = 24.0
CALL_MARGIN = 0.06
ICM_BASE = 0.10
ICM_PER_BUST = 0.15
PRE_BIG_CALL = 0.40
POST_BIG_CALL = 0.50
POST_BET_DISCOUNT = 0.6
VALUE_BET_EQ = 0.62
VALUE_BET_FRAC = 0.65
CBET_FREQ = 0.55
CBET_FRAC = 0.5
STAB_W = 0.4

RANKS = "23456789TJQKA"
STRAIGHTS = [(0b11111 << (h - 4)) for h in range(12, 3, -1)] + [(1 << 12) | 0b1111]


def category(cards):
    """Hold'em category of the best 5 of 5..7 cards: 0 high card .. 8 straight flush."""
    cnt = [0] * 13
    suits = [0, 0, 0, 0]
    smask = [0, 0, 0, 0]
    mask = 0
    for c in cards:
        r = c % 13
        s = c // 13
        cnt[r] += 1
        suits[s] += 1
        smask[s] |= 1 << r
        mask |= 1 << r
    fl = -1
    for s in range(4):
        if suits[s] >= 5:
            fl = s
    if fl >= 0:
        m = smask[fl]
        for st in STRAIGHTS:
            if m & st == st:
                return 8
    mx = max(cnt)
    if mx == 4:
        return 7
    if mx == 3:
        n3 = 0
        n2 = 0
        for v in cnt:
            if v == 3:
                n3 += 1
            elif v == 2:
                n2 += 1
        if n3 >= 2 or n2:
            return 6
    if fl >= 0:
        return 5
    for st in STRAIGHTS:
        if mask & st == st:
            return 4
    if mx == 3:
        return 3
    if mx == 2:
        return 2 if cnt.count(2) >= 2 else 1
    return 0


def board_cat(board):
    if len(board) >= 5:
        return category(board)
    cnt = {}
    for c in board:
        cnt[c % 13] = cnt.get(c % 13, 0) + 1
    v = sorted(cnt.values(), reverse=True)
    if v[0] == 4:
        return 7
    if v[0] == 3:
        return 3
    if v[0] == 2:
        return 2 if len(v) > 1 and v[1] == 2 else 1
    return 0


def flush_draw(hole, board, cat):
    if cat >= 5 or len(board) >= 5:
        return 0
    allc = hole + board
    for s in (hole[0] // 13, hole[1] // 13):
        if sum(1 for c in allc if c // 13 == s) == 4:
            return 1
    return 0


def _class_index():
    out, i = {}, 0
    for hi in range(12, -1, -1):
        for lo in range(hi, -1, -1):
            if hi == lo:
                out[(hi, lo, 2)] = i
                i += 1
            else:
                out[(hi, lo, 1)] = i
                out[(hi, lo, 0)] = i + 1
                i += 2
    return out


CLASS_IDX = _class_index()


def pre2(a, b, k):
    """Variant equity of keeping a, b vs k opponents (None if not in table)."""
    ra, rb = a % 13, b % 13
    if ra < rb:
        ra, rb = rb, ra
    shape = 2 if ra == rb else (1 if a // 13 == b // 13 else 0)
    i = (CLASS_IDX[(ra, rb, shape)] * 7 + k - 1) * 3
    s = PRE[i:i + 3]
    return None if s == "   " else int(s) / 999.0


def best_keep(hole, k):
    """(equity, discard card) maximising the kept two-card equity vs k."""
    best, disc = -1.0, hole[0]
    n = len(hole)
    for i in range(n):
        keep = [hole[j] for j in range(n) if j != i]
        e = pre2(keep[0], keep[1], k)
        if e is None:
            e = 0.0
        if e > best:
            best, disc = e, hole[i]
    if best <= 0.0:
        best = 0.8 / (k + 1)
    return best, disc


def post_eq(si, mc, bc, fd, k):
    i = ((((si * 9 + mc) * 9 + bc) * 2 + fd) * 7 + k - 1) * 3
    s = POST[i:i + 3]
    if s != "   ":
        return int(s) / 999.0
    tot, n = 0.0, 0
    for b in range(9):
        for f in range(2):
            j = ((((si * 9 + mc) * 9 + b) * 2 + f) * 7 + k - 1) * 3
            s = POST[j:j + 3]
            if s != "   ":
                tot += int(s)
                n += 1
    if n:
        return tot / n / 999.0
    return 1.0 / (k + 1)


def raise_str(chips, bb):
    """'r x' rounded UP to 0.5 bb (so the engine never rounds us below `chips`)."""
    half = -(-int(chips) * 2 // bb)
    return "r %.1f" % (half / 2.0)


def allin_str(st):
    return raise_str(st["max_raise_to"], st["bb"])


class Agent:
    def __init__(self):
        self.me = None
        self.rng = random.Random(7)
        self.open_faced = {}
        self.open_fold = {}
        self.bet_faced = {}
        self.bet_fold = {}
        self.dbg = []
        self._new_hand()

    def _new_hand(self):
        self.pf_raises = 0
        self.opener = None
        self.responded = set()
        self.street = "preflop"
        self.street_bets = 0
        self.aggressor = None
        self.pre_cache = {}
        self.post_cache = None

    # ---------------- notifications (kept cheap: they are charged to decisions)
    def on_table_start(self, info):
        self.me = info.get("your_id")
        seed = 0
        for ch in str(info.get("table_id", "")) + str(self.me):
            seed = seed * 131 + ord(ch)
        self.rng = random.Random(seed)

    def on_hand_start(self, hand):
        self._new_hand()

    def on_event(self, ev):
        t = ev["type"]
        if t == "street":
            self.street = ev["street"]
            self.street_bets = 0
            self.aggressor = None
            return
        p = ev.get("player")
        if t == "blind" or t == "discard" or p is None:
            return
        if self.street == "preflop":
            if self.pf_raises == 1 and p != self.opener and p not in self.responded:
                self.responded.add(p)
                if p != self.me:
                    self.open_faced[p] = self.open_faced.get(p, 0) + 1
                    if t == "fold":
                        self.open_fold[p] = self.open_fold.get(p, 0) + 1
            if t == "raise":
                self.pf_raises += 1
                if self.pf_raises == 1:
                    self.opener = p
                self.aggressor = p
        else:
            if self.street_bets and p != self.aggressor and p != self.me and t != "check":
                self.bet_faced[p] = self.bet_faced.get(p, 0) + 1
                if t == "fold":
                    self.bet_fold[p] = self.bet_fold.get(p, 0) + 1
            if t == "bet" or t == "raise":
                self.street_bets += 1
                self.aggressor = p

    def open_rate(self, p):
        return (self.open_fold.get(p, 0) + 1.0) / (self.open_faced.get(p, 0) + 2.0)

    def bet_rate(self, p):
        return (self.bet_fold.get(p, 0) + 1.0) / (self.bet_faced.get(p, 0) + 2.0)

    # ---------------- decisions
    def on_discard_request(self, state):
        hole = state["hole_cards"]
        try:
            k = sum(1 for q in state["players"] if q["status"] != "folded") - 1
            k = 1 if k < 1 else (7 if k > 7 else k)
            c = best_keep(hole, k)[1]
            if c in hole:
                return c
        except Exception:
            if DEBUG:
                raise
        return min(hole, key=lambda x: x % 13)

    def on_action_request(self, state):
        try:
            a = self.decide(state)
            if DEBUG:
                self.check(state, a)
            return a
        except Exception:
            if DEBUG:
                raise
            return "c" if state.get("to_call", 1) == 0 else "f"

    def pre_eq(self, hole, k):
        e = self.pre_cache.get(k)
        if e is None:
            e = best_keep(hole, k)[0]
            self.pre_cache[k] = e
        return e

    def pre_eq_f(self, hole, kf):
        if kf <= 1:
            return self.pre_eq(hole, 1)
        if kf >= 7:
            return self.pre_eq(hole, 7)
        lo = int(kf)
        w = kf - lo
        e = self.pre_eq(hole, lo)
        return e if w == 0 else e * (1 - w) + self.pre_eq(hole, lo + 1) * w

    def premium(self, n_left):
        return ICM_BASE * (1 + ICM_PER_BUST * (8 - n_left))

    def decide(self, st):
        me = self.me
        bb = st["bb"]
        to_call = st["to_call"]
        free = to_call == 0
        players = st["players"]
        pot = st["pot"]
        stack = st["stack"]
        mine = stack + st["your_bet"]
        opps = [q for q in players if q["id"] != me and q["status"] != "folded"]
        n_opp = len(opps)
        big = 0
        for q in opps:
            v = q["stack"] + q["bet"]
            if v > big:
                big = v
        eff = min(mine, big) / bb
        hole = st["hole_cards"]
        can_raise = st["can_raise"]

        if st["street"] == "preflop":
            if st["current_bet"] <= bb:
                # ----- no raise yet
                acted = set()
                limpers = 0
                for e in st["history"]:
                    if e["street"] == "preflop" and e["type"] != "blind":
                        acted.add(e["player"])
                        if e["type"] == "call":
                            limpers += 1
                behind = [q for q in opps if q["id"] not in acted]
                k = len(behind) + limpers
                k = 1 if k < 1 else (7 if k > 7 else k)
                eq = self.pre_eq(hole, k)
                if can_raise:
                    if eff <= PUSH_DEPTH:
                        if eq >= (PUSH_BASE + PUSH_SLOPE * eff / PUSH_DEPTH) / (k + 1):
                            return allin_str(st)
                    else:
                        sf = 1.0
                        if 1 <= len(behind) <= 5 and limpers == 0:
                            f = sum(self.open_rate(q["id"]) for q in behind) / len(behind)
                            sf = 1 - STEAL_W * max(0.0, 2 * f - 1)
                        if eq >= OPEN_BAR / (k + 1) * sf:
                            return raise_str((2 + limpers) * bb, bb)
                return "c" if free else "f"
            # ----- facing a raise
            kf = RAISER_K + EXTRA_OPP_K * max(0, n_opp - 1)
            eq = self.pre_eq_f(hole, kf)
            if can_raise and eq * (kf + 1) >= RERAISE:
                if eff <= RERAISE_ALLIN_EFF:
                    return allin_str(st)
                return raise_str(3 * st["current_bet"], bb)
            if free:
                return "c"
            need = to_call / float(pot + to_call) + CALL_MARGIN
            if to_call >= stack or to_call > PRE_BIG_CALL * stack:
                need += self.premium(len(players))
            return "c" if eq >= need else "f"

        # ----- postflop
        k = 1 if n_opp < 1 else (7 if n_opp > 7 else n_opp)
        board = st["board"]
        key = (st["street"], len(board))
        pc = self.post_cache
        if pc is None or pc[0] != key:
            mc = category(hole + board)
            bc = board_cat(board)
            fd = flush_draw(hole, board, mc)
            si = len(board) - 3
            pc = (key, si, mc, bc, fd, {})
            self.post_cache = pc
        eqs = pc[5]
        eq = eqs.get(k)
        if eq is None:
            eq = post_eq(pc[1], pc[2], pc[3], pc[4], k)
            eqs[k] = eq
        if not free:
            nb = 0
            for e in st["history"]:
                if e["street"] == st["street"] and (e["type"] == "bet" or e["type"] == "raise"):
                    nb += 1
            adj = eq * (POST_BET_DISCOUNT ** max(1, nb))
            need = to_call / float(pot + to_call) + CALL_MARGIN
            if to_call >= POST_BIG_CALL * stack:
                need += self.premium(len(players))
            return "c" if adj >= need else "f"
        if not can_raise:
            return "c"
        if eq >= VALUE_BET_EQ:
            return raise_str(st["your_bet"] + VALUE_BET_FRAC * pot, bb)
        if st["street"] == "flop" and k == 1 and self.i_raised_pre(st):
            if self.rng.random() < CBET_FREQ:
                return raise_str(st["your_bet"] + CBET_FRAC * pot, bb)
            return "c"
        if k <= 2:
            f = sum(self.bet_rate(q["id"]) for q in opps) / len(opps)
            if self.rng.random() < STAB_W * max(0.0, 2 * f - 1):
                return raise_str(st["your_bet"] + CBET_FRAC * pot, bb)
        return "c"

    def i_raised_pre(self, st):
        last = None
        for e in st["history"]:
            if e["street"] == "preflop" and e["type"] == "raise":
                last = e["player"]
        return last == self.me

    # ---------------- debug checks (prompt 4)
    def check(self, st, a):
        players = st["players"]
        tot_in = sum(q["contributed"] for q in players)
        assert st["pot"] == tot_in, "pot %d != contributions %d" % (st["pot"], tot_in)
        chips = sum(q["stack"] + q["contributed"] for q in players)
        assert chips == 2000 * 8, "chips %d != 16000" % chips
        rebuilt = 0
        for e in st["history"]:
            if e["type"] in ("blind", "call", "bet", "raise"):
                rebuilt += e["amount"]
        assert rebuilt == st["pot"], "rebuilt pot %d != pot %d" % (rebuilt, st["pot"])
        me = [q for q in players if q["id"] == self.me][0]
        assert me["stack"] == st["stack"] and me["bet"] == st["your_bet"]
        assert st["to_call"] == min(st["current_bet"] - st["your_bet"], st["stack"])
        if a.startswith("r"):
            assert st["can_raise"], "raise sent when can_raise is false"
            x = float(a.split()[1])
            half = int(x * 2 + 0.5)
            assert abs(half - x * 2) < 1e-9, "not a 0.5 bb step: %r" % a
            chips = half * st["bb"] // 2
            assert chips >= st["min_raise_to"], "raise %r = %d chips below min %d (engine would bump it)" % (
                a, chips, st["min_raise_to"])
            assert chips > st["current_bet"], "raise %r to %d not above current bet %d" % (
                a, chips, st["current_bet"])
            self.dbg.append((chips, st["min_raise_to"], st["max_raise_to"]))
        else:
            assert a in ("c", "f"), a


# generated by build_tables.py: 707250 deals x 8 heroes
PRE = '838713613533468414368644479384324280246219627452355291247213185627453355297253221195605427327264218185159613434338279238206181589404304241198167142596415321263221192169574386286226184153130571385290236198172152548353252193155128107556369277221187160141528333237182146120101547362271217183159140516323228175140115096528348261212179155137499314221168134111094530353267218185163146499310222172139117099520342260213182159143479300218170138114099515343261210180158142473290206160129109094511332252208179157142                     799651538450385333290586418329272232202177566389296238197167142569398310255217188166550372278221181152129560385299244206179158536354262205167141120535354266214180155136506319230176141115096512337251203170148130480293206156125102085495317235190161139121474289202154122098083497315233186156135121460278194147118097082481309232187158136119445267188144116095079474305226183155135120444267188143115095081466295220178151130117434256182137108089076455288216176151131117                     761593473385318272235546381296242206179157519349262208170143122531365283232196169150508335250198162136117507340257208176153135479305222171137113095479310230185155135120454281198150120098082462297221177148129115433259181137107087073455290215174146127112422254177134105085071448291218175147128113415245169129103086073440282209170145127114404237166125100083071437280209167142124109392231161125100083070427272200164139121108                     724541418330270227197511355276228195171152486324244195162137119484328252205174151134459295216168136113097462305233190159138123434273197152122102087446289215172145126111413250177134107088076426273204164139120107392231162121096080068420270203162136119106383228158120096080067412261196158135119104377219152112089075064407255189154129113100364212144110089074064399250190152127112100                     689492367286232194168468320248203173151135439289216171141120105450304230188161141126420266194152124105092425278212171144127113401249180140112095081412271206166140122108380229162124098083071392250189154132117105360213151114091076064391253189154129112100350204142106085072062387245183148129114102348204141110088074063381242184150129115104                     649448329253205173152436299230188159140125407264194152125105092415278212172148131117385245177139114096084403263199164141124112370228164126102087075390249187152129113100349212150118096082070366236175140119106094331194134102081067057370235176142120106094317182126094077067059366234174141119105095                     608403289224183157140407278216177152134121379246181142118101089398267204167145128114362231168131109093082379254195158137122112344214154121100086076362237180148127112102321193139108090078067353228174141121105095314192137106088075065355227172143120104093                     572369264205170148134389266206172150134121357232172137115100089383262202168145129116341218160127107094084361241184153132118106325202146113095083074340227175145123110101304189134106089076066335216161132115101092                     541341246194164145132373256201171151136124335215159129110097087358244191162142126117323206152123105092083347230176148132119107308194139111096084076328214162135119104096                     511317228182156139128359247195167145132121327211160129113101092345235183154138124113311200148119103093085336228176151134120108                     486295212172150135124343235189162144130120307185139112100089082338224178152132115104                     464277201165146132123331224173144128117109                     443263193161142131121'
POST = '344192133103084072063550426365326299276258                                                                                                                                                                                                                                                                                                                                                626429314241192157132721562458386334295265376204132093070055044562421345297261234212                                                                                                                                                                                                                                                                                                      826700606533475428388                     651462344267214177149                                                                                                                                                                                                                                                                                                                           907835776725683646612                     913840774717664616573                                                               430257176131100081065                                                                                                                                                                                                                                       890808739678626580541892813750701653612576                                                                                                                                                                                                                                                                                                                                                930874822776735698663                                                                                                                                                                                                                                                                                                                                                                                                               968943919896876857839                                                               711541428350295246214                                                                                                                                                                                                                                                                                 999999998998997997996                                                               999999999999999999999                                                                                                                                                                                                                                       999999999999999999999                                                                                                                                                                                                                                                                                                                                                                     265123079060049042037394266217190173159148                                                                                                                                                                                                                                                                                                                                                595387269196149117093657471359287238202177308143082054039030023425271203166142124110                                                                                                                                                                                                                                                                                                      814682580501440389348842718625552495445406646445321239184145117679492370289232191161420236149100069050036473292203144107082061                                                                                                                                                                                                                                                            896815750695649609574888798719650599543495906825752689631579534905826748682627570518                                          366189117080059045036414232140102065051038                                                                                                                                                                                                                  880791717657604559520887804729669613565524853739652573511457408866755673594521465416                                                                                                                                                                                                                                                                                                      910838778725680641606                     893803724659604554505                                                                                                                                                                                                                                                                                                                                                                     973950929907887868850                     923860803749696647606                     752583465376312260221                                                                                                                                                                                                                                                                                 999999998998997997997                     996989989989986979976                     999999999999999999999                                                                                                                                                   497334250202171145125                                                               998996996996994987983                     999999999999999999999                                                                                                                                                                                                                                                                                                                           154032008002000000000                                                                                                                                                                                                                                                                                                                                                                     546324205136094067048                     213061020007003001000                                                                                                                                                                                                                                                                                                                           815678571487420364318                     634419287202146108081                     406220133085057039027                                                                                                                                                                                                                                                                                 878781703637581535493                     892800719648585529478                                                               282107045021010005003                                                                                                                                                                                                                                       896811740680628583543                     876774685610545487439                     785596458343255189140                     496257149076049025017                     483312228178146122105                                                                                                                                                                                             908835773721678641609                     884786704635576526480                     817668541430345277219                     585335181106055030016                     896808745681635598565                     493325241192158131114                                                                                                                                                                                             981964946929912896880                     928863802744691640597                     768602479386317262219                                                                                                         478304214163129106088                                                                                                                                                   999998998997997997997                     998996994994994992990                     999999999999999999999                                                                                                         993990990990987987981                     500336251199170147125                                                               994991984981978974972                     996996996994989987984                     999999999999999999999                                                               972946946946937928919                     985985971971971957957                                                                                                         500333250200166143125                     '
