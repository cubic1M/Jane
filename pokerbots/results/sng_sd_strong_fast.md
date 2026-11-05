# Short deck: strong-room option exact vs f9_min_left=6, vs icm_switch, seeds 681000+ (400 paired tables)

## cell 1: --field custom:planb_sd=1 --preset kit4_sixplus

paired difference vs icm_switch (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15 +9.84 ± 3.43 *
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 +26.25 ± 3.44 *


## cell 2: --field custom:f10_chen=2,f10_ --preset kit4_sixplus

paired difference vs icm_switch (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15 +7.22 ± 4.15 *
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 +7.61 ± 4.26 *


## cell 3: --field field10 --preset kit4_sixplus

paired difference vs icm_switch (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15 +1.48 ± 3.95
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -1.31 ± 3.98


## cell 4: --field field5 --preset kit4_sixplus

paired difference vs icm_switch (same tables):
  icm_switch:start=b;back_share=0.22;switch_min=15 -0.82 ± 4.32
  icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6 -1.12 ± 4.51

done
