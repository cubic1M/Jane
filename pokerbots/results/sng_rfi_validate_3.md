# rfi_mode fresh-seed validation, part 3 (seeds 147000+, 600 paired tables)

## --field custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=1;rfi_scale=1.3 -0.11 ± 2.71
  icm_tag:rfi_mode=1;rfi_scale=1.5 -1.29 ± 2.60


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=1;rfi_scale=1.3 +14.76 ± 3.51 *
  icm_tag:rfi_mode=1;rfi_scale=1.5 +11.57 ± 3.39 *


## --field field5

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=1;rfi_scale=1.3 -6.05 ± 3.80 *
  icm_tag:rfi_mode=1;rfi_scale=1.5 -4.05 ± 3.78 *


## --preset kit4_sixplus --field field4

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=1;rfi_scale=1.3 +4.81 ± 2.37 *
  icm_tag:rfi_mode=1;rfi_scale=1.5 +5.97 ± 2.35 *

done
