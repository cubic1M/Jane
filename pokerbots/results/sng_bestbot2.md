# Which bot, round 2 (300 paired tables, time limit on, seeds 271000+)

## --field default

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 70.00 ± 4.13 | 46% | 72% | 39% | 0.096 | 6.31 | 4 | 0 |
| f8_ensemble | 61.19 ± 4.27 | 32% | 64% | 50% | 0.122 | 4.32 | 5 | 0 |
| f8_adaptive | 62.94 ± 4.37 | 40% | 64% | 48% | 0.120 | 2.16 | 11 | 0 |
| f9_bubble | 58.40 ± 4.34 | 34% | 60% | 54% | 0.105 | 3.44 | 10 | 0 |
| f9_meta | 64.35 ± 4.25 | 35% | 66% | 47% | 0.113 | 4.23 | 8 | 0 |
| f9_threebet | 59.43 ± 4.19 | 31% | 64% | 53% | 0.100 | 2.33 | 7 | 0 |
| f7_balanced | 55.78 ± 4.32 | 20% | 59% | 53% | 0.080 | 1.44 | 4 | 0 |
| f3_exploiter | 57.99 ± 4.64 | 39% | 58% | 50% | 0.231 | 2.35 | 8 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -8.81 ± 5.60 *
  f8_adaptive                  -7.06 ± 5.39 *
  f9_bubble                    -11.60 ± 5.69 *
  f9_meta                      -5.65 ± 5.20 *
  f9_threebet                  -10.57 ± 5.57 *
  f7_balanced                  -14.22 ± 5.66 *
  f3_exploiter                 -12.01 ± 5.84 *
  pushfold_icm            42.85 ± 1.57  (n=1240)
  adaptive                42.82 ± 1.70  (n=904)
  chen_tag                41.02 ± 1.10  (n=1824)
  nit                     36.23 ± 1.18  (n=1080)
  lag                     35.57 ± 2.17  (n=1072)
  mc_slow                 29.08 ± 0.85  (n=1040)
  station                 21.62 ± 1.46  (n=1200)
  mc_fast                 20.78 ± 1.45  (n=1456)
  mc_equity               20.27 ± 1.24  (n=1544)
  maniac                  17.55 ± 2.16  (n=888)

## --field field2

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 46.41 ± 3.86 | 19% | 49% | 73% | 0.094 | 8.08 | 4 | 0 |
| f8_ensemble | 45.36 ± 3.73 | 18% | 53% | 76% | 0.107 | 4.20 | 7 | 0 |
| f8_adaptive | 44.26 ± 3.77 | 19% | 52% | 79% | 0.107 | 3.82 | 3 | 0 |
| f9_bubble | 45.62 ± 3.76 | 21% | 47% | 77% | 0.093 | 11.96 | 8 | 0 |
| f9_meta | 45.86 ± 3.59 | 18% | 54% | 79% | 0.098 | 3.87 | 3 | 0 |
| f9_threebet | 46.84 ± 3.68 | 18% | 53% | 76% | 0.090 | 8.53 | 6 | 0 |
| f7_balanced | 43.87 ± 3.74 | 18% | 50% | 79% | 0.067 | 3.97 | 6 | 0 |
| f3_exploiter | 40.72 ± 3.81 | 16% | 44% | 81% | 0.254 | 7.87 | 4 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -1.05 ± 4.88
  f8_adaptive                  -2.15 ± 5.14
  f9_bubble                    -0.80 ± 5.45
  f9_meta                      -0.55 ± 5.03
  f9_threebet                  +0.42 ± 5.16
  f7_balanced                  -2.54 ± 5.02
  f3_exploiter                 -5.70 ± 5.17 *
  f2_shark                36.66 ± 1.52  (n=1768)
  f2_nash                 35.63 ± 1.37  (n=1784)
  f2_bubble               35.55 ± 1.42  (n=1736)
  f2_gto                  33.19 ± 1.48  (n=1736)
  f2_exploit              29.35 ± 1.44  (n=1744)
  f2_equity               29.17 ± 1.43  (n=1672)

