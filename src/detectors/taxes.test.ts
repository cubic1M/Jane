import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { PEOPLE, PERSON_IDS, type PersonId } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_DETECTORS, daysToEstimatedDate, urgencyForEstimated } from "./taxes";

// Spec step 261: the tax detectors on the eight sample people, their deadlines, and the
// percentages worked out from evidence.

const run = (id: PersonId, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS);
};
const topics = (id: PersonId, change?: (d: ProfileInput) => ProfileInput) =>
  run(id, change).map((s) => s.topic);
const inJanuary = (d: ProfileInput): ProfileInput => ({ ...d, today: "2027-01-20" });

describe("who the tax detectors reach", () => {
  it("withholding on stock pay: only the person with a stock plan, worked out from their figures", () => {
    for (const id of PERSON_IDS) {
      expect(topics(id).includes("withholding_gap"), id).toBe(id === "equity");
    }
    const s = run("equity").find((x) => x.topic === "withholding_gap")!;
    expect(s).toMatchObject({ capability: "taxes", worthKind: "risk", urgency: "soon" });
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.confidence.percent).toBeLessThanOrEqual(70);
    expect(s.confidence.reason).toContain("no vest schedule");
    expect(s.why).toMatch(/withheld at 22 cents.*bracket.*to pay when you file/);
    // Without the plan there is nothing to suggest.
    expect(
      topics("equity", (d) => ({
        ...d,
        accounts: d.accounts.filter((a) => a.subtype !== "stock plan"),
      })),
    ).not.toContain("withholding_gap");
  });

  it("Roth conversions: near or in retirement with a big pre-tax balance, never someone starting out", () => {
    const fired = PERSON_IDS.filter((id) => topics(id).includes("roth_conversion"));
    expect(fired).toEqual(["preretire", "retiree"]);
    const s = run("preretire").find((x) => x.topic === "roth_conversion")!;
    expect(s.worthKind).toBe("saves");
    expect(s.confidence.percent).toBeLessThanOrEqual(65);
    expect(s.confidence.reason).toMatch(/pre-tax account/);
    // A small balance isn't worth raising.
    expect(
      topics("preretire", (d) => ({
        ...d,
        accounts: d.accounts.map((a) =>
          a.type === "investment" ? { ...a, balanceCents: 1_000_000 } : a,
        ),
      })),
    ).not.toContain("roth_conversion");
    // It becomes urgent in November, the last full month to do it.
    expect(s.urgency).toBe("later");
    expect(
      run("preretire", (d) => ({ ...d, today: "2026-11-20" })).find(
        (x) => x.topic === "roth_conversion",
      )!.urgency,
    ).toBe("soon");
  });

  it("childcare: the family that pays for it, from what they paid", () => {
    expect(PERSON_IDS.filter((id) => topics(id).includes("childcare_tax_break"))).toEqual([
      "family",
    ]);
    const s = run("family").find((x) => x.topic === "childcare_tax_break")!;
    expect(s.worthKind).toBe("saves");
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.why).toMatch(/You paid \$19,800\.00 for childcare/);
    // No childcare payments, nothing to say.
    expect(
      topics("family", (d) => ({
        ...d,
        transactions: d.transactions.filter((t) => t.pfc !== "GENERAL_SERVICES_CHILDCARE"),
      })),
    ).not.toContain("childcare_tax_break");
  });

  it("the identity PIN: for everyone paid, only from January to filing season", () => {
    for (const id of PERSON_IDS)
      expect(topics(id), `${id} in October`).not.toContain("identity_ip_pin");
    for (const id of PERSON_IDS) {
      expect(topics(id, inJanuary), `${id} in January`).toContain("identity_ip_pin");
    }
    const s = run("renter", inJanuary).find((x) => x.topic === "identity_ip_pin")!;
    expect(s.worthCents).toBe(
      Math.round(DETECTOR_RATES.tax.typicalRefundCents * DETECTOR_RATES.tax.ipPinTheftChance),
    );
    expect(s.urgency).toBe("soon");
    expect(topics("renter", (d) => ({ ...d, today: "2027-04-16" }))).not.toContain(
      "identity_ip_pin",
    );
    expect(topics("renter", (d) => ({ ...d, today: "2027-04-15" }))).toContain("identity_ip_pin");
  });
});

describe("the deadline drives urgency for estimated payments", () => {
  it("counts days to the next quarterly date", () => {
    expect(daysToEstimatedDate("2026-09-10")).toBe(5);
    expect(daysToEstimatedDate("2026-09-15")).toBe(0);
    expect(daysToEstimatedDate("2026-09-16")).toBe(121);
    expect(daysToEstimatedDate("2027-01-10")).toBe(5);
  });

  it("is now within two weeks, soon within six, later otherwise", () => {
    expect(urgencyForEstimated("2026-09-10")).toBe("now");
    expect(urgencyForEstimated("2026-09-01")).toBe("now");
    expect(urgencyForEstimated("2026-08-15")).toBe("soon");
    expect(urgencyForEstimated("2026-06-20")).toBe("later");
    const freelancer = (today: string) =>
      runDetectors(
        {
          profile: buildProfile({ ...inputFor("freelancer"), today }),
          data: { ...inputFor("freelancer"), today },
        },
        undefined,
      ).find((s) => s.topic === "estimated_taxes");
    expect(freelancer("2026-09-10")?.urgency).toBe("now");
    expect(freelancer("2026-09-10")?.why).toContain("due in 5 days");
  });
});

