# current icm_tag vs each field's best and vs the pre-change bot (fresh seeds 37000+, 400 paired tables)

## --field default

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 +0.74 ± 3.42
  pushfold_icm                 -19.49 ± 4.34 *
  adaptive                     -19.12 ± 4.08 *


## --field strong

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 +0.19 ± 1.56
  pushfold_icm                 -32.33 ± 4.28 *
  adaptive                     -37.61 ± 3.73 *


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 -0.09 ± 0.61
  pushfold_icm                 -7.37 ± 4.10 *
  adaptive                     -21.26 ± 3.50 *


## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 -0.35 ± 0.73
  f2_shark                     -0.88 ± 4.19
  f2_nash                      -1.25 ± 4.07


## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 +2.67 ± 2.66 *
  f3_exploiter                 -5.59 ± 4.56 *
  f3_quant_icm                 -16.59 ± 4.04 *


## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 +0.71 ± 1.58
  f3_exploiter                 -2.28 ± 2.79
  f2_shark                     -8.74 ± 2.68 *


## --field custom:push=2,maniac=2,station=2

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 -0.79 ± 0.60 *
  f3_exploiter                 +1.16 ± 4.04
  f2_shark                     -6.46 ± 4.01 *


## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0 -2.01 ± 4.40
  f3_exploiter                 -0.03 ± 5.42
  f2_shark                     -12.39 ± 5.11 *

done