## --field field3

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 67.78 ± 4.20 | 37% | 71% | 39% | 0.138 | 9.98 | 9 | 0 |
| f8_ensemble | 55.42 ± 4.06 | 23% | 62% | 58% | 0.118 | 4.22 | 10 | 0 |
| f8_adaptive | 56.86 ± 4.44 | 31% | 58% | 53% | 0.118 | 4.67 | 16 | 0 |
| f9_bubble | 57.53 ± 4.07 | 26% | 63% | 57% | 0.100 | 2.30 | 4 | 0 |
| f9_meta | 57.83 ± 4.20 | 30% | 62% | 54% | 0.112 | 6.19 | 9 | 0 |
| f9_threebet | 54.01 ± 4.08 | 21% | 59% | 58% | 0.099 | 1.75 | 3 | 0 |
| f7_balanced | 47.42 ± 4.00 | 16% | 49% | 64% | 0.074 | 3.30 | 3 | 0 |
| f3_exploiter | 54.27 ± 4.45 | 28% | 59% | 54% | 0.216 | 3.88 | 4 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -12.36 ± 5.34 *
  f8_adaptive                  -10.92 ± 5.52 *
  f9_bubble                    -10.25 ± 4.95 *
  f9_meta                      -9.95 ± 5.35 *
  f9_threebet                  -13.77 ± 5.37 *
  f7_balanced                  -20.36 ± 5.34 *
  f3_exploiter                 -13.51 ± 5.22 *
  f3_exploiter            49.36 ± 3.01  (n=608)
  f3_quant_icm            42.46 ± 1.89  (n=984)
  f3_ladder_pro           37.73 ± 2.31  (n=952)
  f3_buggy                35.60 ± 1.32  (n=1880)
  f3_generic              33.47 ± 1.01  (n=2168)
  f3_survivor             32.00 ± 1.13  (n=1216)
  f3_shover               27.10 ± 1.62  (n=1592)
  f3_mc_slow              14.86 ± 0.97  (n=1528)

## --field field4

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 43.78 ± 3.57 | 11% | 50% | 77% | 0.105 | 8.10 | 13 | 0 |
| f8_ensemble | 45.95 ± 3.76 | 16% | 50% | 75% | 0.113 | 6.16 | 7 | 0 |
| f8_adaptive | 45.36 ± 3.94 | 21% | 46% | 74% | 0.114 | 7.45 | 7 | 0 |
| f9_bubble | 45.01 ± 3.79 | 18% | 49% | 76% | 0.097 | 4.16 | 13 | 0 |
| f9_meta | 46.19 ± 3.99 | 22% | 48% | 73% | 0.105 | 2.67 | 6 | 0 |
| f9_threebet | 45.34 ± 3.74 | 19% | 48% | 76% | 0.093 | 2.20 | 4 | 0 |
| f7_balanced | 44.61 ± 3.91 | 17% | 50% | 74% | 0.068 | 1.57 | 1 | 0 |
| f3_exploiter | 45.95 ± 4.00 | 17% | 52% | 72% | 0.245 | 3.39 | 11 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +2.18 ± 4.73
  f8_adaptive                  +1.58 ± 5.01
  f9_bubble                    +1.24 ± 4.66
  f9_meta                      +2.41 ± 4.87
  f9_threebet                  +1.56 ± 4.84
  f7_balanced                  +0.83 ± 4.89
  f3_exploiter                 +2.18 ± 4.98
  f4_icm                  37.43 ± 1.46  (n=1680)
  f4_tag                  35.03 ± 1.34  (n=1824)
  f4_gto                  34.19 ± 1.42  (n=1760)
  f4_mc                   32.16 ± 1.47  (n=1792)
  f4_lag                  30.28 ± 1.57  (n=1896)
  f4_eqrule               29.28 ± 1.22  (n=1464)

