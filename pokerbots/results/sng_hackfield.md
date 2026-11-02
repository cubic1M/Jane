# icm_tag on a hackathon-like field (fresh seeds 24000+, 400 paired tables)

## payouts=synthetic

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 54.53 ± 3.03 | 10% | 62% | 61% | 0.057 | 15.91 | 13 | 0 |
| icm_lite | 53.18 ± 3.05 | 9% | 60% | 62% | 0.053 | 4.52 | 6 | 0 |
| pushfold_icm | 48.71 ± 2.56 | 4% | 62% | 76% | 0.160 | 10.71 | 4 | 0 |
| f3_exploiter | 56.21 ± 3.48 | 26% | 60% | 59% | 0.211 | 16.58 | 15 | 0 |
| f2_shark | 47.64 ± 3.22 | 11% | 51% | 68% | 0.078 | 4.14 | 6 | 0 |
| adaptive | 44.75 ± 2.44 | 2% | 59% | 78% | 0.176 | 5.85 | 13 | 0 |

paired difference vs icm_tag (same tables):
  icm_lite                     -1.35 ± 2.44
  pushfold_icm                 -5.82 ± 3.31 *
  f3_exploiter                 +1.68 ± 3.99
  f2_shark                     -6.89 ± 3.84 *
  adaptive                     -9.78 ± 3.20 *

field archetypes (points/table):
  f3_exploiter            58.65 ± 2.44  (n=834)
  f2_shark                45.33 ± 2.14  (n=876)
  pushfold_icm            44.17 ± 1.64  (n=948)
  f3_buggy                42.96 ± 2.01  (n=852)
  lag                     42.30 ± 2.18  (n=906)
  chen_tag                41.31 ± 1.36  (n=906)
  nit                     40.49 ± 1.30  (n=828)
  mc_slow                 35.33 ± 1.02  (n=804)
  f3_shover               34.61 ± 2.13  (n=918)
  station                 26.84 ± 1.44  (n=1434)
  maniac                  20.20 ± 1.58  (n=1416)
  push                    12.05 ± 1.21  (n=1536)
  random                  10.62 ± 1.21  (n=852)

2400 tables in 245s

## payouts=top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 22.71 ± 1.93 | 10% | 62% | 61% | 0.055 | 0.65 | 0 | 0 |
| icm_lite | 21.99 ± 1.90 | 8% | 61% | 62% | 0.050 | 0.94 | 0 | 0 |
| pushfold_icm | 19.80 ± 1.61 | 5% | 64% | 77% | 0.157 | 2.86 | 4 | 0 |
| f3_exploiter | 23.54 ± 2.12 | 28% | 59% | 59% | 0.203 | 7.53 | 8 | 0 |
| f2_shark | 18.37 ± 1.94 | 9% | 51% | 70% | 0.075 | 3.44 | 5 | 0 |
| adaptive | 17.18 ± 1.52 | 1% | 60% | 77% | 0.174 | 3.40 | 7 | 0 |

paired difference vs icm_tag (same tables):
  icm_lite                     -0.71 ± 1.65
  pushfold_icm                 -2.91 ± 2.18 *
  f3_exploiter                 +0.83 ± 2.50
  f2_shark                     -4.34 ± 2.45 *
  adaptive                     -5.53 ± 2.12 *

field archetypes (points/table):
  f3_exploiter            25.31 ± 1.46  (n=834)
  pushfold_icm            17.79 ± 1.08  (n=948)
  lag                     16.97 ± 1.26  (n=906)
  f2_shark                16.26 ± 1.26  (n=876)
  f3_buggy                16.01 ± 1.19  (n=852)
  chen_tag                14.73 ± 0.90  (n=906)
  nit                     13.84 ± 0.91  (n=828)
  f3_shover               12.81 ± 1.17  (n=918)
  mc_slow                  9.02 ± 0.80  (n=804)
  station                  8.04 ± 0.81  (n=1434)
  maniac                   6.95 ± 0.85  (n=1416)
  push                     3.45 ± 0.60  (n=1536)
  random                   1.78 ± 0.58  (n=852)

2400 tables in 217s

## payouts=flat8

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
|---|---|---|---|---|---|---|---|---|
| icm_tag | 190.48 ± 10.31 | 10% | 63% | 61% | 0.054 | 6.09 | 3 | 0 |
| icm_lite | 187.06 ± 10.39 | 8% | 60% | 61% | 0.051 | 2.02 | 1 | 0 |
| pushfold_icm | 171.48 ± 8.71 | 5% | 63% | 75% | 0.161 | 8.15 | 6 | 0 |
| f3_exploiter | 196.83 ± 12.02 | 27% | 60% | 59% | 0.211 | 14.32 | 11 | 0 |
| f2_shark | 165.54 ± 10.88 | 9% | 50% | 68% | 0.074 | 4.08 | 7 | 0 |
| adaptive | 154.71 ± 8.08 | 2% | 59% | 77% | 0.177 | 2.13 | 6 | 0 |

paired difference vs icm_tag (same tables):
  icm_lite                     -3.42 ± 8.48
  pushfold_icm                 -19.00 ± 11.44 *
  f3_exploiter                 +6.35 ± 13.75
  f2_shark                     -24.94 ± 13.18 *
  adaptive                     -35.77 ± 11.02 *

field archetypes (points/table):
  f3_exploiter           207.14 ± 8.45  (n=834)
  pushfold_icm           156.34 ± 5.54  (n=948)
  lag                    151.52 ± 7.30  (n=906)
  f2_shark               151.02 ± 6.97  (n=876)
  f3_buggy               150.18 ± 6.66  (n=852)
  chen_tag               141.24 ± 4.45  (n=906)
  nit                    139.37 ± 4.30  (n=828)
  f3_shover              125.87 ± 7.05  (n=918)
  mc_slow                120.84 ± 3.34  (n=804)
  station                 98.30 ± 4.68  (n=1434)
  maniac                  81.17 ± 5.23  (n=1416)
  push                    57.96 ± 4.14  (n=1536)
  random                  49.47 ± 3.78  (n=852)

2400 tables in 235s
done
