# The loop

Updated 2026-11-21T13:12Z by .github/workflows/ci-finished.yml. Wakes are **dry: recorded, not sent**. See docs/agent-loop.md.

| # | Number | Now |
| --- | --- | --- |
| 1 | Deploy lag: age of the newest green commit not live | 0 minutes |
| 2 | Red main, minutes today (UTC) | 0 |
| 8 | Tasks with no event for 120 minutes | 1 ([#2099](https://github.com/cubic1M/Jane/pull/2099)) |

Main: green. Out of tries, for a person: [#977](https://github.com/cubic1M/Jane/pull/977), [#2098](https://github.com/cubic1M/Jane/pull/2098), [#2099](https://github.com/cubic1M/Jane/pull/2099).

## Red main by day

- 2026-11-20: 213 minutes
- 2026-11-19: 79 minutes

## Claims

None.

## Waiting on a PR

- lane:connectors for claude/connect-flow: #2112 merged, woken 2026-11-19T07:03Z (waited-merged, dry), until 2026-11-22T06:50Z
- lane:debug-3 for d3/inv-6: #2120 merged, woken 2026-11-19T09:51Z (waited-merged, dry), until 2026-11-22T09:37Z
- lane:debug-3 for d3/payday-today: #2200 merged, woken 2026-11-20T23:39Z (waited-merged, dry), until 2026-11-23T23:15Z

## Latest wakes

| When | Reason | Lane | PR | Commit | Sent |
| --- | --- | --- | --- | --- | --- |
| 2026-11-21T09:23Z | red | lane:general | #2208 | 566adde6 | dry |
| 2026-11-20T23:39Z | waited-merged | lane:debug-3 | #2200 | b0a7d5e9 | dry |
| 2026-11-20T14:36Z | red | lane:general | #2179 | ac39dc32 | dry |
| 2026-11-20T12:03Z | red-main | lane:debugger | main | 2049e717 | dry |
| 2026-11-20T11:26Z | red-main | lane:debugger | main | 2049e717 | dry |
| 2026-11-20T10:54Z | red-main | lane:debugger | main | de83994a | dry |
| 2026-11-20T05:21Z | red-main | lane:debugger | main | 82cd6983 | dry |
| 2026-11-20T05:17Z | red-main | lane:debugger | main | 5ee1609f | dry |
| 2026-11-20T04:40Z | red-main | lane:debugger | main | 5ee1609f | dry |
| 2026-11-20T00:38Z | red-main | lane:debugger | main | 9faef455 | dry |
| 2026-11-19T22:41Z | red-main | lane:debugger | main | 9faef455 | dry |
| 2026-11-19T18:11Z | red | lane:general | #2152 | c4741765 | dry |
| 2026-11-19T17:37Z | red | lane:general | #2151 | a72efa82 | dry |
| 2026-11-19T15:56Z | red | lane:general | #977 | f6ba33a5 | dry |
| 2026-11-19T12:58Z | red | lane:general | #977 | f6ba33a5 | dry |
| 2026-11-19T09:51Z | waited-merged | lane:debug-3 | #2120 | a71f2b19 | dry |
| 2026-11-19T07:49Z | silent | lane:general | #2099 | d7e49acf | dry |
| 2026-11-19T07:07Z | silent | lane:general | #2099 | d7e49acf | dry |
| 2026-11-19T07:03Z | waited-merged | lane:connectors | #2112 | 65e072c3 | dry |
| 2026-11-19T06:34Z | silent | lane:general | #2099 | d7e49acf | dry |
| 2026-11-19T04:53Z | red | lane:general | #2098 | 7c66b533 | dry |
| 2026-11-19T04:18Z | red | lane:general | #2098 | 7c66b533 | dry |
| 2026-11-19T03:55Z | red | lane:general | #2096 | 62468489 | dry |
| 2026-11-18T16:46Z | conflict | lane:general | #977 | f6ba33a5 | dry |
| 2026-11-18T11:56Z | conflict | lane:general | #2069 | ea673f18 | dry |
| 2026-11-18T11:24Z | red | lane:general | #2069 | 26e614d7 | dry |
| 2026-11-18T09:56Z | red-main | lane:debugger | main | 27b9d395 | dry |
| 2026-11-18T09:34Z | conflict | lane:general | #2059 | 85f80b79 | dry |
| 2026-11-18T08:56Z | waited-merged | lane:suggest | #2057 | 27b9d395 | dry |
| 2026-11-18T08:56Z | conflict | lane:general | #2059 | b63df7c7 | dry |