## --field field5

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 60.29 ± 4.18 | 28% | 66% | 45% | 0.135 | 5.03 | 2 | 0 |
| f8_ensemble | 43.49 ± 3.90 | 17% | 48% | 77% | 0.109 | 3.64 | 7 | 0 |
| f8_adaptive | 42.50 ± 4.11 | 21% | 45% | 76% | 0.109 | 2.64 | 4 | 0 |
| f9_bubble | 39.79 ± 4.08 | 19% | 43% | 78% | 0.097 | 4.19 | 4 | 0 |
| f9_meta | 43.03 ± 3.87 | 18% | 50% | 77% | 0.109 | 2.00 | 5 | 0 |
| f9_threebet | 43.64 ± 4.05 | 20% | 47% | 74% | 0.094 | 2.54 | 4 | 0 |
| f7_balanced | 42.90 ± 4.07 | 17% | 46% | 70% | 0.067 | 8.49 | 5 | 0 |
| f3_exploiter | 43.40 ± 4.20 | 18% | 49% | 71% | 0.267 | 8.15 | 9 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -16.80 ± 5.22 *
  f8_adaptive                  -17.79 ± 5.52 *
  f9_bubble                    -20.50 ± 5.52 *
  f9_meta                      -17.26 ± 5.57 *
  f9_threebet                  -16.64 ± 5.16 *
  f7_balanced                  -17.38 ± 5.40 *
  f3_exploiter                 -16.88 ± 5.52 *
  f5_bully                36.13 ± 1.44  (n=1832)
  f5_trapper              33.60 ± 1.37  (n=1856)
  f5_reg                  32.85 ± 1.29  (n=1944)
  f5_adapt                32.69 ± 1.39  (n=1896)
  f5_nash                 31.48 ± 1.30  (n=1848)

## --field field6

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 20.04 ± 3.02 | 5% | 17% | 89% | 0.168 | 3.26 | 6 | 0 |
| f8_ensemble | 37.89 ± 3.95 | 13% | 40% | 74% | 0.111 | 8.30 | 12 | 0 |
| f8_adaptive | 34.24 ± 4.00 | 14% | 36% | 81% | 0.110 | 2.27 | 5 | 0 |
| f9_bubble | 38.68 ± 4.05 | 16% | 40% | 77% | 0.101 | 3.03 | 6 | 0 |
| f9_meta | 40.87 ± 4.14 | 19% | 42% | 72% | 0.110 | 11.54 | 6 | 0 |
| f9_threebet | 40.55 ± 4.15 | 18% | 44% | 71% | 0.089 | 1.58 | 8 | 0 |
| f7_balanced | 36.71 ± 3.81 | 12% | 40% | 75% | 0.062 | 1.71 | 1 | 0 |
| f3_exploiter | 34.53 ± 4.12 | 13% | 37% | 73% | 0.262 | 14.76 | 11 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +17.85 ± 4.72 *
  f8_adaptive                  +14.19 ± 4.79 *
  f9_bubble                    +18.64 ± 5.00 *
  f9_meta                      +20.83 ± 4.88 *
  f9_threebet                  +20.51 ± 4.82 *
  f7_balanced                  +16.67 ± 4.57 *
  f3_exploiter                 +14.49 ± 4.77 *
  f6_riverbluffer         35.46 ± 1.35  (n=1952)
  f6_overbettor           34.83 ± 1.37  (n=1824)
  f6_raiser               34.05 ± 1.35  (n=1864)
  f6_floater              33.38 ± 1.32  (n=1832)
  f6_checkraiser          33.30 ± 1.36  (n=1832)

