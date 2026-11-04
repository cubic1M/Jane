"""Plan B5 bot for practice kit 4 (Six-Plus hold'em, 36 cards).

Built from the Plan B prompts: preflop class table, postflop
(street, my category, board category, k) table, ICM-ish margins.
"""
import bisect
import math
import random
from collections import Counter

NAME = "PlanB5"

# ---- parameters (named constants) ----
OPEN_BAR = 1.07
OPEN_BAR_HU = 0.60
RAISER_K = 4.0
RAISER_K_HU = 2.0
CALLER_K = 0.8
TO_ACT_K = 0.2
PUSH_DEPTH = 9.0
RESHOVE_DEPTH = 28.0
RERAISE = 2.6
RERAISE_SHOVE_DEPTH = 24.0
CALL_MARGIN = 0.06
ICM_PREMIUM = 0.10
ICM_SLOPE = 0.15
PRE_BIG_CALL = 0.40
POST_BIG_CALL = 0.50
VALUE_BET_EQ = 0.62
VALUE_BET_FRAC = 0.65
CBET_FRAC = 0.50
CBET_FREQ = 0.55
STAB_FREQ = 0.40
LOCK_OPENS = 20
LOCK_RATE = 0.30
LOCK_P = (0.40, 0.33, 0.23, 0.17, 0.14, 0.12, 0.11)

DEBUG = False          # switched on by planb5/harness.py, never by env vars
DEBUG_PROBLEMS = []

RANKCH = "6789TJQKA"
RV = {r: i + 6 for i, r in enumerate(RANKCH)}
DECK = [r + s for r in RANKCH for s in "cdhs"]
STARTING_STACK = 2000
FULL_DECK = False      # attacked-opens lock only on a 52-card deck

