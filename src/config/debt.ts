// Loans and debt (spec Phase Y, steps 109–117): every threshold, rate and limit Jane's
// debt features read. Nothing here is inline in the code.

// --- Step 109: every debt in one place -----------------------------------------------

// Buy now, pay later companies, found from their payments (src/insights/bnpl.ts). A
// payment counts when its merchant or description has one of the words.
export const BNPL_PROVIDERS = [
  { key: "affirm", name: "Affirm", words: ["affirm"] },
  { key: "klarna", name: "Klarna", words: ["klarna"] },
  { key: "afterpay", name: "Afterpay", words: ["afterpay"] },
] as const;
export type BnplProviderKey = (typeof BNPL_PROVIDERS)[number]["key"];

// A Pay in 4 plan: four equal payments two weeks apart, the first at checkout. Every one of
// these companies offers it interest-free; that's where its 0% rate comes from.
export const BNPL_PAY_IN_4_PAYMENTS = 4;
export const BNPL_PAY_IN_4_RATE_SOURCE =
  "Pay in 4 plans charge no interest under the company's own terms";
// Days between payments that read as every two weeks, and as monthly.
export const BNPL_BIWEEKLY_DAYS = { min: 12, max: 16 } as const;
export const BNPL_MONTHLY_DAYS = { min: 26, max: 35 } as const;
// Payments looked at: this far back.
export const BNPL_LOOKBACK_DAYS = 200;
// A plan is still running while its next payment is no more than this late.
export const BNPL_GRACE_DAYS = 10;
// Payments a few cents apart (rounding of the last one) are the same plan.
export const BNPL_AMOUNT_TOLERANCE_CENTS = 2;

// Terms the person types for a debt the bank doesn't report (src/lib/debts.ts): typo guards.
export const MAX_TYPED_APR_BPS = 9_999;
export const MAX_TYPED_DEBT_CENTS = 2_000_000_000;

// Jane's chat (src/config/agent-chat.ts takes these in): each debt message source's daily
// limit, and where its messages go among the rest (higher first).
export const DEBT_SOURCE_LIMITS = {
  debts: 1,
  payoff: 1,
  refinance: 1,
  loans: 2,
  transfers: 1,
  student: 1,
  mortgage: 1,
  credit: 1,
  debt_autopilot: 1,
  credit_cards: 2,
  credit_building: 2,
  bnpl: 2,
  tight_money: 2,
  medical_bills: 2,
  credit_report_fixes: 2,
  card_interest: 2,
  student_long_game: 1,
  family_loans: 1,
} as const;
export const DEBT_MESSAGE_PRIORITY = {
  // A buy now, pay later plan Jane found, then a debt with no rate: news that can wait,
  // after the questions other features need answered first (taxes, investments).
  debt_found: 31,
  debt_missing_rate: 29,
  // Spec step 110: a plan off track comes with the time-sensitive things; Jane's offer of a
  // plan and an on-track check after the findings.
  payoff_off_track: 72,
  payoff_offer: 55,
  payoff_on_track: 48,
  // Spec step 111: the refinance offer that saves the most, then any others: money that
  // can wait a few days, after the questions other features wait on (taxes, 35).
  refinance_offer: 33,
  refinance_more: 28,
  // Spec step 112: an approved loan waiting for the person's yes, and an old loan still
  // showing a balance after the new one funded, come early; funded and paid-off news after.
  loan_approved: 86,
  loan_payoff_late: 84,
  loan_funded: 50,
  loan_paid_off: 52,
  // Spec step 113: a reminder before a 0% transfer ends is a deadline; an offer can wait,
  // like refinance offers.
  transfer_reminder: 89,
  transfer_offer: 32,
  // Spec step 114: a cheaper student loan plan, and studentaid.gov's steps, both can wait.
  student_pick: 31,
  student_steps: 27,
  // Spec step 115: PMI that can come off is money every month; an escrow change is news.
  mortgage_pmi: 62,
  mortgage_escrow: 46,
  // Spec step 116: card use high enough to hurt the score; a score that moved.
  credit_utilisation: 47,
  credit_moved: 34,
  // Spec step 117: a rate the bank changed is news; a due date to move and a plan Jane
  // started by herself can wait a little.
  debt_rate_changed: 63,
  debt_due_move: 33,
  debt_plan_started: 49,
  // Spec step 174: a fee that doesn't pay for itself and a better card are money that can
  // wait, after the questions other features wait on (taxes, 35); which card for what last.
  card_fee: 30,
  card_better: 30,
  card_picks: 26,
  // Spec step 175: a payment before a statement closes has a date; one Jane scheduled is
  // news; a streak milestone and a credit-builder offer can wait.
  statement_pay: 70,
  statement_paid: 51,
  credit_streak: 30,
  credit_builder: 29,
  // Spec step 176: installments before payday that the forecast missed come just under the
  // findings (60), so a first day still shows them; a free early payoff can wait.
  bnpl_due: 58,
  bnpl_payoff: 31,
  // Spec step 177: a plan for a tight month is time-sensitive; a lender's answer follows.
  tight_plan: 88,
  tight_answer: 66,
  // Spec step 180: a medical bill can wait a little; a provider's answer follows.
  medical_bill: 36,
  medical_answer: 60,
  // Spec step 181: a collection's validation window closes in 30 days, so it comes just
  // under the findings (60), which a first day must still show; a bureau dispute and the
  // answers can wait a little.
  report_fix_window: 59,
  report_fix: 40,
  report_fix_answer: 61,
  // Spec step 224: a promotion off pace has a date, so it comes just under the findings
  // (60); a rate request and the answers can wait a little.
  promo_off_pace: 59,
  card_rate_ask: 37,
  card_rate_answer: 62,
  // Spec step 225: student loan paperwork due within a month has a date.
  student_paperwork: 64,
  // Spec step 226: a loan to a friend is asked about once, under the findings; a reminder
  // and a co-signed loan going late can wait a little longer or come earlier.
  family_candidate: 38,
  family_reminder: 35,
  cosigned_late: 68,
} as const;

