import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS, runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Spec step 263: spending, bills and cash detectors, on the eight sample people and on made-up
// charges where the sample people have none of the signal. Each says who it applies to, the
// dollars a year, a confidence percentage with its reason, the urgency, why this person and
// the action.

const fire = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, SPENDING_DETECTORS);
};
const topics = (id: string, change?: (d: ProfileInput) => ProfileInput) =>
  fire(id, change).map((s) => s.topic);
const add =
  (...txs: ProfileInput["transactions"][number][]) =>
  (d: ProfileInput): ProfileInput => ({ ...d, transactions: [...d.transactions, ...txs] });
const t = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId = "x",
) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId,
});

describe("on the eight sample people", () => {
  it("tells each only what their own charges show", () => {
    const by = Object.fromEntries(PEOPLE.map((p) => [p.id, topics(p.id).sort()]));
    // Netflix and Hulu; Xfinity at $75; cash under a month of bills; Audible went up in September
    // and a Skillshare trial became $13.99 charges.
    expect(by.renter).toEqual([
      "bill_negotiation",
      "duplicate_subscription",
      "low_balance",
      "price_increase",
      "trial_conversion",
    ]);
    // Netflix, Hulu and Disney+; Xfinity and a $148 phone; dinner charged twice; a catered party
    // that put last month's food well over the usual.
    expect(by.family).toEqual([
      "bill_negotiation",
      "budget_overrun",
      "duplicate_charge",
      "duplicate_subscription",
    ]);
    // A $70 phone bill is under the line, and no two streaming services.
    expect(by.freelancer).toEqual([]);
    expect(by.equity).toEqual(["bill_negotiation", "duplicate_subscription"]);
    expect(by.preretire).toEqual(["bill_negotiation"]);
    expect(by.retiree).toEqual(["bill_negotiation"]);
    // Chris: Netflix and Hulu, and $38 in checking against the month's bills.
    expect(by.debt).toEqual(["duplicate_subscription", "low_balance"]);
    expect(by.owner).toEqual(["bill_negotiation"]);
  });

  it("gives each its dollars, a percentage with the reason, an urgency, why and the button", () => {
    for (const p of PEOPLE) {
      for (const s of fire(p.id)) {
        expect(s.worthCents, s.id).toBeGreaterThan(0);
        expect(s.confidence.percent, s.id).toBeGreaterThan(0);
        expect(s.confidence.reason.length, s.id).toBeGreaterThan(3);
        expect(["now", "soon", "later"]).toContain(s.urgency);
        expect(s.why, s.id).toMatch(/\$/);
        expect(s.action.href, s.id).toMatch(/^\//);
      }
    }
  });

  it("works out the dollars from the person's own charges", () => {
    const maya = fire("renter");
    // Hulu $17.99 vs Netflix $15.49: drop the cheaper, $15.49 a year times twelve.
    expect(maya.find((s) => s.topic === "duplicate_subscription")!.worthCents).toBe(1_549 * 12);
    // Xfinity $74.99 a month, 12% off.
    expect(maya.find((s) => s.topic === "bill_negotiation")!.worthCents).toBe(
      Math.round(7_499 * 12 * 0.12),
    );
    // Chris: dropping one of Netflix and Hulu, and the cash short of a month's bills.
    expect(fire("debt").find((s) => s.topic === "low_balance")!.worthKind).toBe("risk");
  });

  it("doesn't tell the well-off that their cash is low", () => {
    for (const id of ["equity", "preretire", "retiree", "family", "owner"]) {
      expect(topics(id), id).not.toContain("low_balance");
    }
  });
});

describe("a price rise", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const series = (amounts: number[], name = "STREAMCO") =>
    months.map((m, i) => t(`${m}-05`, amounts[i], name, "ENTERTAINMENT_OTHER_ENTERTAINMENT"));
  it("is found when a fixed price goes up, worth the rise for a year", () => {
    const s = fire("freelancer", add(...series([999, 999, 999, 999, 999, 1299]))).find(
      (x) => x.topic === "price_increase",
    )!;
    expect(s.worthCents).toBe(300 * 12);
    expect(s.why).toContain("Streamco went from $9.99 to $12.99");
    expect(s.urgency).toBe("soon");
  });
  it("is not raised for a bill that moves every month", () => {
    expect(
      topics("freelancer", add(...series([5000, 6100, 4800, 5900, 5200, 7300], "POWER CO"))),
    ).not.toContain("price_increase");
  });
  it("is not raised for a tiny change", () => {
    expect(topics("freelancer", add(...series([999, 999, 999, 999, 999, 1009])))).not.toContain(
      "price_increase",
    );
  });
});

