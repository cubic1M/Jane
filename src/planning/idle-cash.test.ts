import { describe, expect, it } from "vitest";
import { cashCushionOf, type IdleTx } from "./idle-cash";

const AS_OF = "2026-10-26";
const CHECKING = { id: "chk", type: "depository", subtype: "checking", balanceCents: 1_586_000 };

// Three months of a usual life: rent, a phone bill and groceries, about $2,700 a month.
function usual(): IdleTx[] {
  const rows: IdleTx[] = [];
  for (const month of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
    rows.push({
      date: `${month}-01`,
      amountCents: 190_000,
      accountId: "chk",
      pfc: "RENT_AND_UTILITIES_RENT",
      description: "ESSEX PROPERTY RENT",
    });
    rows.push({
      date: `${month}-12`,
      amountCents: 8_500,
      accountId: "chk",
      pfc: "RENT_AND_UTILITIES_TELEPHONE",
      description: "VERIZON WIRELESS",
    });
    for (const day of ["05", "15", "25"]) {
      rows.push({
        date: `${month}-${day}`,
        amountCents: 23_000,
        accountId: "chk",
        pfc: "FOOD_AND_DRINK_GROCERIES",
        description: "TRADER JOE'S #123",
      });
    }
  }
  return rows.filter((t) => t.date >= "2026-07-28");
}

// Night QA 10-30: $11,200 of one-offs (a car, a sofa) made the checkup say "$15,860 cash, under
// 3 months of spending" for someone whose usual month is about $2,700.
describe("cashCushionOf", () => {
  const oneOffs: IdleTx[] = [
    {
      date: "2026-08-20",
      amountCents: 320_000,
      accountId: "chk",
      pfc: "HOME_IMPROVEMENT_FURNITURE",
      description: "IKEA EAST PALO ALTO",
    },
    {
      date: "2026-09-14",
      amountCents: 800_000,
      accountId: "chk",
      pfc: "GENERAL_SERVICES_AUTOMOTIVE",
      description: "CARMAX #7101 SAN JOSE CA",
    },
  ];

  it("leaves one-off charges out of a month's spending", () => {
    const cushion = cashCushionOf({
      asOf: AS_OF,
      accounts: [CHECKING],
      transactions: [...usual(), ...oneOffs],
    })!;
    const plain = cashCushionOf({ asOf: AS_OF, accounts: [CHECKING], transactions: usual() })!;
    expect(cushion.monthlyCents).toBe(plain.monthlyCents);
    expect(cushion.excessCents).toBeGreaterThan(0);
  });

  it("keeps every charge when the bank's words aren't given", () => {
    const words = (rows: IdleTx[]) => rows.map(({ description: _, ...t }) => t);
    const cushion = cashCushionOf({
      asOf: AS_OF,
      accounts: [CHECKING],
      transactions: words([...usual(), ...oneOffs]),
    })!;
    const plain = cashCushionOf({ asOf: AS_OF, accounts: [CHECKING], transactions: usual() })!;
    expect(cushion.monthlyCents).toBeGreaterThan(plain.monthlyCents);
  });
});
