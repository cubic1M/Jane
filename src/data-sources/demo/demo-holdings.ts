import type { Holding, InvestmentTransaction, Security } from "plaid";
import { accountId, addDays, demoAccounts, type DemoSeed } from "./demo-bank";

// What the demo bank's investment accounts hold (spec step 128), shaped like Plaid
// Investments' /investments/holdings/get and /investments/transactions/get. The funds are
// made up (their facts are in src/config/funds.ts); the employer's shares are ACME's, who
// pays the demo salary. Built so each later investment step has something to find: costly
// funds next to cheap ones, too much in one company, a gain and a loss, a sale followed by
// a reinvested dividend within 30 days, advisory and account fees, and a 401(k)
// contribution below the employer's full match.
//
// Every account's holdings add up to its balance to the cent: the cash position takes
// whatever the rest leaves. Deterministic and pure, like the rest of the demo bank.

type DemoSecurity = {
  ticker: string | null;
  name: string;
  type: string;
  subtype: string;
  cash?: boolean;
  sector?: string;
};

const SECURITIES: Readonly<Record<string, DemoSecurity>> = {
  NSTDX: {
    ticker: "NSTDX",
    name: "Northstar Target 2055 Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  SLGFX: {
    ticker: "SLGFX",
    name: "Summit Large Cap Growth Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  KTSIX: {
    ticker: "KTSIX",
    name: "Keystone Total US Stock Index Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  KTBIX: {
    ticker: "KTBIX",
    name: "Keystone Total Bond Index Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  DSVXX: {
    ticker: "DSVXX",
    name: "Demo Stable Value Fund",
    type: "mutual fund",
    subtype: "mutual fund",
    cash: true,
  },
  ACME: {
    ticker: "ACME",
    name: "Acme Corp",
    type: "equity",
    subtype: "common stock",
    sector: "Technology Services",
  },
  PDIFX: {
    ticker: "PDIFX",
    name: "Pinnacle Dividend Income Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  KLCX: { ticker: "KLCX", name: "Keystone US Large Cap Index ETF", type: "etf", subtype: "etf" },
  // Funds the demo person doesn't hold yet but can buy (spec step 133).
  KTIIX: {
    ticker: "KTIIX",
    name: "Keystone Total International Index Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  KTRGX: {
    ticker: "KTRGX",
    name: "Keystone Target 2055 Index Fund",
    type: "mutual fund",
    subtype: "mutual fund",
  },
  KDVX: { ticker: "KDVX", name: "Keystone US Dividend Index ETF", type: "etf", subtype: "etf" },
  CASH: { ticker: null, name: "Cash", type: "cash", subtype: "cash", cash: true },
};

type Key = keyof typeof SECURITIES;
export const demoSecurityId = (key: string) => `demo-sec-${key.toLowerCase()}`;

type Position = { key: Key; quantity: number; price: number; costBasis: number };

// The cash position (last in each list) is filled in from the account's balance.
const POSITIONS: Readonly<Record<"retirement" | "brokerage", readonly Position[]>> = {
  retirement: [
    { key: "NSTDX", quantity: 1520.384, price: 25.17, costBasis: 31_900 },
    { key: "SLGFX", quantity: 412.106, price: 51.36, costBasis: 17_400 },
    { key: "KTSIX", quantity: 98.552, price: 142.18, costBasis: 11_250 },
    { key: "KTBIX", quantity: 612.87, price: 9.84, costBasis: 6_420 },
    { key: "DSVXX", quantity: 0, price: 1, costBasis: 0 },
  ],
  brokerage: [
    { key: "ACME", quantity: 38, price: 136.4, costBasis: 2_280 },
    { key: "PDIFX", quantity: 142.317, price: 21.72, costBasis: 3_640 },
    { key: "KLCX", quantity: 7.5, price: 452.3, costBasis: 3_180 },
    { key: "CASH", quantity: 0, price: 1, costBasis: 0 },
  ],
};

const cents = (dollars: number) => Math.round(dollars * 100);

// Every demo security's price, in dollars: the held ones' and the ones that can be bought.
export const DEMO_PRICES: Readonly<Record<string, number>> = {
  ...Object.fromEntries(
    [...POSITIONS.retirement, ...POSITIONS.brokerage].map((p) => [p.key, p.price]),
  ),
  KTIIX: 34.12,
  KTRGX: 18.4,
  KDVX: 41.25,
};

// The securities Plaid would list: the ones held (after any orders), or all of them.
export function demoSecurities(today: string, only?: ReadonlySet<string>): Security[] {
  return Object.entries(SECURITIES).flatMap(([key, s]) => {
    if (only && !only.has(demoSecurityId(key))) return [];
    const price = DEMO_PRICES[key];
    return [
      {
        security_id: demoSecurityId(key),
        isin: null,
        cusip: null,
        sedol: null,
        institution_security_id: null,
        institution_id: null,
        proxy_security_id: null,
        name: s.name,
        ticker_symbol: s.ticker,
        is_cash_equivalent: s.cash ?? false,
        type: s.type,
        subtype: s.subtype,
        close_price: price,
        close_price_as_of: today,
        update_datetime: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        market_identifier_code: null,
        sector: s.sector ?? null,
        industry: null,
        option_contract: null,
        fixed_income: null,
      } as Security,
    ];
  });
}

export function demoHoldings(
  demo: DemoSeed,
  today: string,
  // Simulated orders the person placed (spec step 133), applied in order.
  orders: DemoOrder[] = [],
): Holding[] {
  return applyDemoOrders(seedHoldings(demo, today), orders, today);
}

function seedHoldings(demo: DemoSeed, today: string): Holding[] {
  const balances = new Map(demoAccounts(demo).map((a) => [a.account_id, a.balances.current ?? 0]));
  return (["retirement", "brokerage"] as const).flatMap((account) => {
    const id = accountId(demo.seed, account);
    const positions = POSITIONS[account];
    const invested = positions
      .slice(0, -1)
      .reduce((sum, p) => sum + cents(p.quantity * p.price), 0);
    const cashCents = cents(balances.get(id) ?? 0) - invested;
    return positions.map((p, i): Holding => {
      const isCash = i === positions.length - 1;
      const valueCents = isCash ? cashCents : cents(p.quantity * p.price);
      return {
        account_id: id,
        security_id: demoSecurityId(p.key),
        institution_price: p.price,
        institution_price_as_of: today,
        institution_price_datetime: null,
        institution_value: valueCents / 100,
        cost_basis: isCash ? valueCents / 100 : p.costBasis,
        quantity: isCash ? valueCents / 100 : p.quantity,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        vested_quantity: null,
        vested_value: null,
      } as Holding;
    });
  });
}

// The demo salary's 401(k) contributions each payday: 4% of pay from the person, and the
// employer's match of half of that. The plan matches half of up to 6% of pay, so the
// person leaves some match on the table. Plaid doesn't report a plan's match rules; this
// stands in for the plan's own documents.
export const DEMO_PAYCHECK_GROSS = 3_400;
export const DEMO_EMPLOYEE_RATE = 0.04;
export const DEMO_MATCH_RATE = 0.5;
export const DEMO_MATCH_UP_TO = 0.06;

type Event = {
  key: string;
  account: "retirement" | "brokerage";
  security: Key | null;
  name: string;
  quantity: number;
  amount: number;
  price: number;
  fees?: number;
  type: InvestmentTransaction["type"];
  subtype: InvestmentTransaction["subtype"];
};

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];
const ACME_DIVIDEND_DAYS = ["02-15", "05-15", "08-15", "11-15"];

