# reverse switch exploration, seeds 401000+ (300 paired tables, baseline icm_tag)

## cell 1: --field field5 

paired difference vs icm_tag (same tables):
  icm_switch                   -0.51 ± 1.46
  icm_switch:start=b;back_share=0.18 -10.83 ± 5.72 *
  icm_switch:start=b;back_share=0.22 -9.54 ± 5.70 *
  icm_switch:start=b;back_share=0.22;switch_min=15 -7.70 ± 5.62 *
  f9_meta                      -20.59 ± 5.40 *


## cell 2: --field field3 

paired difference vs icm_tag (same tables):
  icm_switch                   +3.31 ± 3.39
  icm_switch:start=b;back_share=0.18 -2.89 ± 5.16
  icm_switch:start=b;back_share=0.22 -4.68 ± 5.32
  icm_switch:start=b;back_share=0.22;switch_min=15 -1.15 ± 5.30
  f9_meta                      -10.80 ± 5.14 *


## cell 3: --field default 

paired difference vs icm_tag (same tables):
  icm_switch                   +4.61 ± 2.94 *
  icm_switch:start=b;back_share=0.18 -3.96 ± 4.77
  icm_switch:start=b;back_share=0.22 -1.97 ± 4.75
  icm_switch:start=b;back_share=0.22;switch_min=15 -0.17 ± 5.03
  f9_meta                      -4.63 ± 5.03


## cell 4: --field field10 

paired difference vs icm_tag (same tables):
  icm_switch                   -0.14 ± 1.98
  icm_switch:start=b;back_share=0.18 -3.77 ± 5.08
  icm_switch:start=b;back_share=0.22 -3.99 ± 5.08
  icm_switch:start=b;back_share=0.22;switch_min=15 -4.41 ± 5.01
  f9_meta                      -4.31 ± 5.12


## cell 5: --field custom:f10_chen=2,f10_montecarlo ler=1,f9_float=1

paired difference vs icm_tag (same tables):
  icm_switch                   -0.46 ± 2.88
  icm_switch:start=b;back_share=0.18 +0.77 ± 4.98
  icm_switch:start=b;back_share=0.22 +0.40 ± 5.01
  icm_switch:start=b;back_share=0.22;switch_min=15 +0.00 ± 4.66
  f9_meta                      -0.63 ± 4.78


## cell 6: --field custom:f10_chen=2,f10_montecarlo 1 --payouts top3

paired difference vs icm_tag (same tables):
  icm_switch                   -0.06 ± 1.52
  icm_switch:start=b;back_share=0.18 +1.39 ± 2.90
  icm_switch:start=b;back_share=0.22 +1.67 ± 2.94
  icm_switch:start=b;back_share=0.22;switch_min=15 +1.17 ± 2.85
  f9_meta                      -0.28 ± 2.87


## cell 7: --preset kit4_sixplus --field custom:f10 ler=1,f9_float=1

paired difference vs icm_tag (same tables):
  icm_switch                   +4.48 ± 2.86 *
  icm_switch:start=b;back_share=0.18 +7.33 ± 4.89 *
  icm_switch:start=b;back_share=0.22 +7.10 ± 4.93 *
  icm_switch:start=b;back_share=0.22;switch_min=15 +7.22 ± 4.96 *
  f9_meta                      +4.95 ± 4.82 *


## cell 8: --field field7 

paired difference vs icm_tag (same tables):
  icm_switch                   +7.28 ± 3.59 *
  icm_switch:start=b;back_share=0.18 +17.42 ± 4.46 *
  icm_switch:start=b;back_share=0.22 +16.30 ± 4.47 *
  icm_switch:start=b;back_share=0.22;switch_min=15 +12.92 ± 4.32 *
  f9_meta                      +18.08 ± 4.56 *


## cell 9: --field custom:f2_shark=1,f3_exploiter=1 1,pushfold_icm=1

paired difference vs icm_tag (same tables):
  icm_switch                   +3.79 ± 3.74 *
  icm_switch:start=b;back_share=0.18 +10.02 ± 4.89 *
  icm_switch:start=b;back_share=0.22 +10.28 ± 4.91 *
  icm_switch:start=b;back_share=0.22;switch_min=15 +9.88 ± 4.77 *
  f9_meta                      +14.32 ± 5.05 *


## cell 10: --field custom:f2_shark=1,f3_exploiter=1 _gto=1,f9_meta=1

paired difference vs icm_tag (same tables):
  icm_switch                   +2.14 ± 2.50
  icm_switch:start=b;back_share=0.18 +8.31 ± 4.28 *
  icm_switch:start=b;back_share=0.22 +8.38 ± 4.26 *
  icm_switch:start=b;back_share=0.22;switch_min=15 +8.41 ± 4.15 *
  f9_meta                      +11.48 ± 4.42 *

done
