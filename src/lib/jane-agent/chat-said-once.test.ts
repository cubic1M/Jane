import { describe, expect, it } from "vitest";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import { holdingsReply } from "./investments/replies";
import { spendingReply } from "./replies";

// Debug 2 (11-16, the side chat at 1280 light):
// - "how much did I spend on gas last month?" → "You spent $147.36 on gas in October 2026, of
//   $147.36 on Transportation in all.": the part is the whole, said twice.
// - "how much do I have invested?" (one Fidelity positions upload) ended "From Your upload.".

const gas = (date: string, cents: number) => ({
  date,
  amountCents: cents,
  description: "CHEVRON 0091234 SAN JOSE CA",
  merchantName: "Chevron",
  pfcPrimary: "TRANSPORTATION",
  pfcDetailed: "TRANSPORTATION_GAS",
  pending: false,
});

describe("chat answers that say a figure once", () => {
  it("gives the category's whole only when it's more than the part asked about", () => {
    const rows = [gas("2026-09-12", 2_054), gas("2026-10-05", 7_368), gas("2026-10-19", 7_368)];
    const reply = spendingReply(
      { kind: "spending", category: "gas", month: "2026-10" },
      rows,
      "2026-11-16",
    );
    expect(reply.body).toMatch(/^You spent \$147\.36 on gas in October 2026\./);
    expect(reply.body).not.toContain("in all");
  });

  it("says where an upload's holdings come from in lower case", () => {
    const data = demoInvestments();
    const one = { ...data, accounts: [{ ...data.accounts[0]!, institution: "Your upload" }] };
    expect(holdingsReply(one, null).body).toMatch(/\nFrom your upload\.$/);
  });
});