describe("percentages come from evidence", () => {
  it("are the same every time, and a guess lowers them", () => {
    expect(run("family")).toEqual(run("family"));
    const base = run("preretire").find((x) => x.topic === "roth_conversion")!;
    // The same life stage, told by the person, still can't beat the assumption it rests on.
    const told = run("preretire", (d) => ({ ...d, told: { life_stage: "approaching" } })).find(
      (x) => x.topic === "roth_conversion",
    )!;
    expect(told.confidence.percent).toBeGreaterThanOrEqual(base.confidence.percent);
    expect(told.confidence.percent).toBeLessThanOrEqual(65);
  });

  it("every tax detector belongs to the taxes capability and every person list names real topics", () => {
    for (const d of TAX_DETECTORS) expect(d.capability).toBe("taxes");
    for (const p of PEOPLE) {
      expect(
        p.should.filter((t) => p.mustNot.includes(t)),
        p.id,
      ).toEqual([]);
    }
  });
});

describe("year-end moves", () => {
  const december = (d: ProfileInput): ProfileInput => ({ ...d, today: "2026-12-05" });

  it("fire from November 15 for people with a workplace plan, and not before", () => {
    for (const id of PERSON_IDS) {
      expect(topics(id).includes("year_end_moves"), `${id} in October`).toBe(false);
    }
    const withPlan = PERSON_IDS.filter((id) => topics(id, december).includes("year_end_moves"));
    expect(withPlan).toEqual(["renter", "family", "equity", "preretire"]);
    expect(topics("renter", (d) => ({ ...d, today: "2026-11-14" }))).not.toContain(
      "year_end_moves",
    );
    expect(topics("renter", (d) => ({ ...d, today: "2026-11-15" }))).toContain("year_end_moves");
  });

  it("is urgent as the date nears, and says what it can't see", () => {
    const early = run("family", (d) => ({ ...d, today: "2026-11-20" })).find(
      (s) => s.topic === "year_end_moves",
    )!;
    const late = run("family", (d) => ({ ...d, today: "2026-12-15" })).find(
      (s) => s.topic === "year_end_moves",
    )!;
    expect(early.urgency).toBe("soon");
    expect(late.urgency).toBe("now");
    expect(late.confidence.percent).toBeLessThanOrEqual(50);
    expect(late.confidence.reason).toMatch(/can't see what you've put in/);
    expect(late.worthCents).toBeGreaterThan(0);
  });
});

