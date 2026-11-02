# c-bet / bluff size exploration (seeds 57000+, 500 paired tables)

## --field all3 --payouts top3

paired difference vs icm_tag (same tables):
  icm_tag:cbet_size=0.33       -0.59 ± 1.70
  icm_tag:cbet_size=0.75       -2.71 ± 1.87 *
  icm_tag:bluff_size=0.33      -0.15 ± 1.63
  icm_tag:bluff_size=0.75      -1.54 ± 1.76
  icm_tag:cbet_size=0.33;bluff_size=0.33 -1.03 ± 1.77

field archetypes (points/table):
  f3_exploiter            26.16 ± 2.48  (n=294)

## --field field3

paired difference vs icm_tag (same tables):
  icm_tag:cbet_size=0.33       -0.33 ± 2.54
  icm_tag:cbet_size=0.75       -2.21 ± 2.79
  icm_tag:bluff_size=0.33      -0.14 ± 2.31
  icm_tag:bluff_size=0.75      -1.03 ± 2.59
  icm_tag:cbet_size=0.33;bluff_size=0.33 +0.24 ± 2.57

field archetypes (points/table):
  f3_exploiter            55.69 ± 2.77  (n=780)

## --field field2

paired difference vs icm_tag (same tables):
  icm_tag:cbet_size=0.33       -2.48 ± 2.12 *
  icm_tag:cbet_size=0.75       -1.49 ± 2.03
  icm_tag:bluff_size=0.33      -0.85 ± 1.25
  icm_tag:bluff_size=0.75      -1.10 ± 1.16
  icm_tag:cbet_size=0.33;bluff_size=0.33 -1.45 ± 2.11

field archetypes (points/table):
  f2_shark                40.36 ± 1.43  (n=2100)

## --field custom:push=2,maniac=2,station=2

paired difference vs icm_tag (same tables):
  icm_tag:cbet_size=0.33       +0.10 ± 1.38
  icm_tag:cbet_size=0.75       -0.25 ± 1.48
  icm_tag:bluff_size=0.33      +0.20 ± 0.85
  icm_tag:bluff_size=0.75      +0.22 ± 0.87
  icm_tag:cbet_size=0.33;bluff_size=0.33 +0.06 ± 1.49

field archetypes (points/table):
  f3_exploiter            61.59 ± 2.18  (n=1014)
done
