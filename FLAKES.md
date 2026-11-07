# Flake list

Updated 2026-11-07T14:23Z after each CI run, for the runs since 2026-10-24. A first-try failure is one a Playwright retry or a job re-run may have hidden.

- Main runs clean on the first try: 85 of 360 (24%)
- Main, last 3 days: 12 of 110 (11%)
- PR runs clean on the first try: 338 of 407 (83%)
- Nightly phone runs clean on the first try: 0 of 5 (0%)
- First-try failures a retry or re-run hid: 832

## Tests

| Test | Last 3 days | Passed later | Failed every try | On main | Last |
| --- | --- | --- | --- | --- | --- |
| [chromium] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 40 | 42 | 2 | 44 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42341228124) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person says yes to Jane's pick (step 104) | 31 | 31 | 0 | 31 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42343298757) |
| [chromium] e2e/hubs.spec.ts › the hubs gather every page, with live numbers from the demo bank | 24 | 24 | 0 | 24 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42343298757) |
| [chromium] e2e/try.spec.ts › five tries in a row each reach the chat in 8 seconds and a card in 25 | 16 | 15 | 1 | 16 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42331342266) |
| [chromium] e2e/debts.spec.ts › student loans show PSLF month by month, save dates as deadlines, and warn about refinancing | 13 | 8 | 5 | 12 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42314786743) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees the sample policy, like-for-like quotes and Jane's pick (steps 102–104) | 11 | 11 | 0 | 11 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42329423172) |
| [chromium] e2e/debts.spec.ts › card rewards count the fee, and a better card is applied for with one tap | 11 | 11 | 0 | 11 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42314786743) |
| [chromium] e2e/debts.spec.ts › a 0% transfer counts its fee and is tracked once moved | 11 | 11 | 0 | 10 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42343298757) |
| [chromium] e2e/practice-ideas.spec.ts › an idea shows how sure Jane is, and a No changes what it brings | 10 | 10 | 0 | 10 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42343298757) |
| [chromium] e2e/home-fixes.spec.ts › Home: hide the checklist at once, trees start at their branches, no greeting | 10 | 10 | 0 | 10 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42339622562) |
| [chromium] e2e/security-headers.spec.ts › signed in › home, charts, the chat and its microphone work under the policy | 10 | 10 | 0 | 10 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42331342266) |
| [chromium] e2e/debts.spec.ts › the mortgage page shows PMI, the escrow change and extra principal | 10 | 10 | 0 | 10 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42316933142) |
| [chromium] e2e/try-feedback.spec.ts › a real upload moves the counts, and what's said outlives the try | 10 | 6 | 6 | 11 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42341228124) |
| [chromium] e2e/tax-set-aside-cached.spec.ts › a correction reaches a Home kept in memory, and so does its undo | 9 | 9 | 0 | 9 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42310098325) |
| [chromium] e2e/debts.spec.ts › every debt shows with its source, and missing terms can be typed in | 8 | 8 | 0 | 8 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 7 | 16 | 1 | 17 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42316933142) |
| [chromium] e2e/debts.spec.ts › the payoff plan picks an order for the demo bank and starts with one tap | 7 | 7 | 1 | 8 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42254309607) |
| [chromium] e2e/investments.spec.ts › the demo bank's holdings show with their sources, and Jane answers about them | 7 | 7 | 0 | 7 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42314786743) |
| [chromium] e2e/debts.spec.ts › student loan plans are compared, and every step links to studentaid.gov | 7 | 7 | 0 | 7 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42305169865) |
| [chromium] e2e/instant-pages.spec.ts › preloading during the first scan can't send the person back to /connect | 7 | 5 | 2 | 6 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42040330063) |
| [chromium] e2e/voice.spec.ts › speak a question with the keyboard, send it, and hear the answer | 6 | 11 | 0 | 11 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42316933142) |
| [chromium] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 6 | 6 | 1 | 7 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42217820650) |
| [chromium] e2e/demo-bank.spec.ts › a demo bank fills the report with fake data, labelled as fake, and can be removed @critical | 6 | 6 | 0 | 2 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42331923449) |
| [chromium] e2e/error-pages.spec.ts › a page that broke in the browser reaches /admin/errors, typed values gone | 5 | 7 | 5 | 11 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/hero-tiles.spec.ts › saved so far opens on where the savings came from | 5 | 7 | 1 | 8 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42325095352) |
| [chromium] e2e/debts.spec.ts › card interest shows the cost, a promotion off pace, and a request sent on the tap | 5 | 5 | 0 | 5 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person goes from a gap to a picked option, and it reaches the team (step 279) | 5 | 5 | 0 | 5 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42252427345) |
| [chromium] e2e/upload-with-linked.spec.ts › with a linked bank, an upload goes to a new account, never a linked one | 5 | 5 | 0 | 5 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42197718187) |
| [chromium] e2e/instant-pages.spec.ts › the loading bar › shows when a page truly isn't ready | 5 | 5 | 0 | 4 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42327407412) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 5 | 5 | 0 | 4 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42271457562) |
| [chromium] e2e/report-a-problem.spec.ts › a person reports a problem from any page, and the founders read it | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/security-headers.spec.ts › signed in › the admin pages work under the policy | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/upload.spec.ts › the team sees the closed beta's numbers | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/founder-numbers.spec.ts › signed in › an admin sees the numbers, the line to copy and what was left out | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/mfa.spec.ts › an admin without a two-factor code is sent to set one up | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/access-log.spec.ts › admin page views land on the access log, which the team can filter | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/admin.spec.ts › signed in › an admin sees the learning loop, kind by kind | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/chat-limit.spec.ts › past the day's limit, Jane says so briefly and still answers from the data | 5 | 0 | 5 | 5 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42003045172) |
| [chromium] e2e/voice.spec.ts › no microphone or Read aloud where the browser can't do them | 4 | 4 | 0 | 4 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42339622562) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › someone else signing in, in another tab, empties this one | 4 | 4 | 0 | 4 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 4 | 4 | 0 | 4 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42271457562) |
| [chromium] e2e/debts.spec.ts › buy now, pay later installments are listed from the plans' schedules | 4 | 4 | 0 | 4 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42205791146) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › a Yes in another tab reaches this one | 4 | 3 | 1 | 3 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42252427345) |
| [chromium] e2e/theme-alert.spec.ts › a theme idea comes to the chat as a card to decide | 3 | 4 | 0 | 4 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42211845015) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person sees their health plan's year and a dispute card (step 200) | 3 | 3 | 0 | 3 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42339622562) |
| [chromium] e2e/instant-pages.spec.ts › the first scan's page starts no preloads | 3 | 3 | 0 | 3 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 3 | 3 | 0 | 3 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42181397384) |
| [chromium] e2e/instant-pages.spec.ts › coming back to a page › refreshes quietly when the page is old | 2 | 2 | 0 | 2 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42320957549) |
| [chromium] e2e/taxes.spec.ts › tax tags: Jane's tags, its questions, and tagging a work expense | 2 | 2 | 0 | 2 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42231012769) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person answers a question about how they live, and a yes opens a gap (step 197) | 2 | 2 | 0 | 2 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42217820650) |
| [chromium] e2e/instant-pages.spec.ts › one person's pages never show to another › another tab signing out empties this one too | 2 | 2 | 0 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42065276553) |
| src/lib/borrowing-power.integration.test.ts › what you could borrow against a real database says the 28/36 home and the mortgage together, in both answers and both tools | 2 | 2 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42046445284) |
| src/lib/jane-agent/figure-ledger.integration.test.ts › the figure ledger on real tool results passes Jane's rule replies, which come from the same numbers | 2 | 0 | 2 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42130045766) |
| src/lib/rate-limit.integration.test.ts › rate limiting against a real database allows the limit within a window, then refuses until the next window | 2 | 1 | 1 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42059294939) |
| [chromium] e2e/decisions.spec.ts › a real account › a no can be undone and puts the card back | 1 | 19 | 0 | 19 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41936902998) |
| [chromium] e2e/demo-chat.spec.ts › after an upload the side chat catches up, and the chip keeps out of the way | 1 | 13 | 0 | 12 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42130045766) |
| [mobile] e2e/decisions.spec.ts › a real account › a no can be undone and puts the card back | 1 | 8 | 0 | 8 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41858806393) |
| [mobile] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 1 | 5 | 0 | 5 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42240788365) |
| [chromium] e2e/plan.spec.ts › the plan opens with three, the rest behind more, and a Yes is instant with Revert | 1 | 3 | 0 | 3 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/41969900958) |
| [mobile] e2e/tap.spec.ts › every kind of tap shows its change within 150 ms | 1 | 3 | 0 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (admin) | 1 | 2 | 0 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42065276553) |
| [mobile] e2e/debts.spec.ts › the payoff plan picks an order for the demo bank and starts with one tap | 1 | 1 | 1 | 2 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › signing out empties the memory, and Back shows nothing of theirs | 1 | 1 | 0 | 1 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42380303786) |
| [mobile] e2e/instant-pages.spec.ts › one person's pages never show to another › deleting the account empties the memory | 1 | 1 | 0 | 1 | [2026-11-07](https://github.com/cubic1M/Jane/actions/runs/42380303786) |
| [mobile] e2e/practice-settings.spec.ts › practice settings save and change what Jane does | 1 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42240788365) |
| [mobile] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 1 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42240788365) |
| [chromium] e2e/instant-pages.spec.ts › what a person has seen › hidden figures start hidden on every return, from memory or by Back | 1 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42217820650) |
| [chromium] e2e/insurance.spec.ts › a demo-bank person pays less for the same cover with one tap (step 196) | 1 | 1 | 0 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42184870217) |
| [chromium] e2e/try.spec.ts › 'Try it with sample data' opens Jane's chat with a sample person @critical | 1 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42085116284) |
| [mobile] e2e/debts.spec.ts › every debt shows with its source, and missing terms can be typed in | 1 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [mobile] e2e/debts.spec.ts › buy now, pay later installments are listed from the plans' schedules | 1 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| [mobile] e2e/theme-alert.spec.ts › a theme idea comes to the chat as a card to decide | 1 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42056821154) |
| src/lib/mfa.integration.test.ts › two-factor against a real database takes an authenticator code once | 1 | 1 | 0 | 1 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42019617453) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database is rate-limited per person | 1 | 1 | 0 | 0 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42293358080) |
| src/lib/jane-agent/typing.integration.test.ts › typing to Jane against a real database with a key stops asking Claude once the person's day has cost its cap, and the rules answer | 1 | 0 | 1 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42179408239) |
| src/lib/agent/written-for-a-company.integration.test.ts › what a person writes, in an email Jane signs passes on a plain answer as one paragraph, and the account's own email | 1 | 0 | 1 | 1 | [2026-11-06](https://github.com/cubic1M/Jane/actions/runs/42148457216) |
| src/lib/rate-limit.integration.test.ts › rate limiting against a real database counts several limits in one round trip, refusing when any one is over | 1 | 1 | 0 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/42059294939) |
| src/lib/jane-agent/checks/proof.integration.test.ts › proof on every person Sam: the right suggestions, led with, and a chat that agrees | 1 | 1 | 2 | 0 | [2026-11-05](https://github.com/cubic1M/Jane/actions/runs/41975910921) |
| [chromium] e2e/side-chat.spec.ts › on a computer the chat docks beside the page, folds, expands and stays put | 0 | 27 | 0 | 27 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41619284794) |
| [mobile] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 0 | 26 | 0 | 25 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41620393836) |
| [chromium] e2e/landing.spec.ts › the column pans from capital to base as the page scrolls | 0 | 25 | 0 | 25 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41664923016) |
| [mobile] e2e/activity.spec.ts › typing in a field records no value (user) | 0 | 25 | 0 | 23 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [chromium] e2e/upload.spec.ts › a file that plainly isn't the chosen account's gets one line saying so | 0 | 19 | 0 | 19 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [chromium] e2e/upload.spec.ts › the same file again says nothing was new, not "Saved 0 transactions" | 0 | 19 | 0 | 19 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [chromium] e2e/decisions.spec.ts › the demo bank › keeps the concierge flow: Yes queues the action for Jane | 0 | 18 | 0 | 18 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41493931447) |
| [chromium] e2e/activity.spec.ts › typing in a field records no value (user) | 0 | 17 | 0 | 17 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41493931447) |
| [chromium] e2e/logo.spec.ts › Jane's logos are plain marks: no link, no button, a click does nothing | 0 | 14 | 0 | 14 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41533580743) |
| [chromium] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 0 | 12 | 0 | 12 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41746382757) |
| [mobile] e2e/who-am-i.spec.ts › a Try Jane family asks who they are and hears about the kids and the pet | 0 | 12 | 0 | 12 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [chromium] e2e/suggestion-popups.spec.ts › suggestions pop up small at the bottom of the hub and open in place | 0 | 12 | 0 | 12 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41466496226) |
| [chromium] e2e/empty-states.spec.ts › an upload-only person's pages each say what's there or the next step | 0 | 10 | 0 | 10 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41216258027) |
| [chromium] e2e/demo-home.spec.ts › beside the docked chat, Home and /jane keep their words and marks in place | 0 | 8 | 0 | 8 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41466240453) |
| [chromium] e2e/steady-shell.spec.ts › the top bar holds still while pages load | 0 | 8 | 0 | 8 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41442473512) |
| [chromium] e2e/who-am-i.spec.ts › a Try Jane family asks who they are and hears about the kids and the pet | 0 | 7 | 0 | 7 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [chromium] e2e/upload.spec.ts › a CSV in an unknown layout gets a column picker instead of failing | 0 | 7 | 0 | 7 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41407663501) |
| [chromium] e2e/close.spec.ts › a sample person's monthly close, from Home | 0 | 8 | 0 | 5 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41731527739) |
| [chromium] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 0 | 6 | 0 | 6 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41664923016) |
| [mobile] e2e/voice.spec.ts › speak a question with the keyboard, send it, and hear the answer | 0 | 6 | 0 | 6 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41528472598) |
| [mobile] e2e/upload.spec.ts › a file that plainly isn't the chosen account's gets one line saying so | 0 | 6 | 0 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [mobile] e2e/error-pages.spec.ts › a page that broke in the browser reaches /admin/errors, typed values gone | 0 | 5 | 0 | 5 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41447552693) |
| [chromium] e2e/chat-layout.spec.ts › the dock steps between suggestions from its header, details staying open | 0 | 5 | 0 | 5 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41389562647) |
| [chromium] e2e/upload-balance.spec.ts › a card without a balance is asked for, and net worth says it isn't counted until then | 0 | 5 | 0 | 5 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41216258027) |
| [chromium] e2e/ask-line-landing.spec.ts › Ask Jane always draws its line, and asked again finds the earlier answer | 0 | 5 | 0 | 5 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40655386163) |
| [chromium] e2e/strategy-tree.spec.ts › pick a strategy in the tree, see it in the graph, use it and revert, on a phone | 0 | 5 | 0 | 5 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40606382701) |
| [mobile] e2e/close.spec.ts › a sample person's monthly close, from Home | 0 | 4 | 1 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41632622042) |
| [mobile] e2e/upload.spec.ts › the same file again says nothing was new, not "Saved 0 transactions" | 0 | 5 | 0 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41624329374) |
| [mobile] e2e/strategy-tree.spec.ts › pick a strategy in the tree, see it in the graph, use it and revert, on a computer | 0 | 4 | 0 | 4 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40606987293) |
| src/lib/jane-agent/taxes-qa-real.integration.test.ts › tax recommendations and real accounts gives tax moves to demo people as advice and none to real accounts | 0 | 3 | 2 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41738038682) |
| [mobile] e2e/empty-states.spec.ts › an upload-only person's pages each say what's there or the next step | 0 | 3 | 1 | 4 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41136406044) |
| [mobile] e2e/hero-tiles.spec.ts › safe to spend says why it's that number, and hands what to spend to the chat | 0 | 3 | 0 | 3 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41442473512) |
| [chromium] e2e/transactions.spec.ts › a person fixes a category for a merchant | 0 | 3 | 0 | 3 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41303439321) |
| [chromium] e2e/upload-remove.spec.ts › start over deletes every upload, and net worth says there's nothing yet | 0 | 3 | 0 | 3 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41166411122) |
| [chromium] e2e/upload.spec.ts › a new person starts with uploading, and lands on the report | 0 | 3 | 0 | 3 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41045173255) |
| [chromium] e2e/strategy-tree.spec.ts › pick a strategy in the tree, see it in the graph, use it and revert, on a computer | 0 | 2 | 2 | 4 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40606382701) |
| [chromium] e2e/insurance.spec.ts › a renter adds their renters policy and the gap goes | 0 | 0 | 4 | 4 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41795692810) |
| [chromium] e2e/rate-limits.spec.ts › an API route answers 429 past its limit, calmly, and cron routes aren't limited | 0 | 2 | 0 | 2 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41716817168) |
| [chromium] e2e/legal.spec.ts › the Privacy Policy says what is shared, kept, deleted, and which cookies | 0 | 0 | 5 | 4 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41693911627) |
| [chromium] e2e/dock-followed.spec.ts › a card followed to its page, or answered, doesn't come back | 0 | 2 | 0 | 2 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41654526340) |
| [mobile] e2e/rate-limits.spec.ts › a session past its server-action limit gets a plain-text 429 the page can show | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41526697009) |
| [mobile] e2e/rate-limits.spec.ts › an API route answers 429 past its limit, calmly, and cron routes aren't limited | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41407663501) |
| [mobile] e2e/transactions.spec.ts › a person fixes a category for a merchant | 0 | 2 | 0 | 2 | [2026-11-02](https://github.com/cubic1M/Jane/actions/runs/41374993867) |
| [mobile] e2e/upload.spec.ts › a CSV in an unknown layout gets a column picker instead of failing | 0 | 2 | 0 | 2 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41274716829) |
| [chromium] e2e/card-choices.spec.ts › every choice on a card is in view and clickable, shut and opened | 0 | 2 | 0 | 2 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41036659891) |
| [mobile] e2e/home-net-worth-true.spec.ts › the headline is the newest balances' sum, the line ends there, and a day's dot opens | 0 | 2 | 0 | 2 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40700184671) |
| [mobile] e2e/ask-line-landing.spec.ts › Ask Jane always draws its line, and asked again finds the earlier answer | 0 | 2 | 0 | 2 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40650465814) |
| [mobile] e2e/strategy-tree.spec.ts › pick a strategy in the tree, see it in the graph, use it and revert, on a phone | 0 | 2 | 0 | 2 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40606987293) |
| src/lib/invariants/nightly.integration.test.ts › the nightly invariants counts a card payment with no other side, once it's had time to post | 0 | 2 | 1 | 1 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41796656550) |
| src/data-sources/csv/control-totals.property.test.ts › a running balance warns when any row in the middle is taken out | 0 | 1 | 1 | 2 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41769404726) |
| src/lib/jane-agent/leads-with-suggestions.integration.test.ts › Jane leads with suggestions freelancer's first chat opens on their top suggestions, as cards | 0 | 3 | 2 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| [chromium] e2e/landing.spec.ts › health check responds | 0 | 0 | 3 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41738038682) |
| src/lib/consolidation-qa.integration.test.ts › the merges, on the eight sample people freelancer | 0 | 0 | 4 | 3 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41715767512) |
| [chromium] e2e/share-card.spec.ts › share the result card, open the invite, land on sign-up with the code | 0 | 1 | 1 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41632622042) |
| [chromium] e2e/unsubscribe.spec.ts › unsubscribe works without signing in @critical | 0 | 1 | 0 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41628222999) |
| [mobile] e2e/events-overlay.spec.ts › the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41303439321) |
| [mobile] e2e/upload.spec.ts › a new person starts with uploading, and lands on the report | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41274716829) |
| [mobile] e2e/hero-tiles.spec.ts › saved so far opens on where the savings came from | 0 | 1 | 0 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/insurance.spec.ts › a policy document is read for the person to check and confirm (step 151) | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41230545279) |
| [chromium] e2e/messy-bank.spec.ts › a messy bank's exports: nothing counted twice, no false subscriptions, no transfer bills | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41208228412) |
| [chromium] e2e/dock-scroll.spec.ts › the wheel scrolls a long card in the dock to its end, and nothing behind it | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41172533004) |
| [mobile] e2e/upload-balance.spec.ts › a card without a balance is asked for, and net worth says it isn't counted until then | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41172533004) |
| [chromium] e2e/upload-remove.spec.ts › an upload can be removed, and its findings go with it | 0 | 1 | 0 | 1 | [2026-10-31](https://github.com/cubic1M/Jane/actions/runs/41166411122) |
| [mobile] e2e/demo-bank.spec.ts › a demo bank fills the report with fake data, labelled as fake, and can be removed | 0 | 1 | 0 | 1 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41146844729) |
| [mobile] e2e/messy-bank.spec.ts › a messy bank's exports: nothing counted twice, no false subscriptions, no transfer bills | 0 | 1 | 0 | 1 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41146844729) |
| [mobile] e2e/taxes.spec.ts › the tax plan: moves by deadline, and one on the deadlines with a tap | 0 | 1 | 0 | 1 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41146844729) |
| [chromium] e2e/home-fixes.spec.ts › an opened card keeps the next ones open, until one is shut | 0 | 1 | 0 | 1 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41118834537) |
| [mobile] e2e/paper-account.spec.ts › Revert takes a paper trade back, and Skip puts a trade away for good | 0 | 1 | 0 | 1 | [2026-10-29](https://github.com/cubic1M/Jane/actions/runs/40851199926) |
| [chromium] e2e/rate-limits.spec.ts › a session past its server-action limit gets a plain-text 429 the page can show | 0 | 1 | 0 | 1 | [2026-10-29](https://github.com/cubic1M/Jane/actions/runs/40839636533) |
| [chromium] e2e/upload-then-delete.spec.ts › after Delete all my data, /goodbye shows no import chip | 0 | 1 | 0 | 1 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40721619792) |
| [mobile] e2e/chat-layout.spec.ts › on a phone the sheet always has the message box: type, send, see it | 0 | 1 | 0 | 1 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40721619792) |
| [chromium] e2e/upload-findings.spec.ts › a card's interest from an upload reads as a year of it, not at today's balance | 0 | 1 | 0 | 1 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40681607978) |
| [chromium] e2e/upload-formats.spec.ts › a QFX after the CSV of the same account adds only what's new | 0 | 1 | 0 | 1 | [2026-10-28](https://github.com/cubic1M/Jane/actions/runs/40681607978) |
| [mobile] e2e/unsubscribe.spec.ts › unsubscribe works without signing in | 0 | 1 | 0 | 1 | [2026-10-27](https://github.com/cubic1M/Jane/actions/runs/40594779177) |
| src/lib/suggestions.integration.test.ts › the nightly scan of suggestions freelancer gets their top suggestions from their written list | 0 | 0 | 2 | 1 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles answers when preretire could stop working with how long the money lasts | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles reads the retiree's Social Security from their deposits, and plans from today | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| src/lib/investments/sample-people.integration.test.ts › the sample people's investing, from their profiles says when there's nothing invested to rebalance, and the review agrees with the trades | 0 | 1 | 1 | 0 | [2026-11-04](https://github.com/cubic1M/Jane/actions/runs/41750501236) |
| [mobile] e2e/share-card.spec.ts › share the result card, open the invite, land on sign-up with the code | 0 | 0 | 2 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41632622042) |
| src/lib/jane-agent/first-brief-budget.integration.test.ts › the first brief's budget posts the brief without the upkeep, which the last run does | 0 | 0 | 3 | 1 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41623535679) |
| src/lib/strategist.integration.test.ts › Claude as strategist proposes nothing without a key | 0 | 1 | 0 | 0 | [2026-11-03](https://github.com/cubic1M/Jane/actions/runs/41620393836) |
| [chromium] e2e/money-goes.spec.ts › rows open to their transactions and the month chart shows and picks months | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [chromium] e2e/upload-numbers.spec.ts › an upload's numbers reach net worth, Home and the money page; a second file moves them | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/debts.spec.ts › refinance offers compare total cost and pick one, labelled | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/money-goes.spec.ts › rows open to their transactions and the month chart shows and picks months | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/upload-numbers.spec.ts › an upload's numbers reach net worth, Home and the money page; a second file moves them | 0 | 0 | 1 | 1 | [2026-11-01](https://github.com/cubic1M/Jane/actions/runs/41270210860) |
| [mobile] e2e/chat-sheet-end.spec.ts › on a phone, the chat sheet opens at its newest answer, clear of Jane's card | 0 | 0 | 1 | 1 | [2026-10-30](https://github.com/cubic1M/Jane/actions/runs/41058312984) |
| [mobile] e2e/mobile-no-sideways.spec.ts › a phone's /import is never wider than the screen, and Import takes the tap | 0 | 0 | 1 | 1 | [2026-10-27](https://github.com/cubic1M/Jane/actions/runs/40578157311) |

## Jobs that failed on the first try

| Job | Main | PRs |
| --- | --- | --- |
| End-to-end tests (2/3) | 28 | 2 |
| Unit tests (4/4) | 3 | 21 |
| Unit tests (3/4) | 4 | 17 |
| Unit tests (1/4) | 4 | 17 |
| Unit tests (2/4) | 8 | 9 |
| Lint, format and typecheck | 1 | 14 |
| End-to-end tests (3/3) | 10 | 2 |
| Gates | 0 | 12 |
| End-to-end tests (1/3) | 9 | 2 |
| Migration safety | 1 | 3 |
| End-to-end build | 0 | 3 |
| Access proof | 0 | 1 |
| End-to-end tests (1/1) | 0 | 1 |
