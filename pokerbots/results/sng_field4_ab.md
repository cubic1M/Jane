# field 4: our switches (seeds 73000+, 400 paired tables)
paired difference vs icm_tag (same tables):
  icm_tag:resteal=1;resteal_risk=0.5 +1.38 ± 1.74
  icm_tag:pev=1;pev_risk=0.5   -0.05 ± 2.34
  icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5 +1.16 ± 2.44
  icm_tag:behind_k=0           -0.89 ± 1.92
  icm_tag:push_steal=1         +0.54 ± 1.43
  icm_tag:pf_chart=1           +4.08 ± 2.67 *
  icm_tag:call_margin=0.03     +1.73 ± 2.85
  icm_tag:bet_discount=0.6     -0.94 ± 2.54
  f4_icm                       +1.26 ± 3.92

field archetypes (points/table):
  f4_icm                  39.24 ± 1.11  (n=3010)
  f4_gto                  35.30 ± 1.10  (n=3080)
  f4_tag                  34.85 ± 1.03  (n=2920)
done
