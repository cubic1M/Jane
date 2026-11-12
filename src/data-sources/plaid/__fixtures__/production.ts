import type { AccountBase, Transaction, TransactionStream } from "plaid";
import { plaidAccount, plaidStream, plaidTransaction } from "./plaid";

// A made-up student at one OAuth bank, as Plaid production sends them (beta accuracy, checked
// against plaid.com/docs/transactions/transactions-data and /api/products/transactions on
// 2026-11-12). Built by hand, never from anyone's data. What production does that sandbox mostly
// doesn't, each below:
// - pending charges that post at another amount (a tip) or never post (a gas hold), the posted one
//   pointing at its pending one by pending_transaction_id, the pending one listed in `removed` on a
//   later page of the same update, or in a later update;
// - a charge that went pending and posted between two syncs, both sent in one update;
// - "transaction churn": a posted transaction removed and added again under a new id;
// - a posted transaction modified (the amount the bank settled on);
// - transfers between the person's own checking and savings, and card payments, on both sides;
// - refunds (negative amounts in a spending category) on the card and on checking;
// - money in: pay, savings interest, a friend paying back through an app;
// - checking, savings and a card at one bank, under one login (one Item);
// - an `accounts` array that only lists the accounts with transactions in the response.
// The figures a person should see are written out by hand in PRODUCTION_EXPECTED, never worked out
// by the code under test.

export const PRODUCTION_NOW = new Date("2026-11-05T15:00:00Z");

type Pfc = [primary: string, detailed: string];
const PAY: Pfc = ["INCOME", "INCOME_SALARY"];
const INTEREST: Pfc = ["INCOME", "INCOME_INTEREST_EARNED"];
const RENT: Pfc = ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"];
const TO_SAVINGS: Pfc = ["TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"];
const FROM_CHECKING: Pfc = ["TRANSFER_IN", "TRANSFER_IN_SAVINGS"];
const FROM_APP: Pfc = ["TRANSFER_IN", "TRANSFER_IN_TRANSFER_IN_FROM_APPS"];
const CARD_PAYMENT: Pfc = ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];
const MUSIC: Pfc = ["ENTERTAINMENT", "ENTERTAINMENT_MUSIC_AND_AUDIO"];
const GROCERIES: Pfc = ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"];
const RESTAURANT: Pfc = ["FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"];
const COFFEE: Pfc = ["FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"];
const GAS: Pfc = ["TRANSPORTATION", "TRANSPORTATION_GAS"];
const SUPERSTORE: Pfc = ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES"];
const MARKETPLACE: Pfc = ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"];

export type ProductionBank = {
  accounts: { checking: AccountBase; savings: AccountBase; card: AccountBase };
  // Each sync is one /transactions/sync run: its pages, in order.
  syncs: SyncResponse[][];
  recurring: { outflow_streams: TransactionStream[]; inflow_streams: TransactionStream[] };
  liabilities: unknown;
  // Ids of what must and mustn't be stored after the last sync.
  ids: (name: string) => string;
};

export type SyncResponse = {
  data: {
    added: Transaction[];
    modified: Transaction[];
    removed: { transaction_id: string; account_id: string }[];
    accounts: AccountBase[];
    next_cursor: string;
    has_more: boolean;
    transactions_update_status: string;
    request_id: string;
  };
};