// Every day from the day after `start` through `end`.
function days(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = addDays(start, 1); day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

function eventsOn(day: string, anchor: string): Event[] {
  const md = day.slice(5);
  const dom = day.slice(8);
  const out: Event[] = [];
  if (dom === "01" || dom === "15") {
    const employee = round(DEMO_PAYCHECK_GROSS * DEMO_EMPLOYEE_RATE, 2);
    const match = round(employee * DEMO_MATCH_RATE, 2);
    const price = 25.17;
    out.push(
      {
        key: "contribution",
        account: "retirement",
        security: null,
        name: "EMPLOYEE CONTRIBUTION",
        quantity: 0,
        amount: -employee,
        price: 0,
        type: "cash" as InvestmentTransaction["type"],
        subtype: "contribution" as InvestmentTransaction["subtype"],
      },
      {
        key: "match",
        account: "retirement",
        security: null,
        name: "EMPLOYER MATCH",
        quantity: 0,
        amount: -match,
        price: 0,
        type: "cash" as InvestmentTransaction["type"],
        subtype: "contribution" as InvestmentTransaction["subtype"],
      },
      {
        key: "buy",
        account: "retirement",
        security: "NSTDX",
        name: "BUY NORTHSTAR TARGET 2055 FUND",
        quantity: round((employee + match) / price, 3),
        amount: employee + match,
        price,
        type: "buy" as InvestmentTransaction["type"],
        subtype: "buy" as InvestmentTransaction["subtype"],
      },
    );
  }
  if (QUARTER_ENDS.includes(md)) {
    out.push(
      {
        key: "plan-fee",
        account: "retirement",
        security: null,
        name: "PLAN ADMINISTRATION FEE",
        quantity: 0,
        amount: 12.5,
        price: 0,
        type: "fee" as InvestmentTransaction["type"],
        subtype: "account fee" as InvestmentTransaction["subtype"],
      },
      {
        key: "advisory-fee",
        account: "brokerage",
        security: null,
        name: "ADVISORY FEE",
        quantity: 0,
        amount: 31.2,
        price: 0,
        type: "fee" as InvestmentTransaction["type"],
        subtype: "management fee" as InvestmentTransaction["subtype"],
      },
    );
  }
  if (ACME_DIVIDEND_DAYS.includes(md)) {
    out.push({
      key: "acme-dividend",
      account: "brokerage",
      security: "ACME",
      name: "ACME CORP DIVIDEND",
      quantity: 0,
      amount: -9.88,
      price: 0,
      type: "cash" as InvestmentTransaction["type"],
      subtype: "dividend" as InvestmentTransaction["subtype"],
    });
  }
  if (dom === "28") {
    out.push({
      key: "pdifx-reinvest",
      account: "brokerage",
      security: "PDIFX",
      name: "PINNACLE DIVIDEND INCOME FUND DIVIDEND REINVESTMENT",
      quantity: round(11.4 / 21.72, 3),
      amount: 11.4,
      price: 21.72,
      type: "buy" as InvestmentTransaction["type"],
      subtype: "dividend reinvestment" as InvestmentTransaction["subtype"],
    });
  }
  // One-offs, placed around the day the demo bank was linked so they always look recent.
  const offset = Math.round((Date.parse(day) - Date.parse(anchor)) / 86_400_000);
  if (offset === -200) {
    out.push({
      key: "acme-sale",
      account: "brokerage",
      security: "ACME",
      name: "SELL ACME CORP",
      quantity: -20,
      amount: -2_562,
      price: 128.1,
      fees: 0,
      type: "sell" as InvestmentTransaction["type"],
      subtype: "sell" as InvestmentTransaction["subtype"],
    });
  }
  if (offset === -95) {
    out.push({
      key: "klcx-buy",
      account: "brokerage",
      security: "KLCX",
      name: "BUY KEYSTONE US LARGE CAP INDEX ETF",
      quantity: 7.5,
      amount: 3_180,
      price: 424,
      fees: 0,
      type: "buy" as InvestmentTransaction["type"],
      subtype: "buy" as InvestmentTransaction["subtype"],
    });
  }
  if (offset === -24) {
    out.push({
      key: "pdifx-sale",
      account: "brokerage",
      security: "PDIFX",
      name: "SELL PINNACLE DIVIDEND INCOME FUND",
      quantity: -60,
      amount: -1_284,
      price: 21.4,
      fees: 0,
      type: "sell" as InvestmentTransaction["type"],
      subtype: "sell" as InvestmentTransaction["subtype"],
    });
  }
  return out;
}

// The investment transactions from `start` (exclusive) through `end`, oldest first.
export function demoInvestmentTransactions(
  demo: DemoSeed,
  start: string,
  end: string,
): InvestmentTransaction[] {
  return days(start, end).flatMap((day) =>
    eventsOn(day, demo.anchor).map(
      (e): InvestmentTransaction =>
        ({
          investment_transaction_id: `demo-${demo.seed}-inv-${e.key}-${day}`,
          account_id: accountId(demo.seed, e.account),
          security_id: e.security ? demoSecurityId(e.security) : null,
          date: day,
          name: e.name,
          quantity: e.quantity,
          amount: e.amount,
          price: e.price,
          fees: e.fees ?? null,
          type: e.type,
          subtype: e.subtype,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        }) as InvestmentTransaction,
    ),
  );
}

// A simulated order the person placed through the stand-in brokerage (spec step 133),
// filled on paper at the demo price. The demo bank replays them on every sync, so the
// holdings stay as the orders left them; no real money is involved.
export type DemoOrder = {
  id: string;
  // The demo account's Plaid id (accountId(seed, key)).
  accountRef: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  amountCents: number;
  // YYYY-MM-DD the order filled.
  day: string;
};

const tickerOf = (securityId: string) =>
  Object.keys(SECURITIES).find((k) => demoSecurityId(k) === securityId) ?? null;

// Each order moves money between the security and the account's cash, so the account's
// total stays the same; a sale takes its share of the cost basis with it. Pure.
export function applyDemoOrders(
  holdings: Holding[],
  orders: DemoOrder[],
  today: string,
): Holding[] {
  const out = holdings.map((h) => ({ ...h }));
  for (const order of orders) {
    const cash = out.find(
      (h) => h.account_id === order.accountRef && SECURITIES[tickerOf(h.security_id) ?? ""]?.cash,
    );
    const price = DEMO_PRICES[order.ticker];
    if (!cash || price === undefined) continue;
    let held = out.find(
      (h) => h.account_id === order.accountRef && h.security_id === demoSecurityId(order.ticker),
    );
    if (!held && order.side === "sell") continue;
    if (!held) {
      held = {
        account_id: order.accountRef,
        security_id: demoSecurityId(order.ticker),
        institution_price: price,
        institution_price_as_of: today,
        institution_price_datetime: null,
        institution_value: 0,
        cost_basis: 0,
        quantity: 0,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        vested_quantity: null,
        vested_value: null,
      } as Holding;
      out.push(held);
    }
    const sign = order.side === "buy" ? 1 : -1;
    const quantity = Math.max(0, round(held.quantity + sign * order.quantity, 6));
    const basis =
      order.side === "buy"
        ? (held.cost_basis ?? 0) + order.amountCents / 100
        : held.quantity > 0
          ? (held.cost_basis ?? 0) * (quantity / held.quantity)
          : 0;
    const valueCents = cents(quantity * price);
    const moved = cents(held.institution_value) - valueCents;
    held.quantity = quantity;
    held.cost_basis = round(basis, 2);
    held.institution_value = valueCents / 100;
    const cashCents = cents(cash.institution_value) + moved;
    cash.institution_value = cashCents / 100;
    cash.quantity = cashCents / 100;
    cash.cost_basis = cashCents / 100;
  }
  return out.filter((h) => h.quantity > 0 || SECURITIES[tickerOf(h.security_id) ?? ""]?.cash);
}

// The orders as investment transactions, as a brokerage would report them.
export function demoOrderTransactions(
  demo: DemoSeed,
  orders: DemoOrder[],
  start: string,
  end: string,
): InvestmentTransaction[] {
  return orders
    .filter((o) => o.day > start && o.day <= end)
    .map(
      (o): InvestmentTransaction =>
        ({
          investment_transaction_id: `demo-${demo.seed}-order-${o.id}`,
          account_id: o.accountRef,
          security_id: demoSecurityId(o.ticker),
          date: o.day,
          name: `${o.side === "buy" ? "BUY" : "SELL"} ${SECURITIES[o.ticker]?.name.toUpperCase() ?? o.ticker}`,
          quantity: o.side === "buy" ? o.quantity : -o.quantity,
          amount: (o.side === "buy" ? o.amountCents : -o.amountCents) / 100,
          price: DEMO_PRICES[o.ticker] ?? 0,
          fees: 0,
          type: o.side as InvestmentTransaction["type"],
          subtype: o.side as InvestmentTransaction["subtype"],
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        }) as InvestmentTransaction,
    );
}
