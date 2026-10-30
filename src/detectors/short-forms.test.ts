import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { shortFormProblems, runHarness } from "./harness";
import { clip, headlineOf, nice } from "./helpers";
import { cardHeadline, type Suggestion } from "./contract";

// docs/detectors.md, "Short forms": every suggestion has a headline of at most 60 characters
// that starts with a verb and carries the dollars, and one why-you line of at most 120 with
// the person's own number. The long title and why are behind "Why?".

describe("the short forms of a suggestion", () => {
  it("holds for every suggestion the eight sample people get", () => {
    const bad = runHarness().flatMap((r) =>
      r.fired.flatMap((s) =>
        shortFormProblems(s).map(
          (p) => `${r.person.id} ${s.id}: ${p} ("${s.headline}" / "${s.short}")`,
        ),
      ),
    );
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("is checked: a long, verbless or dollarless headline fails", () => {
    const base = {
      worthCents: 21_588,
      headline: "Cancel Hulu, save $216 a year",
      short: "You pay $17.99 a month.",
    } as Suggestion;
    expect(shortFormProblems(base)).toEqual([]);
    expect(shortFormProblems({ ...base, headline: "Hulu, save $216 a year" })).toHaveLength(1);
    expect(shortFormProblems({ ...base, headline: "Cancel Hulu" })).toEqual([
      "headline lacks the dollars ($216)",
    ]);
    expect(
      shortFormProblems({ ...base, headline: `Cancel ${"x".repeat(60)}, save $216` })[0],
    ).toMatch(/over 60/);
    expect(shortFormProblems({ ...base, short: `You pay ${"1".repeat(120)}` })[0]).toMatch(
      /over 120/,
    );
    expect(shortFormProblems({ ...base, short: "You pay a lot." })[0]).toMatch(/own numbers/);
  });

  it("says a card's headline in a glance: /yr, and a risk as what it protects", () => {
    expect(cardHeadline("Cancel Hulu, save $216 a year.")).toBe("Cancel Hulu, save $216/yr");
    expect(cardHeadline("Look at life cover for your family, avoid up to $1,287,200")).toBe(
      "Look at life cover for your family, protect $1,287,200",
    );
  });

  it("builds headlines with the dollars, and cuts long lines at a word", () => {
    expect(headlineOf("Cancel Hulu", 21_588, "saves")).toBe("Cancel Hulu, save $216 a year");
    expect(headlineOf("Move idle cash", 36_000, "earns")).toBe("Move idle cash, earn $360 a year");
    expect(headlineOf("Ask for it back", 4_000, "earns", true)).toBe(
      "Ask for it back, get $40 back",
    );
    expect(headlineOf("Get cover", 1_234_500, "risk")).toBe("Get cover, avoid up to $12,345");
    expect(headlineOf("Check a bill", 0, "saves")).toBe("Check a bill");
    const cut = clip(
      "Netflix, Hulu, Disney Plus, Spotify, Max and Peacock all charge you every single month of the year, adding up to a lot",
      60,
    );
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("nice", () => {
  it("names a payee as a person would say it", () => {
    expect(nice("NETFLIX.COM")).toBe("Netflix");
    // Night QA 10-30: "You pay $1,020.00 a year on Verizon Wireless Des:Paymentrec Id:Xxxxx".
    expect(nice("VERIZON WIRELESS DES:PAYMENTREC ID:XXXXX")).toBe("Verizon Wireless");
  });
});
