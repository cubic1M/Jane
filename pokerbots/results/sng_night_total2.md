# current icm_tag vs start-of-night (OLD) and pre-Plan-B-fix (MID) bots (fresh seeds 70000+, 600 paired tables)

## --field default

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +3.45 ± 3.15 *
  icm_tag:behind_k=0.8;push_steal=0 +2.46 ± 2.99


## --field field2

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +0.25 ± 2.32
  icm_tag:behind_k=0.8;push_steal=0 +1.24 ± 2.17


## --field field3

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +7.42 ± 2.73 *
  icm_tag:behind_k=0.8;push_steal=0 +4.75 ± 2.66 *


## --field all3 --payouts top3

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +1.40 ± 1.85
  icm_tag:behind_k=0.8;push_steal=0 +2.04 ± 1.73 *


## --field all3 --payouts winner

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +8.44 ± 3.71 *
  icm_tag:behind_k=0.8;push_steal=0 +4.79 ± 3.68 *


## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +0.47 ± 2.34
  icm_tag:behind_k=0.8;push_steal=0 +0.11 ± 2.21


## --field mirror

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +3.04 ± 2.80 *
  icm_tag:behind_k=0.8;push_steal=0 -0.82 ± 2.26


## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0 (same tables):
  icm_tag                      +7.45 ± 1.74 *
  icm_tag:behind_k=0.8;push_steal=0 +1.95 ± 1.22 *

done
