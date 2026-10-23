# Proof on every person (spec step 266)

Run on 2026-10-23 with `npm run checks:proof` (src/lib/jane-agent/checks/proof.ts): each sample person's demo bank linked and scanned, their top suggestions compared with their written list (src/config/people.ts), the first chat read, every tool behind a top suggestion run, and the questions for those features plus QA's casual ones asked. Without an Anthropic key the chat walk uses the rules and the tools; the live Claude walk is QA's graded run.

| Person | Top three (harness) | Offered in the chat | Leads the first chat | Questions understood by the rules | Result |
| --- | --- | --- | --- | --- | --- |
| Maya | employer_match, card_interest, balance_transfer | 3 | yes | 8/13 | pass |
| The Reyes family | life_insurance, insurance_claim, student_forgiveness | 3 | yes | 6/11 | pass |
| Sam | auto_insurance, estimated_taxes, income_smoothing | 3 | yes | 7/12 | pass |
| Priya | concentration, refinance, withholding_gap | 3 | yes | 6/11 | pass |
| Dan and Lena | umbrella, investment_fees, roth_conversion | 3 | yes | 5/10 | pass |
| Ruth | medical_bills, costly_products, idle_cash | 3 | yes | 6/11 | pass |
| Chris | debt_plan, high_cost_loans, low_balance | 3 | yes | 7/13 | pass |
| Jo | business_insurance, emergency_fund, disability_insurance | 3 | yes | 6/11 | pass |

## Maya: Young renter, first job

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Get your employer's full 401(k) match, earn $1,181 a year | 75% (whether and how much your employer matches is a guess) | yes | retirement_plan 3, account_plan 12 |
| Pay down the card charging interest, save $524 a year | 95% (12 interest charges in 12 months of data) | yes | card_interest 2, credit_cards 7 |
| Try a 0% balance transfer card, save $499 a year | 83% (1 card linked in 12 months of data) | yes | balance_transfers 2 |

The first chat opens:

> Good evening! You have $1,030.40 safe to spend until payday, Nov 1 (in 10 days).
> Here's what I'd do first, from looking at your money:
> - Get your employer's full 401(k) match, earn $1,181/yr. Why you: Your 401(k) holds $1,973.33 against pay of about $39,360.00 a year. 75% sure: whether and how much your employer matches is a guess.
> - Pay down the card charging interest, save $524/yr. Why you: Your cards cost you about $523.66 a year in interest. 95% sure: 12 interest charges in 12 months of data.
> - Try a 0% balance transfer card, save $499/yr. Why you: You owe $1,940.20 on cards and paid $556.80 in interest. 83% sure: 1 card linked in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| am i saving enough for retirement | yes | You have $1,973.33 in Demo 401(k). To plan from here I need your age and three more quick answers. |
| should i open a roth ira | yes | The order depends on what the money is for and when you'll need it. Four quick answers first. |
| how can i pay less interest on my cards | yes | Your cards cost about $523.66 a year in interest at today's balances. |
| which card should i use for gas | yes | Use your Demo Credit Card ····1003 for gas: it earns 1%, about $0.00 a year on your $0.00 of gas. |
| is there a 0% balance transfer for me | yes | I'd move your Demo Credit Card ····1003 balance ($1,940.20 at 26.99%) to Northstar Slate. |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is -$12,406.47: you have $3,733.73 and owe $16,140.20. |
| whats the biggest mistake im making | yes | Make sure you get your employer's full 401(k) match. Your 401(k) holds $1,973.33 against pay of about $39,360.00 a year. 75% sure: whether and how much your emp |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $1,940.20 on credit cards, at up to 27% a year. You hold $1,760.40 in cash, about 0.6 months of spending; a cush |

No problems.

