import { describe, expect, it } from "vitest";
import { PRICE_RISE_LEAD_DAYS, PROMO_RISE_SHARE } from "@/config/price-rises";
import { payeeOf, priceRises, type Charge } from "./price-rises";

// Spec step 243, pure: intro prices about to end and yearly plans about to renew.

const TODAY = "2026-10-20";
const monthly = (name: string, pfc: string, cents: number, from: string, to = "2026-10-05") => {
  const out: Charge[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; ; i += 1) {
    const date = new Date(Date.UTC(y, m - 1 + i, d)).toISOString().slice(0, 10);
    if (date > to) break;
    out.push({ date, amountCents: cents, description: name, pfc });
  }
  return out;
};
// The person's data starts a year back.
const start: Charge = {
  date: "2025-10-21",
  amountCents: 4_000,
  description: "KROGER",
  pfc: "FOOD_AND_DRINK_GROCERIES",
};
const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";

describe("price rises", () => {
  it("sees a new internet bill's intro price ending a year in, with the likely new price", () => {
    const [rise] = priceRises(
      [start, ...monthly("AT&T FIBER 5521", INTERNET, 5_500, "2025-12-06")],
      TODAY,
    );
    expect(rise).toMatchObject({
      kind: "promo_end",
      name: "AT&T Fiber",
      date: "2026-12-06",
      daysLeft: 47,
      nowCents: 5_500,
      thenCents: Math.round(5_500 * (1 + PROMO_RISE_SHARE)),
    });
    expect(rise.daysLeft).toBeGreaterThanOrEqual(PRICE_RISE_LEAD_DAYS);
    expect(rise.script).toMatch(/promotional rate ends soon/);
    expect(rise.confidence.percent).toBeLessThanOrEqual(70);
  });

  it("leaves a bill alone that was there from the start, moved in price, or is too far off", () => {
    expect(priceRises(monthly("XFINITY", INTERNET, 7_499, "2025-10-21"), TODAY)).toEqual([]);
    const moved = monthly("AT&T FIBER", INTERNET, 5_500, "2025-12-06");
    moved[moved.length - 1] = { ...moved[moved.length - 1], amountCents: 7_700 };
    expect(priceRises([start, ...moved], TODAY)).toEqual([]);
    expect(
      priceRises([start, ...monthly("AT&T FIBER", INTERNET, 5_500, "2026-03-06")], TODAY),
    ).toEqual([]);
  });

  it("sees a yearly plan paid once about a year ago renewing", () => {
    const [rise] = priceRises(
      [
        start,
        {
          date: "2025-12-05",
          amountCents: 9_999,
          description: "ICLOUD+ ANNUAL PLAN",
          pfc: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        },
      ],
      TODAY,
    );
    expect(rise).toMatchObject({
      kind: "annual_renewal",
      date: "2026-12-05",
      thenCents: 9_999,
      atStakeCents: 9_999,
    });
    // A one-off from a shop isn't a plan, and a recent one isn't renewing yet.
    expect(
      priceRises(
        [start, { date: "2025-12-05", amountCents: 9_999, description: "BEST BUY", pfc: null }],
        TODAY,
      ),
    ).toEqual([]);
    expect(
      priceRises(
        [
          start,
          { date: "2026-06-05", amountCents: 9_999, description: "ICLOUD+ ANNUAL", pfc: null },
        ],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("names payees the way people say them", () => {
    expect(payeeOf("AT&T FIBER 5521")).toBe("AT&T Fiber");
    expect(payeeOf("SPECTRUM*INTERNET 123")).toBe("Spectrum");
  });
});
