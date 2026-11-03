# field 7 (balanced, bully, trickster, hackathon, profiler; written blind): icm_tag vs field bests (seeds 123000+, 400 paired tables)

  320/3200 tables (49s)
  640/3200 tables (99s)
  960/3200 tables (145s)
  1280/3200 tables (191s)
  1600/3200 tables (235s)
  1920/3200 tables (281s)
  2240/3200 tables (325s)
  2560/3200 tables (370s)
  2880/3200 tables (415s)
  3200/3200 tables (464s)
| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 19.84 ± 2.46 | 5% | 16% | 94% | 0.135 | 11.21 | 5 | 0 |
| f3_exploiter | 30.33 ± 3.05 | 9% | 32% | 89% | 0.237 | 2.70 | 9 | 0 |
| f2_shark | 36.90 ± 3.30 | 9% | 41% | 79% | 0.066 | 1.81 | 2 | 0 |
| f4_icm | 31.54 ± 2.73 | 3% | 35% | 87% | 0.189 | 4.20 | 10 | 0 |
| f5_adapt | 31.65 ± 2.64 | 4% | 34% | 88% | 0.061 | 10.20 | 7 | 0 |
| f5_nash | 33.82 ± 2.77 | 5% | 38% | 88% | 0.053 | 3.13 | 4 | 0 |
| icm_tag:rs_call=0 | 14.78 ± 1.88 | 2% | 9% | 97% | 0.127 | 1.16 | 2 | 0 |
| f6_checkraiser | 34.83 ± 2.93 | 6% | 38% | 84% | 0.053 | 3.14 | 2 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 +10.48 ± 3.56 *
  f2_shark                     +17.06 ± 3.92 *
  f4_icm                       +11.69 ± 3.56 *
  f5_adapt                     +11.81 ± 3.54 *
  f5_nash                      +13.98 ± 3.61 *
  icm_tag:rs_call=0            -5.06 ± 2.15 *
  f6_checkraiser               +14.98 ± 3.77 *

field archetypes (points/table):
  f7_bully                37.05 ± 1.15  (n=2672)
  f7_profiler             36.43 ± 1.27  (n=2560)
  f7_trickster            36.26 ± 1.35  (n=2432)
  f7_balanced             36.16 ± 1.27  (n=2592)
  f7_hackathon            29.61 ± 1.01  (n=2576)

3200 tables in 464s
