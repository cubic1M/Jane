# rs_call fresh-seed validation, part 2 (seeds 96000+, 600 paired tables)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:rs_call=2            +0.07 ± 1.00
  icm_tag:rs_call=3            -0.28 ± 1.18


## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:rs_call=2            +1.62 ± 2.81
  icm_tag:rs_call=3            +2.83 ± 3.42


## --field custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1

paired difference vs icm_tag (same tables):
  icm_tag:rs_call=2            +1.36 ± 1.64
  icm_tag:rs_call=3            +1.38 ± 1.79


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:rs_call=2            +1.58 ± 1.59
  icm_tag:rs_call=3            +3.55 ± 1.97 *


## --field field5

paired difference vs icm_tag (same tables):
  icm_tag:rs_call=2            +4.65 ± 2.19 *
  icm_tag:rs_call=3            +5.50 ± 2.39 *

done