// `prefix` keeps one bank's ids apart from another's: a second link of the same bank (OAuth
// re-linked rather than reconnected) gets new account and transaction ids for the same accounts,
// as Plaid does for a new Item.
export function productionBank(prefix: string): ProductionBank {
  const id = (name: string) => `${prefix}-${name}`;
  const checking = plaidAccount({
    account_id: id("checking"),
    name: "TOTAL CHECKING",
    official_name: "Total Checking",
    mask: "4321",
    type: "depository",
    subtype: "checking",
    // Available is current less what's pending (Plaid's accounts docs); the app keeps current.
    balances: { current: 2150, available: 2101.25, limit: null, iso_currency_code: "USD" },
  } as never);
  const savings = plaidAccount({
    account_id: id("savings"),
    name: "SAVINGS",
    official_name: "Premier Savings",
    mask: "8765",
    type: "depository",
    subtype: "savings",
    balances: { current: 3900, available: 3900, limit: null, iso_currency_code: "USD" },
  } as never);
  const card = plaidAccount({
    account_id: id("card"),
    name: "CREDIT CARD",
    official_name: "Freedom Unlimited",
    mask: "1111",
    type: "credit",
    subtype: "credit card",
    // What's owed, positive; available is the limit less it and what's pending.
    balances: { current: 431.63, available: 4520.37, limit: 5000, iso_currency_code: "USD" },
  } as never);

  const tx = (
    name: string,
    account: AccountBase,
    date: string,
    amount: number,
    description: string,
    merchant: string | null,
    [primary, detailed]: Pfc,
    extra: Partial<Transaction> = {},
  ): Transaction =>
    plaidTransaction({
      transaction_id: id(name),
      account_id: account.account_id,
      date,
      authorized_date: date,
      amount,
      name: description,
      merchant_name: merchant,
      pending: false,
      pending_transaction_id: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
      personal_finance_category: { primary, detailed, confidence_level: "VERY_HIGH" },
      ...extra,
    } as Partial<Transaction>);

  const months = ["08", "09", "10"] as const;
  const history: Transaction[] = [
    // Pay twice a month, into checking.
    ...months.flatMap((m) => [
      tx(`pay-${m}-a`, checking, `2026-${m}-01`, -1250, "ACME CORP DIR DEP", "Acme Corp", PAY),
      tx(`pay-${m}-b`, checking, `2026-${m}-15`, -1250, "ACME CORP DIR DEP", "Acme Corp", PAY),
    ]),
    tx("pay-11-a", checking, "2026-11-01", -1250, "ACME CORP DIR DEP", "Acme Corp", PAY),
    // Rent, by bill pay from checking.
    ...months.map((m) =>
      tx(`rent-${m}`, checking, `2026-${m}-02`, 950, "OAKWOOD APTS BILL PAY", "Oakwood Apts", RENT),
    ),
    // To savings, both sides.
    ...months.flatMap((m) => [
      tx(
        `save-out-${m}`,
        checking,
        `2026-${m}-05`,
        300,
        "ONLINE TRANSFER TO SAV XXXXX8765",
        null,
        TO_SAVINGS,
      ),
      tx(
        `save-in-${m}`,
        savings,
        `2026-${m}-05`,
        -300,
        "ONLINE TRANSFER FROM CHK XXXXX4321",
        null,
        FROM_CHECKING,
      ),
    ]),
    // Savings interest.
    tx("interest-08", savings, "2026-08-31", -1.21, "INTEREST PAYMENT", null, INTEREST),
    tx("interest-09", savings, "2026-09-30", -1.84, "INTEREST PAYMENT", null, INTEREST),
    tx("interest-10", savings, "2026-10-31", -2.1, "INTEREST PAYMENT", null, INTEREST),
    // The card paid in full from checking each month, both sides.
    ...(
      [
        ["08", "22", "23", 412.37],
        ["09", "22", "23", 388.1],
        ["10", "22", "23", 405.55],
      ] as const
    ).flatMap(([m, out, card_, amount]) => [
      tx(
        `autopay-${m}`,
        checking,
        `2026-${m}-${out}`,
        amount,
        "CHASE CREDIT CRD AUTOPAY PPD",
        null,
        CARD_PAYMENT,
      ),
      tx(
        `card-paid-${m}`,
        card,
        `2026-${m}-${card_}`,
        -amount,
        "AUTOMATIC PAYMENT - THANK YOU",
        null,
        CARD_PAYMENT,
      ),
    ]),
    // A friend pays back their half of dinner.
    tx("venmo-in", checking, "2026-09-20", -30, "VENMO CASHOUT", "Venmo", FROM_APP),
    // On the card: music every month, groceries, eating out, a return.
    ...months.map((m) =>
      tx(`spotify-${m}`, card, `2026-${m}-12`, 11.99, "SPOTIFY USA", "Spotify", MUSIC),
    ),
    tx("grocery-08-a", card, "2026-08-09", 87.4, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("grocery-08-b", card, "2026-08-23", 92.15, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("grocery-09-a", card, "2026-09-06", 78.9, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("grocery-09-b", card, "2026-09-21", 101.33, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("grocery-10-a", card, "2026-10-04", 84.12, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("grocery-10-b", card, "2026-10-19", 95.6, "SAFEWAY STORE", "Safeway", GROCERIES),
    tx("dinner-08", card, "2026-08-15", 42.5, "CHIPOTLE ONLINE", "Chipotle", RESTAURANT),
    tx("dinner-09", card, "2026-09-17", 38.75, "CHIPOTLE ONLINE", "Chipotle", RESTAURANT),
    tx("target", card, "2026-09-18", 120, "TARGET", "Target", SUPERSTORE),
    tx("target-return", card, "2026-09-25", -60, "TARGET", "Target", SUPERSTORE),
    // A debit purchase sent back in full.
    tx("amazon", checking, "2026-10-08", 89.99, "AMAZON MKTPL", "Amazon", MARKETPLACE),
    tx(
      "amazon-refund",
      checking,
      "2026-10-14",
      -89.99,
      "AMAZON MKTPL REFUND",
      "Amazon",
      MARKETPLACE,
    ),
  ];

  // Pending at the first sync: dinner before the tip, and a gas station's hold.
  const pendingDinner = tx(
    "pending-dinner",
    card,
    "2026-11-02",
    40,
    "THE LOCAL CAFE",
    "The Local Cafe",
    RESTAURANT,
    { pending: true },
  );
  const pendingGas = tx("pending-gas", card, "2026-11-01", 100, "SHELL OIL", "Shell", GAS, {
    pending: true,
  });
  // The second sync: dinner posts with the tip; the hold goes and the pump's amount posts, unmatched;
  // a coffee goes pending and posts between the two syncs, its removal only in the third.
  const postedDinner = tx(
    "dinner-11",
    card,
    "2026-11-03",
    48,
    "THE LOCAL CAFE",
    "The Local Cafe",
    RESTAURANT,
    { pending_transaction_id: id("pending-dinner") },
  );
  const postedGas = tx("gas-11", card, "2026-11-03", 52.31, "SHELL OIL", "Shell", GAS);
  const pendingCoffee = tx(
    "pending-coffee",
    card,
    "2026-11-03",
    4.75,
    "BLUE BOTTLE COFFEE",
    "Blue Bottle Coffee",
    COFFEE,
    { pending: true },
  );
  const postedCoffee = tx(
    "coffee-11",
    card,
    "2026-11-04",
    4.75,
    "BLUE BOTTLE COFFEE",
    "Blue Bottle Coffee",
    COFFEE,
    { pending_transaction_id: id("pending-coffee") },
  );
  // Churn: the October 19 groceries come back under a new id.
  const churned = history.find((t) => t.transaction_id === id("grocery-10-b"))!;
  const rechurned = { ...churned, transaction_id: id("grocery-10-b-again") };
  // The third sync: the bank settles October 4's groceries at another amount.
  const settled = {
    ...history.find((t) => t.transaction_id === id("grocery-10-a"))!,
    amount: 84.21,
  };

  const page = (p: Partial<SyncResponse["data"]> & { next_cursor: string }): SyncResponse => ({
    data: {
      added: [],
      modified: [],
      removed: [],
      accounts: [],
      has_more: false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      request_id: "req",
      ...p,
    },
  });
  const gone = (t: Transaction) => ({ transaction_id: t.transaction_id, account_id: t.account_id });
  const half = Math.ceil(history.length / 2);

  return {
    accounts: { checking, savings, card },
    syncs: [
      [
        page({
          added: history.slice(0, half),
          accounts: [checking, savings, card],
          next_cursor: id("c1a"),
          has_more: true,
        }),
        page({
          added: [...history.slice(half), pendingDinner, pendingGas],
          accounts: [checking, savings, card],
          next_cursor: id("c1"),
        }),
      ],
      [
        // Only the card has news: the other accounts aren't listed (Plaid lists only accounts with
        // transactions in the response).
        page({
          added: [postedDinner, postedGas, pendingCoffee],
          accounts: [card],
          next_cursor: id("c2a"),
          has_more: true,
        }),
        page({
          added: [postedCoffee, rechurned],
          removed: [gone(pendingDinner), gone(pendingGas), gone(churned)],
          accounts: [card],
          next_cursor: id("c2"),
        }),
      ],
      [
        page({
          modified: [settled],
          removed: [gone(pendingCoffee)],
          accounts: [card],
          next_cursor: id("c3"),
        }),
      ],
    ],
    recurring: {
      outflow_streams: [
        plaidStream({
          stream_id: id("stream-spotify"),
          account_id: card.account_id,
          description: "SPOTIFY USA",
          merchant_name: "Spotify",
          frequency: "MONTHLY",
          last_amount: { amount: 11.99 },
          average_amount: { amount: 11.99 },
          last_date: "2026-10-12",
          predicted_next_date: "2026-11-12",
          status: "MATURE",
          is_active: true,
          personal_finance_category: { primary: MUSIC[0], detailed: MUSIC[1] },
          transaction_ids: months.map((m) => id(`spotify-${m}`)),
        } as Partial<TransactionStream>),
        // Plaid's early guess at a stream from one charge: not a subscription yet.
        plaidStream({
          stream_id: id("stream-cafe"),
          account_id: card.account_id,
          description: "THE LOCAL CAFE",
          merchant_name: "The Local Cafe",
          frequency: "MONTHLY",
          last_amount: { amount: 48 },
          average_amount: { amount: 48 },
          last_date: "2026-11-03",
          status: "EARLY_DETECTION",
          is_active: true,
          personal_finance_category: { primary: RESTAURANT[0], detailed: RESTAURANT[1] },
          transaction_ids: [id("dinner-11")],
        } as Partial<TransactionStream>),
      ],
      inflow_streams: [
        plaidStream({
          stream_id: id("stream-pay"),
          account_id: checking.account_id,
          description: "ACME CORP DIR DEP",
          merchant_name: "Acme Corp",
          frequency: "SEMI_MONTHLY",
          last_amount: { amount: -1250 },
          average_amount: { amount: -1250 },
          last_date: "2026-11-01",
          status: "MATURE",
          is_active: true,
          personal_finance_category: { primary: PAY[0], detailed: PAY[1] },
          transaction_ids: [
            ...months.flatMap((m) => [id(`pay-${m}-a`), id(`pay-${m}-b`)]),
            id("pay-11-a"),
          ],
        } as Partial<TransactionStream>),
      ],
    },
    liabilities: {
      accounts: [card],
      liabilities: {
        credit: [
          {
            account_id: card.account_id,
            aprs: [{ apr_percentage: 24.99, apr_type: "purchase_apr" }],
            is_overdue: false,
            last_payment_amount: 405.55,
            last_payment_date: "2026-10-23",
            last_statement_balance: 431.63,
            last_statement_issue_date: "2026-10-28",
            minimum_payment_amount: 35,
            next_payment_due_date: "2026-11-22",
          },
        ],
        mortgage: [],
        student: [],
      },
    },
    ids: id,
  };
}

// A person whose only account is three weeks old: one bank, a few charges, no full month.
export function newAccountBank(prefix: string): { syncs: SyncResponse[][] } {
  const id = (name: string) => `${prefix}-${name}`;
  const checking = plaidAccount({
    account_id: id("checking"),
    name: "STUDENT CHECKING",
    mask: "2468",
    balances: { current: 433.26, available: 433.26, limit: null, iso_currency_code: "USD" },
  } as never);
  const tx = (
    name: string,
    date: string,
    amount: number,
    description: string,
    merchant: string | null,
    [primary, detailed]: Pfc,
  ) =>
    plaidTransaction({
      transaction_id: id(name),
      account_id: checking.account_id,
      date,
      amount,
      name: description,
      merchant_name: merchant,
      pending: false,
      pending_transaction_id: null,
      iso_currency_code: "USD",
      personal_finance_category: { primary, detailed, confidence_level: "HIGH" },
    } as Partial<Transaction>);
  return {
    syncs: [
      [
        {
          data: {
            added: [
              tx("opening", "2026-10-16", -500, "DEPOSIT FROM PARENT BANK", null, [
                "TRANSFER_IN",
                "TRANSFER_IN_ACCOUNT_TRANSFER",
              ]),
              tx("spotify", "2026-10-20", 11.99, "SPOTIFY USA", "Spotify", MUSIC),
              tx("groceries", "2026-11-02", 45.1, "TRADER JOE S", "Trader Joe's", GROCERIES),
              tx("coffee", "2026-11-03", 9.65, "BLUE BOTTLE COFFEE", "Blue Bottle Coffee", COFFEE),
            ],
            modified: [],
            removed: [],
            accounts: [checking],
            next_cursor: id("c1"),
            has_more: false,
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
            request_id: "req",
          },
        },
      ],
    ],
  };
}

// What the person above should see after the third sync, worked out by hand (cents).
export const PRODUCTION_EXPECTED = {
  // Spending: rent, music, groceries, dinners, the Target purchase less its return, and November's
  // posted dinner (with its tip), gas at the pump's amount and the coffee. No transfer, card
  // payment, pending charge or refunded Amazon order.
  spendingCents: {
    "2026-08": 95000 + 1199 + 8740 + 9215 + 4250, // 118404
    "2026-09": 95000 + 1199 + 7890 + 10133 + 3875 + 12000 - 6000, // 124097
    "2026-10": 95000 + 1199 + 8421 + 9560, // 114180
    "2026-11": 4800 + 5231 + 475, // 10506
  },
  // Pay and interest; not the savings transfers or the friend paying back.
  incomeCents: {
    "2026-08": 250000 + 121,
    "2026-09": 250000 + 184,
    "2026-10": 250000 + 210,
    "2026-11": 125000,
  },
  // Checking and savings less what's owed on the card.
  netWorthCents: 215000 + 390000 - 43163,
  // Rows stored, all settled: the 41 of the history, the churned one under its new id in place of
  // its old, and November's three. No pending row is left.
  rows: 44,
};
