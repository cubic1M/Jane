# rfi_mode=2 (full deck, not-top-heavy payouts only) fresh-seed validation, part 3 (seeds 151000+, 600 paired tables)

## --field custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=2;rfi_scale=1.3 +0.37 ± 2.64
  icm_tag:rfi_mode=2;rfi_scale=1.5 +1.58 ± 2.60


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=2;rfi_scale=1.3 +13.42 ± 3.35 *
  icm_tag:rfi_mode=2;rfi_scale=1.5 +11.75 ± 3.32 *


## --field field5

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=2;rfi_scale=1.3 -9.61 ± 3.79 *
  icm_tag:rfi_mode=2;rfi_scale=1.5 -8.66 ± 3.89 *


## --preset kit4_sixplus --field field4

paired difference vs icm_tag (same tables):
  icm_tag:rfi_mode=2;rfi_scale=1.3 +0.33 ± 0.37
  icm_tag:rfi_mode=2;rfi_scale=1.5 +0.39 ± 0.47

done
