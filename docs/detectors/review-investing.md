# Review: investing suggestions, as a skeptical customer (step 262 quality pass)

I ran the investing detectors on the eight sample people and read what they say: are the dollars
believable, does the percentage move with the evidence and give a reason I would accept, is the
"why you" about me, and is the top three right for my life. Wording is pinned in
`src/detectors/investing.test.ts` and `holdings.test.ts`.

## What I changed

1. **A match is a guess until Jane knows the terms.** Maya's "$1,181 a year of match" now caps at
   75% with "whether and how much your employer matches is a guess" (it was 80% on the strength of
   having a 401(k)).
2. **Age-based suggestions say they are guessed.** Catch-up, required withdrawals and the mix check
   rest on life stage, which Jane infers. Their reason now says so ("your age is a guess from your
   accounts and income"; "your target mix is a guess from your life stage until you answer four
   questions") instead of "2 signals in 12 months of data", which meant nothing to a customer.
3. **Automatic investing no longer counts a 401(k).** Payroll contributions are regular investing,
   so "I see no regular investing" was wrong for anyone with a workplace plan. It now looks only at
   accounts outside it (brokerage, IRA, Roth) and says so. Maya, whose only account is a 401(k),
   no longer gets it.
4. **Catch-up says "if you are not already using it"**, because Jane cannot see payroll deductions.
5. **Grammar:** "1 of your funds cost" is now "One of your funds costs".

## Per person (investing items and where they rank overall)

| Person | Investing items (rank, dollars a year, confidence) | Verdict |
|---|---|---|
| **Maya** | match (#1, $1,181, 75%) | Right: her 401(k) holds $1,973 on $39,360 pay. Capped because the match is unknown. |
| **The Reyes** | mix 93% stocks (#8, $11,972 to move, 60%), fund fees (#9, $440, 80%), 529 (#14, $250, 74%) | The 529 is small and honest (a state deduction, not "college costs"). Their $65,694 target-date fund is the fee story. |
| **Sam** | self-employed retirement (#3, $1,198, 79%) | Right; no workplace plan. |
| **Priya** | company stock (#2, $77,748 at risk, 80%), idle cash, backdoor Roth ($1,329), fees ($489), auto-invest ($253), HSA ($74), bond location ($79, 70%) | Top three right. The HSA and location items are small and say so; they sit below. |
| **Dan and Lena** | catch-up (#2, $1,650, 58%), mix (#3, 84% stocks vs about 60%, 58%), idle cash, fees ($1,311), old 401(k) ($119) | Catch-up and mix at 58% are right: Jane guesses their age. The old 401(k) is only $119 a year; tiny but real and a direct rollover. |
| **Ruth** | costly annuity (#3, $1,275, 60%), mix (#4), fees (#6, $1,315), required withdrawals (#10, $2,840 penalty avoided, 58%) | The annuity is capped at 60% because its fees are assumed, and says to read the contract first. Required withdrawals ranks low (#10) because penalties are a risk, not a yearly cost; she is already withdrawing. |
| **Chris, Jo** | none (Jo: self-employed retirement #1) | Right: Chris has no investments, and the debt plan comes first. |

## Not mine, but worth saying

- **Mix targets by life stage are crude** (`stockShareByStage`). Until the person answers the four
  profile questions the percentage stays near 60% and the text says so. A told risk answer should
  replace the stage target when present; the profile has no "target mix" fact yet.
- **Fund fees come from Jane's stand-in fund table** (demo funds), so the 80% on a fee saving is
  about the count of funds, not the table; real fund data should add its own source and age to the
  reason.
- **Priya's idle cash and her backdoor Roth both want the same dollars** (she holds $106,000 in cash);
  they are alternatives and the ranking treats them as separate. The nightly scan could damp the
  second after a yes to the first.
