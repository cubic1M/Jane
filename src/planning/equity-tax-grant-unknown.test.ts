import { describe, expect, it } from "vitest";
import { esppSale, type Event } from "./equity-tax";

// CodeRabbit sweep 1b: an ESPP sale with no offering date was called a qualifying sale from the
// purchase date alone.
const e: Event = {
  kind: "espp",
  company: "Acme",
  shares: 100,
  occurredOn: "2024-03-01",
  grantedOn: null,
  priceCents: 8_500,
  fmvCents: 10_000,
  withheldCents: null,
  soldOn: "2026-06-01",
  soldPriceCents: 12_000,
};

describe("ESPP sale with the offering date not known", () => {
  it("flags that 'qualifying' rests on the purchase date alone", () => {
    expect(esppSale(e)).toMatchObject({ qualifying: true, grantUnknown: true });
    expect(esppSale({ ...e, grantedOn: "2023-01-01" })).toMatchObject({ grantUnknown: false });
  });
  it("is never flagged for a disqualifying sale", () => {
    expect(esppSale({ ...e, soldOn: "2024-09-01" })).toMatchObject({
      qualifying: false,
      grantUnknown: false,
    });
  });
});
