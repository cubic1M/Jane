# Flake list

**The nightly phone run failed on 2026-11-14: https://github.com/cubic1M/Jane/actions/runs/43604137835. CI on main doesn't run the phone project, so nothing else will catch this. The debugger owns it.**

Updated 2026-11-14T14:33Z after each CI run, for the runs since 2026-10-31. A first-try failure is one a Playwright retry or a job re-run may have hidden.

- Main runs clean on the first try: 75 of 328 (23%)
- Main, last 3 days: 2 of 65 (3%)
- PR runs clean on the first try: 463 of 575 (81%)
- Nightly phone runs clean on the first try: 0 of 11 (0%)
- First-try failures a retry or re-run hid: 830

## Tests

| Test | Last 3 days | Passed later | Failed every try | On main | Last |
| --- | --- | --- | --- | --- | --- |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 31 | 54 | 1 | 53 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43597179363) |
| [chromium] e2e/suggestion-popups.spec.ts › suggestions pop up small at the bottom of the hub and open in place | 21 | 23 | 4 | 22 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43527510087) |
| [chromium] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 19 | 28 | 0 | 27 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43600067778) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 16 | 46 | 1 | 47 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43601551342) |
| [chromium] e2e/practice-ideas.spec.ts › an idea shows how sure Jane is, and a No changes what it brings | 9 | 19 | 0 | 17 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43569288037) |
| [chromium] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 8 | 49 | 3 | 50 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43597179363) |
| [chromium] e2e/debts.spec.ts › card interest shows the cost, a promotion off pace, and a request sent on the tap | 8 | 13 | 0 | 13 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43581357883) |
| [chromium] e2e/taxes.spec.ts › tax tags: Jane's tags, its questions, and tagging a work expense | 8 | 10 | 0 | 10 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43601551342) |
| [chromium] e2e/debts.spec.ts › every debt shows with its source, and missing terms can be typed in | 7 | 15 | 0 | 14 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43562987984) |
| [chromium] e2e/demo-bank.spec.ts › a demo bank fills the report with fake data, labelled as fake, and can be removed @critical | 7 | 13 | 0 | 6 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43584192420) |
| [chromium] e2e/debts.spec.ts › student loan plans are compared, and every step links to studentaid.gov | 5 | 12 | 0 | 12 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43576699490) |
| [chromium] e2e/voice.spec.ts › no microphone or Read aloud where the browser can't do them | 5 | 9 | 0 | 9 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43558213383) |
| [chromium] e2e/theme-alert.spec.ts › a theme idea comes to the chat as a card to decide | 5 | 8 | 0 | 8 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43550662122) |
| [chromium] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 5 | 8 | 0 | 8 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43397797118) |
| [chromium] e2e/first-scan-card.spec.ts › the first scan's yes/no card shows as the scan ends, without a reload | 5 | 5 | 0 | 5 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43594245309) |
| src/lib/jane-agent/tools-person-day.integration.test.ts › Claude's tools in the person's own day say the same on Dec 31, 3pm and 7pm for preretire | 5 | 3 | 2 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43527510087) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database counts each Production Item, and the 11th is refused before any Plaid call | 5 | 2 | 3 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| [chromium] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 4 | 19 | 1 | 20 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43594245309) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees the sample policy, like-for-like quotes and Jane's pick (steps 102–104) | 4 | 15 | 0 | 14 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43531184901) |
| [chromium] e2e/try-feedback.spec.ts › a real upload moves the counts, and what's said outlives the try | 4 | 10 | 6 | 15 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43558213383) |
| [chromium] e2e/upload-with-linked.spec.ts › with a linked bank, an upload goes to a new account, never a linked one | 4 | 9 | 0 | 9 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43569288037) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 4 | 5 | 0 | 5 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43596171956) |
| [chromium] e2e/two-factor-setup.spec.ts › turning on two-factor shows the backup codes once | 4 | 4 | 0 | 4 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43600067778) |
| [chromium] e2e/net-worth-chart.spec.ts › the net worth chart scrubs, changes range and returns to today | 4 | 4 | 0 | 4 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43507959513) |
| [chromium] e2e/upload-history-balances.spec.ts › an older file added, then the newer removed: the older months stay as the file said | 4 | 0 | 4 | 4 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43369064599) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link can't take the Items kept for people the team invited | 4 | 2 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| [chromium] e2e/debts.spec.ts › card rewards count the fee, and a better card is applied for with one tap | 3 | 14 | 0 | 13 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43507959513) |
| [chromium] e2e/debts.spec.ts › the mortgage page shows PMI, the escrow change and extra principal | 3 | 13 | 0 | 12 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43303136730) |
| [chromium] e2e/tax-set-aside-cached.spec.ts › a correction reaches a Home kept in memory, and so does its undo | 3 | 12 | 0 | 11 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43335073269) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 3 | 8 | 0 | 7 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43292373396) |
| [chromium] e2e/debts.spec.ts › buy now, pay later installments are listed from the plans' schedules | 3 | 7 | 0 | 7 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43335073269) |
| src/lib/invariants/nightly.integration.test.ts › the nightly invariants counts a card payment with no other side, once it's had time to post | 3 | 4 | 2 | 2 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43597179363) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › after a Yes, no page shows the old numbers; before it, the page comes from memory | 3 | 3 | 0 | 3 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43413984005) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link leaves those for people the team invited, up to the limit | 3 | 1 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database people who came in by a share link can't get past it from two tabs at once | 3 | 1 | 2 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43282313729) |
| [chromium] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 2 | 14 | 0 | 14 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43531184901) |
| [chromium] e2e/debts.spec.ts › a 0% transfer counts its fee and is tracked once moved | 2 | 13 | 0 | 12 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43336262950) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person goes from a gap to a picked option, and it reaches the team (step 279) | 2 | 7 | 0 | 7 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43560674694) |
| [chromium] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 2 | 7 | 0 | 6 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43505307227) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees their health plan's year and a dispute card (step 200) | 2 | 6 | 0 | 6 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43223277897) |
| [chromium] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 2 | 5 | 0 | 5 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43397074464) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › another tab signing out empties this one too | 2 | 4 | 0 | 4 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43600067778) |
| src/lib/borrowing-power.integration.test.ts › what you could borrow against a real database says the 28/36 home and the mortgage together, in both answers and both tools | 2 | 3 | 1 | 2 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43591253193) |
| [mobile] e2e/mobile-no-sideways.spec.ts › a phone uploads with long names: no sideways scroll, and the import goes through | 2 | 0 | 2 | 2 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43604137835) |
| [chromium] e2e/chat.spec.ts › the demo bank lands in Jane's chat, and Yes answers a finding @critical | 2 | 2 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43511804647) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database never passes the limit with many people at once | 2 | 0 | 2 | 2 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43404846656) |
| [mobile] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 2 | 2 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43203764098) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database is rate-limited per person | 2 | 2 | 1 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43203204158) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database keeps the slot when the Item is removed or the account deleted | 2 | 0 | 2 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database gives the slot back when Plaid refused the exchange, and only then | 2 | 0 | 2 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| [chromium] e2e/tab-switch.spec.ts › after a Yes on a card, the tabs come back fresh and open from memory | 2 | 1 | 1 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43370013158) |
| [chromium] e2e/tab-switch.spec.ts › after the first page, a chat message, and the tab coming back, every tab is in memory | 2 | 1 | 1 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43332071767) |
| [mobile] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 1 | 16 | 0 | 14 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [chromium] e2e/debts.spec.ts › student loans show PSLF month by month, save dates as deadlines, and warn about refinancing | 1 | 9 | 5 | 13 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43581357883) |
| [chromium] e2e/security-headers.spec.ts › signed in › home, charts, the chat and its microphone work under the policy | 1 | 11 | 0 | 11 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43538047267) |
| [chromium] e2e/home-fixes.spec.ts › Home: hide the checklist at once, trees start at their branches, no greeting | 1 | 11 | 0 | 10 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43203764098) |
| [chromium] e2e/investments.spec.ts › the demo bank's holdings show with their sources, and Jane answers about them | 1 | 8 | 0 | 8 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43510756694) |
| [chromium] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 1 | 7 | 1 | 8 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43377602559) |
| [chromium] e2e/demo-chat.spec.ts › after an upload the side chat catches up, and the chip keeps out of the way | 1 | 8 | 0 | 7 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43373308358) |
| [chromium] e2e/chat-layout.spec.ts › the dock steps between suggestions from its header, details staying open | 1 | 6 | 0 | 6 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189772864) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 1 | 5 | 0 | 5 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43292373396) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 1 | 5 | 0 | 5 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43292373396) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › a Yes in another tab reaches this one | 1 | 4 | 1 | 4 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43335073269) |
| [chromium] e2e/instant-pages.spec.ts › the first scan's page starts no preloads | 1 | 4 | 0 | 3 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person answers a question about how they live, and a yes opens a gap (step 197) | 1 | 3 | 0 | 3 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43226378189) |
| [mobile] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 1 | 4 | 0 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 1 | 2 | 0 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 1 | 2 | 0 | 2 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| [mobile] e2e/hero-tiles.spec.ts › saved so far opens on where the savings came from | 1 | 2 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/debts.spec.ts › a 0% transfer counts its fee and is tracked once moved | 1 | 2 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 1 | 1 | 0 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43453233768) |
| [mobile] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 1 | 1 | 0 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43453233768) |
| [mobile] e2e/upload-with-linked.spec.ts › with a linked bank, an upload goes to a new account, never a linked one | 1 | 1 | 0 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43254473468) |
| src/lib/agent/agent.integration.test.ts › the action agent against a real database hands a refusal to the team with the reason | 1 | 1 | 0 | 0 | [2026-11-14](https://github.com/cubic1M/Jane/actions/runs/43596273302) |
| src/data-sources/csv/control-totals.property.test.ts › a running balance says nothing of a statement that adds up, oldest or newest first | 1 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43511927121) |
| src/lib/plaid/bank-link-states.integration.test.ts › a bank connection a key that can't encrypt fails before Plaid makes anything, and takes nothing of the count | 1 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43409780504) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key says plainly when the person's month of written answers is used up | 1 | 1 | 0 | 0 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43405126149) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database gives one person in two tabs one Item | 1 | 0 | 1 | 1 | [2026-11-13](https://github.com/cubic1M/Jane/actions/runs/43404846656) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database removes the Item when saving it fails, counts it, and lets the person try again | 1 | 0 | 1 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43204229162) |
| src/lib/plaid/item-slots.integration.test.ts › Plaid's Trial plan Items against a real database lets one Item per person through, and a second falls back | 1 | 0 | 1 | 1 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43204229162) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 1 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [mobile] e2e/debts.spec.ts › student loan plans are compared, and every step links to studentaid.gov | 1 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43195625312) |
| [mobile] e2e/voice.spec.ts › no microphone or Read aloud where the browser can't do them | 1 | 1 | 0 | 0 | [2026-11-12](https://github.com/cubic1M/Jane/actions/runs/43189597594) |
| [mobile] e2e/activity.spec.ts › typing in a field records no value (user) | 0 | 10 | 0 | 8 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [chromium] e2e/side-chat.spec.ts › on a computer the chat docks beside the page, folds, expands and stays put | 0 | 9 | 0 | 9 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41619284794) |
| [chromium] e2e/voice.spec.ts › speak a question with the keyboard, send it, and hear the answer | 0 | 8 | 0 | 8 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42316933142) |
| [chromium] e2e/error-pages.spec.ts › a page that broke in the browser reaches /admin/errors, typed values gone | 0 | 6 | 5 | 10 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/upload.spec.ts › a file that plainly isn't the chosen account's gets one line saying so | 0 | 8 | 0 | 8 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [chromium] e2e/upload.spec.ts › the same file again says nothing was new, not "Saved 0 transactions" | 0 | 8 | 0 | 8 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [chromium] e2e/hero-tiles.spec.ts › saved so far opens on where the savings came from | 0 | 7 | 1 | 8 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42325095352) |
| [chromium] e2e/debts.spec.ts › the payoff plan picks an order for the demo bank and starts with one tap | 0 | 7 | 1 | 8 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42254309607) |
| [chromium] e2e/logo.spec.ts › Jane's logos are plain marks: no link, no button, a click does nothing | 0 | 7 | 0 | 7 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41533580743) |
| [chromium] e2e/close.spec.ts › a sample person's monthly close, from Home | 0 | 8 | 0 | 5 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41731527739) |
| [chromium] e2e/instant-pages.spec.ts › preloading during the first scan can't send the person back to /connect | 0 | 5 | 2 | 6 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42040330063) |
| [chromium] e2e/decisions.spec.ts › a real account › a no can be undone and puts the card back | 0 | 5 | 0 | 5 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41936902998) |
| [mobile] e2e/decisions.spec.ts › a real account › a no can be undone and puts the card back | 0 | 5 | 0 | 5 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41858806393) |
| [mobile] e2e/upload.spec.ts › a file that plainly isn't the chosen account's gets one line saying so | 0 | 6 | 0 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [mobile] e2e/who-am-i.spec.ts › a Try Jane family asks who they are and hears about the kids and the pet | 0 | 5 | 0 | 5 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (user) | 0 | 5 | 0 | 5 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41493931447) |
| [chromium] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 0 | 4 | 0 | 4 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41746382757) |
| [mobile] e2e/close.spec.ts › a sample person's monthly close, from Home | 0 | 4 | 1 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41632622042) |
| [mobile] e2e/upload.spec.ts › the same file again says nothing was new, not "Saved 0 transactions" | 0 | 5 | 0 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [chromium] e2e/demo-home.spec.ts › beside the docked chat, Home and /jane keep their words and marks in place | 0 | 4 | 0 | 4 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41466240453) |
| [chromium] e2e/upload.spec.ts › a CSV in an unknown layout gets a column picker instead of failing | 0 | 4 | 0 | 4 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41407663501) |
| src/lib/jane-agent/taxes-qa-real.integration.test.ts › tax recommendations and real accounts gives tax moves to demo people as advice and none to real accounts | 0 | 3 | 2 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41738038682) |
| [mobile] e2e/voice.spec.ts › speak a question with the keyboard, send it, and hear the answer | 0 | 3 | 0 | 3 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41528472598) |
| [chromium] e2e/who-am-i.spec.ts › a Try Jane family asks who they are and hears about the kids and the pet | 0 | 3 | 0 | 3 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [chromium] e2e/decisions.spec.ts › the demo bank › keeps the concierge flow: Yes queues the action for Jane | 0 | 3 | 0 | 3 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41493931447) |
| [chromium] e2e/steady-shell.spec.ts › the top bar holds still while pages load | 0 | 3 | 0 | 3 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41442473512) |
| [mobile] e2e/debts.spec.ts › the payoff plan picks an order for the demo bank and starts with one tap | 0 | 2 | 1 | 3 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| [chromium] e2e/report-a-problem.spec.ts › a person reports a problem from any page, and the founders read it | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/security-headers.spec.ts › signed in › the admin pages work under the policy | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/upload.spec.ts › the team sees the closed beta's numbers | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/founder-numbers.spec.ts › signed in › an admin sees the numbers, the line to copy and what was left out | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/mfa.spec.ts › an admin without a two-factor code is sent to set one up | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/access-log.spec.ts › admin page views land on the access log, which the team can filter | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/admin.spec.ts › signed in › an admin sees the learning loop, kind by kind | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/chat-limit.spec.ts › past the day's limit, Jane says so briefly and still answers from the data | 0 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 0 | 2 | 0 | 2 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › refreshes quietly when the page is old | 0 | 2 | 0 | 2 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/insurance.spec.ts › a renter adds their renters policy and the gap goes | 0 | 0 | 4 | 4 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41795692810) |
| [chromium] e2e/legal.spec.ts › the Privacy Policy says what is shared, kept, deleted, and which cookies | 0 | 0 | 5 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41693911627) |
| [mobile] e2e/rate-limits.spec.ts › a session past its server-action limit gets a plain-text 429 the page can show | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [mobile] e2e/error-pages.spec.ts › a page that broke in the browser reaches /admin/errors, typed values gone | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41447552693) |
| [mobile] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41442473512) |
| [mobile] e2e/upload.spec.ts › a CSV in an unknown layout gets a column picker instead of failing | 0 | 2 | 0 | 2 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41274716829) |
| src/data-sources/csv/control-totals.property.test.ts › a running balance warns when any row in the middle is taken out | 0 | 1 | 1 | 2 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41769404726) |
| src/lib/jane-agent/leads-with-suggestions.integration.test.ts › Jane leads with suggestions freelancer's first chat opens on their top suggestions, as cards | 0 | 3 | 2 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| [chromium] e2e/landing.spec.ts › health check responds | 0 | 0 | 3 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41738038682) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people freelancer | 0 | 0 | 4 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41715767512) |
| [mobile] e2e/security-headers.spec.ts › signed in › home, charts, the chat and its microphone work under the policy | 0 | 1 | 0 | 1 | [2026-11-10](https://github.com/cubic1M/Jane/actions/runs/42846708635) |
| [mobile] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 0 | 1 | 0 | 1 | [2026-11-09](https://github.com/cubic1M/Jane/actions/runs/42666737167) |
| [mobile] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 0 | 1 | 0 | 1 | [2026-11-08](https://github.com/cubic1M/Jane/actions/runs/42489544607) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person sees their health plan's year and a dispute card (step 200) | 0 | 1 | 0 | 1 | [2026-11-08](https://github.com/cubic1M/Jane/actions/runs/42489544607) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 0 | 1 | 0 | 1 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42380303786) |
| [mobile] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 0 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42240788365) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 0 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42240788365) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 0 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42184870217) |
| src/lib/jane-agent/figure-ledger.integration.test.ts › the figure ledger on real tool results passes Jane's rule replies, which come from the same numbers | 0 | 0 | 2 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42130045766) |
| [chromium] e2e/try.spec.ts › 'Try it with sample data' opens Jane's chat with a sample person @critical | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42085116284) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (admin) | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42065276553) |
| [mobile] e2e/debts.spec.ts › every debt shows with its source, and missing terms can be typed in | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [mobile] e2e/debts.spec.ts › buy now, pay later installments are listed from the plans' schedules | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [mobile] e2e/theme-alert.spec.ts › a theme idea comes to the chat as a card to decide | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| src/lib/mfa.integration.test.ts › two-factor against a real database takes an authenticator code once | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42019617453) |
| [chromium] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 0 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/41969900958) |
| [chromium] e2e/rate-limits.spec.ts › an API route answers 429 past its limit, calmly, and cron routes aren't limited | 0 | 1 | 0 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41716817168) |
| [chromium] e2e/dock-followed.spec.ts › a card followed to its page, or answered, doesn't come back | 0 | 1 | 0 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41654526340) |
| [chromium] e2e/unsubscribe.spec.ts › unsubscribe works without signing in @critical | 0 | 1 | 0 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [mobile] e2e/rate-limits.spec.ts › an API route answers 429 past its limit, calmly, and cron routes aren't limited | 0 | 1 | 0 | 1 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41407663501) |
| [mobile] e2e/transactions.spec.ts › a person fixes a category for a merchant | 0 | 1 | 0 | 1 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41374993867) |
| [chromium] e2e/transactions.spec.ts › a person fixes a category for a merchant | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41303439321) |
| [mobile] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41303439321) |
| [mobile] e2e/upload.spec.ts › a new person starts with uploading, and lands on the report | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41274716829) |
| [mobile] e2e/insurance.spec.ts › a policy document is read for the person to check and confirm (step 151) | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41230545279) |
| [chromium] e2e/upload-balance.spec.ts › a card without a balance is asked for, and net worth says it isn't counted until then | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41216258027) |
| [chromium] e2e/empty-states.spec.ts › an upload-only person's pages each say what's there or the next step | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41216258027) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key stops asking Claude once the person's day has cost its cap, and the rules answer | 0 | 0 | 1 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42179408239) |
| src/lib/agent/written-for-a-company.integration.test.ts › what a person writes, in an email Jane signs passes on a plain answer as one paragraph, and the account's own email | 0 | 0 | 1 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42148457216) |
| src/lib/rate-limit.integration.test.ts › rate limiting against a real database allows the limit within a window, then refuses until the next window | 0 | 1 | 1 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42059294939) |
| src/lib/rate-limit.integration.test.ts › rate limiting against a real database counts several limits in one round trip, refusing when any one is over | 0 | 1 | 0 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42059294939) |
| src/lib/jane-agent/checks/proof.integration.test.ts › proof on every person Sam: the right suggestions, led with, and a chat that agrees | 0 | 1 | 2 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/41975910921) |
| src/lib/suggestions.integration.test.ts › the nightly scan of suggestions freelancer gets their top suggestions from their written list | 0 | 0 | 2 | 1 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles answers when preretire could stop working with how long the money lasts | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles reads the retiree's Social Security from their deposits, and plans from today | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles says when there's nothing invested to rebalance, and the review agrees with the trades | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/jane-agent/first-brief-budget.integration.test.ts › the first brief's budget posts the brief without the upkeep, which the last run does | 0 | 0 | 3 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41623535679) |
| src/lib/strategist.integration.test.ts › Claude as strategist proposes nothing without a key | 0 | 1 | 0 | 0 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41620393836) |
| [chromium] e2e/money-goes.spec.ts › rows open to their transactions and the month chart shows and picks months | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [chromium] e2e/upload-numbers.spec.ts › an upload's numbers reach net worth, Home and the money page; a second file moves them | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/money-goes.spec.ts › rows open to their transactions and the month chart shows and picks months | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/upload-numbers.spec.ts › an upload's numbers reach net worth, Home and the money page; a second file moves them | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |

## Jobs that failed on the first try

| Job | Main | PRs |
| --- | --- | --- |
| Unit tests (4/4) | 5 | 35 |
| End-to-end tests (2/3) | 30 | 3 |
| Unit tests (3/4) | 8 | 25 |
| Unit tests (1/4) | 4 | 26 |
| Unit tests (2/4) | 8 | 16 |
| Lint, format and typecheck | 1 | 18 |
| End-to-end tests (3/3) | 17 | 2 |
| Gates | 0 | 13 |
| End-to-end tests (1/3) | 9 | 2 |
| End-to-end tests (1/1) | 0 | 7 |
| End-to-end build | 0 | 6 |
| Migration safety | 1 | 3 |
| Phone (2/3) | 3 | 0 |
| Access proof | 0 | 2 |
| Phone (1/3) | 1 | 0 |
| Phone (3/3) | 1 | 0 |
| Unit tests (1/2) | 0 | 1 |
