# Jane runs the money: detector inventory (Phase AP, steps 238–244)

How each Phase AP capability finds its person unasked. Detectors are in
`src/detectors/controller.ts`; thresholds in each step's own config file. Conventions are those of
`docs/detectors/debt.md`. People: R Maya, F the Reyes family, L Sam, H Priya, C Dan and Lena,
T Ruth, D Chris, B Jo.

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Books that balance** (`books`, step 238) | An open problem from the daily books check (`extras.books`): a balance off from its transactions, transactions that stopped, a stale link, a link that needs a sign-in, the same account linked twice. A transfer with no other side is only said, never a problem | The balances of the accounts the problem touches (the figures at stake), as risk | Seen: more months of data and more problems raise it | now for a link that needs a sign-in, else soon | F (joint savings linked twice, through each parent's login) | everyone else | `books:data_problems` |
