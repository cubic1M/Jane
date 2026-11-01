# out of sample: field 3 (400 paired tables, fresh seeds 16000+, 2 workers)

## payouts=synthetic

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 64.44 ± 3.43 | 10% | 70% | 37% | 0.054 | 2.24 | 2 | 0 |
| f3_exploiter | 55.80 ± 3.73 | 28% | 61% | 54% | 0.202 | 3.54 | 6 | 0 |
| f3_quant_icm | 46.86 ± 3.04 | 8% | 57% | 65% | 0.186 | 1.29 | 3 | 0 |
| f3_ladder_pro | 44.38 ± 3.79 | 20% | 46% | 66% | 0.344 | 1.99 | 7 | 0 |
| pushfold_icm | 43.81 ± 2.92 | 4% | 50% | 69% | 0.152 | 2.55 | 2 | 0 |
| icm_lite | 63.02 ± 3.33 | 8% | 70% | 41% | 0.228 | 5.35 | 4 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 -8.63 ± 4.61 *
  f3_quant_icm                 -17.58 ± 4.19 *
  f3_ladder_pro                -20.05 ± 4.66 *
  pushfold_icm                 -20.63 ± 4.00 *
  icm_lite                     -1.42 ± 3.23

field archetypes (points/table):
  f3_exploiter            52.75 ± 2.88  (n=684)
  f3_ladder_pro           43.38 ± 2.59  (n=864)
  f3_quant_icm            43.28 ± 2.02  (n=888)
  f3_buggy                34.71 ± 1.30  (n=1914)
  f3_survivor             32.26 ± 1.08  (n=1248)
  f3_generic              31.24 ± 1.01  (n=2154)
  f3_shover               27.15 ± 1.68  (n=1434)
  f3_mc_slow              14.46 ± 1.00  (n=1434)


## payouts=top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 30.88 ± 1.88 | 8% | 75% | 36% | 0.054 | 2.23 | 6 | 0 |
| f3_exploiter | 24.70 ± 2.10 | 26% | 61% | 54% | 0.201 | 2.46 | 4 | 0 |
| f3_quant_icm | 19.36 ± 1.81 | 9% | 58% | 66% | 0.182 | 3.01 | 4 | 0 |
| f3_ladder_pro | 17.04 ± 2.05 | 18% | 43% | 69% | 0.336 | 4.99 | 14 | 0 |
| pushfold_icm | 16.44 ± 1.72 | 4% | 51% | 70% | 0.151 | 2.51 | 1 | 0 |
| icm_lite | 28.36 ± 1.97 | 7% | 70% | 40% | 0.227 | 2.10 | 10 | 0 |

paired difference vs icm_tag (same tables):
  f3_exploiter                 -6.18 ± 2.56 *
  f3_quant_icm                 -11.52 ± 2.45 *
  f3_ladder_pro                -13.84 ± 2.50 *
  pushfold_icm                 -14.45 ± 2.35 *
  icm_lite                     -2.53 ± 1.95 *

field archetypes (points/table):
  f3_exploiter            24.08 ± 1.65  (n=684)
  f3_ladder_pro           17.70 ± 1.39  (n=864)
  f3_quant_icm            17.31 ± 1.15  (n=888)
  f3_buggy                12.54 ± 0.74  (n=1914)
  f3_shover               10.41 ± 0.86  (n=1434)
  f3_generic               9.28 ± 0.58  (n=2154)
  f3_survivor              8.77 ± 0.68  (n=1248)
  f3_mc_slow               2.79 ± 0.49  (n=1434)

done
