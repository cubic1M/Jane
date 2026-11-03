# field 5 (blind, written after tonight's tuning): icm_tag vs field bests (seeds 88000+, 400 paired tables)

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 58.14 ± 3.60 | 26% | 64% | 46% | 0.225 | 7.28 | 20 | 0 |
| f3_exploiter | 42.98 ± 3.72 | 20% | 47% | 71% | 0.500 | 11.38 | 31 | 0 |
| f2_shark | 34.69 ± 3.39 | 10% | 40% | 78% | 0.119 | 5.26 | 9 | 0 |
| f4_icm | 33.39 ± 3.03 | 6% | 38% | 81% | 0.311 | 8.19 | 20 | 0 |
| f5_nash | 32.77 ± 3.03 | 8% | 36% | 83% | 0.084 | 43.14 | 3 | 0 |
| f5_adapt | 33.16 ± 2.92 | 6% | 36% | 81% | 0.112 | 36.79 | 10 | 0 |
| f5_bully | 34.44 ± 3.06 | 11% | 37% | 84% | 0.101 | 4.42 | 9 | 0 |
| icm_tag:resteal_rel=0.35;resteal_read=0 | 60.07 ± 3.37 | 22% | 67% | 43% | 0.241 | 5.98 | 16 | 0 |
paired difference vs icm_tag (same tables):
  f3_exploiter                 -15.16 ± 4.60 *
  f2_shark                     -23.45 ± 4.52 *
  f4_icm                       -24.75 ± 4.42 *
  f5_nash                      -25.37 ± 4.40 *
  f5_adapt                     -24.98 ± 4.28 *
  f5_bully                     -23.70 ± 4.50 *
  icm_tag:resteal_rel=0.35;resteal_read=0 +1.94 ± 3.11
  f5_adapt                37.64 ± 1.29  (n=2336)
  f5_reg                  35.21 ± 1.20  (n=2496)
  f5_bully                34.27 ± 1.23  (n=2464)
  f5_nash                 34.23 ± 1.19  (n=2512)
  f5_trapper              31.44 ± 1.15  (n=2576)

[exited with code 0]
