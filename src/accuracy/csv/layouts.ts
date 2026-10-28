import {
  ISSUER,
  addDays,
  addMonths,
  balanceOn,
  rng,
  type CsvAccount,
  type CsvPerson,
  type TrueRow,
} from "./people";

// Each account of a CSV bench person (./people.ts) as its bank exports it: the columns, sign,
// date style, order and wording of that bank's CSV, and the mess real exports have (a byte-order
// mark, Windows line ends, a summary block above the header, running balances, padded and cut
// descriptions, pending rows, monthly files that overlap). Every true row is in at least one file;
// rows in two overlapping files are the same row twice, which the upload must keep once.

export type BenchFile = {
  name: string;
  account: string;
  text: string;
  // Each true row's description as this bank writes it.
  descriptions: Record<string, string>;
  // The true rows the file holds, and the rows in it that aren't transactions yet (pending).
  rows: string[];
  pending: number;
};

const CITIES = [
  ["SAN FRANCISCO", "CA"],
  ["AUSTIN", "TX"],
  ["CHICAGO", "IL"],
  ["BROOKLYN", "NY"],
  ["DENVER", "CO"],
  ["SEATTLE", "WA"],
] as const;

const PEOPLE_NAMES = ["JANE DOE", "RAJ MEHTA", "LUCIA GOMEZ", "OWEN PARK", "MAYA COHEN"];

