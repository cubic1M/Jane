# earlier/tighter rfi_lock exploration, seeds 251000+ (300 paired tables)

## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      -0.16 ± 2.13
  icm_tag:rfi_lock=0.25        +0.38 ± 1.44
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +0.78 ± 2.55
  icm_tag:rfi_scale=1.0        -0.13 ± 1.74
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 +0.34 ± 2.17


## --field field9

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +1.03 ± 2.07
  icm_tag:rfi_lock=0.25        +0.64 ± 1.91
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +2.27 ± 2.70
  icm_tag:rfi_scale=1.0        -0.03 ± 1.52
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -0.88 ± 2.02


## --field custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +0.40 ± 2.67
  icm_tag:rfi_lock=0.25        +1.63 ± 2.43
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +0.87 ± 3.50
  icm_tag:rfi_scale=1.0        +2.61 ± 2.61 *
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 +1.28 ± 2.83


## --field field7

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +0.69 ± 3.61
  icm_tag:rfi_lock=0.25        -0.65 ± 3.33
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +0.46 ± 3.60
  icm_tag:rfi_scale=1.0        -1.68 ± 3.33
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -0.53 ± 3.67


## --field field5

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      -1.54 ± 1.66
  icm_tag:rfi_lock=0.25        -0.21 ± 1.91
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 -1.54 ± 2.61
  icm_tag:rfi_scale=1.0        -0.15 ± 1.54
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -1.03 ± 1.77


## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      -0.11 ± 3.04
  icm_tag:rfi_lock=0.25        -1.31 ± 3.33
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 -1.12 ± 2.86
  icm_tag:rfi_scale=1.0        -1.18 ± 2.91
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -0.66 ± 3.37


## --field default

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +0.64 ± 3.77
  icm_tag:rfi_lock=0.25        -0.08 ± 4.13
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 -0.12 ± 4.34
  icm_tag:rfi_scale=1.0        -1.91 ± 4.32
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -4.30 ± 4.12 *


## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +1.72 ± 4.94
  icm_tag:rfi_lock=0.25        -0.14 ± 4.80
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 -1.30 ± 4.56
  icm_tag:rfi_scale=1.0        +0.35 ± 4.45
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 -2.26 ± 4.51


## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      +0.91 ± 1.72
  icm_tag:rfi_lock=0.25        +0.52 ± 2.42
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +0.62 ± 2.88
  icm_tag:rfi_scale=1.0        +1.88 ± 2.15
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 +0.09 ± 2.03


## --field field6

paired difference vs icm_tag (same tables):
  icm_tag:rfi_lock_min=10      -0.04 ± 2.93
  icm_tag:rfi_lock=0.25        +2.46 ± 2.54
  icm_tag:rfi_lock_min=10;rfi_lock=0.25 +1.74 ± 3.66
  icm_tag:rfi_scale=1.0        -1.10 ± 2.71
  icm_tag:rfi_lock_min=12;rfi_scale=1.1 +1.14 ± 3.14

done
