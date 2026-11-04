# 52-card hand-over target f7 vs f9_meta, fresh seeds 351000+ (600 paired tables; baseline icm_switch)

## --field field10

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +0.34 ± 1.06
  icm_tag                      -0.61 ± 1.16


## --field field10 --payouts top3

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         -0.11 ± 0.72
  icm_tag                      +0.08 ± 0.74


## --field custom:f10_chen=1,f10_montecarlo=1,f10_pushfold=1,f1

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +1.47 ± 1.76
  icm_tag                      -1.39 ± 1.76


## --field field5

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         -0.57 ± 1.05
  icm_tag                      +0.45 ± 1.19


## --field field3

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +0.21 ± 2.39
  icm_tag                      +2.05 ± 2.41


## --field default

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +2.41 ± 3.08
  icm_tag                      +1.71 ± 3.07


## --field field7

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +1.20 ± 2.63
  icm_tag                      -4.33 ± 2.61 *


## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

paired difference vs icm_switch (same tables):
  icm_switch:b=f9_meta         +3.79 ± 1.85 *
  icm_tag                      -2.35 ± 1.80 *

done