// What Jane does about debts by herself at each autopilot level (src/config/autopilot.ts),
// step by step. Applying for credit, moving money and signing always need the person's tap,
// at every level. Steps 110–117, 174–181 and 224–230 add to this list.
export const DEBT_AUTOPILOT: Readonly<
  Record<"ask" | "safe" | "all", readonly { step: number; does: string }[]>
> = {
  ask: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
    },
    {
      step: 115,
      does: "Watches your mortgage: tells you once when your home's value lets PMI come off (and drafts the request), spots escrow changes in your payment, and works out refinance break-even and extra payments. Sending the request and paying more are yours.",
    },
    {
      step: 116,
      does: "Checks your credit score once a month with a soft pull (it never affects the score), explains what's helping and hurting, and tells you how much to pay on a card before the statement to bring your card use down.",
    },
    {
      step: 117,
      does: "Watches every rate your bank reports and tells you when one changes, and drafts a request to move a payment due just before payday. Starting a payoff plan waits for your yes.",
    },
    {
      step: 174,
      does: "Works out what each of your cards earns on your own spending, fee included, and tells you when a fee doesn't pay for itself or another card would earn more. Applying is always your tap.",
    },
    {
      step: 175,
      does: "Reminds you before a card's statement closes with what to pay so a lower balance is reported, counts your on-time streak, and estimates what each change would do to your score. Paying waits for your tap.",
    },
    {
      step: 176,
      does: "Puts every buy now, pay later installment in your forecast and safe to spend, warns you before a new plan would strain the month, and tells you when paying a Pay in 4 plan off early is free. Paying waits for your tap.",
    },
    {
      step: 177,
      does: "When your forecast shows a tight month, prepares one plan: bills in order (housing, utilities and insurance first), and written requests to move a due date, ask for hardship help, a lower rate or a late fee waived. Every request waits for your tap.",
    },
    {
      step: 178,
      does: "When you ask about a car, works out what you can afford with insurance and running costs in, compares preapproval offers by what they cost in all, and checks a dealer's financing against them. Nothing is applied for without your tap.",
    },
    {
      step: 179,
      does: "When you ask about buying a home, works out what you can afford from your real income and debts, the cash needed up front, how long saving takes, and compares mortgage offers. Starting the down payment goal waits for your tap.",
    },
    {
      step: 180,
      does: "Finds medical bills in your payments, and writes the requests that can lower them (an itemized bill, a check against your insurance, financial assistance, a plan with no interest). Each is sent only on your tap.",
    },
    {
      step: 181,
      does: "Checks your credit report every month for collections and errors, writes the validation letter or bureau dispute that fits (citing the rule and its deadline), puts the answer dates on your deadlines and tells you what comes back. Each letter is sent only on your tap.",
    },
    {
      step: 224,
      does: "Shows what each card costs in interest, what paying early saves, and how a 0% promotion is pacing (a deadline with the monthly amount if it's off pace), and writes a request and call script for a lower rate. Each request is sent only on your tap.",
    },
    {
      step: 225,
      does: "Counts Public Service Loan Forgiveness month by month, puts the employer certification and income-driven recertification dates on your deadlines, sizes the tax on forgiven debt for your tax plan, and tells you what a refinance would give up.",
    },
    {
      step: 226,
      does: "Spots large payment-app transfers (Venmo, Zelle, Cash App) that might be a loan and asks you once, tracks what comes back, drafts a kind reminder for you to send yourself, and warns about a late payment on a loan you co-signed. A transfer is a loan only after you say so; I never message the other person.",
    },
  ],
  safe: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
    },
    {
      step: 115,
      does: "Watches your mortgage: tells you once when your home's value lets PMI come off (and drafts the request), spots escrow changes in your payment, and works out refinance break-even and extra payments. Sending the request and paying more are yours.",
    },
    {
      step: 116,
      does: "Checks your credit score once a month with a soft pull (it never affects the score), explains what's helping and hurting, and tells you how much to pay on a card before the statement to bring your card use down.",
    },
    {
      step: 117,
      does: "Watches every rate your bank reports and tells you when one changes, drafts a request to move a payment due just before payday, and starts your payoff plan by itself if you haven't, so it's checked every month.",
    },
    {
      step: 174,
      does: "Works out what each of your cards earns on your own spending, fee included, tells you which card to use for each kind of spending whenever that changes, and when another card would earn more. Applying is always your tap.",
    },
    {
      step: 175,
      does: "Pays the amount that brings card use down before a card's statement closes, by itself through the money-movement stand-in within your debt limits, counts your on-time streak, and estimates what each change would do to your score. Opening a credit-builder account is always your tap.",
    },
    {
      step: 176,
      does: "Puts every buy now, pay later installment in your forecast and safe to spend, warns you before a new plan would strain the month, and pays a Pay in 4 plan off early when that's free, with your tap.",
    },
    {
      step: 177,
      does: "When your forecast shows a tight month, prepares one plan: bills in order (housing, utilities and insurance first), and written requests to move a due date, ask for hardship help, a lower rate or a late fee waived. Every request waits for your tap.",
    },
    {
      step: 178,
      does: "When you ask about a car, works out what you can afford with insurance and running costs in, compares preapproval offers by what they cost in all, and checks a dealer's financing against them. Nothing is applied for without your tap.",
    },
    {
      step: 179,
      does: "When you ask about buying a home, works out what you can afford from your real income and debts, the cash needed up front, how long saving takes, and compares mortgage offers. Starting the down payment goal waits for your tap.",
    },
    {
      step: 180,
      does: "Finds medical bills in your payments, and writes the requests that can lower them (an itemized bill, a check against your insurance, financial assistance, a plan with no interest). Each is sent only on your tap.",
    },
    {
      step: 181,
      does: "Checks your credit report every month for collections and errors, writes the validation letter or bureau dispute that fits (citing the rule and its deadline), puts the answer dates on your deadlines and tells you what comes back. Each letter is sent only on your tap.",
    },
    {
      step: 224,
      does: "Shows what each card costs in interest, what paying early saves, and how a 0% promotion is pacing (a deadline with the monthly amount if it's off pace), and writes a request and call script for a lower rate. Each request is sent only on your tap.",
    },
    {
      step: 225,
      does: "Counts Public Service Loan Forgiveness month by month, puts the employer certification and income-driven recertification dates on your deadlines, sizes the tax on forgiven debt for your tax plan, and tells you what a refinance would give up.",
    },
    {
      step: 226,
      does: "Spots large payment-app transfers (Venmo, Zelle, Cash App) that might be a loan and asks you once, tracks what comes back, drafts a kind reminder for you to send yourself, and warns about a late payment on a loan you co-signed. A transfer is a loan only after you say so; I never message the other person.",
    },
  ],
  all: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
    },
    {
      step: 115,
      does: "Watches your mortgage: tells you once when your home's value lets PMI come off (and drafts the request), spots escrow changes in your payment, and works out refinance break-even and extra payments. Sending the request and paying more are yours.",
    },
    {
      step: 116,
      does: "Checks your credit score once a month with a soft pull (it never affects the score), explains what's helping and hurting, and tells you how much to pay on a card before the statement to bring your card use down.",
    },
    {
      step: 117,
      does: "Watches every rate your bank reports and tells you when one changes, drafts a request to move a payment due just before payday, and starts your payoff plan by itself if you haven't, so it's checked every month.",
    },
    {
      step: 174,
      does: "Works out what each of your cards earns on your own spending, fee included, tells you which card to use for each kind of spending whenever that changes, and when another card would earn more. Applying is always your tap.",
    },
    {
      step: 175,
      does: "Pays the amount that brings card use down before a card's statement closes, by itself through the money-movement stand-in within your debt limits, counts your on-time streak, and estimates what each change would do to your score. Opening a credit-builder account is always your tap.",
    },
    {
      step: 176,
      does: "Puts every buy now, pay later installment in your forecast and safe to spend, warns you before a new plan would strain the month, and pays a Pay in 4 plan off early when that's free, with your tap.",
    },
    {
      step: 177,
      does: "When your forecast shows a tight month, prepares one plan: bills in order (housing, utilities and insurance first), and written requests to move a due date, ask for hardship help, a lower rate or a late fee waived. Every request waits for your tap.",
    },
    {
      step: 178,
      does: "When you ask about a car, works out what you can afford with insurance and running costs in, compares preapproval offers by what they cost in all, and checks a dealer's financing against them. Nothing is applied for without your tap.",
    },
    {
      step: 179,
      does: "When you ask about buying a home, works out what you can afford from your real income and debts, the cash needed up front, how long saving takes, and compares mortgage offers. Starting the down payment goal waits for your tap.",
    },
    {
      step: 180,
      does: "Finds medical bills in your payments, and writes the requests that can lower them (an itemized bill, a check against your insurance, financial assistance, a plan with no interest). Each is sent only on your tap.",
    },
    {
      step: 181,
      does: "Checks your credit report every month for collections and errors, writes the validation letter or bureau dispute that fits (citing the rule and its deadline), puts the answer dates on your deadlines and tells you what comes back. Each letter is sent only on your tap.",
    },
    {
      step: 224,
      does: "Shows what each card costs in interest, what paying early saves, and how a 0% promotion is pacing (a deadline with the monthly amount if it's off pace), and writes a request and call script for a lower rate. Each request is sent only on your tap.",
    },
    {
      step: 225,
      does: "Counts Public Service Loan Forgiveness month by month, puts the employer certification and income-driven recertification dates on your deadlines, sizes the tax on forgiven debt for your tax plan, and tells you what a refinance would give up.",
    },
    {
      step: 226,
      does: "Spots large payment-app transfers (Venmo, Zelle, Cash App) that might be a loan and asks you once, tracks what comes back, drafts a kind reminder for you to send yourself, and warns about a late payment on a loan you co-signed. A transfer is a loan only after you say so; I never message the other person.",
    },
  ],
};

