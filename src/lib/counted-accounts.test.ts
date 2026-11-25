import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The founder's rule (11-24): every figure that adds up or reads balances counts what the bank links
// send, and an uploaded statement only when it can't be a copy of one (src/lib/account-copies.ts). A
// file that reads accounts with their balances goes through accountCopies, onlyCounted or
// withoutCopies, or is listed here with why it may read them all: it shows one account, lists them
// for the person to manage, or looks one up by id. A second code path that adds balances itself is
// the usual leak, so a new one fails here.

const ROOT = join(__dirname, "..");
const COUNTED = /accountCopies|onlyCounted|withoutCopies|loadNetWorthInputs|input\.accounts/;
const EXEMPT: Record<string, string> = {
  "lib/account-copies.ts": "the rule itself",
  "lib/accounts.ts": "lists every account for the person to manage, left-out ones marked",
  "app/settings/page.tsx": "lists every bank account for the person to manage",
  "app/household/page.tsx": "lists what the partner may see, account by account",
  "app/import/page.tsx": "lists every upload, and says which are left out",
  "lib/snapshots.ts": "each account's own daily balance, kept for every account",
  "lib/net-worth-history.ts": "accountsWithoutBalance lists the ones with no balance by name",
  "lib/loan-applications.ts": "reads the one account a loan application replaces",
  "lib/jane-agent/multi.ts": "picks the one account a transfer goes from or to",
  "lib/investing/brokerage-balance.ts": "asks what a named brokerage holds; counts nothing",
  "lib/goals.ts": "a goal's own account, read by its id",
  "lib/data-export.ts": "Download my data: every row, left out or not",
  "lib/import/account-balance.ts": "sets and asks one uploaded account's own balance",
  "lib/import/balances.ts": "an upload's own account, read for its running balance",
  "lib/import/positions.ts": "an upload's own holdings file, one account",
  "lib/import/remove.ts": "takes one upload back, whatever net worth counts",
  "lib/invariants/accuracy.ts":
    "checks each account's own history against its transactions, not a total",
  "lib/plaid/demo-history.ts": "writes the demo bank's own history",
  "lib/plaid/sync.ts": "writes what the bank sent, account by account",
  "lib/tax-estimate.ts": "reads investment accounts' kinds, not their balances",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
    return /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$|\.d\.ts$/.test(name) &&
      !path.includes("__fixtures__")
      ? [path]
      : [];
  });
}

describe("every read of accounts with their balances counts each account once", () => {
  it("goes through the counted accounts, or says why not", () => {
    const loose = sources(ROOT)
      .map((path) => [path.slice(ROOT.length + 1), readFileSync(path, "utf8")] as const)
      .filter(
        ([file, text]) =>
          /\.accounts\.(findMany|aggregate)\(/.test(text) &&
          /currentBalanceCents/.test(text) &&
          !COUNTED.test(text) &&
          !(file in EXEMPT),
      )
      .map(([file]) => file);
    expect(loose).toEqual([]);
  });

  // The tables kept by account (holdings, liabilities, investment transactions) have the same leak: a
  // total or a suggestion that reads them all adds an account linked twice, or uploaded and linked,
  // twice (CodeRabbit on #2259: the taxable gains, the life term). They read through onlyCountedRows
  // or the accounts that were, or are listed here with why they may read every row.
  const ROWS_EXEMPT: Record<string, string> = {
    "lib/data-export.ts": "Download my data: every row, left out or not",
    "lib/plaid/sync.ts": "writes what the bank sent, account by account",
    "lib/tax-docs/demo.ts": "writes the demo bank's own tax documents",
    "lib/student-long-game.ts": "one account's own plan and status, by the id of a counted debt",
    "lib/mortgage.ts": "one account's own escrow and PMI, by the id of a counted debt",
    "lib/card-interest.ts": "the statement dates of cards already counted in the debts book",
    "lib/credit-building.ts": "one card's statement date, by the id of a counted debt",
    "lib/investments/retirement.ts": "reads the accounts loadInvestments counted",
    "lib/investments/hsa.ts": "reads the accounts loadInvestments counted",
    "lib/investments/returns.ts": "reads the accounts loadInvestments counted",
    "lib/investments/company-stock.ts": "reads the accounts loadInvestments counted",
    "lib/investments/family.ts": "one custodial or child account's own deposits",
  };
  it("reads holdings, liabilities and investment transactions of counted accounts only", () => {
    const loose = sources(ROOT)
      .map((path) => [path.slice(ROOT.length + 1), readFileSync(path, "utf8")] as const)
      .filter(
        ([file, text]) =>
          /\.(holdings|liabilities|investmentTransactions)\.(findMany|aggregate|groupBy)\(/.test(
            text,
          ) &&
          !COUNTED.test(text) &&
          !(file in ROWS_EXEMPT) &&
          !(file in EXEMPT),
      )
      .map(([file]) => file);
    expect(loose).toEqual([]);
  });
});
