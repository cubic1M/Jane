# Flake list

Updated 2026-11-21T13:12Z after each CI run, for the runs since 2026-11-07. A first-try failure is one a Playwright retry or a job re-run may have hidden.

- Main runs clean on the first try: 85 of 341 (25%)
- Main, last 3 days: 29 of 95 (31%)
- PR runs clean on the first try: 525 of 686 (77%)
- Nightly phone runs clean on the first try: 4 of 13 (31%)
- First-try failures a retry or re-run hid: 654

## Tests

| Test | Last 3 days | Passed later | Failed every try | On main | Last |
| --- | --- | --- | --- | --- | --- |
| [mobile] e2e/phone-small-controls.spec.ts › the rest of the phone pass's small controls are 44 px, and the strip answers a near tap | 18 | 23 | 1 | 1 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44890225876) |
| [chromium] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 17 | 71 | 0 | 68 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44891587729) |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 16 | 71 | 6 | 74 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44730152335) |
| [chromium] e2e/insurance-chosen-stays.spec.ts › the chosen insurance stays on the quotes page after it reloads | 16 | 31 | 0 | 30 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44891587729) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › after a Yes, no page shows the old numbers; before it, the page comes from memory | 11 | 25 | 0 | 24 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44868959872) |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank @critical | 11 | 11 | 0 | 4 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44885005179) |
| [chromium] e2e/taxes.spec.ts › tax tags: Jane's tags, its questions, and tagging a work expense | 7 | 33 | 0 | 33 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44905336993) |
| [chromium] e2e/demo-bank.spec.ts › a demo bank fills the report with fake data, labelled as fake, and can be removed @critical | 7 | 34 | 0 | 4 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44885005179) |
| [chromium] e2e/two-factor-setup.spec.ts › turning on two-factor shows the backup codes once | 6 | 17 | 0 | 16 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44819231771) |
| [chromium] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 4 | 14 | 2 | 16 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44882698839) |
| [chromium] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 4 | 6 | 0 | 6 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44712959177) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › a Yes in another tab reaches this one | 3 | 12 | 0 | 11 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44848205495) |
| [chromium] e2e/tax-set-aside-cached.spec.ts › a correction reaches a Home kept in memory, and so does its undo | 3 | 9 | 0 | 8 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44754411956) |
| [chromium] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 2 | 13 | 2 | 14 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44575398391) |
| [chromium] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 2 | 13 | 1 | 12 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44495883422) |
| [chromium] e2e/first-scan-card.spec.ts › the first scan's yes/no card shows as the scan ends, without a reload | 2 | 10 | 0 | 10 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44351165564) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 2 | 5 | 0 | 4 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44835409723) |
| [chromium] e2e/insurance.spec.ts › a policy document is read for the person to check and confirm (step 151) | 2 | 4 | 0 | 4 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44436320786) |
| [mobile] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 2 | 3 | 0 | 3 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44771320367) |
| [chromium] e2e/insurance.spec.ts › a policy found in the payments is confirmed from its gap | 2 | 0 | 2 | 2 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44676626629) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 1 | 18 | 0 | 18 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44676626629) |
| [chromium] e2e/instant-pages.spec.ts › the first scan's page starts no preloads | 1 | 10 | 0 | 9 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44648455395) |
| [chromium] e2e/home-fixes.spec.ts › Home: hide the checklist at once, trees start at their branches, no greeting | 1 | 7 | 0 | 6 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44848205495) |
| [chromium] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 1 | 2 | 5 | 6 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44885005179) |
| [chromium] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 1 | 4 | 0 | 4 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44716894903) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 1 | 4 | 0 | 3 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44876846101) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › refreshes quietly when the page is old | 1 | 2 | 0 | 2 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44903530968) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (user) | 1 | 1 | 0 | 1 | [2026-11-21](https://github.com/cubic1M/Jane/actions/runs/44903530968) |
| [chromium] e2e/put-away-undo.spec.ts › a suggestion put away comes back from the line in its place, after a reload too | 1 | 1 | 0 | 1 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44676626629) |
| [chromium] e2e/strip-click-keeps-card.spec.ts › a click on a strip marker keeps its card open, and a second click closes it | 1 | 1 | 0 | 1 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44663091636) |
| [mobile] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 1 | 1 | 0 | 1 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44568478286) |
| [mobile] e2e/strip-click-keeps-card.spec.ts › a click on a strip marker keeps its card open, and a second click closes it | 1 | 1 | 0 | 1 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44568478286) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 1 | 1 | 0 | 1 | [2026-11-19](https://github.com/cubic1M/Jane/actions/runs/44542768159) |
| src/lib/agent/auto-answer.integration.test.ts › the agent answering for itself, against a real database never answers when the email asks for a secret, however Claude worded the question | 1 | 1 | 0 | 0 | [2026-11-20](https://github.com/cubic1M/Jane/actions/runs/44761783155) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 0 | 16 | 2 | 18 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43677356591) |
| [chromium] e2e/suggestion-popups.spec.ts › suggestions pop up small at the bottom of the hub and open in place | 0 | 17 | 4 | 16 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43527510087) |
| [chromium] e2e/debts.spec.ts › card interest shows the cost, a promotion off pace, and a request sent on the tap | 0 | 8 | 0 | 8 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43581357883) |
| [chromium] e2e/practice-ideas.spec.ts › an idea shows how sure Jane is, and a No changes what it brings | 0 | 9 | 0 | 7 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43569288037) |
| [chromium] e2e/debts.spec.ts › every debt shows with its source, and missing terms can be typed in | 0 | 7 | 0 | 6 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43562987984) |
| [chromium] e2e/try-feedback.spec.ts › a real upload moves the counts, and what's said outlives the try | 0 | 5 | 1 | 6 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43754397125) |
| [chromium] e2e/debts.spec.ts › student loan plans are compared, and every step links to studentaid.gov | 0 | 5 | 0 | 5 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43576699490) |
| [chromium] e2e/voice.spec.ts › no microphone or Read aloud where the browser can't do them | 0 | 5 | 0 | 5 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43558213383) |
| [chromium] e2e/theme-alert.spec.ts › a theme idea comes to the chat as a card to decide | 0 | 5 | 0 | 5 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43550662122) |
| [chromium] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 0 | 5 | 0 | 5 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43397797118) |
| [chromium] e2e/upload-with-linked.spec.ts › with a linked bank, an upload goes to a new account, never a linked one | 0 | 4 | 0 | 4 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43569288037) |
| [chromium] e2e/net-worth-chart.spec.ts › the net worth chart scrubs, changes range and returns to today | 0 | 4 | 0 | 4 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43507959513) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › another tab signing out empties this one too | 0 | 4 | 0 | 3 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43796632431) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees the sample policy, like-for-like quotes and Jane's pick (steps 102–104) | 0 | 4 | 0 | 3 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43531184901) |
| [chromium] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 0 | 3 | 0 | 3 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44020493534) |
| src/lib/invariants/nightly.integration.test.ts › the nightly invariants counts a card payment with no other side, once it's had time to post | 0 | 4 | 4 | 2 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44000445795) |
| src/lib/jane-agent/tools-person-day.integration.test.ts › Claude's tools in the person's own day say the same on Dec 31, 3pm and 7pm for preretire | 0 | 4 | 2 | 2 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43680314739) |
| [chromium] e2e/debts.spec.ts › buy now, pay later installments are listed from the plans' schedules | 0 | 3 | 0 | 3 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43335073269) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 0 | 3 | 0 | 3 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43292373396) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees their health plan's year and a dispute card (step 200) | 0 | 3 | 0 | 3 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43223277897) |
| [chromium] e2e/debts.spec.ts › card rewards count the fee, and a better card is applied for with one tap | 0 | 3 | 0 | 2 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43507959513) |
| [chromium] e2e/debts.spec.ts › the mortgage page shows PMI, the escrow change and extra principal | 0 | 3 | 0 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43303136730) |
| [chromium] e2e/investments.spec.ts › the demo bank's holdings show with their sources, and Jane answers about them | 0 | 2 | 0 | 2 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44302182549) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (admin) | 0 | 2 | 0 | 2 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44076565089) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person goes from a gap to a picked option, and it reaches the team (step 279) | 0 | 2 | 0 | 2 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43560674694) |
| [chromium] e2e/upload-history-balances.spec.ts › an older file added, then the newer removed: the older months stay as the file said | 0 | 0 | 4 | 4 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43369064599) |
| [chromium] e2e/debts.spec.ts › a 0% transfer counts its fee and is tracked once moved | 0 | 2 | 0 | 2 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43336262950) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database counts each Production Item, and the 11th is refused before any Plaid call | 0 | 2 | 3 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link can't take the Items kept for people the team invited | 0 | 2 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 0 | 2 | 0 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 0 | 2 | 0 | 2 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| src/app/monochrome.test.ts › monochrome keeps colour-named classes from spreading to new code | 0 | 0 | 22 | 3 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43829949073) |
| [chromium] e2e/demo-chat.spec.ts › after an upload the side chat catches up, and the chip keeps out of the way | 0 | 2 | 0 | 1 | [2026-11-16](https://github.com/cubic1M/Jane/actions/runs/43796632431) |
| src/lib/borrowing-power.integration.test.ts › what you could borrow against a real database says the 28/36 home and the mortgage together, in both answers and both tools | 0 | 2 | 1 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43605757321) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link leaves those for people the team invited, up to the limit | 0 | 1 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link can't get past it from two tabs at once | 0 | 1 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| [mobile] e2e/debts.spec.ts › a 0% transfer counts its fee and is tracked once moved | 0 | 2 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 0 | 2 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/phone-import-chip.spec.ts › after an upload the notice covers nothing on a phone, and a finding's link out is a tap | 0 | 2 | 0 | 0 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44299920093) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › is there at once, with no bar and no trip to the server | 0 | 1 | 0 | 1 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44253403766) |
| [chromium] e2e/instant-pages.spec.ts › the pages loaded ahead of time › leave what only opening a page does, until the page is opened | 0 | 1 | 0 | 1 | [2026-11-18](https://github.com/cubic1M/Jane/actions/runs/44212712791) |
| [chromium] e2e/ledger.spec.ts › a sample person's ledger: Held wins with their lines, estimates apart | 0 | 0 | 2 | 2 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44028423238) |
| [chromium] e2e/home-fixes.spec.ts › an opened card keeps the next ones open, until one is shut | 0 | 1 | 0 | 1 | [2026-11-17](https://github.com/cubic1M/Jane/actions/runs/44014809294) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank refused_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank blocked_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on the demo bank empty_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account refused_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account blocked_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| src/lib/jane-agent/checks/real-path.integration.test.ts › the path people are really answered on when Claude doesn't answer at first, on a real account empty_always | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43762679889) |
| [chromium] e2e/ask-line-landing.spec.ts › Ask Jane always draws its line, and asked again finds the earlier answer | 0 | 1 | 0 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43669864121) |
| [mobile] e2e/mobile-no-sideways.spec.ts › a phone uploads with long names: no sideways scroll, and the import goes through | 0 | 0 | 3 | 2 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43665400120) |
| src/lib/agent/concierge-safety.integration.test.ts › the agent, when what it hears isn't what it seems acts only on a reply from the company Jane wrote to, and reads nothing else | 0 | 1 | 0 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43653449301) |
| [chromium] e2e/debts.spec.ts › student loans show PSLF month by month, save dates as deadlines, and warn about refinancing | 0 | 1 | 0 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43581357883) |
| [chromium] e2e/security-headers.spec.ts › signed in › home, charts, the chat and its microphone work under the policy | 0 | 1 | 0 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43538047267) |
| [chromium] e2e/chat.spec.ts › the demo bank lands in Jane's chat, and Yes answers a finding @critical | 0 | 2 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43511804647) |
| [mobile] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 0 | 1 | 0 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43453233768) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database never passes the limit with many people at once | 0 | 0 | 2 | 2 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43404846656) |
| [mobile] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 0 | 1 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| [mobile] e2e/upload-with-linked.spec.ts › with a linked bank, an upload goes to a new account, never a linked one | 0 | 1 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person answers a question about how they live, and a yes opens a gap (step 197) | 0 | 1 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43226378189) |
| [mobile] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 0 | 2 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43203764098) |
| [chromium] e2e/chat-layout.spec.ts › the dock steps between suggestions from its header, details staying open | 0 | 1 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189772864) |
| [mobile] e2e/debts.spec.ts › the payoff plan picks an order for the demo bank and starts with one tap | 0 | 1 | 0 | 1 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| [mobile] e2e/security-headers.spec.ts › signed in › home, charts, the chat and its microphone work under the policy | 0 | 1 | 0 | 1 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| [mobile] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 0 | 1 | 0 | 1 | [2026-11-09](https://github.com/cubic1M/Jane/actions/runs/42666737167) |
| [mobile] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 0 | 1 | 0 | 1 | [2026-11-08](https://github.com/cubic1M/Jane/actions/runs/42489544607) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person sees their health plan's year and a dispute card (step 200) | 0 | 1 | 0 | 1 | [2026-11-08](https://github.com/cubic1M/Jane/actions/runs/42489544607) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 0 | 1 | 0 | 1 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42380303786) |
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
| src/lib/offers/catalog.integration.test.ts › the offers catalog quarantines a reading that jumps or can't be true, tells the founders once, and stops showing it | 0 | 0 | 1 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43704378277) |
| src/lib/jane-agent/figure-ledger.integration.test.ts › the figure ledger on real tool results passes Jane's rule replies, which come from the same numbers | 0 | 0 | 6 | 1 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43698275352) |
| [mobile] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 0 | 1 | 0 | 0 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43665400120) |
| src/lib/agent/answer-numbers.integration.test.ts › numbers in a person's answer to a company still won't pass on a long number, a phone number or a card number | 0 | 1 | 0 | 0 | [2026-11-15](https://github.com/cubic1M/Jane/actions/runs/43663366322) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key stops asking Claude once the person's day has cost its cap, and the rules answer | 0 | 0 | 1 | 1 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43617846379) |
| src/lib/agent/agent.integration.test.ts › the action agent against a real database hands a refusal to the team with the reason | 0 | 1 | 0 | 0 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43596273302) |
| src/data-sources/csv/control-totals.property.test.ts › a running balance says nothing of a statement that adds up, oldest or newest first | 0 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43511927121) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database keeps the slot when the Item is removed or the account deleted | 0 | 0 | 2 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database gives the slot back when Plaid refused the exchange, and only then | 0 | 0 | 2 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| src/lib/plaid/bank-link-states.integration.test.ts › a bank connection a key that can't encrypt fails before Plaid makes anything, and takes nothing of the count | 0 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key says plainly when the person's month of written answers is used up | 0 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43405126149) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database gives one person in two tabs one Item | 0 | 0 | 1 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43404846656) |
| [chromium] e2e/tab-switch.spec.ts › after a Yes on a card, the tabs come back fresh and open from memory | 0 | 1 | 1 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43370013158) |
| [chromium] e2e/tab-switch.spec.ts › after the first page, a chat message, and the tab coming back, every tab is in memory | 0 | 1 | 1 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43332071767) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database removes the Item when saving it fails, counts it, and lets the person try again | 0 | 0 | 1 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43204229162) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database lets one Item per person through, and a second falls back | 0 | 0 | 1 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43204229162) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database is rate-limited per person | 0 | 1 | 1 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43203204158) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 0 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [mobile] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 0 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [mobile] e2e/debts.spec.ts › student loan plans are compared, and every step links to studentaid.gov | 0 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [mobile] e2e/hero-tiles.spec.ts › saved so far opens on where the savings came from | 0 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/voice.spec.ts › no microphone or Read aloud where the browser can't do them | 0 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |

## Jobs that failed on the first try

| Job | Main | PRs |
| --- | --- | --- |
| Unit tests (4/4) | 9 | 41 |
| Unit tests (3/4) | 6 | 19 |
| Unit tests (2/4) | 3 | 16 |
| Unit tests (1/4) | 3 | 15 |
| End-to-end tests (2/3) | 15 | 1 |
| End-to-end tests (1/1) | 0 | 13 |
| End-to-end tests (3/3) | 10 | 1 |
| Lint, format and typecheck | 1 | 7 |
| End-to-end build | 1 | 6 |
| End-to-end tests (1/3) | 6 | 0 |
| Phone (2/3) | 3 | 0 |
| Access proof | 1 | 2 |
| Gates | 0 | 2 |
| Phone (1/3) | 1 | 0 |
| Phone (3/3) | 1 | 0 |
| Unit tests (1/2) | 0 | 1 |
| Secret scan | 0 | 1 |
| Dependency audit | 1 | 0 |