// --- Step 110: payoff plans ----------------------------------------------------------

// Debts the payoff plan leaves out: a mortgage runs for decades on its own schedule and
// would swamp the plan (step 115 watches it). Same as the planner (PLANNER_LEFT_OUT_SUBTYPES).
export const PAYOFF_LEFT_OUT_KINDS: readonly string[] = ["mortgage"];
// A Pay in 4 plan's payment comes every two weeks: this many count toward a month.
export const BNPL_PAYMENTS_PER_MONTH = 2;
// "What if I paid more?": the extra a month each scenario adds on top of the minimums.
export const DEBT_EXTRA_SCENARIOS_CENTS: readonly number[] = [0, 5_000, 10_000, 25_000];
// The most extra a month the chat or the page takes, as a typo guard.
export const MAX_DEBT_EXTRA_CENTS = 10_000_000;
// Demo advice picks highest rate first (least interest), unless smallest balance first
// costs at most this much more interest and clears its first debt at least this many
// months sooner: then the early win is worth the small cost.
export const SNOWBALL_PICK_MAX_EXTRA_INTEREST_CENTS = 5_000;
export const SNOWBALL_QUICK_WIN_MONTHS = 3;
// The plan checks itself once this many days have passed since its last check.
export const DEBT_PLAN_CHECK_DAYS = 28;
// Months of expected balances kept, to compare with what's owed at each check.
export const DEBT_PLAN_TRACK_MONTHS = 24;
// Off track: owing more than the plan expected by more than this share of what the plan
// meant to pay down since the last check, and by at least this much.
export const DEBT_OFF_TRACK_SHARE = 0.5;
export const DEBT_OFF_TRACK_MIN_CENTS = 10_000;

