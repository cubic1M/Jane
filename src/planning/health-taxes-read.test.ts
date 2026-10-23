import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readHealthTaxes } from "./health-taxes-read";

// Taxes QA (2026-10-22): a bank's transactions never include an investment account's, so money
// into a linked HSA was never seen in the app and Priya's HSA check never fired. Her deposits
// are transfers from checking; an HSA's own reported contributions are used when the bank sends
// them, and the two are never added together.

const read = (d: ProfileInput) => readHealthTaxes(buildProfile(d), d).hsa;

describe("HSA deposits, wherever the bank shows them", () => {
  it("counts transfers to an HSA from checking, even with the HSA linked", () => {
    const h = read(inputFor("equity"));
    expect(h).toMatchObject({ deposits: 10, contributedCents: 500_000, excessCents: 60_000 });
  });

  it("uses the HSA's reported contributions instead, never both", () => {
    const d = inputFor("equity");
    const h = read({
      ...d,
      extras: { ...d.extras!, hsaContributions: { cents: 300_000, count: 6 } },
    });
    expect(h).toMatchObject({ deposits: 6, contributedCents: 300_000 });
    // None reported: back to the transfers.
    const none = read({ ...d, extras: { ...d.extras!, hsaContributions: { cents: 0, count: 0 } } });
    expect(none.contributedCents).toBe(500_000);
  });
});