describe("the rest of the tax tools find their people", () => {
  it("receipts for big gifts: whoever gave one, never the renter or the person in debt", () => {
    const who = PERSON_IDS.filter((id) => topics(id).includes("charity_receipts"));
    expect(who).toEqual(["family", "equity", "preretire", "retiree"]);
    const s = run("equity").find((x) => x.topic === "charity_receipts")!;
    expect(s.worthKind).toBe("risk");
    expect(s.confidence.percent).toBeLessThanOrEqual(70);
    expect(s.why).toMatch(/You gave \$1,000\.00 in one gift/);
    // A small gift needs no receipt.
    expect(
      topics("equity", (d) => ({
        ...d,
        transactions: d.transactions.map((t) =>
          t.pfc === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" ? { ...t, amountCents: 10_000 } : t,
        ),
      })),
    ).not.toContain("charity_receipts");
  });

  it("property tax: owners who pay it, from what they paid, with the appeal gap as the stake", () => {
    const who = PERSON_IDS.filter((id) => topics(id).includes("property_tax_check"));
    expect(who).toEqual(["family", "equity", "preretire", "retiree"]);
    const s = run("family").find((x) => x.topic === "property_tax_check")!;
    expect(s.worthCents).toBe(Math.round(580_000 * 0.07));
    expect(s.confidence.percent).toBeLessThanOrEqual(45);
    expect(s.confidence.reason).toContain("assessment");
    // A renter with the same bill has nothing to appeal.
    expect(topics("family", (d) => ({ ...d, told: { housing: "rent" } }))).not.toContain(
      "property_tax_check",
    );
  });

  it("loss harvesting: a taxable account below cost, never a retirement account's loss", () => {
    expect(PERSON_IDS.filter((id) => topics(id).includes("tax_loss_harvest"))).toEqual(["equity"]);
    const s = run("equity").find((x) => x.topic === "tax_loss_harvest")!;
    expect(s.worthKind).toBe("saves");
    expect(s.why).toContain("wash-sale");
    expect(s.worthCents).toBeLessThanOrEqual(Math.round(300_000 * 0.5));
    // The same loss inside a retirement account isn't a deduction.
    expect(
      topics("equity", (d) => ({
        ...d,
        accounts: d.accounts.map((a) =>
          a.subtype === "brokerage" ? { ...a, subtype: "401k" } : a,
        ),
      })),
    ).not.toContain("tax_loss_harvest");
    // No holdings read, nothing to say.
    expect(topics("equity", (d) => ({ ...d, holdings: undefined }))).not.toContain(
      "tax_loss_harvest",
    );
  });

  it("filing: January 15 to April 15 for people paid, urgent in the last two weeks, quiet after a refund", () => {
    const at =
      (today: string) =>
      (d: ProfileInput): ProfileInput => ({ ...d, today });
    for (const id of PERSON_IDS) expect(topics(id), id).not.toContain("file_return");
    expect(topics("renter", at("2027-01-14"))).not.toContain("file_return");
    expect(topics("renter", at("2027-01-15"))).toContain("file_return");
    expect(topics("renter", at("2027-04-16"))).not.toContain("file_return");
    expect(run("renter", at("2027-03-01")).find((x) => x.topic === "file_return")!.urgency).toBe(
      "soon",
    );
    const late = run("renter", at("2027-04-05")).find((x) => x.topic === "file_return")!;
    expect(late.urgency).toBe("now");
    expect(late.why).toContain("10 days from now");
    // A refund already deposited means it's filed.
    expect(
      topics("renter", (d) => ({
        ...at("2027-03-01")(d),
        transactions: [
          ...d.transactions,
          {
            date: "2027-02-20",
            amountCents: -120_000,
            description: "IRS TREAS 310 TAX REF",
            pfc: "INCOME_TAX_REFUND",
            accountId: d.accounts[0].id,
          },
        ],
      })),
    ).not.toContain("file_return");
  });
});

describe("business owners' tax structure", () => {
  it("raises an S corporation only for the profit where it pays: Jo, not Sam", () => {
    expect(PERSON_IDS.filter((id) => topics(id).includes("s_corp_election"))).toEqual(["owner"]);
    const s = run("owner").find((x) => x.topic === "s_corp_election")!;
    expect(s.worthKind).toBe("saves");
    expect(s.worthCents).toBeGreaterThanOrEqual(100_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expect(s.confidence.reason).toMatch(/deposits are sales, so I assumed 15% is profit/);
    expect(s.why).toMatch(/Form 2553\) is due March 15/);
    // Bigger profit, bigger saving: Sam's income doubled would be worth raising too.
    expect(
      topics("freelancer", (d) => ({
        ...d,
        transactions: d.transactions.map((t) =>
          t.pfc === "INCOME_CONTRACTOR" ? { ...t, amountCents: t.amountCents * 3 } : t,
        ),
      })),
    ).toContain("s_corp_election");
  });

  it("is urgent before the March 15 election date and not after", () => {
    // The sample's year of data moved forward whole, so the same life is seen on another date.
    const on =
      (today: string) =>
      (d: ProfileInput): ProfileInput => {
        const days = Math.round((Date.parse(today) - Date.parse(d.today)) / 86_400_000);
        const move = (day: string) =>
          new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
        return {
          ...d,
          today,
          transactions: d.transactions.map((t) => ({ ...t, date: move(t.date) })),
        };
      };
    const urgency = (today: string) =>
      run("owner", on(today)).find((x) => x.topic === "s_corp_election")?.urgency;
    expect(urgency("2027-02-20")).toBe("soon");
    expect(urgency("2027-03-16")).toBe("later");
    expect(urgency("2026-10-17")).toBe("later");
  });

  it("home office: the freelancer who rents at home, never the shop owner with a shop", () => {
    expect(PERSON_IDS.filter((id) => topics(id).includes("home_office_deduction"))).toEqual([
      "freelancer",
    ]);
    const s = run("freelancer").find((x) => x.topic === "home_office_deduction")!;
    expect(s.why).toMatch(/150 square feet at \$5 a square foot, is a \$750\.00 deduction/);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
  });

  it("vehicle: whoever works for themselves and buys gas, from the standard mileage rate", () => {
    expect(PERSON_IDS.filter((id) => topics(id).includes("vehicle_deduction"))).toEqual([
      "freelancer",
      "owner",
    ]);
    const s = run("owner").find((x) => x.topic === "vehicle_deduction")!;
    expect(s.why).toMatch(/4,000 miles.*\$2,900\.00/);
    expect(s.confidence.percent).toBeLessThanOrEqual(45);
    expect(
      topics("owner", (d) => ({
        ...d,
        transactions: d.transactions.filter((t) => t.pfc !== "TRANSPORTATION_GAS"),
      })),
    ).not.toContain("vehicle_deduction");
  });
});
