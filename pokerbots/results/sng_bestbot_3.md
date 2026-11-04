# Which bot to submit: icm_tag vs f2_shark / f3_exploiter / f7_balanced, part 3 (seeds 173000+, 300 paired tables, no time limit)

## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1

| icm_tag | 26.92 ± 3.20 | 5% | 27% | 88% | 0.197 | 16.09 | 367 | 0 |
| f2_shark | 31.67 ± 3.53 | 6% | 35% | 86% | 0.083 | 12.09 | 276 | 0 |
| f3_exploiter | 34.25 ± 3.89 | 12% | 37% | 80% | 0.343 | 16.20 | 427 | 0 |
| f7_balanced | 37.95 ± 3.82 | 13% | 44% | 80% | 0.072 | 16.08 | 308 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     +4.75 ± 4.59 *
  f3_exploiter                 +7.32 ± 4.52 *
  f7_balanced                  +11.02 ± 4.54 *

## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1 --payouts top3

| icm_tag | 9.43 ± 1.97 | 9% | 24% | 82% | 0.186 | 20.08 | 293 | 0 |
| f2_shark | 13.81 ± 2.13 | 10% | 39% | 77% | 0.079 | 16.09 | 230 | 0 |
| f3_exploiter | 11.12 ± 2.01 | 10% | 31% | 84% | 0.338 | 16.27 | 378 | 0 |
| f7_balanced | 16.26 ± 2.20 | 14% | 46% | 75% | 0.071 | 20.09 | 247 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     +4.38 ± 2.94 *
  f3_exploiter                 +1.69 ± 2.55
  f7_balanced                  +6.83 ± 2.89 *

## --preset kit4_sixplus --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1

| icm_tag | 29.01 ± 3.04 | 6% | 27% | 91% | 0.172 | 40.60 | 345 | 0 |
| f2_shark | 37.82 ± 3.58 | 12% | 43% | 85% | 0.082 | 12.08 | 268 | 0 |
| f3_exploiter | 42.86 ± 3.84 | 18% | 51% | 80% | 0.946 | 16.30 | 476 | 0 |
| f7_balanced | 30.29 ± 3.63 | 12% | 30% | 87% | 1.677 | 20.21 | 569 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     +8.81 ± 4.39 *
  f3_exploiter                 +13.85 ± 4.46 *
  f7_balanced                  +1.28 ± 4.37

## --preset kit4_sixplus --field field4

| icm_tag | 47.13 ± 2.63 | 7% | 61% | 91% | 0.133 | 20.18 | 314 | 0 |
| f2_shark | 42.12 ± 3.54 | 12% | 47% | 84% | 0.087 | 16.12 | 273 | 0 |
| f3_exploiter | 46.85 ± 3.68 | 18% | 57% | 81% | 2.192 | 12.70 | 557 | 0 |
| f7_balanced | 36.42 ± 3.09 | 7% | 43% | 93% | 2.388 | 20.29 | 640 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     -5.02 ± 4.47 *
  f3_exploiter                 -0.28 ± 4.44
  f7_balanced                  -10.71 ± 3.94 *
done