## --field field7

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 21.69 ± 2.96 | 4% | 21% | 93% | 0.134 | 7.19 | 2 | 0 |
| f8_ensemble | 38.47 ± 3.71 | 12% | 42% | 81% | 0.107 | 6.20 | 5 | 0 |
| f8_adaptive | 37.71 ± 3.94 | 16% | 40% | 81% | 0.107 | 6.16 | 7 | 0 |
| f9_bubble | 37.40 ± 3.79 | 14% | 38% | 81% | 0.096 | 2.28 | 6 | 0 |
| f9_meta | 37.87 ± 3.65 | 13% | 41% | 84% | 0.106 | 2.12 | 1 | 0 |
| f9_threebet | 39.90 ± 4.10 | 17% | 42% | 77% | 0.090 | 2.32 | 4 | 0 |
| f7_balanced | 34.44 ± 3.63 | 11% | 36% | 85% | 0.057 | 8.92 | 3 | 0 |
| f3_exploiter | 29.79 ± 3.64 | 10% | 34% | 89% | 0.250 | 4.27 | 9 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +16.78 ± 4.69 *
  f8_adaptive                  +16.02 ± 4.85 *
  f9_bubble                    +15.71 ± 4.53 *
  f9_meta                      +16.18 ± 4.50 *
  f9_threebet                  +18.21 ± 4.75 *
  f7_balanced                  +12.75 ± 4.40 *
  f3_exploiter                 +8.10 ± 4.30 *
  f7_balanced             38.14 ± 1.53  (n=1880)
  f7_profiler             36.64 ± 1.43  (n=2048)
  f7_bully                35.51 ± 1.31  (n=1936)
  f7_trickster            34.48 ± 1.57  (n=1760)
  f7_hackathon            30.74 ± 1.19  (n=1928)

## --field field8

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 34.37 ± 3.38 | 7% | 39% | 83% | 0.139 | 3.66 | 6 | 0 |
| f8_ensemble | 35.79 ± 3.61 | 11% | 38% | 85% | 0.101 | 13.21 | 8 | 0 |
| f8_adaptive | 38.37 ± 3.98 | 17% | 40% | 80% | 0.100 | 4.66 | 11 | 0 |
| f9_bubble | 36.34 ± 3.71 | 14% | 39% | 83% | 0.099 | 35.35 | 5 | 0 |
| f9_meta | 37.15 ± 3.78 | 15% | 37% | 83% | 0.110 | 1.69 | 6 | 0 |
| f9_threebet | 38.65 ± 3.69 | 14% | 44% | 83% | 0.091 | 5.62 | 6 | 0 |
| f7_balanced | 33.00 ± 3.73 | 11% | 34% | 84% | 0.075 | 3.73 | 4 | 0 |
| f3_exploiter | 34.76 ± 3.63 | 9% | 41% | 85% | 0.268 | 36.64 | 7 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +1.42 ± 4.50
  f8_adaptive                  +4.00 ± 4.84
  f9_bubble                    +1.97 ± 4.58
  f9_meta                      +2.78 ± 4.76
  f9_threebet                  +4.28 ± 4.69
  f7_balanced                  -1.37 ± 4.56
  f3_exploiter                 +0.40 ± 4.56
  f8_adaptive             37.01 ± 1.55  (n=1824)
  f8_solver               36.13 ± 1.42  (n=1920)
  f8_ensemble             34.87 ± 1.42  (n=1888)
  f8_endgame              32.53 ± 1.30  (n=1928)
  f8_nash                 32.31 ± 1.38  (n=1832)

## --field field9

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 27.55 ± 3.25 | 6% | 28% | 88% | 0.145 | 17.63 | 7 | 0 |
| f8_ensemble | 31.48 ± 3.48 | 9% | 34% | 87% | 0.112 | 5.34 | 6 | 0 |
| f8_adaptive | 31.01 ± 3.60 | 11% | 33% | 88% | 0.109 | 19.10 | 11 | 0 |
| f9_bubble | 33.93 ± 3.76 | 13% | 35% | 85% | 0.085 | 1.00 | 0 | 0 |
| f9_meta | 33.48 ± 3.45 | 9% | 37% | 88% | 0.094 | 4.21 | 5 | 0 |
| f9_threebet | 35.18 ± 3.62 | 11% | 40% | 85% | 0.079 | 2.13 | 1 | 0 |
| f7_balanced | 28.53 ± 3.48 | 8% | 33% | 89% | 0.075 | 3.20 | 3 | 0 |
| f3_exploiter | 31.40 ± 3.57 | 9% | 36% | 88% | 0.266 | 2.12 | 7 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +3.93 ± 4.47
  f8_adaptive                  +3.46 ± 4.29
  f9_bubble                    +6.38 ± 4.55 *
  f9_meta                      +5.93 ± 4.57 *
  f9_threebet                  +7.63 ± 4.43 *
  f7_balanced                  +0.98 ± 4.47
  f3_exploiter                 +3.85 ± 4.51
  f9_float                36.46 ± 1.52  (n=1704)
  f9_threebet             35.89 ± 1.43  (n=1832)
  f9_gto                  35.70 ± 1.51  (n=1704)
  f9_limptrap             35.16 ± 1.56  (n=1720)
  f9_bubble               35.13 ± 1.42  (n=1792)
  f9_meta                 34.54 ± 1.48  (n=1664)

