# Which bot to submit: icm_tag vs f2_shark / f3_exploiter / f7_balanced, part 2 (seeds 173000+, 300 paired tables, no time limit)

## --field field6

| icm_tag | 22.06 ± 3.26 | 6% | 20% | 87% | 0.214 | 16.08 | 420 | 0 |
| f2_shark | 47.18 ± 4.18 | 14% | 54% | 58% | 0.086 | 24.10 | 410 | 0 |
| f3_exploiter | 38.13 ± 4.16 | 15% | 42% | 72% | 1.201 | 20.31 | 652 | 0 |
| f7_balanced | 38.27 ± 3.91 | 13% | 42% | 74% | 0.077 | 16.09 | 375 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     +25.12 ± 4.95 *
  f3_exploiter                 +16.07 ± 4.85 *
  f7_balanced                  +16.21 ± 4.66 *

## --field field7

| icm_tag | 21.37 ± 3.10 | 6% | 19% | 93% | 0.211 | 16.09 | 363 | 0 |
| f2_shark | 36.97 ± 3.88 | 9% | 43% | 80% | 0.089 | 20.08 | 316 | 0 |
| f3_exploiter | 30.30 ± 3.57 | 9% | 33% | 88% | 1.344 | 16.95 | 562 | 0 |
| f7_balanced | 35.28 ± 3.73 | 10% | 39% | 82% | 0.065 | 16.10 | 245 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     +15.60 ± 4.60 *
  f3_exploiter                 +8.93 ± 4.25 *
  f7_balanced                  +13.91 ± 4.63 *

## --field all3 --payouts top3

| icm_tag | 27.05 ± 2.46 | 32% | 64% | 49% | 0.112 | 12.27 | 82 | 0 |
| f2_shark | 17.22 ± 2.24 | 10% | 47% | 71% | 0.077 | 12.14 | 51 | 0 |
| f3_exploiter | 22.31 ± 2.39 | 25% | 58% | 62% | 0.242 | 16.26 | 93 | 0 |
| f7_balanced | 18.05 ± 2.43 | 21% | 45% | 69% | 0.075 | 26.59 | 66 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     -9.83 ± 3.05 *
  f3_exploiter                 -4.73 ± 3.04 *
  f7_balanced                  -9.00 ± 3.34 *

## --field all3 --payouts winner

| icm_tag | 42.47 ± 5.32 | 34% | 61% | 53% | 0.133 | 16.28 | 309 | 0 |
| f2_shark | 18.96 ± 3.96 | 8% | 36% | 76% | 0.082 | 19.02 | 209 | 0 |
| f3_exploiter | 32.60 ± 5.20 | 30% | 48% | 66% | 0.313 | 32.51 | 468 | 0 |
| f7_balanced | 25.48 ± 4.72 | 20% | 45% | 71% | 0.079 | 24.11 | 206 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     -23.52 ± 6.33 *
  f3_exploiter                 -9.87 ± 6.77 *
  f7_balanced                  -16.99 ± 6.71 *

## --field custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1

| icm_tag | 62.15 ± 3.60 | 28% | 71% | 60% | 0.135 | 19.67 | 372 | 0 |
| f2_shark | 52.01 ± 3.68 | 12% | 59% | 66% | 0.086 | 16.07 | 334 | 0 |
| f3_exploiter | 57.11 ± 4.05 | 30% | 61% | 59% | 0.457 | 12.36 | 574 | 0 |
| f7_balanced | 58.35 ± 3.70 | 25% | 68% | 64% | 0.089 | 16.09 | 358 | 0 |
paired difference vs icm_tag (same tables):
  f2_shark                     -10.15 ± 4.50 *
  f3_exploiter                 -5.04 ± 4.74 *
  f7_balanced                  -3.80 ± 4.60
done