# 2969500 deals, 120 s x 4 workers
PRE = {'66p':[4203,2973,2528,2270,2097,1952,1827],'76o':[3486,2090,1483,1147,910,749,628],'76s':[3792,2442,1837,1491,1273,1120,1004],'77p':[4730,3283,2714,2411,2204,2057,1928],'86o':[3737,2280,1637,1282,1035,853,718],'86s':[3930,2515,1917,1560,1339,1169,1055],'87o':[4078,2561,1828,1412,1144,940,795],'87s':[4290,2797,2141,1752,1494,1283,1143],'88p':[5357,3726,3003,2610,2373,2194,2055],'96o':[3966,2439,1772,1370,1106,924,776],'96s':[4256,2790,2123,1746,1492,1314,1168],'97o':[4315,2726,1984,1549,1239,1027,863],'97s':[4552,2989,2295,1882,1614,1416,1263],'98o':[4624,2978,2172,1683,1361,1124,944],'98s':[4855,3246,2449,1991,1669,1445,1279],'99p':[5964,4242,3392,2919,2613,2387,2229],'A6o':[4802,3040,2189,1688,1344,1120,949],'A6s':[4973,3312,2481,1962,1651,1431,1270],'A7o':[5051,3237,2331,1778,1421,1172,997],'A7s':[5239,3501,2594,2081,1729,1502,1338],'A8o':[5274,3449,2482,1877,1509,1245,1055],'A8s':[5438,3673,2746,2207,1845,1583,1398],'A9o':[5403,3565,2595,1995,1614,1336,1142],'A9s':[5643,3843,2918,2337,1946,1700,1499],'AAp':[7511,5987,4984,4303,3794,3430,3146],'AJo':[5786,3959,2965,2333,1901,1595,1364],'AJs':[5922,4142,3186,2592,2193,1914,1691],'AKo':[5979,4255,3251,2600,2132,1780,1518],'AKs':[6112,4479,3498,2843,2378,2068,1826],'AQo':[5839,4059,3081,2423,1978,1659,1429],'AQs':[6028,4289,3306,2666,2248,1947,1723],'ATo':[5575,3787,2818,2216,1826,1534,1321],'ATs':[5748,4021,3116,2512,2117,1844,1634],'J6o':[3984,2409,1731,1354,1109,934,809],'J6s':[4233,2695,2061,1706,1465,1291,1154],'J7o':[4346,2681,1943,1523,1236,1033,882],'J7s':[4543,2934,2221,1812,1556,1361,1210],'J8o':[4673,2975,2178,1692,1387,1165,995],'J8s':[4814,3216,2436,2010,1712,1506,1354],'J9o':[5017,3280,2418,1894,1545,1287,1095],'J9s':[5204,3544,2704,2210,1882,1640,1468],'JJp':[6657,4908,3936,3363,2987,2735,2534],'JTo':[5439,3751,2864,2316,1931,1632,1413],'JTs':[5538,3963,3117,2574,2195,1914,1707],'K6o':[4426,2733,1945,1498,1207,1000,856],'K6s':[4676,3055,2313,1866,1572,1385,1246],'K7o':[4640,2910,2077,1604,1295,1077,925],'K7s':[4851,3174,2379,1906,1616,1417,1264],'K8o':[4766,2991,2147,1657,1336,1108,950],'K8s':[5031,3298,2488,2014,1705,1489,1332],'K9o':[5142,3338,2420,1878,1512,1252,1066],'K9s':[5283,3531,2629,2123,1779,1562,1385],'KJo':[5594,3860,2901,2311,1887,1595,1372],'KJs':[5780,4131,3207,2599,2196,1911,1693],'KKp':[7161,5506,4501,3820,3383,3092,2872],'KQo':[5676,3974,3028,2419,1990,1672,1445],'KQs':[5799,4150,3237,2667,2253,1961,1741],'KTo':[5499,3766,2831,2228,1822,1537,1311],'KTs':[5727,3997,3103,2517,2139,1883,1677],'Q6o':[4231,2556,1806,1396,1122,934,801],'Q6s':[4405,2802,2110,1729,1478,1305,1174],'Q7o':[4344,2671,1911,1474,1196,1005,862],'Q7s':[4542,2890,2180,1757,1502,1317,1176],'Q8o':[4694,2949,2130,1641,1343,1128,961],'Q8s':[4936,3197,2394,1928,1627,1445,1303],'Q9o':[5054,3293,2421,1884,1530,1281,1088],'Q9s':[5253,3541,2679,2183,1854,1610,1424],'QJo':[5525,3828,2905,2310,1904,1607,1390],'QJs':[5690,4046,3141,2575,2196,1936,1730],'QQp':[6903,5180,4160,3558,3165,2890,2691],'QTo':[5465,3755,2852,2273,1875,1586,1372],'QTs':[5577,3899,3014,2459,2084,1815,1599],'T6o':[3905,2413,1754,1376,1137,959,822],'T6s':[4177,2734,2110,1735,1502,1310,1172],'T7o':[4341,2744,2004,1568,1280,1076,920],'T7s':[4570,3019,2312,1901,1625,1421,1271],'T8o':[4675,3054,2256,1776,1453,1222,1040],'T8s':[4856,3309,2546,2089,1793,1569,1413],'T9o':[5011,3346,2507,1989,1644,1384,1186],'T9s':[5187,3633,2778,2272,1934,1690,1493],'TTp':[6415,4672,3714,3154,2804,2560,2386]}
POST = {1001:3854,1002:2401,1003:1768,1004:1396,1005:1147,1006:967,1007:830,1101:5511,1102:3613,1103:2635,1104:2051,1105:1671,1106:1407,1107:1214,1111:3846,1112:2116,1113:1351,1114:935,1115:679,1116:510,1117:398,1201:6988,1202:5239,1203:4147,1204:3435,1205:2962,1206:2615,1207:2369,1211:5861,1212:3835,1213:2710,1214:2018,1215:1577,1216:1272,1217:1053,1301:7694,1302:6107,1303:4890,1304:3956,1305:3207,1306:2623,1307:2167,1401:9510,1402:9111,1403:8761,1404:8436,1405:8142,1406:7876,1407:7615,1411:9190,1412:8451,1413:7790,1414:7189,1415:6642,1416:6152,1417:5693,1441:4420,1442:2644,1443:1773,1444:1295,1445:979,1446:759,1447:591,1511:9488,1512:9039,1513:8625,1514:8258,1515:7917,1516:7618,1517:7329,1541:6743,1542:5040,1543:3793,1544:2963,1545:2439,1546:1937,1547:1613,1601:9784,1602:9582,1603:9377,1604:9202,1605:9030,1606:8831,1607:8685,1711:9993,1712:9971,1713:9964,1714:9964,1715:9934,1716:9934,1717:9891,1741:10000,1742:10000,1743:10000,1744:9978,1745:9967,1746:9956,1747:9956,1801:9972,1802:9944,1803:9944,1804:9944,1805:9887,1806:9887,1807:9887,2001:2843,2002:1715,2003:1319,2004:1095,2005:942,2006:829,2007:738,2101:4869,2102:2907,2103:1981,2104:1467,2105:1148,2106:935,2107:783,2111:3127,2112:1561,2113:961,2114:655,2115:472,2116:350,2117:269,2201:6607,2202:4679,2203:3506,2204:2752,2205:2246,2206:1896,2207:1655,2211:5555,2212:3412,2213:2255,2214:1566,2215:1143,2216:866,2217:679,2221:3813,2222:1925,2223:1096,2224:670,2225:438,2226:293,2227:217,2301:7683,2302:6114,2303:4938,2304:4050,2305:3347,2306:2797,2307:2352,2311:7170,2312:5322,2313:3954,2314:2891,2315:2107,2316:1510,2317:1060,2401:9537,2402:9154,2403:8825,2404:8512,2405:8222,2406:7967,2407:7710,2411:9167,2412:8395,2413:7693,2414:7049,2415:6473,2416:5941,2417:5446,2441:3730,2442:1955,2443:1222,2444:842,2445:611,2446:464,2447:355,2511:9482,2512:9027,2513:8618,2514:8251,2515:7918,2516:7611,2517:7326,2521:8773,2522:7787,2523:6945,2524:6204,2525:5558,2526:4958,2527:4473,2541:7081,2542:5260,2543:3984,2544:3066,2545:2441,2546:1913,2547:1515,2601:9317,2602:8737,2603:8195,2604:7759,2605:7356,2606:7005,2607:6729,2611:9784,2612:9583,2613:9363,2614:9149,2615:8983,2616:8798,2617:8622,2711:9988,2712:9979,2713:9971,2714:9963,2715:9938,2716:9930,2717:9901,2721:9964,2722:9891,2723:9891,2724:9891,2725:9854,2726:9818,2727:9781,2741:9992,2742:9986,2743:9981,2744:9976,2745:9973,2746:9962,2747:9962,2771:5112,2772:3330,2773:2487,2774:2038,2775:1722,2776:1526,2777:1401,2801:9945,2802:9871,2803:9847,2804:9802,2805:9747,2806:9669,2807:9613,2811:10000,2812:10000,2813:10000,2814:10000,2815:10000,2816:10000,2817:10000,3001:397,3002:18,3003:1,3004:0,3005:0,3006:0,3007:0,3101:3205,3102:1242,3103:550,3104:261,3105:132,3106:71,3107:38,3111:1228,3112:189,3113:30,3114:4,3115:0,3116:0,3117:0,3201:6307,3202:4141,3203:2815,3204:1969,3205:1416,3206:1041,3207:783,3211:5041,3212:2717,3213:1555,3214:922,3215:559,3216:342,3217:207,3221:3504,3222:1600,3223:802,3224:410,3225:211,3226:106,3227:51,3301:8140,3302:6730,3303:5633,3304:4770,3305:4073,3306:3512,3307:3053,3311:7460,3312:5575,3313:4149,3314:3070,3315:2241,3316:1603,3317:1127,3321:7067,3322:4859,3323:3258,3324:2059,3325:1283,3326:707,3327:367,3331:4685,3332:2967,3333:2115,3334:1610,3335:1279,3336:1046,3337:879,3401:9556,3402:9180,3403:8864,3404:8565,3405:8300,3406:8047,3407:7810,3411:9140,3412:8351,3413:7621,3414:6960,3415:6337,3416:5757,3417:5212,3431:9462,3432:9070,3433:8718,3434:8452,3435:8193,3436:7894,3437:7674,3441:2442,3442:762,3443:249,3444:81,3445:26,3446:8,3447:2,3511:9588,3512:9210,3513:8872,3514:8547,3515:8240,3516:7962,3517:7696,3521:8871,3522:7877,3523:6997,3524:6207,3525:5531,3526:4930,3527:4418,3541:7302,3542:5371,3543:4029,3544:3040,3545:2334,3546:1792,3547:1385,3551:4644,3552:2866,3553:1980,3554:1459,3555:1094,3556:837,3557:644,3601:9172,3602:8480,3603:7851,3604:7292,3605:6806,3606:6397,3607:6069,3611:9284,3612:8669,3613:8091,3614:7622,3615:7234,3616:6893,3617:6598,3621:9911,3622:9780,3623:9636,3624:9533,3625:9411,3626:9295,3627:9178,3631:9085,3632:8257,3633:7644,3634:6991,3635:6349,3636:5891,3637:5394,3641:9289,3642:8550,3643:7866,3644:7127,3645:6499,3646:5816,3647:5077,3661:4798,3662:3053,3663:2176,3664:1643,3665:1288,3666:1065,3667:876,3711:9988,3712:9978,3713:9966,3714:9960,3715:9941,3716:9929,3717:9917,3721:10000,3722:9967,3723:9967,3724:9958,3725:9958,3726:9925,3727:9900,3741:9994,3742:9993,3743:9993,3744:9988,3745:9985,3746:9980,3747:9978,3751:9967,3752:9935,3753:9913,3754:9902,3755:9869,3756:9847,3757:9826,3771:5011,3772:3311,3773:2460,3774:1962,3775:1640,3776:1414,3777:1245,3801:9931,3802:9855,3803:9825,3804:9779,3805:9733,3806:9657,3807:9627,3811:9938,3812:9869,3813:9819,3814:9775,3815:9719,3816:9676,3817:9626,3821:10000,3822:10000,3823:10000,3824:10000,3825:10000,3826:10000,3827:10000,3831:9898,3832:9762,3833:9626,3834:9388,3835:9286,3836:9252,3837:9116,3841:10000,3842:10000,3843:10000,3844:10000,3845:10000,3846:10000,3847:10000,3861:9896,3862:9896,3863:9740,3864:9427,3865:9271,3866:9115,3867:8958,3881:5169,3882:3483,3883:2626,3884:2146,3885:1845,3886:1565,3887:1404}

