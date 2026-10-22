# The perfect fit for borrowing, reviewed as a skeptical customer (step 284)

Each sample person asked for a personal loan ($5,000), a car loan ($20,000), a consolidation of
their cards, a refinance of their costliest debt and a mortgage ($250,000) through the fit
engine (`src/planning/fit.ts`, loaded by `src/lib/fit.ts`), on the lender stand-in's October
rates. The verdicts are what a doubtful customer would say; what I changed is at the bottom.

| Person | Verdict |
| --- | --- |
| Maya | Believable. A $1,940 card at about 27% with a $58 minimum is 5.3 years of payments; a 13.04% two-year loan saves $1,426 over that, and the five-year one $989 for a lower payment. The mortgage is flagged "stretch" (it is: $1,348 on her income). Pick for a car: the 5-year Harbor loan at $379 a month, within her comfortable 12%. |
| The Reyes | Right: the cash covers the $3,120 card and still leaves a month of spending, so paying it off from savings is the pick ($2,417 less than the minimum); the loans stay beside it. Car and home options have a comfortable pick. |
| Sam | The $1,999 card is cleared by cash (pick); a car at 4 years and a 30-year mortgage are comfortable on his income, the 15-year is marked stretch. His uneven income caps nothing in the engine itself, so the profile's income evidence is what keeps the confidence honest. |
| Priya | The card is cleared from cash; a car loan is offered (she doesn't need one). A $250,000 mortgage on top of her existing $6,000 payment is 59% of income: nothing fits, with the reason. |
| Dan and Lena | The $1,799 card is cleared by cash; a 15-year mortgage is the cheapest, the 30-year the lowest payment. Fine. |
| Ruth | Her $420 card is below any lender's smallest loan: "no lender prices a loan this small, pay it down directly". A mortgage is offered but she isn't asking for one. |
| Chris | Honest and cautious. Score 560: no personal loan, consolidation or card refinance fits, and it says a score of 600 would open that up and paying cards down is the quickest way. A car loan is offered only as stretch options, with a line that none fits comfortably and the lowest payment. |
| Jo | The $6,900 card is cleared from cash ($5,986 less); the loans are listed beside it. |

## What I changed because of the review

- Debt service is no longer every card payment: a card paid in full each month is spending, so only loans and a card's minimum count. Before, Priya's debt-to-income read 68-83% and nothing fit her.
- Keeping a card was costed over an invented 36 months at a payment higher than the card's minimum. It is now the months the real payment takes (5.3 years for Maya), so "saves $X" is against what staying put really costs.
- "Pay it off with your cash" is an option and the pick when the cash covers the debt and leaves a month of spending: a loan is never picked over cash that is sitting there. The consolidation and personal-loan decisions say so too, and the suggestion stays quiet.
- When nothing is comfortable the first option is labelled the lowest payment, not "best total cost", and the chat says none fits comfortably.
- A debt too small for any lender gets a plain answer instead of "I don't see a card".
- The consolidation suggestion reaches Maya (the one sample person with a card she carries and no spare cash), counts only what it saves beyond a 0% transfer for ranking, and never fires for someone in debt trouble.

## Not mine

- The credit score is assumed (700) until one is pulled; for Chris the real score (560) is only used in the chat and tool path, so the suggestion path skips anyone in debt trouble instead of guessing.
- Card limits come from the credit report; a person without a pulled report has no card use to show.
