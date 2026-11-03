# field 6 (postflop specialists, blind): icm_tag vs field bests (seeds 95000+, 400 paired tables)

  280/2800 tables (97s)
  560/2800 tables (179s)
  840/2800 tables (274s)
  1120/2800 tables (367s)
  1400/2800 tables (453s)
  1680/2800 tables (535s)
  1960/2800 tables (623s)
  2240/2800 tables (709s)
  2520/2800 tables (792s)
  2800/2800 tables (877s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 13.91 ± 1.98 | 2% | 8% | 94% | 0.313 | 4.23 | 22 | 0 |
| f3_exploiter | 33.63 ± 3.40 | 12% | 36% | 78% | 0.545 | 78.99 | 41 | 0 |
| f2_shark | 50.18 ± 3.56 | 16% | 59% | 57% | 0.136 | 7.62 | 14 | 0 |
| f4_icm | 33.76 ± 3.07 | 4% | 39% | 71% | 0.414 | 10.18 | 35 | 0 |
| f5_adapt | 29.90 ± 2.60 | 2% | 33% | 82% | 0.133 | 2.94 | 15 | 0 |
| f5_nash | 32.48 ± 2.89 | 4% | 34% | 78% | 0.105 | 3.49 | 9 | 0 |
| icm_tag:resteal_rel=0;push_steal=0;behind_k=0.8 | 13.15 ± 1.62 | 0% | 7% | 96% | 0.330 | 3.38 | 19 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 +19.71 ± 3.60 *
  f2_shark                     +36.26 ± 3.97 *
  f4_icm                       +19.84 ± 3.46 *
  f5_adapt                     +15.98 ± 3.06 *
  f5_nash                      +18.57 ± 3.32 *
  icm_tag:resteal_rel=0;push_steal=0;behind_k=0.8 -0.77 ± 2.18

field archetypes (points/table):
  f6_floater              37.67 ± 1.26  (n=2198)
  f6_raiser               36.52 ± 1.22  (n=2289)
  f6_riverbluffer         35.43 ± 1.24  (n=2219)
  f6_checkraiser          34.69 ± 1.23  (n=2296)
  f6_overbettor           32.95 ± 1.24  (n=2163)

2800 tables in 877s