// --- Step 111: refinance offers --------------------------------------------------------

// The kinds of loan a lender partner refinances (src/lib/lenders), and which of the
// person's debts each takes: a card's balance moves to a personal loan.
export const LOAN_PRODUCTS = ["student", "auto", "mortgage", "personal"] as const;
export type LoanProduct = (typeof LOAN_PRODUCTS)[number];
export const PRODUCT_FOR_DEBT: Readonly<Record<string, LoanProduct>> = {
  student: "student",
  auto: "auto",
  mortgage: "mortgage",
  loan: "personal",
  card: "personal",
};
// A card has no end date, so its offers are compared over this many months.
export const REFI_CARD_TERM_MONTHS = 36;
// Jane asks the lender partner for offers this often, by herself.
export const REFI_CHECK_DAYS = 30;
// And brings one up only when it saves at least this much over the same term, fees in.
export const REFI_MIN_SAVING_CENTS = 30_000;
// Offers shown besides the pick.
export const REFI_RUNNERS_UP = 2;
// Jane picks the cheapest fixed-rate offer that saves enough before a cheaper variable one:
// a variable rate can go up, so its saving isn't certain.
export const REFI_PREFER_FIXED = true;
// Which lender partner to use: "demo" is the stand-in catalog (demo-bank people only, never
// in production unless DEMO_BANK=1); "none" turns refinancing off. A real loan marketplace
// partner is a new value here and a new implementation of LenderPartner.
export const LENDER_PARTNER: "demo" | "none" = "demo";

