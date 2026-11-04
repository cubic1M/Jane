# Field 10 standing, fresh seeds 341000+ (400 paired tables; baseline icm_tag)

## --field field10

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 61.74 ± 3.38 | 29% | 66% | 50% | 0.080 | 11.40 | 7 | 0 |
| icm_switch | 59.80 ± 3.44 | 29% | 62% | 53% | 0.073 | 0.68 | 0 | 0 |
| f9_meta | 60.11 ± 3.42 | 31% | 65% | 56% | 0.095 | 12.15 | 9 | 0 |
| f7_balanced | 54.11 ± 3.51 | 24% | 57% | 59% | 0.065 | 4.08 | 3 | 0 |
| f8_ensemble | 56.10 ± 3.38 | 26% | 61% | 60% | 0.102 | 5.27 | 2 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   -1.93 ± 1.68 *
  f9_meta                      -1.63 ± 4.53
  f7_balanced                  -7.63 ± 4.41 *
  f8_ensemble                  -5.64 ± 4.43 *
  f10_tag_simple          46.16 ± 1.42  (n=1780)
  f10_exploit_lite        39.25 ± 1.44  (n=1785)
  f10_pushfold            39.11 ± 1.44  (n=1565)
  f10_llm_rules           35.83 ± 1.18  (n=1890)
  f10_chen                34.34 ± 0.93  (n=1830)
  f10_aggro               24.11 ± 1.61  (n=1725)
  f10_montecarlo          21.72 ± 1.21  (n=1680)
  f10_passive              9.85 ± 0.66  (n=1745)

## --field field10 --payouts top3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 26.80 ± 2.08 | 30% | 66% | 50% | 0.076 | 4.15 | 3 | 0 |
| icm_switch | 25.62 ± 2.09 | 28% | 64% | 53% | 0.073 | 4.10 | 3 | 0 |
| f9_meta | 24.93 ± 2.13 | 32% | 62% | 57% | 0.094 | 2.19 | 11 | 0 |
| f7_balanced | 19.97 ± 2.04 | 19% | 54% | 66% | 0.063 | 8.19 | 3 | 0 |
| f8_ensemble | 22.41 ± 2.05 | 23% | 59% | 62% | 0.101 | 10.28 | 7 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   -1.18 ± 1.13 *
  f9_meta                      -1.87 ± 2.84
  f7_balanced                  -6.83 ± 2.64 *
  f8_ensemble                  -4.38 ± 2.61 *
  f10_tag_simple          18.35 ± 0.87  (n=1730)
  f10_exploit_lite        16.14 ± 0.92  (n=1590)
  f10_pushfold            13.41 ± 0.77  (n=1770)
  f10_llm_rules           13.11 ± 0.71  (n=1845)
  f10_chen                10.98 ± 0.64  (n=1740)
  f10_aggro                8.12 ± 0.79  (n=1850)
  f10_montecarlo           5.69 ± 0.63  (n=1720)
  f10_passive              1.64 ± 0.33  (n=1755)

## --preset kit4_sixplus --field field10

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 58.72 ± 2.98 | 24% | 68% | 66% | 0.070 | 4.05 | 4 | 0 |
| icm_switch | 59.66 ± 3.05 | 27% | 69% | 64% | 0.074 | 8.30 | 5 | 0 |
| f9_meta | 58.79 ± 3.25 | 31% | 67% | 65% | 0.091 | 2.16 | 5 | 0 |
| f7_balanced | 45.86 ± 3.24 | 20% | 51% | 78% | 0.202 | 1.60 | 6 | 0 |
| f8_ensemble | 46.74 ± 1.98 | 1% | 70% | 91% | 0.059 | 2.48 | 3 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +0.94 ± 1.58
  f9_meta                      +0.07 ± 3.99
  f7_balanced                  -12.86 ± 4.16 *
  f8_ensemble                  -11.98 ± 3.30 *
  f10_tag_simple          44.83 ± 1.66  (n=1645)
  f10_pushfold            38.33 ± 1.47  (n=1595)
  f10_exploit_lite        37.54 ± 1.61  (n=1790)
  f10_llm_rules           37.21 ± 1.35  (n=1830)
  f10_chen                36.67 ± 1.23  (n=1780)
  f10_montecarlo          29.93 ± 1.36  (n=1700)
  f10_aggro               19.54 ± 1.37  (n=1880)
  f10_passive             10.69 ± 0.73  (n=1780)

