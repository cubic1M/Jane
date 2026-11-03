# field 6 (postflop specialists, blind): icm_tag (rs_call=2) vs field bests, rs_call 0 and 3 (seeds 99000+, 400 paired tables)

  320/3200 tables (111s)
  640/3200 tables (204s)
  960/3200 tables (299s)
  1280/3200 tables (391s)
  1600/3200 tables (481s)
  1920/3200 tables (570s)
  2240/3200 tables (663s)
  2560/3200 tables (758s)
  2880/3200 tables (852s)
  3200/3200 tables (946s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 17.54 ± 2.40 | 4% | 14% | 92% | 0.295 | 20.08 | 18 | 0 |
| f3_exploiter | 37.83 ± 3.60 | 15% | 42% | 73% | 0.522 | 10.19 | 32 | 0 |
| f2_shark | 50.50 ± 3.65 | 15% | 57% | 55% | 0.130 | 4.30 | 17 | 0 |
| f4_icm | 34.68 ± 3.12 | 4% | 41% | 70% | 0.384 | 10.28 | 30 | 0 |
| f5_adapt | 30.46 ± 2.77 | 3% | 32% | 79% | 0.126 | 5.10 | 14 | 0 |
| f5_nash | 30.74 ± 2.92 | 5% | 33% | 80% | 0.097 | 4.20 | 5 | 0 |
| icm_tag:rs_call=0 | 14.01 ± 2.02 | 2% | 9% | 94% | 0.290 | 13.08 | 15 | 0 |
| icm_tag:rs_call=3 | 20.08 ± 2.77 | 7% | 18% | 89% | 0.281 | 5.22 | 17 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 +20.29 ± 4.01 *
  f2_shark                     +32.96 ± 4.23 *
  f4_icm                       +17.14 ± 3.63 *
  f5_adapt                     +12.92 ± 3.55 *
  f5_nash                      +13.20 ± 3.64 *
  icm_tag:rs_call=0            -3.53 ± 2.08 *
  icm_tag:rs_call=3            +2.54 ± 1.93 *

field archetypes (points/table):
  f6_checkraiser          37.74 ± 1.16  (n=2536)
  f6_riverbluffer         35.59 ± 1.16  (n=2528)
  f6_floater              34.99 ± 1.17  (n=2584)
  f6_raiser               33.99 ± 1.16  (n=2568)
  f6_overbettor           33.00 ± 1.14  (n=2488)

3200 tables in 946s
