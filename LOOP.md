# The loop

Updated 2026-11-07T14:22Z by .github/workflows/ci-finished.yml. Wakes are **dry: recorded, not sent**. See docs/agent-loop.md.

| # | Number | Now |
| --- | --- | --- |
| 1 | Deploy lag: age of the newest green commit not live | 0 minutes |
| 2 | Red main, minutes today (UTC) | 25 |
| 8 | Tasks with no event for 120 minutes | 0 (none) |

Main: green. Out of tries, for a person: [#977](https://github.com/cubic1M/Jane/pull/977), [#1592](https://github.com/cubic1M/Jane/pull/1592), [#1596](https://github.com/cubic1M/Jane/pull/1596).

## Red main by day

- 2026-11-07: 25 minutes
- 2026-11-06: 68 minutes

## Claims

None.

## Waiting on a PR

- lane:connectors for claude/federal-refi-idr: #1551 merged, woken 2026-11-06T18:26Z (waited-merged, dry), until 2026-11-09T18:02Z
- lane:connectors for claude/card-transfer-maths: #1552 merged, woken 2026-11-06T18:31Z (waited-merged, dry), until 2026-11-09T18:06Z
- lane:connectors for claude/federal-autopay-card: #1556 merged, woken 2026-11-06T22:28Z (waited-merged, dry), until 2026-11-09T21:02Z
- lane:connectors for claude/direct-pay-steps: #1563 merged, woken 2026-11-06T22:01Z (waited-merged, dry), until 2026-11-09T21:45Z
- lane:connectors for claude/tax-config-obbba: #1564 merged, woken 2026-11-06T22:10Z (waited-merged, dry), until 2026-11-09T21:51Z
- lane:connectors for claude/eftps-move: #1568 merged, woken 2026-11-06T23:26Z (waited-merged, dry), until 2026-11-09T22:15Z
- lane:connectors for claude/save-ending-card: #1570 merged, woken 2026-11-06T22:47Z (waited-merged, dry), until 2026-11-09T22:21Z
- lane:connectors for claude/irs-card-fee: #1571 merged, woken 2026-11-06T22:49Z (waited-merged, dry), until 2026-11-09T22:32Z
- lane:connectors for claude/irs-transcript: #1574 merged, woken 2026-11-06T23:10Z (waited-merged, dry), until 2026-11-09T22:51Z
- lane:connectors for claude/transcript-partner: #1576 merged, woken 2026-11-06T23:28Z (waited-merged, dry), until 2026-11-09T23:13Z
- lane:connectors for claude/tax-form-upload: #1578 merged, woken 2026-11-06T23:53Z (waited-merged, dry), until 2026-11-09T23:31Z
- lane:connectors for claude/paystub-deductions: #1579 merged, woken 2026-11-07T00:13Z (waited-merged, dry), until 2026-11-09T23:56Z
- lane:connectors for claude/rollover-clock: #1584 merged, woken 2026-11-07T00:53Z (waited-merged, dry), until 2026-11-10T00:16Z
- lane:connectors for claude/savers-credit: #1589 merged, woken 2026-11-07T01:16Z (waited-merged, dry), until 2026-11-10T00:52Z
- lane:connectors for claude/savers-match: #1591 merged, woken 2026-11-07T01:37Z (waited-merged, dry), until 2026-11-10T01:18Z
- lane:connectors for claude/budget-billing: #1594 merged, woken 2026-11-07T02:52Z (waited-merged, dry), until 2026-11-10T01:43Z
- lane:connectors for claude/care-hint: #1597 merged, woken 2026-11-07T02:52Z (waited-merged, dry), until 2026-11-10T02:33Z
- lane:connectors for claude/lifeline-internet: #1598 merged, woken 2026-11-07T03:25Z (waited-merged, dry), until 2026-11-10T03:00Z
- lane:connectors for claude/stripe-fc: #1599 merged, woken 2026-11-07T03:48Z (waited-merged, dry), until 2026-11-10T03:29Z
- lane:connectors for claude/link-events: #1600 merged, woken 2026-11-07T04:14Z (waited-merged, dry), until 2026-11-10T03:55Z
- lane:connectors for claude/stripe-fc-events: #1601 merged, woken 2026-11-07T04:42Z (waited-merged, dry), until 2026-11-10T04:17Z
- lane:connectors for claude/user-sends-email: #1602 merged, woken 2026-11-07T05:05Z (waited-merged, dry), until 2026-11-10T04:46Z
- lane:connectors for claude/voice-gate: #1603 merged, woken 2026-11-07T05:34Z (waited-merged, dry), until 2026-11-10T05:09Z

## Latest wakes

| When | Reason | Lane | PR | Commit | Sent |
| --- | --- | --- | --- | --- | --- |
| 2026-11-07T05:34Z | waited-merged | lane:connectors | #1603 | 4f385887 | dry |
| 2026-11-07T05:34Z | silent | lane:debugger | #1592 | efde7c60 | dry |
| 2026-11-07T05:05Z | waited-merged | lane:connectors | #1602 | ecb5468b | dry |
| 2026-11-07T04:42Z | waited-merged | lane:connectors | #1601 | 81712a1b | dry |
| 2026-11-07T04:42Z | silent | lane:debugger | #1592 | efde7c60 | dry |
| 2026-11-07T04:14Z | waited-merged | lane:connectors | #1600 | 5a0cf094 | dry |
| 2026-11-07T03:48Z | waited-merged | lane:connectors | #1599 | fea7686b | dry |
| 2026-11-07T03:25Z | waited-merged | lane:connectors | #1598 | 803f86c3 | dry |
| 2026-11-07T02:52Z | waited-merged | lane:connectors | #1594 | ea64c132 | dry |
| 2026-11-07T02:52Z | waited-merged | lane:connectors | #1597 | f6c693ff | dry |
| 2026-11-07T02:52Z | red | lane:debugger | #1596 | 7ee942ed | dry |
| 2026-11-07T02:17Z | red | lane:debugger | #1596 | 7ee942ed | dry |
| 2026-11-07T02:09Z | conflict | lane:debugger | #1592 | efde7c60 | dry |
| 2026-11-07T01:38Z | conflict | lane:debugger | #1592 | efde7c60 | dry |
| 2026-11-07T01:37Z | waited-merged | lane:connectors | #1591 | 56d613df | dry |
| 2026-11-07T01:16Z | waited-merged | lane:connectors | #1589 | 66dc9c26 | dry |
| 2026-11-07T00:53Z | waited-merged | lane:connectors | #1584 | 085d01c5 | dry |
| 2026-11-07T00:13Z | conflict | lane:debugger | #1580 | 2041284d | dry |
| 2026-11-07T00:13Z | waited-merged | lane:connectors | #1579 | 32188c0f | dry |
| 2026-11-06T23:53Z | waited-merged | lane:connectors | #1578 | 6f20678a | dry |
| 2026-11-06T23:28Z | waited-merged | lane:connectors | #1576 | d44664eb | dry |
| 2026-11-06T23:26Z | waited-merged | lane:connectors | #1568 | ed10133e | dry |
| 2026-11-06T23:10Z | waited-merged | lane:connectors | #1574 | 3b84c082 | dry |
| 2026-11-06T22:49Z | waited-merged | lane:connectors | #1571 | f17f744a | dry |
| 2026-11-06T22:47Z | waited-merged | lane:connectors | #1570 | 7175ab04 | dry |
| 2026-11-06T22:28Z | waited-merged | lane:connectors | #1556 | d2b3008c | dry |
| 2026-11-06T22:28Z | conflict | lane:general | #1568 | 88b038ed | dry |
| 2026-11-06T22:10Z | waited-merged | lane:connectors | #1564 | 32911201 | dry |
| 2026-11-06T22:01Z | waited-merged | lane:connectors | #1563 | c5063848 | dry |
| 2026-11-06T21:30Z | red | lane:general | #1556 | 0480528c | dry |
