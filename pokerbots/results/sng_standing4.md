# Standings after rs_call=2 (seeds 109000+, 300 paired tables per field)

## all3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 61.48 ± 4.35 | 34% | 66% | 48% | 0.224 | 9.50 | 13 | 0 |
| f3_exploiter | 53.60 ± 4.49 | 29% | 58% | 57% | 0.458 | 4.17 | 23 | 0 |
| f2_shark | 38.08 ± 3.82 | 6% | 44% | 75% | 0.127 | 8.31 | 9 | 0 |
| f4_icm | 43.14 ± 3.73 | 7% | 50% | 71% | 0.282 | 6.21 | 15 | 0 |
| f5_adapt | 40.82 ± 3.63 | 8% | 44% | 74% | 0.128 | 3.79 | 11 | 0 |
| f6_checkraiser | 47.72 ± 3.88 | 15% | 54% | 69% | 0.118 | 7.23 | 9 | 0 |
| pushfold_icm | 38.69 ± 3.26 | 3% | 43% | 77% | 0.307 | 3.60 | 10 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 -7.88 ± 5.74 *
  f2_shark                     -23.41 ± 5.91 *
  f4_icm                       -18.35 ± 5.39 *
  f5_adapt                     -20.67 ± 5.37 *
  f6_checkraiser               -13.77 ± 5.34 *
  pushfold_icm                 -22.80 ± 5.24 *

## field4

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 42.03 ± 3.77 | 15% | 43% | 76% | 0.169 | 4.30 | 10 | 0 |
| f3_exploiter | 44.55 ± 4.01 | 16% | 52% | 74% | 0.487 | 3.84 | 16 | 0 |
| f2_shark | 40.80 ± 3.93 | 9% | 47% | 74% | 0.116 | 3.96 | 4 | 0 |
| f4_icm | 37.29 ± 3.43 | 6% | 42% | 80% | 0.240 | 6.40 | 11 | 0 |
| f5_adapt | 37.66 ± 3.38 | 8% | 42% | 82% | 0.112 | 5.22 | 4 | 0 |
| f6_checkraiser | 43.10 ± 3.62 | 11% | 48% | 75% | 0.103 | 14.23 | 10 | 0 |
| pushfold_icm | 37.12 ± 2.76 | 2% | 42% | 86% | 0.318 | 4.31 | 6 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 +2.53 ± 5.09
  f2_shark                     -1.23 ± 5.23
  f4_icm                       -4.74 ± 4.91
  f5_adapt                     -4.37 ± 4.88
  f6_checkraiser               +1.08 ± 4.77
  pushfold_icm                 -4.90 ± 4.29 *

## field5

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 60.78 ± 4.30 | 32% | 66% | 44% | 0.213 | 2.63 | 7 | 0 |
| f3_exploiter | 46.87 ± 4.19 | 22% | 53% | 68% | 0.439 | 2.79 | 9 | 0 |
| f2_shark | 33.90 ± 3.80 | 10% | 38% | 79% | 0.106 | 1.51 | 1 | 0 |
| f4_icm | 35.39 ± 3.64 | 8% | 40% | 79% | 0.277 | 5.16 | 9 | 0 |
| f5_adapt | 38.87 ± 3.53 | 10% | 46% | 76% | 0.094 | 12.16 | 5 | 0 |
| f6_checkraiser | 42.63 ± 3.74 | 11% | 50% | 71% | 0.092 | 4.15 | 6 | 0 |
| pushfold_icm | 36.47 ± 3.24 | 2% | 43% | 79% | 0.289 | 7.36 | 7 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 -13.90 ± 5.56 *
  f2_shark                     -26.88 ± 5.55 *
  f4_icm                       -25.38 ± 5.31 *
  f5_adapt                     -21.90 ± 5.38 *
  f6_checkraiser               -18.14 ± 5.33 *
  pushfold_icm                 -24.31 ± 5.07 *

## custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 59.03 ± 3.65 | 24% | 65% | 63% | 0.107 | 15.88 | 4 | 0 |
| f3_exploiter | 57.85 ± 3.94 | 30% | 65% | 61% | 0.234 | 6.42 | 4 | 0 |
| f2_shark | 48.48 ± 3.69 | 10% | 52% | 69% | 0.082 | 4.10 | 2 | 0 |
| f4_icm | 54.65 ± 3.18 | 10% | 69% | 68% | 0.155 | 4.15 | 9 | 0 |
| f5_adapt | 55.07 ± 3.64 | 17% | 61% | 63% | 0.079 | 2.38 | 4 | 0 |
| f6_checkraiser | 54.14 ± 3.63 | 19% | 62% | 66% | 0.076 | 2.29 | 5 | 0 |
| pushfold_icm | 49.28 ± 2.94 | 5% | 64% | 77% | 0.183 | 2.72 | 2 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 -1.18 ± 4.70
  f2_shark                     -10.55 ± 4.96 *
  f4_icm                       -4.37 ± 4.52
  f5_adapt                     -3.96 ± 4.69
  f6_checkraiser               -4.89 ± 4.90
  pushfold_icm                 -9.75 ± 4.36 *
done
