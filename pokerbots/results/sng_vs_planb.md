== submission/bot.py vs 7 planb copies, 300 tables seed 21
  average points : 32.22   (max 100 per table)
  places         : 1st:38  2nd:32  3rd:16  4th:31  5th:37  6th:54  7th:49  8th:43
  errors         : 0   timeouts: 0   (limit 50.0 ms)
  hand_over()    : errors 0   over limit 0
Opponents (average points per seat):
== planb/bot.py vs 7 planb copies, 300 tables seed 21
  average points : 38.49   (max 100 per table)
  places         : 1st:43  2nd:38  3rd:43  4th:34  5th:36  6th:39  7th:29  8th:38
  errors         : 0   timeouts: 0   (limit 50.0 ms)
  hand_over()    : errors 0   over limit 0
Opponents (average points per seat):

== after behind_k=0.2 + push_steal=0.5 (submission/bot.py rebuilt), same 300 tables seed 21
  average points : 37.68   (max 100 per table)   [was 32.22; Plan B itself 38.49]
  places         : 1st:35  2nd:40  3rd:37  4th:43  5th:35  6th:33  7th:33  8th:44
  errors         : 0   timeouts: 0

== after resteal_rel=0.35 (submission/bot.py rebuilt), same 300 tables seed 21
  average points : 46.09   (max 100 per table)   [start of night 32.22; after behind_k + push_steal 37.68; Plan B itself 38.49]
  places         : 1st:77  2nd:65  3rd:31  4th:25  5th:27  6th:22  7th:24  8th:29
  errors         : 0   timeouts: 0
