# standings after resteal_rel (seeds 81000+, 400 paired tables)

## all3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 61.00 ± 3.47 | 28% | 68% | 50% | 0.104 | 2.11 | 2 | 0 |
| f3_exploiter | 53.77 ± 3.82 | 30% | 58% | 57% | 0.216 | 5.97 | 4 | 0 |
| f4_icm | 44.39 ± 3.27 | 10% | 50% | 71% | 0.134 | 2.12 | 6 | 0 |
| f4_mc | 48.20 ± 3.70 | 13% | 52% | 61% | 0.212 | 2.36 | 8 | 0 |
| f2_shark | 41.14 ± 3.35 | 8% | 44% | 72% | 0.068 | 7.18 | 4 | 0 |
| icm_lite | 59.21 ± 3.47 | 26% | 64% | 53% | 0.106 | 2.65 | 3 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 -7.23 ± 4.75 *
  f4_icm                       -16.61 ± 4.39 *
  f4_mc                        -12.80 ± 4.83 *
  f2_shark                     -19.86 ± 4.60 *
  icm_lite                     -1.79 ± 3.93
  f3_exploiter            47.65 ± 4.98  (n=180)
  f3_quant_icm            45.60 ± 3.17  (n=348)
  f2_bubble               42.71 ± 2.35  (n=792)
  f2_shark                41.28 ± 2.24  (n=834)
  f2_nash                 41.19 ± 2.09  (n=876)
  pushfold_icm            41.19 ± 2.25  (n=570)
  chen_tag                36.85 ± 1.31  (n=942)
  lag                     36.20 ± 2.99  (n=414)
  adaptive                35.32 ± 2.43  (n=312)
  f3_survivor             34.94 ± 1.71  (n=486)
  f3_buggy                34.92 ± 2.04  (n=846)
  f3_ladder_pro           34.43 ± 3.83  (n=348)
  f2_exploit              33.14 ± 2.42  (n=828)
  f2_gto                  32.67 ± 2.52  (n=672)
  f3_generic              32.54 ± 1.37  (n=1146)
  f2_equity               31.74 ± 2.21  (n=852)
  f3_shover               31.37 ± 2.59  (n=660)
  nit                     30.04 ± 1.70  (n=438)
  mc_slow                 27.55 ± 1.31  (n=426)
  f3_mc_slow              18.49 ± 1.69  (n=726)
  station                 17.95 ± 2.56  (n=372)
  mc_equity               17.17 ± 1.80  (n=600)
  mc_fast                 16.60 ± 1.97  (n=582)
  maniac                  11.30 ± 2.58  (n=384)

## field4

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 34.40 ± 2.70 | 6% | 36% | 86% | 0.094 | 4.06 | 3 | 0 |
| f3_exploiter | 46.12 ± 3.55 | 18% | 51% | 68% | 0.219 | 2.40 | 12 | 0 |
| f4_icm | 36.01 ± 2.97 | 5% | 42% | 81% | 0.124 | 4.28 | 2 | 0 |
| f4_mc | 33.87 ± 3.17 | 8% | 34% | 80% | 0.184 | 2.60 | 4 | 0 |
| f2_shark | 42.40 ± 3.32 | 11% | 48% | 74% | 0.066 | 1.76 | 3 | 0 |
| icm_lite | 35.90 ± 2.66 | 6% | 37% | 85% | 0.092 | 0.92 | 0 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 +11.72 ± 4.15 *
  f4_icm                       +1.61 ± 3.64
  f4_mc                        -0.53 ± 3.88
  f2_shark                     +8.00 ± 4.01 *
  icm_lite                     +1.49 ± 2.94
  f4_icm                  38.49 ± 1.43  (n=1740)
  f4_tag                  35.16 ± 1.33  (n=1848)
  f4_gto                  34.44 ± 1.43  (n=1722)
  f4_lag                  33.60 ± 1.64  (n=1854)
  f4_mc                   33.34 ± 1.48  (n=1764)
  f4_eqrule               31.48 ± 1.30  (n=1410)
done
