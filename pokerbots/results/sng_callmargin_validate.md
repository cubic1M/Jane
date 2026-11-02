# call_margin=0.09 fresh-seed validation (tuner pick; seeds 71000+, 600 paired tables)

## --preset rehearsal_sixplus --field custom:planb_sd

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     -3.93 ± 1.60 *

field archetypes (points/table):
  planb_sd                37.73 ± 1.26  (n=1200)


## --field default

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     +3.98 ± 2.76 *

field archetypes (points/table):
  pushfold_icm            44.25 ± 2.08  (n=676)
  lag                     38.36 ± 2.95  (n=542)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     +0.17 ± 2.00

field archetypes (points/table):
  f2_bubble               36.94 ± 2.11  (n=858)
  f2_shark                36.22 ± 2.10  (n=834)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     +0.98 ± 2.41

field archetypes (points/table):
  f3_exploiter            60.49 ± 4.27  (n=324)
  f3_ladder_pro           43.13 ± 3.59  (n=458)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     +0.24 ± 1.95

field archetypes (points/table):
  f3_exploiter            23.34 ± 3.52  (n=138)
  f3_ladder_pro           17.01 ± 3.11  (n=174)

## --field all3 --payouts winner

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     -3.13 ± 3.74

field archetypes (points/table):
  f3_exploiter            36.68 ± 8.45  (n=120)
  f3_ladder_pro           22.20 ± 5.60  (n=198)

## --field custom:push=2,maniac=2,station=2,random=1,

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     -1.01 ± 1.75

field archetypes (points/table):
  f3_exploiter            57.77 ± 3.36  (n=428)
  f2_shark                48.37 ± 3.06  (n=426)

## --field mirror

paired difference vs icm_tag (same tables):
  icm_tag:call_margin=0.09     -1.14 ± 2.44

field archetypes (points/table):
  icm_tag                 45.03 ± 1.88  (n=1170)
  pushfold_icm            37.60 ± 1.82  (n=1036)
done