# ---- table helpers ----
_POST_AVG = {}
for _k, _v in POST.items():
    _a = (_k // 1000, (_k // 100) % 10, _k % 10)
    _e = _POST_AVG.setdefault(_a, [0, 0])
    _e[0] += _v
    _e[1] += 1
_POST_AVG = {k: v[0] / v[1] for k, v in _POST_AVG.items()}


def _cls(c1, c2):
    r1, r2 = RV[c1[0]], RV[c2[0]]
    if r1 < r2:
        r1, r2 = r2, r1
    a, b = RANKCH[r1 - 6], RANKCH[r2 - 6]
    if r1 == r2:
        return a + b + "p"
    return a + b + ("s" if c1[1] == c2[1] else "o")


def _pre_eq_int(c, k):
    row = PRE.get(c)
    if row is None:
        return 1.0 / (k + 1)
    return row[k - 1] / 1e4


def _pre_eq(c, k):
    """Preflop equity, linear interpolation between integer k."""
    if k <= 1:
        return _pre_eq_int(c, 1)
    if k >= 7:
        return _pre_eq_int(c, 7)
    lo = int(k)
    fr = k - lo
    e = _pre_eq_int(c, lo)
    if fr > 1e-9:
        e += fr * (_pre_eq_int(c, lo + 1) - e)
    return e


def _post_eq(street, cat, bcat, k):
    k = max(1, min(7, k))
    v = POST.get(street * 1000 + cat * 100 + bcat * 10 + k)
    if v is not None:
        return v / 1e4
    v = _POST_AVG.get((street, cat, k))
    if v is not None:
        return v / 1e4
    return 1.0 / (k + 1)


def _straight(vals):
    for hi in range(14, 9, -1):
        if all(v in vals for v in range(hi - 4, hi + 1)):
            return True
    return {14, 6, 7, 8, 9} <= vals


def category(cards):
    """Six-Plus category of 5-7 cards, numbered like the kit (0 high .. 8 SF)."""
    vals = [RV[c[0]] for c in cards]
    suits = Counter(c[1] for c in cards)
    fs = None
    for s, n in suits.items():
        if n >= 5:
            fs = s
    if fs is not None and _straight({RV[c[0]] for c in cards if c[1] == fs}):
        return 8
    cnt = sorted(Counter(vals).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if fs is not None:
        return 6
    if cnt[0] == 3:
        return 5 if len(cnt) > 1 and cnt[1] >= 2 else 4
    if _straight(set(vals)):
        return 3
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


def board_category(board):
    if len(board) >= 5:
        return category(board)
    cnt = sorted(Counter(c[0] for c in board).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if cnt[0] == 3:
        return 4
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


# percentile table: top share of each starting hand (fraction with higher equity)
TOP = {}


def _build_top():
    hands = [(DECK[i], DECK[j]) for i in range(len(DECK)) for j in range(i + 1, len(DECK))]
    eqs = sorted(_pre_eq_int(_cls(a, b), 1) for a, b in hands)
    n = len(eqs)

    for c in PRE:
        e = _pre_eq_int(c, 1)
        TOP[c] = (n - bisect.bisect_right(eqs, e)) / n


_build_top()


def setup(rules):
    global FULL_DECK
    try:
        FULL_DECK = len(rules.get("deck", ())) >= 52
    except Exception:
        pass


# ---- log parsing ----
def _tokens(log):
    """List of streets; each a list of (seat, code, amount)."""
    streets = [[]]
    for t in log.split():
        if t[0] == "|":
            streets.append([])
            continue
        if t[-1] == "!":
            t = t[:-1]
        amt = int(t[2:]) if len(t) > 2 else 0
        streets[-1].append((int(t[0]), t[1], amt))
    return streets


def _rate(d, seat, prior_a, prior_b):
    e = d.get(seat)
    if e is None:
        return prior_a / prior_b
    return (e[0] + prior_a) / (e[1] + prior_b)


def _bump(d, seat, hit):
    e = d.get(seat)
    if e is None:
        e = d[seat] = [0, 0]
    e[1] += 1
    if hit:
        e[0] += 1


def _process(memory, lh, me):
    """Update per-seat stats from the previous hand's public log."""
    streets = _tokens(lh.get("log") or "")
    pre = streets[0]
    dealt = memory["dealt"]
    for s in {x[0] for x in pre}:
        dealt[s] = dealt.get(s, 0) + 1
    raises = [i for i, x in enumerate(pre) if x[1] == "r"]
    if raises:
        i0 = raises[0]
        opener = pre[i0][0]
        memory["opens"][opener] = memory["opens"].get(opener, 0) + 1
        end = raises[1] if len(raises) > 1 else len(pre)
        seen = set()
        for s, c, a in pre[i0 + 1:end + 1 if len(raises) > 1 else end]:
            if s == opener or s in seen:
                continue
            seen.add(s)
            _bump(memory["fold_open"], s, c == "f")
            _bump(memory["rr_lone"], s, c == "r")
        if len(raises) > 1:
            for s, c, a in pre[raises[1] + 1:]:
                if s == opener:
                    _bump(memory["fold_3b"], opener, c == "f")
                    break
            if opener == me:
                memory["my_reraised"] += 1
        if opener == me:
            memory["my_opens"] += 1
    for st in streets[1:]:
        first = None
        seen = set()
        for i, (s, c, a) in enumerate(st):
            if first is None:
                if c == "r":
                    first = s
                continue
            if s == first or s in seen:
                continue
            seen.add(s)
            _bump(memory["fold_bet"], s, c == "f")


def _init(memory, view):
    memory["init"] = True
    memory["dealt"] = {}
    memory["opens"] = {}
    memory["fold_open"] = {}
    memory["rr_lone"] = {}
    memory["fold_3b"] = {}
    memory["fold_bet"] = {}
    memory["my_opens"] = 0
    memory["my_reraised"] = 0
    memory["locked"] = False
    memory["seen_hand"] = 0
    memory["rng"] = random.Random("planb5:%d:%d:%s" % (
        view["me"], view["button"], "".join(view["hole"])))


def _open_rate(memory, s):
    v = (memory["opens"].get(s, 0) + 0.96) / (memory["dealt"].get(s, 0) + 8)
    return min(0.7, max(0.04, v))


# ---- the decision ----
def _raise_to(view, to):
    """Chips to add to make the bet 'to' this street, within the kit's bounds."""
    me = view["seats"][view["me"] - 1]
    if view["min_add"] is None:
        return view["owe"]
    add = max(view["min_add"], int(to) - me["bet"])
    return min(add, view["max_add"])


def _add_bet(view, frac):
    if view["min_add"] is None:
        return 0
    add = max(view["min_add"], int(frac * view["pot"]))
    return min(add, view["max_add"])


def _premium(left):
    return ICM_PREMIUM * (1 + ICM_SLOPE * (8 - left))


def _decide(view, memory):
    if "init" not in memory:
        _init(memory, view)
    me = view["me"]
    lh = view.get("last_hand")
    if lh and lh.get("hand", 0) > memory["seen_hand"]:
        memory["seen_hand"] = lh["hand"]
        _process(memory, lh, me)
    seats = view["seats"]
    my = seats[me - 1]
    owe, bb, pot = view["owe"], view["bb"], view["pot"]
    stack = view["max_add"]
    rng = memory["rng"]
    opps = [x for x in seats if x["seat"] != me and x["status"] in ("in", "allin")]
    left = sum(1 for x in seats if x["status"] != "out")
    heads_up_table = left == 2
    big = max((x["stack"] + x["bet"] for x in opps), default=0)
    eff = min(stack + my["bet"], big) / bb
    streets = _tokens(view["log"])
    cur = streets[-1]
    acted = {s for s, c, a in cur if c in "fkcr"}
    to_act = [x["seat"] for x in opps if x["status"] == "in" and x["seat"] not in acted]
    call = min(owe, stack)
    street = view["street"]
    hole = view["hole"]

    if street == 0:
        c = _cls(hole[0], hole[1])
        raises = [i for i, x in enumerate(cur) if x[1] == "r"]
        if not raises:
            limpers = len({s for s, cc, a in cur if cc == "c" and s != me})
            k = max(1, min(7, len(to_act) + limpers))
            eq = _pre_eq(c, k)
            steal = 1.0
            if 1 <= len(to_act) <= 5 and limpers == 0:
                f = sum(_rate(memory["fold_open"], s, 1, 2) for s in to_act) / len(to_act)
                steal = 1 - 0.55 * max(0.0, 2 * f - 1)
            if eff <= PUSH_DEPTH:
                if eq >= (0.75 + 0.25 * eff / PUSH_DEPTH) / (k + 1) * (1 + 0.5 * (steal - 1)):
                    return stack
                return 0 if owe == 0 else -1
            if (not memory["locked"] and FULL_DECK and memory["my_opens"] >= LOCK_OPENS
                    and memory["my_reraised"] >= LOCK_RATE * memory["my_opens"]):
                memory["locked"] = True
            if memory["locked"]:
                kk = max(1, min(7, len(to_act) + limpers))
                ok = TOP.get(c, 1.0) <= 1.3 * LOCK_P[kk - 1] / steal
            else:
                bar = OPEN_BAR_HU if heads_up_table else OPEN_BAR
                ok = eq >= bar / (k + 1) * steal
            if ok:
                return _raise_to(view, (2 + limpers) * bb)
            return 0 if owe == 0 else -1
        # facing a raise
        i0 = raises[0]
        opener = cur[i0][0]
        after = cur[i0 + 1:]
        callers = [s for s, cc, a in after if cc == "c"]
        opener_st = seats[opener - 1]["status"]
        if (len(raises) == 1 and not callers and opener_st == "in"
                and eff <= RESHOVE_DEPTH and opener != me):
            f = _rate(memory["fold_3b"], opener, 3.9, 6)
            m = min(1.6, max(0.4, f / 0.65))
            if TOP.get(c, 1.0) <= max(0.03, _open_rate(memory, opener) * m):
                return stack
        last_raiser = cur[raises[-1]][0]
        base = RAISER_K_HU if heads_up_table else RAISER_K
        rk = base
        if (opener == me and len(raises) == 2 and not callers
                and seats[last_raiser - 1]["status"] == "allin"):
            r = _rate(memory["rr_lone"], last_raiser, 0.7, 10)
            cc = min(0.5, 2 * r)
            kc = max(1.0, min(7.0, 1 + 0.65 * math.log2(0.5 / cc)))
            rk = min(base, kc)
        others = {s for s, cc, a in cur if cc in "cr" and s != me and s != last_raiser
                  and seats[s - 1]["status"] in ("in", "allin")}
        kf = rk + CALLER_K * len(others) + TO_ACT_K * len(
            [s for s in to_act if s not in others and s != last_raiser])
        eq = _pre_eq(c, kf)
        if eq * (kf + 1) >= RERAISE and view["min_add"] is not None:
            if eff <= RERAISE_SHOVE_DEPTH:
                return stack
            curbet = max(x["bet"] for x in seats)
            return _raise_to(view, 3 * curbet)
        need = call / (pot + call) + CALL_MARGIN
        if call >= stack or call > PRE_BIG_CALL * stack:
            need += _premium(left)
        if eq >= need:
            return call
        return -1

    # ---- postflop ----
    key = (view["hand"], street)
    cache = memory.get("cat")
    if cache is None or cache[0] != key:
        board = view["board"]
        cache = memory["cat"] = (key, category(hole + board), board_category(board))
    k = max(1, min(7, len(opps)))
    eq = _post_eq(street, cache[1], cache[2], k)
    if owe > 0:
        nb = sum(1 for s, cc, a in cur if cc == "r")
        adj = eq * (0.5 ** nb)
        need = call / (pot + call) + CALL_MARGIN
        if call >= POST_BIG_CALL * stack:
            need += _premium(left)
        return call if adj >= need else -1
    if view["min_add"] is None:
        return 0
    if eq >= VALUE_BET_EQ:
        return _add_bet(view, VALUE_BET_FRAC)
    pre = streets[0]
    pre_raisers = [s for s, cc, a in pre if cc == "r"]
    if street == 1 and k == 1 and pre_raisers and pre_raisers[-1] == me:
        if rng.random() < CBET_FREQ:
            return _add_bet(view, CBET_FRAC)
        return 0
    if 1 <= k <= 2:
        f = sum(_rate(memory["fold_bet"], x["seat"], 1, 2) for x in opps) / k
        if rng.random() < STAB_FREQ * max(0.0, 2 * f - 1):
            return _add_bet(view, CBET_FRAC)
    return 0


def _check(view, memory, r):
    """Debug-mode invariants (prompt 4)."""
    seats = view["seats"]
    tot = sum(x["total"] for x in seats)
    if tot != view["pot"]:
        DEBUG_PROBLEMS.append("pot %d != sum totals %d" % (view["pot"], tot))
    chips = sum(x["stack"] + x["total"] for x in seats)
    if chips != STARTING_STACK * len(seats):
        DEBUG_PROBLEMS.append("chips %d != %d" % (chips, STARTING_STACK * len(seats)))
    log_sum = sum(a for st in _tokens(view["log"]) for s, c, a in st)
    if log_sum != view["pot"]:
        DEBUG_PROBLEMS.append("log sum %d != pot %d" % (log_sum, view["pot"]))
    owe, mn, mx = view["owe"], view["min_add"], view["max_add"]
    if type(r) is not int:
        DEBUG_PROBLEMS.append("non-int reply %r" % (r,))
    elif r > 0 and r != min(owe, mx) and r != owe:
        if mn is None and r != mx:
            DEBUG_PROBLEMS.append("raise %d when raising not allowed" % r)
        elif mn is not None and not (mn <= r <= mx) and r != mx:
            DEBUG_PROBLEMS.append("raise %d outside [%s, %d]" % (r, mn, mx))
    if r < 0 and owe == 0:
        DEBUG_PROBLEMS.append("fold when check is free")


def play(view, memory):
    try:
        r = int(_decide(view, memory))
        if r < 0 and view["owe"] == 0:
            r = 0
        if DEBUG:
            _check(view, memory, r)
        return r
    except Exception as e:
        if DEBUG:
            DEBUG_PROBLEMS.append("exception %r" % (e,))
        try:
            return 0 if view["owe"] == 0 else -1
        except Exception:
            return -1
