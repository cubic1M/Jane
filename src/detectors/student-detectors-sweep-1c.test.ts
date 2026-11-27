import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { STUDENT_BENEFIT_DETECTORS } from "./student-benefits";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { STATE_MOVE_DETECTORS } from "./state-move";
import { runDetectors } from "./index";
import { undergrad } from "./__fixtures__/students";
import { STUDENT_TODAY } from "./__fixtures__/student-walk";

// CodeRabbit sweep 1c, det-03 findings 7, 9, 12, 14, 15 and 16.
const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...STUDENT_BENEFIT_DETECTORS,
    ...STUDENT_CREDIT_DETECTORS,
    ...STATE_MOVE_DETECTORS,
  ]).find((s) => s.topic === topic) ?? null;
const row = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const person = (rows: ReturnType<typeof row>[], told: Told = {}): ProfileInput => ({
  today: STUDENT_TODAY,
  transactions: rows,
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
  liabilities: [],
  told: { home_state: "CA", tax_residency: "citizen", ...told },
});
const groceries = ["2026-08-18", "2026-09-18", "2026-10-18", "2026-11-13"].map((d) =>
  row(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
);

describe("a move read from purchases", () => {
  const located = (state: string, months: string[]) =>
    months.flatMap((m) =>
      [3, 9, 14, 21].map((d) =>
        row(
          `${m}-${String(d).padStart(2, "0")}`,
          4_500,
          `SHOP #12 ${state === "CA" ? "PALO ALTO CA" : "RENO NV"}`,
          "GENERAL_MERCHANDISE_OTHER",
        ),
      ),
    );
  it("says a possible move, not a required part-year status", () => {
    const data = person([
      ...located("NV", ["2026-07", "2026-08"]),
      ...located("CA", ["2026-09", "2026-10"]),
    ]);
    const s = fire(data, "state_move");
    expect(s).not.toBeNull();
    expect(s!.required).not.toBe(true);
    expect(s!.title).toMatch(/if you moved/);
    expect(s!.why).toMatch(/If you moved your home/);
    expect(s!.confidence.percent).toBeLessThanOrEqual(60);
  });
});

describe("Stanford's aid priority date", () => {
  const aid = [row("2026-10-02", -125_000, "STANFORD UNIVERSITY FINANCIAL AID", null)];
  const stanfordish = (told: Told) => {
    const base = undergrad();
    return { ...base, today: "2027-03-01", told: { ...base.told, ...told } };
  };
  it("is for continuing undergraduates, not someone who said they are in a graduate program", () => {
    const base = undergrad();
    const withAid: ProfileInput = {
      ...stanfordish({}),
      transactions: [
        ...base.transactions,
        ...aid.map((t) => ({ ...t, accountId: base.accounts[0]!.id })),
      ],
    };
    const known = fire(
      { ...withAid, told: { ...withAid.told, enrollment: "grad" } },
      "aid_priority_date",
    );
    expect(known).toBeNull();
    const undergraduate = fire(
      { ...withAid, told: { ...withAid.told, enrollment: "undergrad" } },
      "aid_priority_date",
    );
    expect(undergraduate?.why).toMatch(/For continuing undergraduates/);
  });
});

describe("the American opportunity credit's refundable part", () => {
  const told = { claimed_as_dependent: "no", enrollment: "undergrad" };
  const tuition = [
    row("2026-10-10", 320_000, "STANFORD UNIVERSITY TUITION PAYMENT", "GENERAL_SERVICES_EDUCATION"),
  ];
  it("reaches someone 24 and someone over 65, by the credit's own age rule", () => {
    for (const age of [24, 66]) {
      const s = fire(person([...groceries, ...tuition], { ...told, age }), "education_credit");
      expect(s, String(age)).not.toBeNull();
      expect(s!.why).toContain("40% of it is paid even with no tax owed");
    }
    expect(
      fire(person([...groceries, ...tuition], { ...told, age: 23 }), "education_credit"),
    ).toBeNull();
  });
});

describe("a dependent's education credit", () => {
  it("is shown as up to, on the return of whoever claims them", () => {
    const tuition = [
      row(
        "2026-10-10",
        320_000,
        "STANFORD UNIVERSITY TUITION PAYMENT",
        "GENERAL_SERVICES_EDUCATION",
      ),
    ];
    const s = fire(
      person([...groceries, ...tuition], { claimed_as_dependent: "yes", enrollment: "undergrad" }),
      "education_credit",
    )!;
    expect(s.title).toMatch(/up to .* on the return of whoever claims you/);
    expect(s.confidence.percent).toBeLessThanOrEqual(45);
  });
});

describe("the earned income credit with interest seen", () => {
  const pay = ["2026-08-20", "2026-09-20", "2026-10-20", "2026-11-15"].map((d) =>
    row(d, -80_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
  );
  const told = { age_25_plus: "yes", claimed_as_dependent: "no" };
  it("is gone when the interest passes the investment-income limit", () => {
    expect(fire(person([...groceries, ...pay], told), "earned_income_credit")).not.toBeNull();
    const interest = ["2026-08-30", "2026-09-30", "2026-10-30", "2026-11-15"].map((d) =>
      row(d, -400_000, "SAVINGS INTEREST PAID", "INCOME_INTEREST_EARNED"),
    );
    expect(
      fire(person([...groceries, ...pay, ...interest], told), "earned_income_credit"),
    ).toBeNull();
  });
});

describe("California's renter's credit after a move", () => {
  it("counts only the rent from the month of the move", () => {
    const rent = (ds: string[], name: string) =>
      ds.map((d) => row(d, 145_000, name, "RENT_AND_UTILITIES_RENT"));
    const located = (state: string, months: string[]) =>
      months.flatMap((m) =>
        [3, 9, 14, 21].map((d) =>
          row(
            `${m}-${String(d).padStart(2, "0")}`,
            4_500,
            `SHOP #12 ${state === "CA" ? "PALO ALTO CA" : "RENO NV"}`,
            "GENERAL_MERCHANDISE_OTHER",
          ),
        ),
      );
    const data = person(
      [
        ...located("NV", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]),
        ...located("CA", ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]),
        ...rent(
          ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"],
          "SIERRA APARTMENTS RENT",
        ),
        ...rent(["2026-11-01"], "OAK CREEK APARTMENTS RENT"),
      ],
      {},
    );
    const s = fire(data, "ca_renters_credit");
    // Five months of Nevada rent are not California rent; one month is under half the year.
    expect(s === null || s.confidence.percent <= 55).toBe(true);
    if (s) expect(s.confidence.reason).toMatch(/rent seen in 1 month/);
  });
});