## --field all3 --payouts winner

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 44.06 ± 5.36 | 38% | 61% | 52% | 0.117 | 10.27 | 6 | 0 |
| f8_ensemble | 27.10 ± 4.79 | 22% | 50% | 69% | 0.121 | 8.25 | 12 | 0 |
| f8_adaptive | 29.16 ± 5.05 | 26% | 47% | 69% | 0.118 | 2.59 | 5 | 0 |
| f9_bubble | 34.98 ± 5.33 | 33% | 52% | 64% | 0.099 | 3.11 | 4 | 0 |
| f9_meta | 35.26 ± 5.26 | 32% | 50% | 62% | 0.110 | 4.22 | 5 | 0 |
| f9_threebet | 33.10 ± 5.11 | 28% | 53% | 64% | 0.096 | 5.25 | 3 | 0 |
| f7_balanced | 25.80 ± 4.59 | 18% | 45% | 69% | 0.074 | 2.26 | 4 | 0 |
| f3_exploiter | 29.72 ± 5.08 | 28% | 45% | 69% | 0.236 | 6.37 | 7 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -16.96 ± 6.77 *
  f8_adaptive                  -14.89 ± 7.06 *
  f9_bubble                    -9.07 ± 6.80 *
  f9_meta                      -8.80 ± 6.79 *
  f9_threebet                  -10.96 ± 6.53 *
  f7_balanced                  -18.26 ± 6.41 *
  f3_exploiter                 -14.33 ± 6.81 *
  f3_exploiter            20.45 ± 4.74  (n=264)
  f3_ladder_pro           20.11 ± 3.91  (n=392)
  f2_shark                17.61 ± 2.29  (n=864)
  f2_bubble               16.51 ± 2.49  (n=776)
  f2_gto                  14.43 ± 2.44  (n=728)
  f2_equity               14.03 ± 2.36  (n=736)
  f2_exploit              13.92 ± 2.14  (n=776)
  f3_quant_icm            13.39 ± 3.38  (n=320)
  f3_shover               11.27 ± 2.22  (n=664)
  f3_buggy                10.63 ± 1.58  (n=864)
  lag                     10.25 ± 2.71  (n=352)
  f2_nash                 10.12 ± 2.02  (n=728)
  pushfold_icm            10.07 ± 1.80  (n=616)
  mc_fast                  5.90 ± 1.81  (n=616)
  adaptive                 5.41 ± 1.70  (n=312)
  f3_generic               5.35 ± 0.95  (n=1144)
  maniac                   3.41 ± 1.90  (n=352)
  chen_tag                 3.37 ± 0.87  (n=856)
  mc_equity                3.32 ± 1.36  (n=632)
  f3_survivor              3.16 ± 0.86  (n=512)
  station                  3.10 ± 1.55  (n=424)
  f3_mc_slow               2.12 ± 1.03  (n=688)
  nit                      1.05 ± 0.42  (n=480)
  mc_slow                  0.02 ± 0.03  (n=312)