// --- Step 112: one-tap apply ------------------------------------------------------------

// The stand-in lender funds an accepted loan this many days later (a real one says when).
export const DEMO_LOAN_FUNDING_DAYS = 3;
// Once funded, the old loan should show as paid off within this many days; after that Jane
// tells the person it still shows a balance.
export const LOAN_PAYOFF_WAIT_DAYS = 10;
// An old loan counts as paid off at or under this balance (a few cents of interest).
export const LOAN_PAID_OFF_CENTS = 100;
// An approved loan the person hasn't answered: Jane reminds them after this many days.
export const LOAN_APPROVED_REMIND_DAYS = 1;

// --- Step 113: balance transfers ----------------------------------------------------------

// A 0% transfer is worth bringing up when it saves at least this much against keeping the
// card, the transfer fee counted, paying the same each month.
export const BT_MIN_SAVING_CENTS = 10_000;
// Reminders before the 0% ends, in days. The promo end also goes on Deadlines.
export const BT_REMIND_DAYS: readonly number[] = [60, 30, 7];
// The demo bank shows a moved card balance gone this many days after the transfer.
export const DEMO_TRANSFER_DAYS = 2;

// --- Step 115: mortgage ------------------------------------------------------------------

// PMI (Homeowners Protection Act, as the CFPB explains it): you can ask your servicer to
// cancel it once the balance is 80% of the home's original value, and it ends by itself at
// 78%. Many lenders also take today's value (usually with an appraisal). Jane raises it
// once the value the person gave (spec step 67) puts the loan under 80%.
export const PMI_ASK_LTV = 0.8;
export const PMI_AUTO_LTV = 0.78;
export const PMI_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/";
// "What if I paid more on the mortgage?": extra principal a month.
export const MORTGAGE_EXTRA_SCENARIOS_CENTS: readonly number[] = [10_000, 25_000, 50_000];
// A mortgage payment that moves by at least this much is an escrow change (taxes or
// insurance), when the rate is fixed.
export const ESCROW_CHANGE_MIN_CENTS = 1_000;

// --- Step 116: credit score ----------------------------------------------------------------

// Which credit partner to use: "demo" is the stand-in (demo-bank people only, labelled, never
// a real score); "none" turns it off. A real credit partner (a bureau or a licensed score
// provider, soft pulls only) is a new value here and a new CreditPartner implementation.
export const CREDIT_PARTNER: "demo" | "none" = "demo";
// Jane pulls the score this often by herself (a soft pull: it never affects the score).
export const CREDIT_CHECK_DAYS = 30;
// Card utilisation: the share of card limits in use. Under the first is helping; over the
// second is hurting. Paying down before the statement closes brings the reported share down.
export const UTILISATION_GOOD = 0.1;
export const UTILISATION_HIGH = 0.3;
// Score bands the lender stand-ins price by (src/lib/lenders), from the score.
export const CREDIT_BANDS = { excellent: 740, good: 670 } as const;
// A move this big since the last pull is worth a message.
export const CREDIT_SCORE_MOVE_POINTS = 10;

// --- Step 117: debt on autopilot ------------------------------------------------------------

// A payment due this many days or fewer before a payday is worth moving to just after it.
export const DUE_BEFORE_PAYDAY_DAYS = 5;
// Where Jane suggests moving it: this many days after the payday.
export const DUE_AFTER_PAYDAY_DAYS = 3;
// Paychecks looked at to find the paydays.
export const PAYDAY_LOOKBACK_DAYS = 62;
// Debt payments listed for "when are my debt payments due?": this many days ahead.
export const DEBT_DUE_DAYS = 31;