const mmdd = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
const us = (iso: string) => `${mmdd(iso)}/${iso.slice(0, 4)}`;
const usShort = (iso: string) => `${mmdd(iso)}/${iso.slice(2, 4)}`;
const dayFirst = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const yymmdd = (iso: string) => iso.slice(2).replaceAll("-", "");
const money = (cents: number) => (cents / 100).toFixed(2);
const thousands = (cents: number) => {
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${cents < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
};
const euro = (cents: number) =>
  thousands(cents).replaceAll(",", "#").replace(".", ",").replaceAll("#", ".");
const quote = (v: string) => (/[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

// --- What each bank writes in the description -----------------------------------------------

type Ctx = {
  p: CsvPerson;
  account: CsvAccount;
  r: ReturnType<typeof rng>;
  who: string;
  city: string;
  st: string;
};

const digits = (r: Ctx["r"], n: number) => Array.from({ length: n }, () => r.int(0, 9)).join("");

// The same choice every time for the same payee: a biller's ACH entry says the same thing every
// month, and an autopay is worded the same on every statement.
function stable<T>(key: string, options: readonly T[]): T {
  let h = 0;
  for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return options[Math.abs(h) % options.length];
}

// The other end of a card payment or a transfer.
const cardOf = (c: Ctx, row: TrueRow) => {
  if (row.flow === "card_payment_out") {
    const paid = c.p.rows.find(
      (x) =>
        x.flow === "card_payment_in" &&
        x.amountCents === -row.amountCents &&
        x.date >= row.date &&
        x.date <= addDays(row.date, 2),
    );
    return (
      c.p.accounts.find((a) => a.id === paid?.account) ??
      c.p.accounts.find((a) => a.kind === "credit_card")!
    );
  }
  return c.account;
};

function cardPaymentFromChecking(c: Ctx, row: TrueRow): string {
  const card = cardOf(c, row);
  const issuer = card.layout;
  const id = digits(c.r, 10);
  const words: Record<string, string[]> = {
    chase_credit_card: ["CHASE CREDIT CRD AUTOPAY", "CHASE CREDIT CRD EPAY"],
    bofa_credit_card: ["BK OF AMER VISA ONLINE PMT", "BANK OF AMERICA ONLINE PMT"],
    capital_one_credit_card: ["CAPITAL ONE MOBILE PMT", "CAPITAL ONE ONLINE PMT"],
    citi_credit_card: ["CITI CARD ONLINE PAYMENT", "CITI AUTOPAY PAYMENT"],
    amex: ["AMERICAN EXPRESS ACH PMT", "AMEX EPAYMENT ACH PMT"],
    discover_credit_card: ["DISCOVER E-PAYMENT", "DISCOVER DIRECTPAY"],
  };
  // The bank's own card, paid from its own checking, says so.
  if (c.account.layout === "chase_checking" && issuer === "chase_credit_card") {
    return `Payment to Chase card ending in ${card.mask} ${mmdd(row.date)}`;
  }
  if (c.account.layout === "bofa_checking" && issuer === "bofa_credit_card") {
    return `BANK OF AMERICA CREDIT CARD Bill Payment`;
  }
  if (c.account.layout === "capital_one_360" && issuer === "capital_one_credit_card") {
    return `Withdrawal to CAPITAL ONE CARD ENDING IN ${card.mask}`;
  }
  const name = stable(`${c.account.id}>${card.id}`, words[issuer]);
  return ach(c, row, name, "PMT", id);
}

function cardPaymentOnCard(c: Ctx): string {
  const options: Record<string, string[]> = {
    chase_credit_card: [
      "AUTOMATIC PAYMENT - THANK",
      "Payment Thank You-Mobile",
      "Payment Thank You - Web",
    ],
    bofa_credit_card: ["PAYMENT - THANK YOU", "BA ELECTRONIC PAYMENT"],
    capital_one_credit_card: ["CAPITAL ONE AUTOPAY PYMT", "CAPITAL ONE MOBILE PYMT"],
    citi_credit_card: ["ONLINE PAYMENT, THANK YOU", `AUTOPAY ${digits(c.r, 15)}RAUTOPAY AUTO-PMT`],
    amex: [
      "AUTOPAY PAYMENT - THANK YOU",
      "ONLINE PAYMENT - THANK YOU",
      "MOBILE PAYMENT - THANK YOU",
    ],
    discover_credit_card: ["INTERNET PAYMENT - THANK YOU", "DIRECTPAY FULL BALANCE"],
  };
  return stable(c.account.id, options[c.account.layout]);
}

// An ACH entry, as each bank writes one.
function ach(c: Ctx, row: TrueRow, company: string, entry: string, id = digits(c.r, 10)): string {
  switch (c.account.layout) {
    case "chase_checking":
      return stable(company, [true, true, true, false])
        ? `${company} ${entry} PPD ID: ${id}`
        : `ORIG CO NAME:${company} ORIG ID:${id} DESC DATE:${yymmdd(row.date)} CO ENTRY DESCR:${entry} SEC:PPD TRACE#:${digits(c.r, 15)} EED:${yymmdd(row.date)} IND ID:${digits(c.r, 8)} IND NAME:${c.who}`;
    case "bofa_checking":
      return `${company} DES:${entry} ID:XXXXX${digits(c.r, 5)} INDN:${c.who.split(" ").reverse().join(", ")} CO ID:XXXXX${digits(c.r, 5)} PPD`;
    case "wells_fargo":
      return `${company} ${entry} ${yymmdd(row.date)} ${digits(c.r, 8)} ${c.who.split(" ").reverse().join(" ")}`;
    case "capital_one_360":
      return row.amountCents < 0
        ? `Deposit from ${company} ${entry}`
        : `Withdrawal to ${company} ${entry}`;
    default:
      return `${company} ${entry}`;
  }
}

// A debit card purchase on checking, as each bank writes it.
function debitPurchase(c: Ctx, row: TrueRow): string {
  const d = row.descriptor;
  switch (c.account.layout) {
    case "chase_checking":
      return `${d} ${c.city} ${c.st}`.padEnd(40) + ` ${mmdd(addDays(row.date, -1))}`;
    case "bofa_checking":
      return `CHECKCARD ${mmdd(addDays(row.date, -1)).replace("/", "")} ${d} ${c.city} ${c.st} ${digits(c.r, 23)}`;
    case "wells_fargo":
      return `PURCHASE AUTHORIZED ON ${mmdd(addDays(row.date, -1))} ${d} ${c.city} ${c.st} S${digits(c.r, 15)} CARD ${c.account.mask}`;
    case "capital_one_360":
      return `Debit Card Purchase - ${d} ${c.city.slice(0, 13)} ${c.st}`;
    default:
      return `${d} ${c.city}`;
  }
}

// A card purchase, as each card company writes it.
function cardPurchase(c: Ctx, row: TrueRow): string {
  const d = row.descriptor;
  switch (c.account.layout) {
    case "citi_credit_card":
      return `${d.padEnd(25)}${c.city.padEnd(13)} ${c.st}`;
    case "amex":
    case "discover_credit_card":
      return `${d} ${c.city} ${c.st}`;
    default:
      return d;
  }
}

function describe(c: Ctx, row: TrueRow): string {
  const L = c.account.layout;
  const isCard = c.account.kind === "credit_card";
  switch (row.flow) {
    case "purchase":
    case "refund":
      return isCard ? cardPurchase(c, row) : debitPurchase(c, row);
    case "payroll":
    case "deposit":
      return ach(
        c,
        row,
        row.descriptor.replace(/ PAYROLL$/, ""),
        row.flow === "payroll" ? "PAYROLL" : "DIR DEP",
      );
    case "ach_out":
      return ach(
        c,
        row,
        row.descriptor,
        stable(row.descriptor, ["WEB PMT", "BILL PAY", "ONLINE PMT", "AUTOPAY"]),
      );
    case "card_payment_out":
      return cardPaymentFromChecking(c, row);
    case "card_payment_in":
      return cardPaymentOnCard(c);
    case "zelle_out":
    case "zelle_in": {
      const name = row.descriptor.replace(/^ZELLE (TO|FROM) /, "");
      const out = row.flow === "zelle_out";
      if (L === "chase_checking")
        return `Zelle payment ${out ? "to" : "from"} ${name} ${digits(c.r, 11)}`;
      if (L === "bofa_checking")
        return `Zelle payment ${out ? "to" : "from"} ${name} Conf# ${digits(c.r, 9)}`;
      if (L === "wells_fargo")
        return `ZELLE ${out ? "TO" : "FROM"} ${name.split(" ").reverse().join(" ")} ON ${mmdd(row.date)} REF # PP0${digits(c.r, 7)}`;
      if (L === "capital_one_360")
        return `Zelle money ${out ? "sent to" : "received from"} ${name}`;
      return `ZELLE ${name}`;
    }
    case "venmo_out":
      return ach(c, row, "VENMO", "PAYMENT", digits(c.r, 10));
    case "venmo_in":
      return ach(c, row, "VENMO", "CASHOUT", digits(c.r, 10));
    case "transfer_out":
    case "transfer_in": {
      const other = c.p.accounts.find((a) => a.id !== c.account.id && a.kind !== "credit_card")!;
      const out = row.flow === "transfer_out";
      const sameBank = ISSUER[other.layout] === ISSUER[c.account.layout];
      if (!sameBank) return ach(c, row, ISSUER[other.layout].toUpperCase(), "TRANSFER");
      if (L === "chase_checking")
        return `Online Transfer ${out ? "to SAV" : "from CHK"} ...${other.mask} transaction#: ${digits(c.r, 11)} ${mmdd(row.date)}`;
      if (L === "bofa_checking")
        return `Online Banking transfer ${out ? "to SAV" : "from CHK"} ${other.mask} Confirmation# ${digits(c.r, 10)}`;
      if (L === "capital_one_360")
        return out
          ? `Withdrawal to 360 Performance Savings XXXXXX${other.mask}`
          : `Deposit from 360 Checking XXXXXX${other.mask}`;
      return out ? "TRANSFER TO SAVINGS" : "TRANSFER FROM CHECKING";
    }
    case "atm":
      if (L === "chase_checking")
        return `ATM WITHDRAWAL ${digits(c.r, 6)} ${mmdd(row.date)} 123 MAIN ST ${c.city} ${c.st}`;
      if (L === "bofa_checking")
        return `BKOFAMERICA ATM ${mmdd(row.date)} #000${digits(c.r, 6)} WITHDRWL MAIN ST ${c.city} ${c.st}`;
      if (L === "wells_fargo")
        return `ATM WITHDRAWAL AUTHORIZED ON ${mmdd(row.date)} 123 MAIN ST ${c.city} ${c.st} 000${digits(c.r, 4)} ATM ID 0${digits(c.r, 3)}A CARD ${c.account.mask}`;
      if (L === "capital_one_360") return `ATM Withdrawal - 123 MAIN ST ${c.city.slice(0, 13)}`;
      return "ATM CASH WITHDRAWAL";
    case "fee":
    case "fee_refund":
      return feeText(c, row);
    case "interest_charge":
      return (
        {
          chase_credit_card: "PURCHASE INTEREST CHARGE",
          bofa_credit_card: "INTEREST CHARGED ON PURCHASES",
          capital_one_credit_card: "INTEREST CHARGE:PURCHASES",
          citi_credit_card: "INTEREST CHARGED TO STANDARD PURCH",
          amex: "INTEREST CHARGE ON PAY OVER TIME PURCHASES",
          discover_credit_card: "INTEREST CHARGE ON PURCHASES",
        } as Record<string, string>
      )[L];
    case "check": {
      const n = row.descriptor.replace("CHECK ", "");
      if (L === "chase_checking") return `CHECK ${n}`;
      if (L === "bofa_checking") return `Check ${n}`;
      if (L === "wells_fargo") return `CHECK # ${n}`;
      if (L === "capital_one_360") return `Check #${n}`;
      return `CHEQUE ${n}`;
    }
    case "reward":
      return (
        {
          chase_credit_card: "REDEMPTION CREDIT",
          bofa_credit_card: "CASH REWARDS STATEMENT CREDIT",
          capital_one_credit_card: "CREDIT-CASH BACK REWARD",
          citi_credit_card: "THANKYOU POINTS REDEMPTION",
          amex: "AMEX REWARDS CREDIT",
          discover_credit_card: "CASHBACK BONUS REDEMPTION PYMT/STMT CRDT",
        } as Record<string, string>
      )[L];
    case "interest_earned":
      return L === "capital_one_360"
        ? "Monthly Interest Paid"
        : L === "bofa_checking"
          ? "Interest Earned"
          : "INTEREST PAYMENT";
    default:
      return row.descriptor;
  }
}

function feeText(c: Ctx, row: TrueRow): string {
  const L = c.account.layout;
  const d = row.descriptor;
  if (d === "OVERDRAFT FEE") {
    if (L === "chase_checking")
      return `INSUFFICIENT FUNDS FEE FOR A $${money(c.r.int(2000, 9000))} CARD PURCHASE - DETAILS: ${mmdd(row.date)}TARGET 00023456`;
    if (L === "bofa_checking")
      return `OVERDRAFT ITEM FEE FOR ACTIVITY OF ${mmdd(row.date).replace("/", "-")} ELECTRONIC TRANSACTION POSTING DATE ${mmdd(row.date).replace("/", "-")}-${row.date.slice(2, 4)} POSTING SEQ 00001`;
    if (L === "wells_fargo")
      return `OVERDRAFT FEE FOR A $${money(c.r.int(2000, 9000))} ITEM - DETAILS: PURCHASE AUTHORIZED ON ${mmdd(row.date)}`;
    return "Overdraft Fee";
  }
  if (d === "OVERDRAFT FEE REVERSAL") {
    if (L === "bofa_checking") return "OVERDRAFT FEE REFUND";
    if (L === "chase_checking") return "FEE REVERSAL";
    return "OVERDRAFT FEE REVERSAL";
  }
  if (d === "MONTHLY SERVICE FEE") {
    if (L === "bofa_checking") return "Monthly Maintenance Fee";
    return "MONTHLY SERVICE FEE";
  }
  if (d === "NON-NETWORK ATM FEE") {
    if (L === "chase_checking") return `NON-CHASE ATM FEE-WITH ${mmdd(row.date)}`;
    if (L === "bofa_checking") return "Non-Bank of America ATM Fee";
    if (L === "wells_fargo") return `NON-WF ATM WITHDRAWAL FEE ${mmdd(row.date)}`;
    return "ATM FEE";
  }
  if (d === "LATE FEE" && L === "bofa_credit_card") return "LATE FEE FOR PAYMENT DUE";
  if (d === "FOREIGN TRANSACTION FEE" && L === "bofa_credit_card") return "INTL TRANSACTION FEE";
  return d;
}

// --- Each bank's own columns ------------------------------------------------------------------

function chaseCategory(row: TrueRow): string {
  if (row.flow === "card_payment_in" || row.flow === "reward") return "";
  const c = row.category;
  if (c.startsWith("BANK_FEES")) return "Fees & Adjustments";
  if (c === "FOOD_AND_DRINK_GROCERIES") return "Groceries";
  if (c.startsWith("FOOD_AND_DRINK")) return "Food & Drink";
  if (c === "TRANSPORTATION_GAS") return "Gas";
  if (c.startsWith("TRAVEL") || c.startsWith("TRANSPORTATION")) return "Travel";
  if (c.startsWith("RENT_AND_UTILITIES")) return "Bills & Utilities";
  if (c.startsWith("ENTERTAINMENT")) return "Entertainment";
  if (c.startsWith("MEDICAL") || c === "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS")
    return "Health & Wellness";
  if (c.startsWith("HOME")) return "Home";
  if (c.startsWith("GENERAL_SERVICES")) return "Professional Services";
  return "Shopping";
}

function capitalOneCategory(row: TrueRow): string {
  const c = row.category;
  if (row.flow === "card_payment_in" || row.flow === "refund" || row.flow === "reward")
    return "Payment/Credit";
  if (c.startsWith("BANK_FEES")) return "Fee/Interest Charge";
  if (c === "FOOD_AND_DRINK_GROCERIES") return "Grocery";
  if (c.startsWith("FOOD_AND_DRINK")) return "Dining";
  if (c === "TRANSPORTATION_GAS") return "Gas/Automotive";
  if (c === "TRAVEL_FLIGHTS") return "Airfare";
  if (c.startsWith("TRANSPORTATION")) return "Other Travel";
  if (c === "RENT_AND_UTILITIES_TELEPHONE" || c === "RENT_AND_UTILITIES_INTERNET_AND_CABLE")
    return "Phone/Cable";
  if (c.startsWith("ENTERTAINMENT")) return "Entertainment";
  if (c.startsWith("MEDICAL")) return "Health Care";
  if (c.startsWith("GENERAL_SERVICES")) return "Other Services";
  return "Merchandise";
}

function amexCategory(row: TrueRow): string {
  const c = row.category;
  if (row.flow === "card_payment_in" || row.flow === "reward") return "";
  if (c.startsWith("BANK_FEES")) return "Fees & Adjustments-Fees & Adjustments";
  if (c === "FOOD_AND_DRINK_GROCERIES") return "Merchandise & Supplies-Groceries";
  if (c.startsWith("FOOD_AND_DRINK")) return "Restaurant-Restaurant";
  if (c === "TRANSPORTATION_GAS") return "Transportation-Fuel";
  if (c === "TRAVEL_FLIGHTS") return "Travel-Airline";
  if (c.startsWith("TRANSPORTATION")) return "Transportation-Taxis & Coach";
  if (c.startsWith("RENT_AND_UTILITIES")) return "Communications-Cable & Internet Comm";
  if (c.startsWith("ENTERTAINMENT")) return "Entertainment-Associations";
  if (c === "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")
    return "Merchandise & Supplies-Internet Purchase";
  if (c.startsWith("GENERAL_SERVICES") || c.startsWith("PERSONAL_CARE"))
    return "Other-Miscellaneous";
  return "Merchandise & Supplies-General Retail";
}

function discoverCategory(row: TrueRow): string {
  const c = row.category;
  if (row.flow === "card_payment_in" || row.flow === "refund") return "Payments and Credits";
  if (row.flow === "reward") return "Awards and Rebate Credits";
  if (row.flow === "interest_charge") return "Interest";
  if (c.startsWith("BANK_FEES")) return "Fees";
  if (c === "FOOD_AND_DRINK_GROCERIES") return "Supermarkets";
  if (c.startsWith("FOOD_AND_DRINK")) return "Restaurants";
  if (c === "TRANSPORTATION_GAS") return "Gasoline";
  if (c.startsWith("TRAVEL") || c.startsWith("ENTERTAINMENT") || c.startsWith("TRANSPORTATION"))
    return "Travel/ Entertainment";
  if (c.startsWith("MEDICAL")) return "Medical Services";
  if (
    c.startsWith("GENERAL_SERVICES") ||
    c.startsWith("RENT_AND_UTILITIES") ||
    c.startsWith("PERSONAL_CARE")
  )
    return "Services";
  if (c === "GENERAL_MERCHANDISE_SUPERSTORES") return "Department Stores";
  return "Merchandise";
}

function chaseType(row: TrueRow, account: CsvAccount): string {
  if (account.kind === "credit_card") {
    if (row.flow === "card_payment_in") return "Payment";
    if (row.flow === "refund") return "Return";
    if (row.flow === "reward") return "Adjustment";
    if (row.flow === "fee" || row.flow === "interest_charge") return "Fee";
    return "Sale";
  }
  return (
    (
      {
        purchase: "DEBIT_CARD",
        refund: "MISC_CREDIT",
        payroll: "ACH_CREDIT",
        deposit: "ACH_CREDIT",
        ach_out: "ACH_DEBIT",
        card_payment_out: "ACH_DEBIT",
        transfer_out: "ACCT_XFER",
        transfer_in: "ACCT_XFER",
        zelle_out: "QUICKPAY_DEBIT",
        zelle_in: "QUICKPAY_CREDIT",
        venmo_out: "ACH_DEBIT",
        venmo_in: "ACH_CREDIT",
        atm: "ATM",
        fee: "FEE_TRANSACTION",
        fee_refund: "REFUND_TRANSACTION",
        check: "CHECK_PAID",
        interest_earned: "MISC_CREDIT",
      } as Record<string, string>
    )[row.flow] ?? "MISC_DEBIT"
  );
}

// --- Files ------------------------------------------------------------------------------------

type Line = {
  row: TrueRow;
  date: string;
  amountCents: number;
  description: string;
  pending: boolean;
};

// The windows each account's exports cover: one file for the whole history, a file per month
// with a few days' overlap, or two halves overlapping by ten days. A Citi export taken about
// three weeks ago still shows some charges as pending.
function windows(p: CsvPerson, account: CsvAccount, r: Ctx["r"]): { from: string; to: string }[] {
  if (account.layout === "citi_credit_card") {
    const cut = addDays(p.asOf, -25);
    return [
      { from: p.start, to: cut },
      { from: addDays(cut, -15), to: p.asOf },
    ];
  }
  const style = r.pick(["one", "monthly", "halves"] as const);
  if (style === "one") return [{ from: p.start, to: p.asOf }];
  if (style === "halves") {
    const mid = addMonths(p.start, Math.floor(p.months / 2), 15);
    return [
      { from: p.start, to: mid },
      { from: addDays(mid, -10), to: p.asOf },
    ];
  }
  const out: { from: string; to: string }[] = [];
  for (let from = p.start; from <= p.asOf; from = addMonths(from, 1, 1)) {
    const to = addDays(addMonths(from, 1, 1), r.int(-1, 3));
    out.push({
      from: from === p.start ? from : addDays(from, -r.int(0, 3)),
      to: to > p.asOf ? p.asOf : to,
    });
  }
  return out;
}

export function renderAccount(p: CsvPerson, account: CsvAccount): BenchFile[] {
  const r = rng(
    p.id.charCodeAt(1) * 977 +
      p.id.charCodeAt(2) * 31 +
      account.id.length * 7 +
      account.mask.charCodeAt(0),
  );
  const [city, st] = CITIES[Number(p.id.slice(1)) % CITIES.length];
  const c: Ctx = {
    p,
    account,
    r,
    who: PEOPLE_NAMES[Number(p.id.slice(1)) % PEOPLE_NAMES.length],
    city,
    st,
  };
  // Each row's description is fixed once, so a row in two overlapping files reads the same.
  const lines: Line[] = p.rows
    .filter((row) => row.account === account.id)
    .map((row) => ({
      row,
      date: row.date,
      amountCents: row.amountCents,
      description: describe(c, row),
      pending: false,
    }));
  const crlf = r.chance(0.5);
  const bom = r.chance(0.3);
  const extra = (p.uploads ?? []).filter((u) => u.account === account.id);
  const main = windows(p, account, r);
  return [...main, ...extra].map((w, i, all) => {
    const last = i >= main.length - 1;
    const inside: Line[] = [];
    for (const line of lines) {
      const copy = line.row.pendingCopy;
      if (copy && !last && line.date > w.to && copy.date <= w.to) {
        inside.push({ ...line, date: copy.date, amountCents: copy.amountCents, pending: true });
      } else if (line.date >= w.from && line.date <= w.to) {
        inside.push(line);
      }
    }
    const body = renderLines(p, account, inside, w, r);
    const eol = crlf ? "\r\n" : "\n";
    const text = `${bom ? "﻿" : ""}${body.join(eol)}${eol}`;
    const again = "again" in w && w.again ? " (1)" : "";
    const name = `${account.layout}-${account.mask}-${w.from.slice(0, 7)}${all.length > 1 ? `-${i + 1}` : ""}${again}.csv`;
    return {
      name,
      account: account.id,
      text,
      descriptions: Object.fromEntries(lines.map((l) => [l.row.id, l.description])),
      rows: inside.filter((l) => !l.pending).map((l) => l.row.id),
      pending: inside.filter((l) => l.pending).length,
    };
  });
}

function renderLines(
  p: CsvPerson,
  a: CsvAccount,
  lines: Line[],
  w: { from: string; to: string },
  r: Ctx["r"],
): string[] {
  const oldest = [...lines];
  const newest = [...lines].reverse();
  // Running balance after each row (money held, or owed on a card).
  const after = new Map<Line, number>();
  {
    let bal = balanceOn(p, a, addDays(w.from, -1));
    for (const l of oldest) {
      if (l.pending) continue;
      bal += a.kind === "credit_card" ? l.amountCents : -l.amountCents;
      after.set(l, bal);
    }
  }
  const out = (l: Line) => l.amountCents; // Plaid sign: positive is money out.
  switch (a.layout) {
    case "chase_checking":
      return [
        "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
        ...newest.map((l) =>
          [
            l.amountCents < 0 ? "CREDIT" : l.row.flow === "check" ? "CHECK" : "DEBIT",
            us(l.date),
            quote(l.description),
            money(-out(l)),
            chaseType(l.row, a),
            money(after.get(l) ?? 0),
            l.row.flow === "check" ? l.description.replace("CHECK ", "") : "",
            "",
          ].join(","),
        ),
      ];
    case "chase_credit_card":
      return [
        "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
        ...newest.map((l) =>
          [
            us(l.row.flow === "purchase" ? addDays(l.date, -r.int(0, 2)) : l.date),
            us(l.date),
            quote(l.description),
            chaseCategory(l.row),
            chaseType(l.row, a),
            money(-out(l)),
            "",
          ].join(","),
        ),
      ];
    case "bofa_checking": {
      const begin = balanceOn(p, a, addDays(w.from, -1));
      const end = balanceOn(p, a, w.to);
      const credits = oldest
        .filter((l) => l.amountCents < 0)
        .reduce((s, l) => s - l.amountCents, 0);
      const debits = oldest.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
      return [
        "Description,,Summary Amt.",
        `Beginning balance as of ${us(w.from)},,"${thousands(begin)}"`,
        `Total credits,,"${thousands(credits)}"`,
        `Total debits,,"${thousands(-debits)}"`,
        `Ending balance as of ${us(w.to)},,"${thousands(end)}"`,
        "",
        "Date,Description,Amount,Running Bal.",
        `${us(w.from)},Beginning balance as of ${us(w.from)},,"${thousands(begin)}"`,
        ...oldest.map((l) =>
          [
            us(l.date),
            quote(l.description),
            `"${thousands(-out(l))}"`,
            `"${thousands(after.get(l) ?? 0)}"`,
          ].join(","),
        ),
      ];
    }
    case "bofa_credit_card":
      return [
        "Posted Date,Reference Number,Payee,Address,Amount",
        ...newest.map((l) => {
          const payee = l.description;
          return [
            us(l.date),
            digits(r, 23),
            quote(payee),
            quote(`${rCity(r)} ${"CA"} `),
            money(-out(l)),
          ].join(",");
        }),
      ];
    case "wells_fargo":
      return newest.map((l) =>
        [us(l.date), money(-out(l)), "*", "", l.description].map((v) => `"${v}"`).join(","),
      );
    case "capital_one_360":
      return [
        "Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance",
        ...newest.map((l) =>
          [
            a.mask,
            quote(l.description),
            usShort(l.date),
            l.amountCents > 0 ? "Debit" : "Credit",
            money(Math.abs(l.amountCents)),
            money(after.get(l) ?? 0),
          ].join(","),
        ),
      ];
    case "capital_one_credit_card":
      return [
        "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
        ...newest.map((l) =>
          [
            addDays(l.date, l.row.flow === "purchase" ? -r.int(0, 2) : 0),
            l.date,
            a.mask,
            quote(l.description),
            capitalOneCategory(l.row),
            l.amountCents > 0 ? money(l.amountCents) : "",
            l.amountCents < 0 ? money(-l.amountCents) : "",
          ].join(","),
        ),
      ];
    case "citi_credit_card":
      return [
        "Status,Date,Description,Debit,Credit",
        ...newest.map((l) =>
          [
            l.pending ? "Pending" : "Cleared",
            us(l.date),
            quote(l.description),
            l.amountCents > 0 ? money(l.amountCents) : "",
            l.amountCents < 0 ? money(l.amountCents) : "",
          ].join(","),
        ),
      ];
    case "amex": {
      // Half the exports have "additional details" ticked: more columns, and details with line
      // breaks inside quotes.
      const extended = r.chance(0.5);
      const head = "Date,Description,Card Member,Account #,Amount";
      return [
        extended
          ? `${head},Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category`
          : head,
        ...newest.map((l) => {
          const base = [us(l.date), quote(l.description), c_(p), `-${digits(r, 5)}`, money(out(l))];
          if (!extended) return base.join(",");
          const details = quote(`${digits(r, 10)}\n${l.description.split(" ")[0]}\n${rCity(r)}`);
          return [
            ...base,
            details,
            quote(l.description),
            quote("123 MARKET ST"),
            quote(`${rCity(r)}\nCA`),
            "94103",
            "UNITED STATES",
            quote(`'${digits(r, 18)}'`),
            amexCategory(l.row),
          ].join(",");
        }),
      ];
    }
    case "discover_credit_card":
      return [
        "Trans. Date,Post Date,Description,Amount,Category",
        ...newest.map((l) =>
          [
            us(addDays(l.date, l.row.flow === "purchase" ? -r.int(0, 1) : 0)),
            us(l.date),
            quote(l.description),
            money(out(l)),
            discoverCategory(l.row),
          ].join(","),
        ),
      ];
    case "custom": {
      // A credit union outside the US layouts: semicolons, day first, decimal commas; half have
      // a line about the account above the column names.
      // One in German with a line about the account above the column names, one in English.
      const german = Number(p.id.slice(1)) % 2 === 1;
      return [
        ...(german
          ? [`Kontoauszug ${a.mask};;;`, "Buchungstag;Verwendungszweck;Betrag;Saldo"]
          : ["Date;Description;Amount;Balance"]),
        ...newest.map((l) =>
          [dayFirst(l.date), quote(l.description), euro(-out(l)), euro(after.get(l) ?? 0)].join(
            ";",
          ),
        ),
      ];
    }
  }
}

const rCity = (r: Ctx["r"]) => r.pick(CITIES)[0];
const c_ = (p: CsvPerson) => PEOPLE_NAMES[Number(p.id.slice(1)) % PEOPLE_NAMES.length];

export function renderPerson(p: CsvPerson): BenchFile[] {
  return p.accounts.flatMap((a) => renderAccount(p, a));
}
