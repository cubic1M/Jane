import { describe, expect, it } from "vitest";
import { fidelity, robinhood, schwab, vanguard } from "./__fixtures__/positions";
import { parsePositionsCsv } from "./positions-csv";

// The layouts below follow what each brokerage publishes for its positions download; every
// number and account is invented.

describe("positions files", () => {
  it("reads a Fidelity file, one account each, with cost, cash and no disclaimer", () => {
    const p = parsePositionsCsv(fidelity)!;
    expect(p.broker).toBe("Fidelity");
    expect(p.accounts.map((a) => a.label)).toEqual(["Individual ···5678", "Roth IRA ···5432"]);
    const [indiv, roth] = p.accounts;
    expect(indiv.positions[0]).toMatchObject({
      ticker: "FXAIX",
      quantity: 100.5,
      priceCents: 18_523,
      valueCents: 1_861_622,
      costBasisCents: 1_400_000,
      isCash: false,
    });
    expect(indiv.positions[2]).toMatchObject({ ticker: "SPAXX", valueCents: 50_000, isCash: true });
    expect(roth.positions).toHaveLength(1);
    expect(p.skipped).toBe(1);
  });

  it("reads a Schwab file: the account from the first line, cash from its own row, no total", () => {
    const p = parsePositionsCsv(schwab)!;
    expect(p.broker).toBe("Schwab");
    expect(p.accounts).toHaveLength(1);
    expect(p.accounts[0].label).toBe("Individual ...123");
    expect(p.accounts[0].positions.map((x) => [x.ticker, x.valueCents, x.costBasisCents])).toEqual([
      ["SCHB", 120_000, 100_000],
      ["SCHX", 80_000, 90_000],
      ["CASH", 25_000, 25_000],
    ]);
  });

  it("stops Vanguard's file at its second section and treats its money market as cash", () => {
    const p = parsePositionsCsv(vanguard)!;
    expect(p.broker).toBe("Vanguard");
    const list = p.accounts[0].positions;
    expect(list.map((x) => x.ticker)).toEqual(["VTSAX", "VMFXX"]);
    expect(list[0].quantity).toBe(12.345);
    expect(list[1].isCash).toBe(true);
    expect(list[0].costBasisCents).toBeNull();
  });

  it("reads a Robinhood-style file with average cost per share", () => {
    const p = parsePositionsCsv(robinhood)!;
    expect(p.broker).toBe("Robinhood");
    expect(p.accounts[0].positions[1]).toMatchObject({
      ticker: "VOO",
      valueCents: 67_500,
      costBasisCents: 60_000,
    });
  });

  it("says nothing for a file that isn't positions", () => {
    expect(parsePositionsCsv("Date,Description,Amount\n10/01/2026,COFFEE,-4.00\n")).toBeNull();
    expect(parsePositionsCsv("")).toBeNull();
  });
});