## --field custom:push=2,maniac=2,station=2,random=1,f3_buggy=1

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 59.05 ± 3.70 | 26% | 66% | 60% | 0.112 | 5.18 | 5 | 0 |
| f8_ensemble | 54.20 ± 3.47 | 20% | 63% | 70% | 0.123 | 3.94 | 6 | 0 |
| f8_adaptive | 54.94 ± 3.74 | 24% | 60% | 66% | 0.118 | 2.30 | 2 | 0 |
| f9_bubble | 53.61 ± 3.53 | 20% | 60% | 69% | 0.107 | 8.20 | 3 | 0 |
| f9_meta | 59.53 ± 3.66 | 27% | 67% | 62% | 0.114 | 18.61 | 6 | 0 |
| f9_threebet | 55.14 ± 3.55 | 20% | 63% | 68% | 0.103 | 1.54 | 9 | 0 |
| f7_balanced | 53.73 ± 3.74 | 21% | 58% | 65% | 0.076 | 1.19 | 1 | 0 |
| f3_exploiter | 58.58 ± 4.02 | 31% | 63% | 58% | 0.228 | 8.64 | 16 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -4.85 ± 4.50 *
  f8_adaptive                  -4.11 ± 4.69
  f9_bubble                    -5.44 ± 4.62 *
  f9_meta                      +0.48 ± 4.74
  f9_threebet                  -3.91 ± 4.53
  f7_balanced                  -5.32 ± 4.58 *
  f3_exploiter                 -0.47 ± 4.67
  f3_exploiter            51.40 ± 2.34  (n=864)
  pushfold_icm            45.13 ± 1.66  (n=872)
  f3_buggy                43.34 ± 1.84  (n=880)
  f2_shark                42.30 ± 2.13  (n=840)
  chen_tag                41.27 ± 1.36  (n=864)
  nit                     40.55 ± 1.19  (n=840)
  lag                     38.13 ± 2.11  (n=816)
  mc_slow                 34.84 ± 1.01  (n=856)
  f3_shover               32.85 ± 2.15  (n=880)
  station                 27.17 ± 1.49  (n=1440)
  maniac                  19.09 ± 1.54  (n=1440)
  push                    14.58 ± 1.42  (n=1544)
  random                  11.55 ± 1.19  (n=936)

## --field custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_en

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 23.45 ± 2.98 | 6% | 21% | 92% | 0.146 | 2.38 | 4 | 0 |
| f8_ensemble | 34.53 ± 3.49 | 10% | 38% | 87% | 0.111 | 7.18 | 6 | 0 |
| f8_adaptive | 31.58 ± 3.46 | 9% | 34% | 89% | 0.112 | 8.20 | 7 | 0 |
| f9_bubble | 38.93 ± 3.73 | 14% | 45% | 83% | 0.094 | 1.15 | 1 | 0 |
| f9_meta | 37.26 ± 3.76 | 14% | 40% | 83% | 0.105 | 4.20 | 7 | 0 |
| f9_threebet | 36.45 ± 3.81 | 15% | 37% | 84% | 0.086 | 2.82 | 1 | 0 |
| f7_balanced | 29.69 ± 3.42 | 9% | 31% | 89% | 0.075 | 1.96 | 2 | 0 |
| f3_exploiter | 30.39 ± 3.24 | 4% | 35% | 92% | 0.262 | 9.60 | 8 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +11.08 ± 4.17 *
  f8_adaptive                  +8.13 ± 4.40 *
  f9_bubble                    +15.47 ± 4.45 *
  f9_meta                      +13.81 ± 4.59 *
  f9_threebet                  +13.00 ± 4.55 *
  f7_balanced                  +6.24 ± 4.33 *
  f3_exploiter                 +6.93 ± 3.97 *
  f8_nash                 38.34 ± 1.76  (n=1280)
  f9_gto                  37.78 ± 1.87  (n=1136)
  f9_threebet             37.22 ± 1.83  (n=1168)
  f9_float                35.43 ± 1.88  (n=1080)
  f9_bubble               35.36 ± 1.84  (n=1168)
  f9_limptrap             34.60 ± 1.85  (n=1152)
  f9_meta                 34.45 ± 1.73  (n=1248)
  f8_ensemble             34.38 ± 1.73  (n=1160)
  f3_exploiter            34.30 ± 1.76  (n=1152)
  f7_balanced             33.57 ± 1.87  (n=1184)
  f2_shark                29.43 ± 1.88  (n=1040)

