import { describe, expect, it } from "vitest";
import { FigureLedger } from "./figure-ledger";

// Debugger 11-15: on the demo person's payday the balance forecast listed the next paycheck as
// {"from":"Acme Corp","amount":"$2,450.00"} inside Demo Checking's entry. The ledger took "from"
// for no name, gave the amount to "Demo Checking", and flagged Jane's true "about $2,450.00 from
// Acme Corp" as the wrong name. A deposit is its payer's.

const NOW = new Date("2026-11-15T09:00:00Z");

const forecast = () => {
  const ledger = new FigureLedger();
  // The employer, as the pay tools name it.
  ledger.addToolResult(JSON.stringify({ employer: "Acme Corp", aMonth: "$4,900.00" }));
  ledger.addToolResult(
    JSON.stringify({
      accounts: [
        {
          account: "Demo Checking",
          balance: "$4,812.30",
          depositsBeforeThen: [{ from: "Acme Corp", on: "2026-12-01", amount: "$2,450.00" }],
        },
      ],
    }),
  );
  return ledger;
};

describe("a deposit in the tools' results", () => {
  it("is its payer's", () => {
    const kinds = (text: string) =>
      forecast()
        .problems(text, NOW)
        .map((p) => p.kind);
    expect(kinds("Your next payday is Dec 1: about $2,450.00 from Acme Corp.")).toEqual([]);
  });

  it("isn't named by a date", () => {
    const ledger = new FigureLedger();
    ledger.addToolResult(
      JSON.stringify({ account: "Demo Checking", from: "2026-11-01", total: "$812.40" }),
    );
    expect(ledger.problems("Demo Checking has $812.40 in it.", NOW)).toEqual([]);
  });
});