## --field custom:f10_chen=1,f10_montecarlo=1,f10_pushfold=1,f10_llm_rule

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 41.47 ± 3.13 | 14% | 42% | 79% | 0.094 | 10.44 | 4 | 0 |
| icm_switch | 43.91 ± 3.29 | 18% | 46% | 77% | 0.084 | 2.16 | 2 | 0 |
| f9_meta | 46.37 ± 3.25 | 18% | 51% | 76% | 0.092 | 1.87 | 3 | 0 |
| f7_balanced | 46.39 ± 3.46 | 20% | 52% | 72% | 0.067 | 2.81 | 2 | 0 |
| f8_ensemble | 47.68 ± 3.22 | 18% | 53% | 74% | 0.102 | 1.92 | 5 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +2.44 ± 2.27 *
  f9_meta                      +4.90 ± 3.99 *
  f7_balanced                  +4.92 ± 4.07 *
  f8_ensemble                  +6.21 ± 3.93 *
  f9_meta                 47.95 ± 1.88  (n=1255)
  f9_threebet             45.20 ± 2.08  (n=955)
  f8_ensemble             44.61 ± 1.82  (n=1195)
  f7_balanced             42.12 ± 2.08  (n=1040)
  f10_tag_simple          38.83 ± 1.63  (n=1235)
  f10_exploit_lite        35.89 ± 1.71  (n=1125)
  f10_llm_rules           34.12 ± 1.44  (n=1225)
  f10_pushfold            33.93 ± 1.70  (n=1110)
  f10_chen                30.44 ± 1.09  (n=1155)
  f10_aggro               22.61 ± 1.87  (n=1300)
  f10_montecarlo          17.01 ± 1.28  (n=1215)
  f10_passive             10.26 ± 0.90  (n=1190)

## --preset kit4_sixplus --field custom:f10_chen=1,f10_montecarlo=1,f10_p

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 43.00 ± 2.96 | 12% | 48% | 81% | 0.085 | 5.19 | 6 | 0 |
| icm_switch | 47.39 ± 3.06 | 18% | 53% | 77% | 0.090 | 1.62 | 2 | 0 |
| f9_meta | 53.34 ± 3.43 | 29% | 59% | 69% | 0.092 | 1.61 | 2 | 0 |
| f7_balanced | 37.66 ± 3.30 | 17% | 38% | 83% | 0.197 | 4.19 | 4 | 0 |
| f8_ensemble | 41.39 ± 2.03 | 1% | 58% | 93% | 0.059 | 1.16 | 1 | 0 |
paired difference vs icm_tag (same tables):
  icm_switch                   +4.38 ± 2.59 *
  f9_meta                      +10.34 ± 4.08 *
  f7_balanced                  -5.34 ± 3.95 *
  f8_ensemble                  -1.62 ± 3.21
  f9_threebet             50.08 ± 2.09  (n=1060)
  f9_meta                 48.56 ± 2.16  (n=1035)
  f10_tag_simple          41.64 ± 1.88  (n=1240)
  f8_ensemble             38.00 ± 1.17  (n=1040)
  f10_pushfold            36.44 ± 1.60  (n=1255)
  f10_exploit_lite        36.42 ± 2.12  (n=1095)
  f7_balanced             34.78 ± 1.96  (n=1080)
  f10_llm_rules           33.22 ± 1.68  (n=1185)
  f10_chen                32.68 ± 1.46  (n=1240)
  f10_montecarlo          24.39 ± 1.48  (n=1305)
  f10_aggro               18.17 ± 1.80  (n=1195)
  f10_passive              7.70 ± 0.68  (n=1270)
done
