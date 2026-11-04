import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import type { Frequency } from "./recurring";

// --- Alerts (src/detection/alerts.ts) ------------------------------------------------

// Only events this recent raise an alert, so importing a year of history doesn't send a
// year of alerts.
export const ALERT_RECENT_DAYS = 7;
// How far ahead /subscriptions looks for each charge's next date: past a year, so yearly
// charges have one.
export const NEXT_CHARGE_WINDOW_DAYS = 400;
// Yearly and quarterly renewals get a "renews soon" alert this many days ahead (monthly
// charges are too frequent to be news).
export const RENEWAL_ALERT_DAYS = 7;
export const RENEWAL_FREQUENCIES: readonly Frequency[] = ["QUARTERLY", "SEMIANNUALLY", "ANNUALLY"];
// A bill reminder comes this many days before the bill's expected date.
export const BILL_REMINDER_DAYS = 3;
// Recurring charges that aren't bills to pay (books QA): card interest is added to the card's
// balance, which its own payment covers.
// The same for an ATM's fee (overnight upload QA: a student's "Non-Chase Atm Fee" was a $3
// bill every two weeks): it follows taking cash out, it isn't a bill to pay.
export const NOT_BILL_CATEGORIES: readonly string[] = [
  "BANK_FEES_INTEREST_CHARGE",
  "BANK_FEES_ATM_FEES",
];
// A habit at one price every week or two (the same coffee) is regular but not a bill to pay, so
// "Coming up" leaves it out (accuracy bench: weekly fixed-price coffee was listed as coming up).
export const NOT_BILL_HABIT_PRIMARIES: readonly string[] = ["FOOD_AND_DRINK"];
export const NOT_BILL_HABIT_FREQUENCIES: readonly Frequency[] = ["WEEKLY", "BIWEEKLY"];
// Boxes sold by subscription, whatever their category: a meal kit every week is a plan to review
// and a bill coming up, not a food habit (CSV bench, second tuning set: HelloFresh and Factor
// every week were missed). Whole words of the merchant name, lower case. Never a yearly plan from
// one order, so not SUBSCRIPTION_MERCHANTS.
export const SUBSCRIPTION_BOX_MERCHANTS: readonly string[] = [
  "hellofresh",
  "hello fresh",
  "factor75",
  "blue apron",
  "home chef",
  "green chef",
  "everyplate",
  "sunbasket",
  "marley spoon",
  "dinnerly",
  "gobble",
  "freshly",
  "daily harvest",
  "purple carrot",
  "butcherbox",
  "barkbox",
  "ipsy",
  "birchbox",
  "fabfitfun",
  "dollar shave club",
  "stitch fix",
  "misfits market",
  "imperfect foods",
];
export const CARD_PAYMENT_NAME = "Credit card payment";
// Card companies as a payment to them reads from checking, and the name for a card of theirs: a
// card payment is named for its card, not "Credit card payment" (overnight beta list).
export const CARD_ISSUERS: readonly (readonly [RegExp, string])[] = [
  [/\bchase\b/i, "Chase"],
  [/\bamex\b|american express/i, "American Express"],
  [/\bciti(bank|cards?)?\b/i, "Citi"],
  [/capital one/i, "Capital One"],
  [/\bdiscover\b/i, "Discover"],
  [/bank of america|\bbofa\b|\bbk of amer/i, "Bank of America"],
  [/wells fargo/i, "Wells Fargo"],
  [/\bbarclay/i, "Barclays"],
  [/\bsynchrony\b|\bsyncb\b/i, "Synchrony"],
  [/apple ?card|\bgs bank\b|goldman sachs/i, "Apple Card"],
  [/\bus ?bank\b/i, "U.S. Bank"],
  [/navy federal/i, "Navy Federal"],
  [/\busaa\b/i, "USAA"],
  [/\bpenfed\b/i, "PenFed"],
  [/\btd bank\b/i, "TD Bank"],
];
// A card's account name may use a short form of its issuer's name.
export const CARD_ISSUER_SHORT: Readonly<Record<string, readonly string[]>> = {
  "American Express": ["amex"],
  "Bank of America": ["bofa"],
  "U.S. Bank": ["us bank", "usbank"],
};
// The payment category for a card or loan, by account type, then subtype (Plaid's detailed
// categories). When the bank reports the due date of every such account, the deadline is the
// one reminder for that payment and the guessed bill reminder is left out (books QA: two
// reminders, with different amounts, for one card payment).
export const PAYMENT_CATEGORY_BY_ACCOUNT: Readonly<Record<string, string>> = {
  credit: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  auto: "LOAN_PAYMENTS_CAR_PAYMENT",
  student: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
  mortgage: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  "home equity": "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  personal: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
};
// A card payment from checking is found by its other side when the card company's name isn't in
// the keyword rules (accuracy bench: "BARCLAYCARD US PAYMENT" was counted as spending and missed
// from "Coming up"): the same amount, out of a bank account, within this many days of the card's
// "payment, thank you".
export const CARD_PAYMENT_MATCH_DAYS = 3;
// Money moved between the person's own accounts (chat QA): saving, investing or into an HSA.
// Never a recurring charge. Payment-app transfers and wires stay: they can be rent to a person.
// Cash taken out at an ATM is the person's own money too (overnight upload QA: "Atm
// Withdrawal, $40 every two weeks" was a bill); the forecast still takes it out of checking.
export const OWN_ACCOUNT_TRANSFERS: readonly string[] = [
  "TRANSFER_OUT_ACCOUNT_TRANSFER",
  "TRANSFER_OUT_SAVINGS",
  "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
  "TRANSFER_OUT_WITHDRAWAL",
];
// Safe to spend holds back these regular transfers out before payday: ones that may be paying
// someone (rent by Zelle before the person says it's rent), not moves to savings, investments
// or cash, which a goal's monthly amount already holds back (review 10-31).
export const PAYMENT_TRANSFERS: readonly string[] = ["TRANSFER_OUT_ACCOUNT_TRANSFER"];
// A move out of one of the person's checking accounts that arrives in another within this many
// days stays in checking: safe to spend leaves it alone.
export const OWN_MOVE_DAYS = 3;
// A charge is unusually large when it is at least this much (in cents)...
export const LARGE_CHARGE_MIN_CENTS = 50_000;
// ...and at least this many times the account's typical (median) charge...
export const LARGE_CHARGE_MEDIAN_MULTIPLE = 5;
// ...judged only once the account has this many charges to compare with.
export const LARGE_CHARGE_MIN_HISTORY = 10;
// Two charges at the same merchant, for the same amount, this many days apart or less
// might be a double charge.
export const DUPLICATE_CHARGE_WINDOW_DAYS = 1;
// Smaller repeats (a second coffee) aren't worth an alert.
export const DUPLICATE_CHARGE_MIN_CENTS = 1_000;
// Where buying the same thing twice in a day is normal, or the "charge" is money moving.
// Two bank fees on one day are the bank's fee schedule (two overdrafts), and the bank fees
// finding already asks for them back (accuracy bench, first held-out set).
export const DUPLICATE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "TRANSPORTATION",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
];
// ...except a meal: the same restaurant bill this big twice is a double charge, not a second
// coffee (accuracy bench: the family's $68.40 dinner charged on two days was missed).
export const DUPLICATE_CHARGE_MEAL_MIN_CENTS = 3_000;
// A seat each: two or three tickets or fares at one price on one day are a group buying
// together, not a mistake (accuracy bench: every one of the 7 false "Charged twice?" was a pair
// of concert tickets). A real double charge at a ticket seller is missed; the bank's dispute
// still covers it.
export const DUPLICATE_CHARGE_PER_SEAT_CATEGORIES: readonly PfcDetailed[] = [
  "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
  "TRAVEL_FLIGHTS",
  "TRANSPORTATION_PUBLIC_TRANSIT",
];
// Two orders, not one charged twice: each charge carries its own order number after the
// processor's "*" ("AMZN Mktp US*2K4L91Z3" and "AMZN Mktp US*7HQ2MX0PB"; CSV bench, second tuning
// set). The number has a digit in it, so a plain name after a "*" is not one.
export const DUPLICATE_CHARGE_ORDER_NUMBER = /\*\s*([A-Z0-9]*[0-9][A-Z0-9]*)/;
// Cinemas sell a seat each too, but Plaid (and Claude) file them with streaming services. A
// streaming service's double charge is on a plan paid on other days too; a cinema visit is one
// day. So in these categories, two at one price on the only day a merchant was ever paid are
// seats (CSV bench: two seats at a cinema whose name says nothing).
export const DUPLICATE_CHARGE_SEAT_UNLESS_RECURRING_CATEGORIES: readonly PfcDetailed[] = [
  "ENTERTAINMENT_TV_AND_MOVIES",
];
// Cinemas are also known by name (whole words of the merchant; accuracy bench, first
// held-out set: two seats at AMC).
// This many identical charges at one place on one day are a group's seats (or rounds), not a
// card run twice: a shop doesn't run a card three times (CSV bench: tickets at a cinema whose
// name says nothing).
export const DUPLICATE_CHARGE_GROUP_MIN = 3;
// The same price twice on one day, in this many months or more, is two plans (a second account, a
// family member's), not a double charge each month: recurring charges list both, and neither is
// "Charged twice?" (upload QA: Spotify $11.99 twice every month showed as two double charges and
// was missing from /subscriptions).
export const TWIN_PLAN_MIN_MONTHS = 2;
// Plans from one company at different prices (Spotify $11.99 and $16.99, each every month): this
// many prices, each a run, that together hold RUN_MIN_SHARE_OF_CHARGES of its charges (QA round 30).
export const PRICE_PLANS_MIN = 2;
// ...each billed like a plan: monthly. Two prices alternating every week are shopping.
export const PRICE_PLANS_FREQUENCIES: readonly Frequency[] = ["MONTHLY"];
export const DUPLICATE_CHARGE_PER_SEAT_WORDS: readonly string[] = [
  "theatre",
  "theatres",
  "theater",
  "theaters",
  "cinema",
  "cinemas",
  "cineplex",
  // The big chains by name, which their card descriptors use alone ("AMC 0517 ONLINE"; CSV bench).
  "amc",
  "regal",
  "cinemark",
  "fandango",
  // Films and box offices by their words (CSV bench, round 9).
  "film",
  "films",
  "movies",
  "tickets",
];
// Money moving rather than spent never counts as an unusually large charge.
export const LARGE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
];
