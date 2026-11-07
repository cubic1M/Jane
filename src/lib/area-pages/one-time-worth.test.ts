import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { DETECTORS, runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { loansTree } from "./loans";
import { worthFigure } from "./tree";

// Debugger 11-06: on a real account's Loans tree, PSLF forgiveness (about $27,716 left after 120
// payments, said once in its headline: "get $27,716 back") was drawn as "$28k/yr". A worth that
// comes once is a bare figure on every tree; one that comes every year has "/yr".

describe("a suggestion's worth on the trees", () => {
  it("has /yr only when its headline says a year", () => {
    const forgiveness = {
      worthCents: 2_771_625,
      worthKind: "earns",
      headline: "Check loan forgiveness (PSLF), get $27,716 back",
    };
    expect(worthFigure(forgiveness)).toBe("$28k");
    expect(
      worthFigure({
        worthCents: 67_049,
        worthKind: "saves",
        headline: "Cut card interest, save $670 a year",
      }),
    ).toBe("$670/yr");
    expect(
      worthFigure({
        worthCents: 156_000,
        worthKind: "risk",
        headline: "Check your rent, avoid up to $1,560",
      }),
    ).toBe("$1.6k");
    // Rows scanned before headlines existed stay yearly, as before.
    expect(worthFigure({ worthCents: 67_049, worthKind: "saves", headline: "" })).toBe("$670/yr");
    expect(worthFigure({ worthCents: 0, worthKind: "saves", headline: "" })).toBeUndefined();

    const { tree } = loansTree({
      asOf: "2026-11-06",
      debts: [],
      suggestions: [
        {
          key: "debt:student_forgiveness",
          topic: "student_forgiveness",
          short: "You work for Springfield Sch Dist and owe $40,500.00 on student loans.",
          urgency: "later",
          ...forgiveness,
        },
      ],
      installments: 0,
      payoff: null,
      credit: null,
      review: null,
    });
    const cheaper = tree.branches.find((b) => b.id === "cheaper")!;
    expect(cheaper.items[0]).toMatchObject({ label: "Student loan forgiveness", figure: "$28k" });
  });

  it("is told by a headline on every suggestion the detectors make for the sample people", () => {
    const kinds = new Set<string>();
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      for (const s of runDetectors({ profile: buildProfile(data), data }, DETECTORS)) {
        if (s.worthCents <= 0 || s.worthKind === "risk") continue;
        // An empty headline would fall back to "/yr" whatever the worth.
        expect(s.headline, `${person.id} ${s.topic}`).not.toBe("");
        kinds.add(worthFigure(s)!.endsWith("/yr") ? "yearly" : "once");
      }
    }
    // Both kinds are reached, so the trees draw each.
    expect([...kinds].sort()).toEqual(["once", "yearly"]);
  });
});
