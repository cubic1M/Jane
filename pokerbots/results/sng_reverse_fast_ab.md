# fast reverse switch vs exact, seeds 431000+ (400 paired tables, baseline the exact reverse switch)

## cell 1: --field field7

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 -2.48 ± 3.99
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -1.52 ± 3.94


## cell 2: --field custom:f2_shark=1,f3_exploiter=1

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 +3.88 ± 3.76 *
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 +3.23 ± 3.50


## cell 3: --field custom:f2_shark=1,f3_exploiter=1

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 -0.70 ± 3.80
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -0.90 ± 3.62


## cell 4: --field field6

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 +3.64 ± 3.97
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 +2.90 ± 3.87


## cell 5: --field custom:f10_chen=2,f10_montecarlo

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 -4.56 ± 3.59 *
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -3.58 ± 3.29 *


## cell 6: --field field5

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 -2.38 ± 4.61
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -1.93 ± 4.42


## cell 7: --preset kit4_sixplus --field custom:f10

paired difference vs icm_switch:start=b;back_share=0.22;switch_min=15 (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=5;f9_cache=0.1 -3.52 ± 3.26 *
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -0.49 ± 3.18

done
