# post-ICM re-tune, fresh-seed validation (seeds 46000+, 600 paired tables)

## --field default

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     +1.50 ± 3.00
  icm_tag:call_margin=0.09     +1.31 ± 2.93


## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     +0.48 ± 2.34
  icm_tag:call_margin=0.09     -1.42 ± 1.95


## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     +2.41 ± 2.61
  icm_tag:call_margin=0.09     +2.62 ± 2.54 *


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     -0.41 ± 2.07
  icm_tag:call_margin=0.09     -0.99 ± 2.50


## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     +1.37 ± 1.86
  icm_tag:call_margin=0.09     +0.32 ± 1.74


## --field custom:push=2,maniac=2,station=2

paired difference vs icm_tag (same tables):
  icm_tag:bet_discount=0.5     +0.86 ± 1.59
  icm_tag:call_margin=0.09     +1.76 ± 1.66 *

done
