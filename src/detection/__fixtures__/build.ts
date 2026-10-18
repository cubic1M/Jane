import type {
  DetectionAccount,
  DetectionInput,
  DetectionRecurringStream,
  DetectionTransaction,
} from "../types";
import { isoDate } from "../units";

// Made-up data for detection tests. Nothing here comes from a real bank export.

export const AS_OF = "2026-10-15";

export const CHECKING: DetectionAccount = {
  id: "acct_checking",
  name: "Everyday Checking",
  type: "depository",
  subtype: "checking",
  currentBalanceCents: 250_000,
};

export const SAVINGS: DetectionAccount = {
  id: "acct_savings",
  name: "Rainy Day Savings",
  type: "depository",
  subtype: "savings",
  currentBalanceCents: 1_500_000,
};

export const CARD: DetectionAccount = {
  id: "acct_card",
  name: "Example Rewards Card",
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 120_000,
};

let sequence = 0;

export function tx(overrides: Partial<DetectionTransaction> = {}): DetectionTransaction {
  sequence += 1;
  return {
    id: `tx_${String(sequence).padStart(4, "0")}`,
    accountId: CHECKING.id,
    plaidTransactionId: null,
    date: AS_OF,
    amountCents: 1000,
    description: "EXAMPLE MERCHANT",
    merchantName: null,
    pfcPrimary: null,
    pfcDetailed: null,
    categorySource: "rule",
    ...overrides,
  };
}

// The date `months` months before AS_OF on the given day of the month.
export function monthsAgo(months: number, day = 15): string {
  const d = new Date(`${AS_OF}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(day);
  return isoDate(d);
}

// One charge a month for `count` months ending this month, oldest first.
export function monthly(
  count: number,
  amounts: number | number[],
  overrides: Partial<DetectionTransaction> = {},
): DetectionTransaction[] {
  return Array.from({ length: count }, (_, i) => {
    const amount = Array.isArray(amounts) ? amounts[i] : amounts;
    return tx({ ...overrides, date: monthsAgo(count - 1 - i), amountCents: amount });
  });
}

export const NETFLIX = {
  description: "NETFLIX.COM NETFLIX.COM CA",
  merchantName: "Netflix",
  pfcPrimary: "ENTERTAINMENT",
  pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
};

export const HULU = {
  description: "HULU 877-8244858 CA",
  merchantName: "Hulu",
  pfcPrimary: "ENTERTAINMENT",
  pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
};

export const SPOTIFY = {
  description: "Spotify USA",
  merchantName: "Spotify Usa",
  pfcPrimary: "ENTERTAINMENT",
  pfcDetailed: "ENTERTAINMENT_MUSIC_AND_AUDIO",
};

export const GEICO = {
  description: "GEICO *AUTO 800-555-0100 DC",
  merchantName: "Geico",
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
};

export const GROCERIES = {
  description: "NEIGHBORHOOD GROCER 0042",
  merchantName: "Neighborhood Grocer",
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
};

export function input(overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    asOf: AS_OF,
    accounts: [CHECKING, SAVINGS, CARD],
    transactions: [],
    recurringStreams: [],
    ...overrides,
  };
}

export function plaidStream(
  overrides: Partial<DetectionRecurringStream> = {},
): DetectionRecurringStream {
  return {
    id: "stream_row_1",
    accountId: CARD.id,
    plaidStreamId: "plaid_stream_1",
    merchantName: "Netflix",
    frequency: "MONTHLY",
    lastAmountCents: 1549,
    averageAmountCents: 1549,
    lastDate: AS_OF,
    status: "MATURE",
    isActive: true,
    pfcPrimary: "ENTERTAINMENT",
    pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
    transactionIds: [],
    ...overrides,
  };
}

// A made-up year: two streaming services (one just went up), car insurance, groceries,
// a couple of bank fees, card interest, and more cash than the household needs on hand.
export function sampleYear() {
  return input({
    transactions: [
      ...monthly(8, [1549, 1549, 1549, 1549, 1549, 1549, 1549, 1799], {
        ...NETFLIX,
        accountId: CARD.id,
      }),
      ...monthly(8, 1199, { ...HULU, accountId: CARD.id }),
      ...monthly(8, 9800, GEICO),
      ...monthly(8, 180_000, { ...GROCERIES, accountId: CARD.id }),
      tx({
        date: "2026-04-03",
        amountCents: 3400,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      }),
      tx({
        date: "2026-09-25",
        accountId: CARD.id,
        amountCents: 2655,
        description: "PURCHASE INTEREST CHARGE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_INTEREST_CHARGE",
      }),
    ],
  });
}
