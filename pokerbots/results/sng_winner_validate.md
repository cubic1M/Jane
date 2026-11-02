# Winner-payout tuning, fresh-seed validation (seeds 29000+, 500 paired tables)

## payouts=winner field=default

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09;range_k=3.2 +1.84 ± 4.42
  icm_tag:call_margin=0.09     -0.45 ± 4.41
  icm_tag:range_k=3.2          +0.16 ± 4.52
  icm_tag:push_mult=0.9091     -0.44 ± 4.25


## payouts=winner field=field2

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09;range_k=3.2 +1.04 ± 2.60
  icm_tag:call_margin=0.09     +1.98 ± 2.56
  icm_tag:range_k=3.2          +1.93 ± 2.87
  icm_tag:push_mult=0.9091     +1.31 ± 1.43


## payouts=winner field=field3

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09;range_k=3.2 +3.79 ± 3.44 *
  icm_tag:call_margin=0.09     +1.73 ± 3.38
  icm_tag:range_k=3.2          +0.63 ± 3.46
  icm_tag:push_mult=0.9091     -0.44 ± 3.02


## payouts=winner field=custom:push=2,ma

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09;range_k=3.2 -0.29 ± 2.74
  icm_tag:call_margin=0.09     -0.70 ± 2.80
  icm_tag:range_k=3.2          +0.90 ± 3.05
  icm_tag:push_mult=0.9091     -0.36 ± 1.52

done
