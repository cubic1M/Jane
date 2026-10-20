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
    expect(s.why).toMatch(/withheld at 22%.*bracket.*to pay when you file/);
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
    expect(s.confidence.reason).toMatch(/12 months of data/);
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
    expect(s.worthCents).toBe(DETECTOR_RATES.tax.typicalRefundCents);
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
