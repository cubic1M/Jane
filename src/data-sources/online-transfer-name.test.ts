import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// Debugger 11-17 (r336, 14 months of Wells Fargo checking on a phone): Spending & bills' next month
// of bills listed rent as "Dec 1 · Online Transfer To Oakwood Residential Ref $1,650.00", from
// "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9". Netflix, Geico and T-Mobile next to it
// had their names. With the bank's reference after it, the payee is the name.

const name = (description: string) => normalizeMerchant(description)?.name;

describe("a Wells Fargo transfer to a company or person", () => {
  it("is named by the payee", () => {
    expect(name("ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9")).toBe(
      "Oakwood Residential",
    );
    expect(
      name("ONLINE TRANSFER TO SMITH J EVERYDAY CHECKING XXXXXX1234 REF #IBE7KQ2VWX ON 11/01/26"),
    ).toBe("Smith J Everyday Checking");
  });

  it("keeps its words without the bank's reference", () => {
    expect(name("ONLINE TRANSFER TO SAVINGS")).toBe("Online Transfer To Savings");
    expect(name("ONLINE TRANSFER TO ALLY BANK SAVINGS")).toBe(
      "Online Transfer To Ally Bank Savings",
    );
    expect(name("ONLINE TRANSFER FROM CHECKING")).toBe("Online Transfer From Checking");
  });
});