describe("the same charge twice, and a trial that converted", () => {
  it("finds an identical charge twice within days", () => {
    const s = fire(
      "freelancer",
      add(
        t("2026-09-10", 4_599, "PIZZA PLACE", "FOOD_AND_DRINK_RESTAURANT"),
        t("2026-09-11", 4_599, "PIZZA PLACE", "FOOD_AND_DRINK_RESTAURANT"),
      ),
    ).find((x) => x.topic === "duplicate_charge")!;
    expect(s.worthCents).toBe(4_599);
    expect(s.urgency).toBe("now");
  });
  it("doesn't call a month apart a double charge", () => {
    expect(
      topics(
        "freelancer",
        add(
          t("2026-08-10", 4_599, "PIZZA PLACE", "FOOD_AND_DRINK_RESTAURANT"),
          t("2026-09-10", 4_599, "PIZZA PLACE", "FOOD_AND_DRINK_RESTAURANT"),
        ),
      ),
    ).not.toContain("duplicate_charge");
  });
  it("finds a trial that turned into a paid charge", () => {
    const s = fire(
      "freelancer",
      add(
        t("2026-07-01", 100, "LEARNCO", "GENERAL_SERVICES_EDUCATION"),
        t("2026-07-08", 1_800, "LEARNCO", "GENERAL_SERVICES_EDUCATION"),
        t("2026-08-08", 1_800, "LEARNCO", "GENERAL_SERVICES_EDUCATION"),
      ),
    ).find((x) => x.topic === "trial_conversion")!;
    expect(s.worthCents).toBe(1_800 * 12);
  });

  // Debugger 10-30, the demo bank: a MasterClass trial, then one $120 charge. The report's card
  // said "Could get back about $120.00"; the plan said "about $1,440.00/yr", as if monthly.
  it("counts one paid charge once: how often it renews isn't seen yet", () => {
    const s = fire(
      "freelancer",
      add(
        t("2026-07-01", 100, "SKILLHOUSE", "GENERAL_SERVICES_EDUCATION"),
        t("2026-07-08", 12_000, "SKILLHOUSE", "GENERAL_SERVICES_EDUCATION"),
      ),
    ).find((x) => x.topic === "trial_conversion")!;
    expect(s.worthCents).toBe(12_000);
    expect(s.why).not.toMatch(/a year/);
    expect(s.headline).not.toMatch(/a year/);
  });

  it("reads a yearly plan's pace from its charges", () => {
    const s = fire(
      "freelancer",
      add(
        t("2025-07-01", 100, "SKILLHOUSE", "GENERAL_SERVICES_EDUCATION"),
        t("2025-07-08", 12_000, "SKILLHOUSE", "GENERAL_SERVICES_EDUCATION"),
        t("2026-07-08", 12_000, "SKILLHOUSE", "GENERAL_SERVICES_EDUCATION"),
      ),
    ).find((x) => x.topic === "trial_conversion")!;
    expect(s.worthCents).toBe(12_000);
  });
});

// Manager decision 10-30: the suggestion says asking is worth it, and never that the bill is too
// high (the checkup may say it's a typical price).
describe("asking for a lower phone or internet rate", () => {
  it("says it's worth asking, never that the bill is too high", () => {
    const s = fire("equity").find((x) => x.topic === "bill_negotiation")!;
    expect(s.title).toMatch(/^Worth asking for a lower rate/);
    // The headline keeps its verb first (src/detectors/short-forms.test.ts) and says no more.
    expect(s.headline).toMatch(/^Ask for a lower bill rate/);
    expect(`${s.title} ${s.why} ${s.short}`).not.toMatch(
      /too high|overpay|above typical|more than you should/i,
    );
    expect(s.why).toMatch(/still worth asking/);
  });
});