## --preset kit4_sixplus --field field5

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 42.88 ± 3.61 | 15% | 46% | 81% | 0.116 | 1.84 | 2 | 0 |
| f8_ensemble | 36.83 ± 2.29 | 0% | 50% | 100% | 0.064 | 1.16 | 2 | 0 |
| f8_adaptive | 36.73 ± 2.28 | 0% | 50% | 100% | 0.065 | 6.76 | 1 | 0 |
| f9_bubble | 44.88 ± 3.63 | 17% | 54% | 83% | 0.095 | 6.21 | 5 | 0 |
| f9_meta | 45.21 ± 3.72 | 18% | 54% | 82% | 0.102 | 1.65 | 2 | 0 |
| f9_threebet | 45.26 ± 3.91 | 20% | 53% | 79% | 0.092 | 8.18 | 7 | 0 |
| f7_balanced | 29.59 ± 3.50 | 9% | 34% | 91% | 0.228 | 4.35 | 7 | 0 |
| f3_exploiter | 39.94 ± 3.81 | 16% | 45% | 84% | 0.263 | 2.38 | 7 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  -6.05 ± 4.27 *
  f8_adaptive                  -6.15 ± 4.28 *
  f9_bubble                    +1.99 ± 4.84
  f9_meta                      +2.32 ± 4.92
  f9_threebet                  +2.37 ± 4.86
  f7_balanced                  -13.29 ± 4.89 *
  f3_exploiter                 -2.94 ± 5.07
  f5_bully                36.73 ± 1.49  (n=1936)
  f5_reg                  35.99 ± 1.44  (n=1888)
  f5_nash                 33.74 ± 1.48  (n=1872)
  f5_adapt                30.92 ± 1.39  (n=1984)
  f5_trapper              30.04 ± 1.41  (n=1848)

## --preset kit4_sixplus --field field9

| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |
| icm_tag | 24.83 ± 2.67 | 2% | 26% | 98% | 0.130 | 4.19 | 5 | 0 |
| f8_ensemble | 27.69 ± 2.13 | 0% | 31% | 100% | 0.066 | 0.60 | 0 | 0 |
| f8_adaptive | 27.39 ± 2.13 | 0% | 30% | 100% | 0.066 | 2.07 | 4 | 0 |
| f9_bubble | 33.90 ± 3.64 | 13% | 37% | 86% | 0.086 | 2.07 | 3 | 0 |
| f9_meta | 34.08 ± 3.37 | 10% | 37% | 89% | 0.093 | 9.32 | 9 | 0 |
| f9_threebet | 33.66 ± 3.61 | 12% | 36% | 87% | 0.080 | 4.20 | 5 | 0 |
| f7_balanced | 16.73 ± 2.74 | 4% | 17% | 96% | 0.235 | 2.49 | 9 | 0 |
| f3_exploiter | 28.55 ± 3.42 | 8% | 32% | 92% | 0.265 | 9.13 | 5 | 0 |
paired difference vs icm_tag (same tables):
  f8_ensemble                  +2.86 ± 3.28
  f8_adaptive                  +2.56 ± 3.28
  f9_bubble                    +9.07 ± 4.25 *
  f9_meta                      +9.24 ± 4.21 *
  f9_threebet                  +8.83 ± 4.10 *
  f7_balanced                  -8.10 ± 3.63 *
  f3_exploiter                 +3.72 ± 4.25
  f9_bubble               36.35 ± 1.54  (n=1696)
  f9_float                35.91 ± 1.54  (n=1768)
  f9_threebet             35.65 ± 1.50  (n=1800)
  f9_meta                 35.49 ± 1.49  (n=1784)
  f9_gto                  34.18 ± 1.54  (n=1664)
  f9_limptrap             33.51 ± 1.53  (n=1832)
done
