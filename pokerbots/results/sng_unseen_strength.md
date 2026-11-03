# Strength on unseen card rules (seeds 115000+, 200 paired tables, default field, --no-enforce)

## c_discard3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 71.05 ± 4.05 | 24% | 79% | 30% | 0.083 | 9.12 | 9 | 0 |
| icm_tag | 70.90 ± 4.41 | 32% | 80% | 38% | 0.105 | 6.63 | 4 | 0 |
| f3_exploiter | 49.32 ± 6.29 | 42% | 48% | 57% | 0.273 | 10.81 | 8 | 0 |
| f2_shark | 46.16 ± 5.53 | 14% | 46% | 62% | 0.101 | 5.47 | 4 | 0 |
| f5_adapt | 42.62 ± 5.25 | 14% | 44% | 66% | 0.085 | 4.11 | 4 | 0 |
| f6_checkraiser | 42.47 ± 5.26 | 14% | 44% | 68% | 0.086 | 1.73 | 1 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      -0.15 ± 4.64
  f3_exploiter                 -21.72 ± 7.07 *
  f2_shark                     -24.88 ± 6.54 *
  f5_adapt                     -28.43 ± 6.57 *
  f6_checkraiser               -28.57 ± 6.03 *

## i_double_discard

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 68.88 ± 4.04 | 16% | 79% | 40% | 0.082 | 4.15 | 2 | 0 |
| icm_tag | 69.29 ± 4.44 | 32% | 78% | 44% | 0.101 | 1.29 | 2 | 0 |
| f3_exploiter | 34.18 ± 5.86 | 28% | 30% | 72% | 0.240 | 3.51 | 5 | 0 |
| f2_shark | 39.03 ± 5.53 | 13% | 38% | 69% | 0.096 | 4.72 | 5 | 0 |
| f5_adapt | 46.27 ± 5.20 | 20% | 48% | 64% | 0.086 | 11.55 | 5 | 0 |
| f6_checkraiser | 38.40 ± 5.67 | 24% | 39% | 70% | 0.194 | 6.86 | 7 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      +0.41 ± 4.79
  f3_exploiter                 -34.70 ± 6.94 *
  f2_shark                     -29.85 ± 6.63 *
  f5_adapt                     -22.62 ± 6.29 *
  f6_checkraiser               -30.49 ± 7.07 *

## k_irish

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 70.86 ± 3.81 | 13% | 84% | 29% | 0.087 | 8.22 | 57 | 0 |
| icm_tag | 72.17 ± 4.45 | 36% | 80% | 38% | 0.093 | 8.14 | 34 | 0 |
| f3_exploiter | 50.80 ± 6.44 | 46% | 50% | 55% | 0.278 | 12.23 | 82 | 0 |
| f2_shark | 50.12 ± 5.51 | 10% | 52% | 55% | 0.103 | 8.15 | 37 | 0 |
| f5_adapt | 50.74 ± 5.10 | 10% | 56% | 54% | 0.095 | 4.42 | 31 | 0 |
| f6_checkraiser | 52.32 ± 5.79 | 25% | 55% | 53% | 0.090 | 4.45 | 32 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      +1.31 ± 4.75
  f3_exploiter                 -20.05 ± 7.28 *
  f2_shark                     -20.74 ± 6.94 *
  f5_adapt                     -20.11 ± 6.44 *
  f6_checkraiser               -18.54 ± 6.89 *

## n_plo4

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_any | 50.87 ± 3.82 | 6% | 60% | 69% | 0.118 | 12.18 | 254 | 0 |
| icm_tag | 70.18 ± 4.27 | 36% | 80% | 44% | 0.129 | 20.16 | 232 | 0 |
| f3_exploiter | 31.19 ± 5.29 | 20% | 29% | 80% | 0.232 | 16.25 | 195 | 0 |
| f2_shark | 54.00 ± 4.90 | 13% | 59% | 62% | 0.222 | 20.13 | 275 | 0 |
| f5_adapt | 38.97 ± 4.62 | 8% | 41% | 76% | 0.114 | 12.16 | 123 | 0 |
| f6_checkraiser | 27.99 ± 4.20 | 8% | 28% | 88% | 0.148 | 16.20 | 126 | 0 |
paired difference vs icm_any (same tables):
  icm_tag                      +19.31 ± 5.51 *
  f3_exploiter                 -19.68 ± 6.62 *
  f2_shark                     +3.13 ± 5.96
  f5_adapt                     -11.90 ± 5.78 *
  f6_checkraiser               -22.88 ± 5.69 *
done