describe("a category running over", () => {
  // Start from a person with no other food spending, so the figures are the made-up ones.
  const noFood = (d: ProfileInput): ProfileInput => ({
    ...d,
    transactions: d.transactions.filter((x) => !(x.pfc ?? "").startsWith("FOOD_AND_DRINK")),
  });
  const withFood =
    (...txs: ProfileInput["transactions"][number][]) =>
    (d: ProfileInput) =>
      add(...txs)(noFood(d));
  const usual = ["2026-06", "2026-07", "2026-08"].map((m) =>
    t(`${m}-12`, 20_000, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT"),
  );
  it("is found when last month was well over the three before it", () => {
    const s = fire(
      "freelancer",
      withFood(...usual, t("2026-09-12", 50_000, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT")),
    ).find((x) => x.topic === "budget_overrun")!;
    expect(s.worthCents).toBe(30_000);
    expect(s.title).toContain("food and drink");
    expect(s.action.href).toBe("/budgets");
  });
  // Overnight upload QA: 3 months of statements from Jul 28.
  it("counts only the months the data covers in full as usual", () => {
    const only =
      (...txs: ProfileInput["transactions"][number][]) =>
      (d: ProfileInput): ProfileInput => ({ ...d, transactions: txs });
    const food = (date: string, cents: number) =>
      t(date, cents, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT");
    // Aug is the only full month before Sep: not enough to call Sep unusual.
    expect(
      topics(
        "freelancer",
        only(food("2026-07-28", 5_000), food("2026-08-12", 20_000), food("2026-09-12", 50_000)),
      ),
    ).not.toContain("budget_overrun");
    // From Jun 28, Jul and Aug are full: the same September is over their average.
    expect(
      topics(
        "freelancer",
        only(
          food("2026-06-28", 5_000),
          food("2026-07-12", 20_000),
          food("2026-08-12", 20_000),
          food("2026-09-12", 50_000),
        ),
      ),
    ).toContain("budget_overrun");
  });
  // Messy-bank QA: one big purchase isn't a month running over.
  it("leaves a one-off big purchase out", () => {
    const meals = ["2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) =>
      ["05", "12", "19"].map((d) => t(`${m}-${d}`, 6_000, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT")),
    );
    const banquet = t("2026-09-20", 190_000, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT");
    expect(topics("freelancer", withFood(...meals, banquet))).not.toContain("budget_overrun");
  });
  it("leaves rent, loans and transfers out, and small swings alone", () => {
    expect(
      topics(
        "freelancer",
        withFood(...usual, t("2026-09-12", 24_000, "BIG EATS", "FOOD_AND_DRINK_RESTAURANT")),
      ),
    ).not.toContain("budget_overrun");
    expect(
      topics(
        "freelancer",
        add(
          ...["2026-06", "2026-07", "2026-08"].map((m) =>
            t(`${m}-01`, 100_000, "LANDLORD", "RENT_AND_UTILITIES_RENT"),
          ),
          t("2026-09-01", 300_000, "LANDLORD", "RENT_AND_UTILITIES_RENT"),
        ),
      ),
    ).not.toContain("budget_overrun");
  });
});

// Spec step 263 (QA sweep): the old spending rules, held to the person.
describe("fees and the emergency fund, for the people the QA sweep named", () => {
  const all = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
    const data = change(inputFor(id));
    return runDetectors({ profile: buildProfile(data), data }, DETECTORS);
  };
  const find = (list: ReturnType<typeof all>, topic: string) => list.find((s) => s.topic === topic);

  it("never calls Jo's Square processing fees bank fees", () => {
    const asFees =
      (description: string) =>
      (d: ProfileInput): ProfileInput => ({
        ...d,
        transactions: [
          ...d.transactions.filter((x) => !/SQUARE/.test(x.description)),
          ...["2026-03", "2026-04", "2026-05", "2026-06"].map((m) =>
            t(`${m}-05`, 22_000, description, "BANK_FEES_ATM_FEES"),
          ),
        ],
      });
    expect(find(all("owner", asFees("SQUARE PROCESSING FEES")), "bank_fees")).toBeUndefined();
    // The same lines from a bank are fees.
    expect(find(all("owner", asFees("ATM FEE")), "bank_fees")).toBeDefined();
  });

  it("suggests a small starter buffer for Chris, who is overdrawn, not three months", () => {
    const s = find(all("debt"), "emergency_fund")!;
    expect(s.title).toMatch(/starter buffer/i);
    expect(s.worthCents).toBeLessThanOrEqual(100_000);
    expect(s.why).toContain("debt plan");
  });

  it("suggests six months for Sam, whose income moves around, and three for Maya", () => {
    const sam = find(
      all("freelancer", (d) => ({
        ...d,
        accounts: d.accounts.map((a) => ({ ...a, balanceCents: 0 })),
      })),
      "emergency_fund",
    )!;
    const maya = find(
      all("renter", (d) => ({
        ...d,
        accounts: d.accounts.map((a) => ({ ...a, balanceCents: 0 })),
      })),
      "emergency_fund",
    )!;
    expect(sam.why).toContain("6 months");
    expect(maya.why).toContain("3 months");
  });

  it("suggests nothing for Ruth even with no cash, since her pension covers her spending", () => {
    expect(
      find(
        all("retiree", (d) => ({
          ...d,
          accounts: d.accounts.map((a) => ({ ...a, balanceCents: 0 })),
        })),
        "emergency_fund",
      ),
    ).toBeUndefined();
  });
});
