# Flake list

**The nightly phone run failed on 2026-11-28: https://github.com/cubic1M/Jane/actions/runs/46164214738. CI on main doesn't run the phone project, so nothing else will catch this. The debugger owns it.**

Updated 2026-11-28T16:49Z after each CI run, for the runs since 2026-11-14. A first-try failure is one a Playwright retry or a job re-run may have hidden.

- Main runs clean on the first try: 114 of 392 (29%)
- Main, last 3 days: 23 of 83 (28%)
- PR runs clean on the first try: 607 of 868 (70%)
- Nightly phone runs clean on the first try: 5 of 14 (36%)
- First-try failures a retry or re-run hid: 642

## Tests

| Test | Last 3 days | Passed later | Failed every try | On main | Last |
| --- | --- | --- | --- | --- | --- |
| [chromium] e2e/chat.spec.ts › the demo bank lands in Jane's chat, and Yes answers a finding @critical | 34 | 34 | 2 | 0 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46158006874) |
| [chromium] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 25 | 40 | 3 | 43 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46163420828) |
| [chromium] e2e/insurance-chosen-stays.spec.ts › the chosen insurance stays on the quotes page after it reloads | 24 | 65 | 1 | 59 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46139176914) |
| [chromium] e2e/demo-bank.spec.ts › a demo bank fills the report with fake data, labelled as fake, and can be removed @critical | 23 | 57 | 1 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46158006874) |
| src/lib/connectors/pinwheel/pinwheel.integration.test.ts › Pinwheel's pay stubs, sandbox finds the health plan on a sample person's pay stub, for them to confirm, once | 12 | 0 | 12 | 3 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45977655559) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › after a Yes, no page shows the old numbers; before it, the page comes from memory | 9 | 34 | 0 | 27 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46133656865) |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank @critical | 8 | 44 | 1 | 20 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46117763462) |
| src/lib/jane-agent/figure-ledger.integration.test.ts › the figure ledger on real tool results passes Jane's rule replies, which come from the same numbers | 6 | 5 | 7 | 1 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/46014187095) |
| [chromium] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 5 | 6 | 5 | 10 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46160213203) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 5 | 9 | 0 | 4 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46132544440) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 4 | 19 | 1 | 17 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46125202485) |
| [mobile] e2e/card-links-stay-phone.spec.ts › on a phone, following a card's page keeps the card, and Yes still works | 4 | 0 | 5 | 5 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46164214738) |
| [chromium] e2e/net-worth-chart.spec.ts › the axis fits what is on screen: ranges, zoom buttons, keys and the wheel all refit it, and there are no break marks | 4 | 0 | 4 | 4 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46117763462) |
| src/app/monochrome.test.ts › monochrome keeps colour-named classes from spreading to new code | 4 | 0 | 26 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46105853660) |
| src/lib/no-utc-today.test.ts › today is UTC's in the kept files only as often as listed | 4 | 0 | 4 | 1 | [2026-11-26](https://github.com/cubic1M/Jane/actions/runs/45903976969) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › a Yes in another tab reaches this one | 3 | 15 | 0 | 11 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46139393091) |
| [chromium] e2e/insurance.spec.ts › a policy document is read for the person to check and confirm (step 151) | 3 | 7 | 0 | 6 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46131110079) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 3 | 5 | 0 | 2 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45966201608) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people renter | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people family | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people freelancer | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people equity | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people preretire | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people retiree | 3 | 0 | 3 | 3 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| [chromium] e2e/first-scan-card.spec.ts › the first scan's yes/no card shows as the scan ends, without a reload | 2 | 7 | 0 | 7 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45920658884) |
| [chromium] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 2 | 6 | 0 | 6 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45999387046) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › refreshes quietly when the page is old | 2 | 4 | 0 | 4 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/46080232766) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › is there at once, with no bar and no trip to the server | 2 | 4 | 0 | 3 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45962073503) |
| [chromium] e2e/put-away-undo.spec.ts › a suggestion put away comes back from the line in its place, after a reload too | 2 | 3 | 0 | 3 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45941513026) |
| [chromium] e2e/chat-options.spec.ts › cheaper car insurance comes as comparison cards, and a pick starts the switch | 2 | 2 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46146621182) |
| src/lib/card-figures-on-page.integration.test.ts › a card's figure on the page it opens asks a lower rate on the phone and internet bills the report found, worked out on /bills | 2 | 3 | 0 | 0 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45943107580) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people owner | 2 | 0 | 2 | 2 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46111268857) |
| [chromium] e2e/taxes.spec.ts › tax tags: Jane's tags, its questions, and tagging a work expense | 1 | 27 | 0 | 27 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45925774633) |
| [chromium] e2e/two-factor-setup.spec.ts › turning on two-factor shows the backup codes once | 1 | 16 | 0 | 15 | [2026-11-25](https://github.com/cubic1M/Jane/actions/runs/45670316357) |
| [chromium] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 1 | 12 | 2 | 13 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45943064680) |
| [chromium] e2e/tax-set-aside-cached.spec.ts › a correction reaches a Home kept in memory, and so does its undo | 1 | 8 | 0 | 8 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45999387046) |
| [chromium] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 1 | 8 | 0 | 8 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/45984428023) |
| [chromium] e2e/home-fixes.spec.ts › Home: hide the checklist at once, trees start at their branches, no greeting | 1 | 8 | 0 | 6 | [2026-11-26](https://github.com/cubic1M/Jane/actions/runs/45810025512) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 1 | 5 | 0 | 4 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46135365908) |
| [mobile] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 1 | 3 | 0 | 3 | [2026-11-25](https://github.com/cubic1M/Jane/actions/runs/45670928417) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › another tab signing out empties this one too | 1 | 4 | 0 | 1 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/46035986810) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank refused_always | 1 | 3 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46133656865) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank blocked_always | 1 | 3 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46133656865) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank empty_always | 1 | 3 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46133656865) |
| [chromium] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 1 | 2 | 0 | 2 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46106911218) |
| [mobile] e2e/phone-tree-tabs.spec.ts › an area page's tree and tabs fit a phone from the start | 1 | 1 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46164214738) |
| [mobile] e2e/transactions-more.spec.ts › Transactions can be read all the way back, 100 at a time | 1 | 1 | 0 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46164214738) |
| src/tax-bench/properties.test.ts › the pieces, for any income taxes ordinary income plus gains no less as the ordinary part rises | 1 | 1 | 0 | 1 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/46057669406) |
| [mobile] e2e/tax-set-aside.spec.ts › it comes up unasked: the card has the figure and how sure Jane is | 1 | 0 | 1 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46164214738) |
| src/config/tax-params/shim-readers.test.ts › readers of the frozen 2026 shims in tax-rates.ts are exactly the known list, which only gets shorter | 1 | 0 | 1 | 1 | [2026-11-28](https://github.com/cubic1M/Jane/actions/runs/46135421990) |
| src/tax-bench/properties.test.ts › the estimate, for any person owes no less before refundable credits as wages rise (nothing else changing) | 1 | 1 | 0 | 0 | [2026-11-27](https://github.com/cubic1M/Jane/actions/runs/46066330033) |
| src/test-setup/sync-snapshots.integration.test.ts › demo-sync snapshots a copy holds what was copied (family) | 1 | 1 | 0 | 0 | [2026-11-26](https://github.com/cubic1M/Jane/actions/runs/45912942157) |
| [chromium] e2e/try.spec.ts › 'Try it with sample data' opens Jane's chat with a sample person @critical | 1 | 1 | 0 | 0 | [2026-11-26](https://github.com/cubic1M/Jane/actions/runs/45842582023) |
| [chromium] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 0 | 53 | 0 | 52 | [2026-11-23](https://github.com/cubic1M/Jane/actions/runs/45265264303) |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 0 | 37 | 5 | 41 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44730152335) |
| [mobile] e2e/phone-small-controls.spec.ts › the rest of the phone pass's small controls are 44 px, and the strip answers a near tap | 0 | 28 | 1 | 1 | [2026-11-24](https://github.com/cubic1M/Jane/actions/runs/45329081591) |
| [chromium] e2e/instant-pages.spec.ts › the first scan's page starts no preloads | 0 | 9 | 0 | 9 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44648455395) |
| [chromium] e2e/investments.spec.ts › the demo bank's holdings show with their sources, and Jane answers about them | 0 | 2 | 0 | 2 | [2026-11-24](https://github.com/cubic1M/Jane/actions/runs/45326724307) |
| [mobile] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 0 | 2 | 0 | 2 | [2026-11-23](https://github.com/cubic1M/Jane/actions/runs/45247883914) |
| [mobile] e2e/strip-click-keeps-card.spec.ts › a click on a strip marker keeps its card open, and a second click closes it | 0 | 2 | 0 | 2 | [2026-11-23](https://github.com/cubic1M/Jane/actions/runs/45247883914) |
| src/sweep/same-twice.integration.test.ts › one person made twice from the same data shows each the same thing in the same order | 0 | 3 | 3 | 1 | [2026-11-22](https://github.com/cubic1M/Jane/actions/runs/44976786521) |
| [chromium] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 0 | 2 | 0 | 2 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44716894903) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (admin) | 0 | 2 | 0 | 2 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44076565089) |
| [chromium] e2e/instant-pages.spec.ts › the pages loaded ahead of time › leave what only opening a page does, until the page is opened | 0 | 2 | 0 | 1 | [2026-11-24](https://github.com/cubic1M/Jane/actions/runs/45335411943) |
| src/lib/invariants/nightly.integration.test.ts › the nightly invariants counts a card payment with no other side, once it's had time to post | 0 | 2 | 3 | 1 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44000445795) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 0 | 1 | 1 | 2 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43677356591) |
| [mobile] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank @critical | 0 | 1 | 0 | 1 | [2026-11-24](https://github.com/cubic1M/Jane/actions/runs/45465089336) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › another tab signing out empties this one too | 0 | 1 | 0 | 1 | [2026-11-23](https://github.com/cubic1M/Jane/actions/runs/45247883914) |
| [mobile] e2e/insurance.spec.ts › a policy document is read for the person to check and confirm (step 151) | 0 | 1 | 0 | 1 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44919216710) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (user) | 0 | 1 | 0 | 1 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44903530968) |
| [chromium] e2e/insurance.spec.ts › a policy found in the payments is confirmed from its gap | 0 | 0 | 2 | 2 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44676626629) |
| [chromium] e2e/strip-click-keeps-card.spec.ts › a click on a strip marker keeps its card open, and a second click closes it | 0 | 1 | 0 | 1 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44663091636) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 0 | 1 | 0 | 1 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44542768159) |
| [mobile] e2e/phone-import-chip.spec.ts › after an upload the notice covers nothing on a phone, and a finding's link out is a tap | 0 | 2 | 0 | 0 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44299920093) |
| [chromium] e2e/ledger.spec.ts › a sample person's ledger: Held wins with their lines, estimates apart | 0 | 0 | 2 | 2 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44028423238) |
| [chromium] e2e/home-fixes.spec.ts › an opened card keeps the next ones open, until one is shut | 0 | 1 | 0 | 1 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44014809294) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account refused_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account blocked_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account empty_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/tools-person-day.integration.test.ts › Claude's tools in the person's own day say the same on Dec 31, 3pm and 7pm for preretire | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43680314739) |
| [chromium] e2e/ask-line-landing.spec.ts › Ask Jane always draws its line, and asked again finds the earlier answer | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43669864121) |
| src/lib/agent/concierge-safety.integration.test.ts › the agent, when what it hears isn't what it seems acts only on a reply from the company Jane wrote to, and reads nothing else | 0 | 1 | 0 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43653449301) |
| src/lib/agent/auto-answer.integration.test.ts › the agent answering for itself, against a real database never answers when the email asks for a secret, however Claude worded the question | 0 | 1 | 0 | 0 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44761783155) |
| src/lib/jane-agent/figure-ledger.integration.test.ts › the figure ledger on real tool results every month's total is that month's, and no other's | 0 | 1 | 0 | 0 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44258589581) |
| src/data-sources/csv/control-totals.property.test.ts › a running balance warns when any row in the middle is taken out | 0 | 0 | 1 | 1 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44009984849) |
| src/config/areas.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/action-args.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/bnpl.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/consolidation-qa.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit-goals.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debt-plan.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debt-trouble.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debts.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/family-credit.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/fit.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/found-policies.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/long-view.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/money-for-two.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/month-close.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/one-number-spending.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/one-number.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/phantom-renewals.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/price-rises.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/refinance-fit.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/tax-set-aside.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/agent/switch.integration.test.ts › switching to the best option, on the demo bank confirms a savings switch when the money is seen leaving, and counts what it earns | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/life.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/quotes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/risks.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/money-movement/bill-pay.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/money-movement/money-movement.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/agent.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/attention.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/chat-blocked.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/chat-local-day.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/data-ended.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/draft-return.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/fresh-chat.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/health-taxes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/multi-year.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/multi.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/news-tools.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/page-tools.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/refusal-fallback.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/retirement-taxes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/search.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/settings-tools.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/short-history.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/still-true-use-all.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-calendar.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-notice.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/taxes-qa-filing.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/practice/themes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/actions/rent.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/baseline.cli.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/checks.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/cli.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/eval.cli.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/facts-earlier-months.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/grade.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/grader.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/history.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/real-path.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/flows/flows.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/insurance/follow-up-after-card.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/investments/from-your-upload.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/app/api/chat/send/route.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/detectors/detectors.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/detectors/tax-reach.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/card-interest.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/costly-borrowing.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit-report-fixes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debt-autopilot.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debt-review.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/goal-tradeoffs.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/ledger.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/life-guesses.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/loans-real-accounts.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/medical-bills.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/one-number-owed.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/plan-upkeep.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/promises-for-real-accounts.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/evidence/orphans.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/hub/area-status.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/investments/investments.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/claims.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/cover-changes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/every-kind.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/readings.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/memory/memory.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/accountant.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/ai-written.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/aup-real-accounts.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/blocks.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/card-only.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/claude-privacy.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/claude.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/disasters.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/figure-ledger-payday.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/giving.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/leads-with-suggestions.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/practice-claude.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/prior-return.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/read-only-area-words.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/remember.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/right-button.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-estimate.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-filing.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-flow.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-identity.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-investments.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-january.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-self-employed.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/taxes-qa-chat.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tool-select.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tools-192.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/typing.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/understanding.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/actions/options.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/actions/tap-at-once.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/capabilities/registry.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/real-path.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/flows/flows.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/insurance/insurance.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/investments/retirement-words.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/bnpl-real-account.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/borrowing-power.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/car-loan.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/car.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/changes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit-building.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit-monthly.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/family-loans.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/health-score.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/home-buying.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/lean-plan.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/loan-applications.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/loans-small-amounts.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/renting.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/savings-proof.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/sector-autopilot.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/strategist.integration.test.ts › Claude as strategist keeps an idea resting on real suggestions, with the weakest part's confidence, and drops the rest | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/strategist.integration.test.ts › Claude as strategist joins the ranking: offered with its parts' buttons, and its parts aren't offered beside it | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/strategist.integration.test.ts › Claude as strategist shows no advice topics to real accounts, and stops at the day's cost cap | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/student-loans.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/tight-money.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/timeline.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/what-if.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/investments/sample-people.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/benefits.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/savings.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/shop.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/backtest-tool.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/card-chat-mismatch.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/chat-refusals.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/chat-said-once.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/family-taxes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/figure-ledger.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/home-taxes.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/inheritance.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/injection.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/interrupt.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/practice-tools.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/primer-store.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/property-tax.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/settings-tools-local-day.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/still-true.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/style.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-plan.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/tax-states.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/plaid/demo-people.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/bank.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/nightly.cli.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/proof.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/checks/scenarios.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/detectors/reach.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/balance-transfers.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/books.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/controller.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/credit-cards.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/debt-decisions.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/figures.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/fit-pick.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/home-equity.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/monthly-report.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/mortgage-money.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/mortgage.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/reach.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/refinance.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/sample-wins.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/steady-pay.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/student-long-game.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/untrusted-text.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/unusual.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/autopilot.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/card-cover.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/checkups.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/done-by-jane.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/family.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/qa.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/insurance/switch.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/ai-written.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/audit-records.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| src/lib/jane-agent/business-structure.integration.test.ts | 0 | 0 | 1 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43846293454) |
| [chromium] e2e/demo-chat.spec.ts › after an upload the side chat catches up, and the chip keeps out of the way | 0 | 1 | 0 | 0 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43796632431) |
| [chromium] e2e/try-feedback.spec.ts › a real upload moves the counts, and what's said outlives the try | 0 | 0 | 1 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43754397125) |
| src/lib/offers/catalog.integration.test.ts › the offers catalog quarantines a reading that jumps or can't be true, tells the founders once, and stops showing it | 0 | 0 | 1 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43704378277) |
| [mobile] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 0 | 1 | 0 | 0 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43665400120) |
| src/lib/agent/answer-numbers.integration.test.ts › numbers in a person's answer to a company still won't pass on a long number, a phone number or a card number | 0 | 1 | 0 | 0 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43663366322) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key stops asking Claude once the person's day has cost its cap, and the rules answer | 0 | 0 | 1 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43617846379) |

## Jobs that failed on the first try

| Job | Main | PRs |
| --- | --- | --- |
| Unit tests (4/4) | 8 | 45 |
| Unit tests (2/4) | 11 | 38 |
| Unit tests (3/4) | 5 | 30 |
| End-to-end tests (1/1) | 0 | 24 |
| Unit tests (1/4) | 3 | 20 |
| End-to-end tests (3/3) | 19 | 1 |
| End-to-end tests (2/3) | 18 | 0 |
| End-to-end tests (1/3) | 6 | 0 |
| Lint, format and typecheck | 1 | 5 |
| End-to-end build | 1 | 4 |
| Phone (1/3) | 5 | 0 |
| Gates | 0 | 3 |
| Access proof | 1 | 1 |
| Secret scan | 0 | 1 |
| Dependency audit | 1 | 0 |
| Unit tests (1/1) | 0 | 1 |
| Phone (3/3) | 1 | 0 |
