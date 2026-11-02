import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { LIFE_FACT_DETECTORS } from "./life-facts";

// The profile's life facts change what is suggested (founder, 2026-10-26): cover for a pet only
// for someone with a pet, student plans only for a student, renters' cover only for a renter.

const base = (): ProfileInput => ({
  today: "2026-10-21",
  transactions: [],
  accounts: [],
  liabilities: [],
  told: {},
});
const pay = (date: string, description: string, pfc: string | null, cents = 4500): ProfileTx => ({
  date,
  amountCents: cents,
  description,
  pfc,
  accountId: "a",
});
const monthly = (description: string, pfc: string | null, n: number, cents = 4500) =>
  Array.from({ length: n }, (_, i) =>
    pay(`2026-${String(i + 1).padStart(2, "0")}-12`, description, pfc, cents),
  );
const topicsFor = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, LIFE_FACT_DETECTORS);

describe("pet insurance", () => {
  it("reaches the Reyes family and no other sample person", () => {
    for (const p of PEOPLE) {
      const found = topicsFor(inputFor(p.id)).map((s) => s.topic);
      expect(found.includes("pet_insurance"), p.id).toBe(p.id === "family");
    }
  });

  it("names the pet payments it saw, takes the fact's confidence, and is demo advice", () => {
    const [s] = topicsFor(inputFor("family"));
    expect(s.why).toMatch(/Chewy|vet|pet/i);
    expect(s.short).toMatch(/\d+ vet and pet payments/);
    expect(s.worthKind).toBe("risk");
    expect(s.confidence.percent).toBeLessThanOrEqual(70);
    expect(s.confidence.reason).toMatch(/typical, not quoted/);
    expect(ADVICE_TOPICS).toContain("pet_insurance");
  });

  it("is a guess, and says so, when the signs are few", () => {
    const data = { ...base(), transactions: monthly("PETCO 1881", null, 3) };
    const [s] = topicsFor(data);
    expect(s.confidence.percent).toBeLessThan(50);
  });

  it("is not made for someone already paying a pet insurer, or with no pet", () => {
    const covered = {
      ...base(),
      transactions: [
        ...monthly("CHEWY.COM", "GENERAL_MERCHANDISE_PET_SUPPLIES", 6),
        ...monthly("TRUPANION PET INSURANCE", "GENERAL_SERVICES_INSURANCE", 6, 6000),
      ],
    };
    expect(topicsFor(covered)).toEqual([]);
    expect(topicsFor({ ...base(), transactions: [pay("2026-05-05", "PETCO 1881", null)] })).toEqual(
      [],
    );
    // They said they have no pet: that wins.
    const told = {
      ...covered,
      transactions: monthly("CHEWY.COM", null, 6),
      told: { has_pet: false },
    };
    expect(topicsFor(told)).toEqual([]);
  });
});

describe("student plans", () => {
  const student = (): ProfileInput => ({
    ...base(),
    transactions: [
      ...monthly("STATE UNIV BOOKSTORE #2", null, 4, 3500),
      ...monthly("STATE UNIVERSITY BURSAR PAYMENT", null, 2, 400000),
      ...monthly("SPOTIFY USA", null, 5, 1199),
      ...monthly("AMAZON PRIME*2K4AB7XY0", null, 5, 1499),
    ],
  });

  it("finds the student plans for the services a student pays for, and what they save", () => {
    const [s] = topicsFor(student());
    expect(s.topic).toBe("student_discounts");
    expect(s.why).toMatch(/Spotify and Amazon Prime/);
    expect(s.worthCents).toBe(7_200 + 9_000);
    expect(s.confidence.reason).toMatch(/typical list prices/);
  });

  it("is not made for someone who is not a student, or who pays for none of them", () => {
    const notStudent = {
      ...base(),
      transactions: [
        ...monthly("SPOTIFY USA", null, 5, 1199),
        ...monthly("NETFLIX.COM", null, 5, 1549),
      ],
    };
    expect(topicsFor(notStudent)).toEqual([]);
    const noPlans = {
      ...base(),
      transactions: [
        ...monthly("STATE UNIV BOOKSTORE #2", null, 4, 3500),
        ...monthly("STATE UNIVERSITY BURSAR PAYMENT", null, 2, 400000),
      ],
    };
    expect(topicsFor(noPlans)).toEqual([]);
  });

  // Debugger 11-02: a student paying $5.99 for Spotify was told "Switch to student plans, save $72 a
  // year". A statement line rarely says "student", so it goes by the price.
  describe("when they're already on the student price", () => {
    const paying = (spotify: number, prime = 1499) => ({
      ...student(),
      transactions: [
        ...monthly("STATE UNIV BOOKSTORE #2", null, 4, 3500),
        ...monthly("STATE UNIVERSITY BURSAR PAYMENT", null, 2, 400000),
        ...monthly("SPOTIFY USA", null, 5, spotify),
        ...monthly("AMAZON PRIME*2K4AB7XY0", null, 5, prime),
      ],
    });

    it("leaves that service out, and what it would save", () => {
      const [s] = topicsFor(paying(599));
      expect(s.why).toMatch(/Amazon Prime/);
      expect(s.why).not.toMatch(/Spotify/);
      expect(s.worthCents).toBe(9_000);
    });

    it("allows for sales tax on the student price", () => {
      expect(topicsFor(paying(649))[0].why).not.toMatch(/Spotify/);
    });

    it("still suggests it at a price well above the student one", () => {
      expect(topicsFor(paying(1199))[0].why).toMatch(/Spotify/);
    });

    it("isn't made when they're on the student price of everything", () => {
      expect(topicsFor(paying(599, 749)).map((t) => t.topic)).not.toContain("student_discounts");
    });

    it("goes by what they pay now, not what they paid", () => {
      const moved = {
        ...student(),
        transactions: [
          ...monthly("STATE UNIV BOOKSTORE #2", null, 4, 3500),
          ...monthly("STATE UNIVERSITY BURSAR PAYMENT", null, 2, 400000),
          ...monthly("SPOTIFY USA", null, 5, 1199).map((t, i, all) =>
            i === all.reduce((late, x, j) => (x.date > all[late].date ? j : late), 0)
              ? { ...t, amountCents: 599 }
              : t,
          ),
        ],
      };
      expect(topicsFor(moved).map((t) => t.topic)).not.toContain("student_discounts");
    });
  });

  it("a student they say they are is a student", () => {
    const told = {
      ...student(),
      transactions: monthly("SPOTIFY USA", null, 5, 1199),
      told: { is_student: true },
    };
    expect(topicsFor(told).map((s) => s.topic)).toEqual(["student_discounts"]);
  });
});

describe("renters' cover and the facts", () => {
  it("is never pitched to someone who owns their home", () => {
    for (const p of PEOPLE) {
      const profile = buildProfile(inputFor(p.id));
      if (profile.facts.housing.value !== "own") continue;
      const data = inputFor(p.id);
      const found = runDetectors({ profile, data }).map((s) => s.topic);
      expect(found, p.id).not.toContain("renters_insurance");
    }
  });
});
