# Review: tax suggestions, as a skeptical customer (step 261 quality pass)

I ran the tax detectors on the eight sample people (and, for the seasonal ones, on a February and a
December date) and read what they say the way someone who has never heard of Jane would: are the
dollars believable and counted once, does the percentage move with the evidence and give a reason I
would accept, is the "why you" about me, are my top three right for my life, and do deadlines drive
urgency. Wording and ranges are pinned in `src/detectors/quality-taxes.test.ts`.

## What I changed

1. **The identity PIN was a $3,200 headline at 89%.** A skeptic asks "89% sure of what?": almost
   nobody is targeted. It now shows the average refund times a 2% chance ($64), at 60%, with the
   reason in words ("the figure is the average refund times a 2% chance of being targeted") and says
   plainly that few people are ever targeted (`ipPinTheftChance`, `src/config/detectors.ts`).
2. **The filing nudge promised a penalty "even with a refund coming".** That is wrong: the
   late-filing penalty only applies to tax owed. It now says so, shows about a fifth of the minimum
   penalty ($97, since about a fifth of filers owe), and its 60% says Jane can't tell whether the person
   owes or is due a refund (`lateFilingOweShare`).
3. **Stock pay and unpaid estimates are bills, not savings.** The tax on vesting stock ($6,479 for
   Priya) and a self-employed person's unpaid quarters can't be saved; planning avoids the penalty and
   the surprise. They keep their true size in "why" (and the penalty avoided, $518 for Priya) but count
   for 30% of the bill in ranking (`rankShareOfBill`, `rankCents`), so Priya's top three now include
   it and Sam's first item is the estimated taxes he has never paid.
4. **A shop's deposits are sales, not profit.** Jo's estimated tax said "$122,960 of tax a year"
   because every Square deposit was treated as income. It assumes 15% is profit (about $18,000 of
   tax), says so, and caps the percentage at 60% (`businessProfitShare`).
5. **One bracket per person.** The loss harvest and the gift receipts used take-home pay alone
   (24% for Priya) while the stock-vesting item added the vesting (32%). All of them now use pay plus a
   year's expected vesting, so Priya's harvest is worth $960 (not $720) and a person sees one bracket.
6. **Roth conversions sized to the life.** A retiree's conversion is limited to the room left in the
   bracket her income puts her in now (Ruth: about $1,226, not $3,010) and says "money you must withdraw
   this year can't be converted"; a couple still working are told what would have to be true (income
   dropping in the years after they stop work). Their reasons name the balance and what is assumed
   instead of "2 signals in 12 months of data".
7. **Year-end 401(k) top-ups never pass a tenth of income** and don't go to someone in debt trouble,
   so Maya isn't told to put in $6,125.
8. **Guessed pieces for what Jane can't see**, each with its reason: whether the employer offers a
   dependent care FSA (the Reyes' childcare saving: $424, 65%), whether a gift's receipt is already in
   hand and whether the person itemizes (receipts: 60%, "if you itemize"), the assessment behind a
   property tax appeal (45%), the vest schedule (70%), what has been put into the 401(k) already (50%).
   What Jane counted stays high: Priya's loss ($4,240 in one taxable holding, 80%) and Sam's unpaid
   quarters (79%). The loss's reason no longer says "in 12 months of data" for a holding.

## Per person (top five, and where the tax items land)

| Person | Top five | Tax items |
|---|---|---|
| **Maya** | employer match, card interest ($557, 89%), a 0% transfer, emergency fund, subscriptions | Nothing in October. In December a 401(k) top-up (about $4,500 at 50%) at #5; in February the filing nudge and the PIN, both low. Right: she has card debt and little cash. |
| **The Reyes** | student loan forgiveness ($8,000, 74%), insurance claim, PMI, emergency fund, a food overrun | Childcare FSA ($424, 65%) #11, property tax check ($406, 45%) #13, receipts ($66, 60%) #16. In December the 401(k) top-up ($1,348, 50%) is #3. |
| **Sam** | estimated taxes ($1,089 a year of penalty, 79%; the whole bill counts for ranking), an income-driven plan, emergency fund, self-employed retirement, health plan | His unpaid quarters are first, urgent "now" within two weeks of a quarter date. |
| **Priya** | refinance, company stock, **the tax on her vesting stock ($6,479, 70%)**, idle cash, backdoor Roth | Harvest ($960, 80%) #7, property tax ($952, 45%) #8, a $1,000 gift's receipt ($320, 60%) #15. |
| **Dan and Lena** | **Roth conversion ($4,116, 55%)**, catch-up, idle cash, employer benefits, insurance shopping | Property tax (45%) #6, receipts #11. The conversion rests on their income dropping after they stop working, and says so. |
| **Ruth** | idle cash, hospital bills ($667, 89%), policy documents, Roth conversion ($1,226, 58%), bill negotiation | Sized to her bracket room. Her property tax (45%) is #9. |
| **Chris** | payoff plan, hardship call, replace the payday loan, card interest, cash shortfall | No tax item in October; in February only the filing nudge and PIN, at the bottom. A 401(k) top-up is never suggested to him. |
| **Jo** | self-employed retirement, emergency fund, **estimated taxes ($1,476 penalty, 60%)**, business separation, business cover | The tax bill is about $18,000, not $123,000; 60% because sales are not profit. |

## Not mine, but worth saying

- **Jo's self-employed retirement ($10,820) and emergency fund ($78,772) use the same sales figure**
  (a tenth of his deposits). They are the work and spending lanes' detectors; a profit share like the
  one added to his estimated taxes would bring them down.
- **Ruth would probably gain more from a property tax senior exemption than from an appeal** (her
  age is not known to Jane, so neither a senior nor a veteran exemption can be named from the rows).
  The property tax check says only what it can see.
- **Dates:** the dollars and brackets shift slightly with a February or December `today` on the sample
  people, because their year of data ends on October 17; that is an artifact of the sample, not of the
  detectors (the quality test pins the October figures).
- **Percentages now range from 45% to 80%** across the tax suggestions, with reasons a person would
  accept for each. If the nightly scan should show more variation, the thinking lane's recipe
  (`CONFIDENCE` in `src/config/profile.ts`) is the place.