## The Reyes family: Family with kids and a mortgage

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Look at life cover for your family, avoid up to $1,287,200 | 81% (no life-cover charges in 12 months of data) | yes | insurance_life 4 |
| Check if this repair was a claim, save $2,100 | 65% (24 car and home cover charges in 12 months of data; 1 repair charge and no claim payout in 12 months of data; it depends on what your policy covers) | yes | insurance_claims 1 |
| Check loan forgiveness (PSLF), get $8,000 back | 49% (12 payments (eligibility isn't certain) in 12 months of data) | yes | student_long_game 8 |

The first chat opens:

> Good evening! You have $3,572.60 safe to spend until payday, Oct 30 (in 8 days).
> Here's what I'd do first, from looking at your money:
> - Look at life cover for your family, avoid $1,287,200. Why you: You have children and I see no life-cover charge in 12 months. 81% sure: no life-cover charges in 12 months of data.
> - Check if this repair was a claim, save $2,100. Why you: You paid $3,100.00 for a repair and I see no payout. 65% sure: 24 car and home cover charges in 12 months of data; 1 repair charge and no claim payout in 12 months of data; it depends on what your policy covers.
> - Check loan forgiveness (PSLF), get $8,000 back. Why you: You work for Springfield Schools and owe $62,000.00 on student loans. 49% sure: 12 payments (eligibility isn't certain) in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| how much life insurance do i need | yes | You'd need about $1,800,000.00 of term life insurance for 30 years. Here's how I worked it out: |
| i had a car accident, what now | yes | I'm sorry: a car accident. Here's what to do now: |
| how many pslf payments have i made | yes | You haven't said you work in public service, so I'm not counting payments toward Public Service Loan Forgiveness. |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is $156,368.50: you have $580,888.50 and owe $424,520.00. |
| whats the biggest mistake im making | yes | Look at life insurance for the people who depend on you. You have children and I see no life-cover charge in 12 months. 81% sure: no life-cover charges in 12 mo |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $3,120.00 on credit cards, at up to 21.5% a year. You hold $13,380.60 in cash, about 1.1 months of spending; a c |

No problems.

## Sam: Freelancer with uneven income

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Check your car is insured, avoid up to $100,000 | 49% (24 car payments, gas or auto cover in 12 months of data; no car-cover charges in 12 months of data) | yes | insurance_policies 17 |
| Pay estimated taxes each quarter, avoid up to $1,439 | 81% (no income-tax payments in 12 months of data) | yes | tax_estimate 7, tax_self_employed 14, tax_calendar 30 |
| Pay yourself a steady amount, avoid up to $3,204 | 95% (28 deposits in 12 months of data) | yes | steady_pay 15 |

The first chat opens:

> Good evening! You have $1,358.75 safe to spend this month.
> Here's what I'd do first, from looking at your money:
> - Check your car is insured, avoid $100,000. Why you: I see car costs but no car-insurance charge in 12 months. 49% sure: 24 car payments, gas or auto cover in 12 months of data; no car-cover charges in 12 months of data.
> - Pay estimated taxes each quarter, avoid $1,439. Why you: Nobody withholds tax from your pay; about $17,985.36 a year is due. 81% sure: no income-tax payments in 12 months of data.
> - Pay yourself a steady amount, avoid $3,204. Why you: Your income averages $5,995.12 a month; your lowest was $2,790.82. 95% sure: 28 deposits in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| what insurance do i have | yes | You have 2 policies on file. |
| how much will i owe in taxes | yes | Federal: you're on course to owe $16,059. That's an estimate from your income so far, projected to the end of the year. |
| do i owe quarterly taxes | yes | Yes. After withholding you'd owe about $16,059, so pay about $16,059 by Jan 15, 2027 and the rest on the later dates. |
| can you give me a steady paycheck from my freelance income | yes | Your steady paycheck is $2,458.98 a month, from the buffer in your savings to checking. The buffer only has $2,459 above its floor, so the paycheck is held to t |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is -$27,459.25: you have $11,720.75 and owe $39,180.00. |
| whats the biggest mistake im making | yes | Check your car is insured. I see car costs but no car-insurance charge in 12 months. 49% sure: 24 car payments, gas or auto cover in 12 months of data; no car-c |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $1,180.00 on credit cards, at up to 20% a year. You hold $11,720.75 in cash, about 3 months of spending; a cushi |

No problems.

## Priya: High earner with stock pay

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Spread out your company stock, avoid up to $77,748 | 83% (1 stock plan in 12 months of data) | yes | company_stock 8 |
| Check for a cheaper mortgage, save $6,370 a year | 83% (1 mortgage record in 12 months of data) | yes | refinance_offers 2 |
| Look at an umbrella policy, avoid up to $994,540 | 95% (8 account balances in 12 months of data; 12 mortgage payments in 12 months of data) | yes | insurance_policies 10 |

The first chat opens:

> Good evening! You have $10,754.00 safe to spend until payday, Nov 1 (in 10 days).
> Here's what I'd do first, from looking at your money:
> - Spread out your company stock, avoid $77,748. Why you: Your company stock is $259,160.00, 64% of what you invest. 83% sure: 1 stock plan in 12 months of data.
> - Check for a cheaper mortgage, save $6,370/yr. Why you: Your rate is 6.90% on $910,000.00. 83% sure: 1 mortgage record in 12 months of data.
> - Look at an umbrella policy, avoid $994,540. Why you: You have about $994,539.80 that a big liability claim could reach. 95% sure: 8 account balances in 12 months of data; 12 mortgage payments in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| how much of my money is in my company's stock | yes | Acme Corp is $259,160.00, 66% of what you've invested. A common rule is to keep it under 10%, because a bad year for the company would hit your job and your sav |
| can i refinance my mortgage | yes | I checked sample offers from the stand-in lender catalog. |
| what insurance do i have | yes | You have 3 policies on file. |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is $994,539.80: you have $1,907,939.80 and owe $913,400.00. |
| whats the biggest mistake im making | yes | Spread out your company stock. Your company stock is $259,160.00, 64% of what you invest. 83% sure: 1 stock plan in 12 months of data. It could spare you a loss |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $3,400.00 on credit cards, at up to 20.2% a year. You hold $106,200.00 in cash, about 9.6 months of spending; a  |

No problems.

## Dan and Lena: Couple near retirement

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Look at an umbrella policy, avoid up to $1,068,749 | 95% (8 account balances in 12 months of data; 12 mortgage payments in 12 months of data) | yes | insurance_policies 9 |
| Switch to cheaper funds, save $2,249 a year | 85% (fund costs from Jane's fund table) | yes | investment_fees 2 |
| Convert some pre-tax money to a Roth, save $4,354 a year | 43% ($435,442.00 in 2 pre-tax accounts; when you'll stop working and your income then are assumptions) | yes | tax_years 12 |

The first chat opens:

> Good evening! You're short by $920.96 until payday, Nov 1 (in 10 days), after your bills.
> Here's what I'd do first, from looking at your money:
> - Look at an umbrella policy, avoid $1,068,749. Why you: You have about $1,068,748.85 that a big liability claim could reach. 95% sure: 8 account balances in 12 months of data; 12 mortgage payments in 12 months of data.
> - Switch to cheaper funds, save $2,249/yr. Why you: Northstar Target 2055 Fund ($156,054.00) costs more than a similar fund. 85% sure: fund costs from Jane's fund table.
> - Convert some pre-tax money to a Roth, save $4,354/yr. Why you: Done well, it could save about $4,354.42 a year in tax. 43% sure: $435,442.00 in 2 pre-tax accounts; when you'll stop working and your income then are assumptions.
> These need your yes:

On their list but not found yet: social_security_timing, medicare.

| Question | Understood | First line of the answer |
| --- | --- | --- |
| what insurance do i have | yes | You have 2 policies on file. |
| am i paying too much in fund fees | yes | Your investments cost about $2,520.73 a year: $2,520.73 in fund costs. Over 30 years that's roughly $211,764.75 to $484,511.22 with growth, depending on returns |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is $1,068,748.85: you have $1,131,888.85 and owe $63,140.00. |
| whats the biggest mistake im making | yes | Look at an umbrella policy. You have about $1,068,748.85 that a big liability claim could reach. 95% sure: 8 account balances in 12 months of data; 12 mortgage  |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $1,640.00 on credit cards, at up to 18% a year. You hold $67,100.00 in cash, about 17.2 months of spending; a cu |

No problems.

## Ruth: Retiree

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Ask for help with medical bills, save $4,327 a year | 95% (15 medical bills in 12 months of data) | yes | medical_bills 2 |
| Check what your annuity costs, save $1,275 a year | 60% (the annuity's fees are assumed, not read from its contract) | yes | costly_products 3 |
| Move idle cash to a higher rate, earn $1,799 a year | 85% (2 cash accounts in 12 months of data) | yes | cash_plan 5 |

The first chat opens:

> Good evening! You have $6,980.00 safe to spend until payday, Nov 1 (in 10 days).
> Here's what I'd do first, from looking at your money:
> - Ask for help with medical bills, save $4,327/yr. Why you: You paid $21,636.40 for medical care in 12 months. 95% sure: 15 medical bills in 12 months of data.
> - Check what your annuity costs, save $1,275/yr. Why you: You hold $85,000.00 in an annuity. 60% sure: the annuity's fees are assumed, not read from its contract.
> - Move idle cash to a higher rate, earn $1,799/yr. Why you: You keep $71,400.00 in cash; about $59,970.03 is more than you need. 85% sure: 2 cash accounts in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| can you check my medical bills | yes | I found 6 medical bills totalling $7,738.80. |
| what does my annuity really cost | yes | I haven't found an annuity, whole life policy or advisory fees. Add one from a statement on the costly products page and I'll show what it really costs, and wha |
| is my cash earning enough | yes | Your cash is $71,400.00 and earns about $254.78 a year. Keeping $4,029.91 in checking, the $12,089.73 emergency fund in high-yield savings (in reach within 3 da |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is $848,994.00: you have $849,414.00 and owe $420.00. |
| whats the biggest mistake im making | yes | Ask for an itemized bill, and for financial help or a no-interest plan, on your medical bills. You paid $21,636.40 for medical care in 12 months. 95% sure: 15 m |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $420.00 on credit cards, at up to 17% a year. You hold $71,400.00 in cash. I'd clear the cards first: your cash  |

No problems.

## Chris: Someone in debt trouble

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Pay off debt, highest interest first, save $2,856 a year | 95% (11 overdraft, insufficient-funds or late fees in 12 months of data) | yes | payoff_plan 2, debts 1 |
| Replace your payday loan, save $1,015 a year | 95% (12 payday loans in 12 months of data) | yes | debt_trouble 4, costly_borrowing 5 |
| Keep more cash in checking, avoid up to $2,336 | 95% (14 regular bills in 12 months of data) | yes | tight_money 8 |

The first chat opens:

> Good evening! You have $38.20 safe to spend until payday, Nov 1 (in 10 days).
> Here's what I'd do first, from looking at your money:
> - Pay off debt, highest interest first, save $2,856/yr. Why you: Your cards hold $10,090.00 and cost you $2,856.00 a year. 95% sure: 11 overdraft, insufficient-funds or late fees in 12 months of data.
> - Replace your payday loan, save $1,015/yr. Why you: Your payday loans cost about $1,015.34 in fees in 12 months. 95% sure: 12 payday loans in 12 months of data.
> - Keep more cash in checking, avoid $2,336. Why you: You hold $38.20 against about $2,374.35 a month in bills. 95% sure: 14 regular bills in 12 months of data.
> These need your yes:

| Question | Understood | First line of the answer |
| --- | --- | --- |
| how fast can i pay off my cards | Claude | (for Claude) |
| how much card interest am I paying | yes | Your cards cost about $2,978.19 a year in interest at today's balances. |
| i have too much debt, what are my options | yes | Your debt payments are $746.00 a month, 31% of your $2,420.00 income, under the 40% mark where I'd bring this up myself, but the options are here if you want th |
| how much have payday loans and cash advances cost me | yes | Costly short-term borrowing cost you $1,300.27 over the last year, across 3 kinds. |
| money is tight this month | yes | Your checking is forecast to be down to $38.20 on Oct 23, $61.80 under the cushion I like to keep. |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is -$8,851.80: you have $14,038.20 and owe $22,890.00. |
| whats the biggest mistake im making | yes | Make a plan to pay your debts off, biggest interest first. Your cards hold $10,090.00 and cost you $2,856.00 a year. 95% sure: 11 overdraft, insufficient-funds  |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $10,090.00 on credit cards, at up to 32% a year. You hold $38.20 in cash, about 0 months of spending; a cushion  |

No problems.

## Jo: Small-business owner

What Jane brought, ranked:

| Suggestion | Confidence | On their list | Tools (ms) |
| --- | --- | --- | --- |
| Check your business cover, avoid up to $50,000 | 81% (no business-cover charges in 12 months of data) | yes | insurance_risks 1 |
| Build an emergency cushion, avoid up to $78,178 | 89% (4 accounts in 12 months of data) | yes | goals 0 |
| Add disability cover for your pay, avoid up to $295,507 | 65% (59 deposits in 12 months of data; 59 deposits in 12 months of data; disability cover through your job doesn't show in your bank data) | yes | insurance_policies 10, insurance_needs 32 |

The first chat opens:

> Good evening! You have $6,008.30 safe to spend this month.
> Here's what I'd do first, from looking at your money:
> - Check your business cover, avoid $50,000. Why you: Your business takes in about $492,512.40 a year and I see no insurance charge. 81% sure: no business-cover charges in 12 months of data.
> - Build an emergency cushion, avoid $78,178. Why you: You keep $39,800.30 in cash; a cushion for you is $117,978.30. 89% sure: 4 accounts in 12 months of data.
> - Add disability cover for your pay, avoid $295,507. Why you: You earn about $41,042.70 a month, with no disability cover on file. 65% sure: 59 deposits in 12 months of data; 59 deposits in 12 months of data; disability cover through your job doesn't show in your bank data.
> These need your yes:

On their list but not found yet: cash_flow.

| Question | Understood | First line of the answer |
| --- | --- | --- |
| what risks do you see in my insurance | yes | Do you run a business from home? I saw $7,615.68 came in from SQUARE DEPOSIT on Oct 16. A home policy pays little for a business. |
| how are my goals doing | yes | You don't have any goals yet. Ask me "can I afford $900 for a trip in March" and I can start one for you. |
| what insurance do i have | yes | You have 1 policy on file. |
| whats my netwroth | Claude | (no rule answer) |
| how much am i worth rn | yes | Your net worth is $36,400.30: you have $67,800.30 and owe $31,400.00. |
| whats the biggest mistake im making | yes | Check your business has liability and property cover. Your business takes in about $492,512.40 a year and I see no insurance charge. 81% sure: no business-cover |
| wher shuld i start | Claude | (for Claude) |
| how do i stop paying so much interest | Claude | (for Claude) |
| uh should i just cancel netflix or whatever | Claude | (for Claude) |
| can u explain my budget in simple words | Claude | (for Claude) |
| is crypto a good idea for me | yes | Before crypto, here is where you stand. You owe $6,900.00 on credit cards, at up to 23.5% a year. You hold $39,800.30 in cash, about 2 months of spending; a cus |

No problems.

