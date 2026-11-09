import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { DETECTORS, runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { loansTree } from "./loans";

// Debugger 11-06: on a real account's Loans tree, PSLF forgiveness (about $27,716 left after 120
// payments, said once in its headline: "get $27,716 back") was drawn as "$28k/yr". A worth that
// comes once is a bare figure on every tree; one that comes every year has "/yr".

type Open = Parameters<typeof loansTree>[0]["suggestions"][number];

const figures = (suggestions: Open[]) => {
  const { tree } = loansTree({
    asOf: "2026-11-06",
    debts: [],
    suggestions,
    installments: 0,
    payoff: null,
    credit: null,
    review: null,
  });
  return Object.fromEntries(
    tree.branches.flatMap((b) => b.items.map((i) => [i.id.split(":")[1], i.figure])),
  );
};

const open = (topic: string, rest: Partial<Open>): Open => ({
  key: `debt:${topic}`,
  topic,
  short: "",
  urgency: "later",
  worthCents: 0,
  worthKind: "saves",
  ...rest,
});

describe("a suggestion's worth on the Loans tree", () => {
  it("has /yr only when its headline says a year", () => {
    const shown = figures([
      open("student_forgiveness", {
        worthCents: 2_771_625,
        worthKind: "earns",
        headline: "Check loan forgiveness (PSLF), get $27,716 back",
      }),
      open("student_autopay", {
        worthCents: 8_500,
        headline: "Turn on autopay, save $85 a year",
      }),
      open("rent_increase", {
        worthCents: 156_000,
        worthKind: "risk",
        headline: "Check your rent, avoid up to $1,560",
      }),
      // Rows scanned before headlines existed stay yearly, as before.
      open("refinance", { worthCents: 67_049, headline: "" }),
    ]);
    expect(shown).toMatchObject({
      student_forgiveness: "$28k",
      student_autopay: "$85/yr",
      rent_increase: "$1.6k",
      refinance: "$670/yr",
    });
  });

  it("is told by a headline on every suggestion the detectors make for the sample people", () => {
    const kinds = new Set<string>();
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      for (const s of runDetectors({ profile: buildProfile(data), data }, DETECTORS)) {
        if (s.worthCents <= 0 || s.worthKind === "risk") continue;
        // An empty headline would fall back to "/yr" whatever the worth.
        expect(s.headline, `${person.id} ${s.topic}`).not.toBe("");
        kinds.add(/\ba year\b/.test(s.headline) ? "yearly" : "once");
      }
    }
    // Both kinds are reached, so the trees draw each.
    expect([...kinds].sort()).toEqual(["once", "yearly"]);
  });
});
