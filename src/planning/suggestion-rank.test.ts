import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { SUGGESTIONS_PER_DAY } from "@/config/suggestions";
import type { Suggestion } from "@/detectors/contract";
import { reportFor } from "@/detectors/harness";
import {
  historyFactor,
  pickForToday,
  rankSuggestions,
  scoreOf,
  workedFactor,
} from "./suggestion-rank";

const make = (over: Partial<Suggestion> & { topic: Suggestion["topic"] }): Suggestion => ({
  id: `x:${over.topic}`,
  capability: "x",
  title: "t",
  worthCents: 100_000,
  worthKind: "saves",
  confidence: { percent: 80, reason: "r" },
  urgency: "soon",
  why: "w $1",
  action: { label: "go", href: "/x" },
  ...over,
});

describe("ranking suggestions", () => {
  it("orders by dollars x confidence x urgency", () => {
    const big = make({ topic: "bank_fees", worthCents: 200_000 });
    const sure = make({
      topic: "card_interest",
      worthCents: 100_000,
      confidence: { percent: 95, reason: "r" },
    });
    const unsure = make({
      topic: "idle_cash",
      worthCents: 100_000,
      confidence: { percent: 50, reason: "r" },
    });
    const urgent = make({ topic: "late_fees", worthCents: 100_000, urgency: "now" });
    const ranked = rankSuggestions([unsure, sure, urgent, big]).map((r) => r.suggestion.topic);
    expect(ranked).toEqual(["bank_fees", "late_fees", "card_interest", "idle_cash"]);
    expect(scoreOf(big)).toBe(Math.round(200_000 * 0.8 * 2));
  });

  it("counts a risk avoided for a fraction of a saving", () => {
    const risk = make({ topic: "life_insurance", worthCents: 1_000_000, worthKind: "risk" });
    const saves = make({ topic: "bank_fees", worthCents: 100_000 });
    expect(scoreOf(risk)).toBeLessThan(
      scoreOf(make({ topic: "bank_fees", worthCents: 1_000_000 })),
    );
    expect(scoreOf(saves)).toBeGreaterThan(0);
  });

  it("lowers what the person said no to and raises what they said yes to (step 207)", () => {
    expect(historyFactor("bank_fees", {})).toBe(1);
    expect(historyFactor("bank_fees", { bank_fees: { yes: 2, no: 0 } })).toBeGreaterThan(1);
    expect(historyFactor("bank_fees", { bank_fees: { yes: 0, no: 2 } })).toBeLessThan(1);
    expect(historyFactor("bank_fees", { bank_fees: { yes: 99, no: 0 } })).toBe(2);
    const a = make({ topic: "bank_fees" });
    const b = make({ topic: "card_interest" });
    const out = rankSuggestions([a, b], { history: { card_interest: { yes: 0, no: 1 } } });
    expect(out[0].suggestion.topic).toBe("bank_fees");
  });

  it("ranks a kind whose actions never showed a saving lower, and one that worked higher", () => {
    expect(workedFactor("bank_fees", [])).toBe(1);
    expect(
      workedFactor("bank_fees", [{ type: "bank_fees", done: 3, worked: 0, notShown: 2 }]),
    ).toBeLessThan(1);
    expect(
      workedFactor("bank_fees", [{ type: "bank_fees", done: 3, worked: 2, notShown: 0 }]),
    ).toBeGreaterThan(1);
    expect(
      workedFactor("bank_fees", [{ type: "bank_fees", done: 1, worked: 0, notShown: 1 }]),
    ).toBe(1);
    expect(
      workedFactor("estimated_taxes", [{ type: "bank_fees", done: 9, worked: 0, notShown: 9 }]),
    ).toBe(1);
  });

  it("never shows what is blocked, and picks the top few for the day", () => {
    const list = ["bank_fees", "card_interest", "idle_cash", "late_fees", "subscriptions"].map(
      (topic) =>
        make({ topic: topic as Suggestion["topic"], worthCents: 1000 * (topic.length + 1) }),
    );
    const ranked = rankSuggestions(list, { blocked: new Set(["x:card_interest"]) });
    expect(ranked.some((r) => r.suggestion.topic === "card_interest")).toBe(false);
    expect(pickForToday(ranked)).toHaveLength(SUGGESTIONS_PER_DAY);
    expect(rankSuggestions(list)).toEqual(rankSuggestions([...list].reverse()));
  });

  // Spec step 255: each of the eight people gets their top suggestions from their written list.
  it.each(PEOPLE)("$id's day: the top suggestions come from their written list", (person) => {
    const report = reportFor(person);
    const top = pickForToday(rankSuggestions(report.fired));
    expect(top.length).toBeGreaterThan(0);
    for (const t of top) {
      expect(person.mustNot, `${person.id} was told ${t.suggestion.topic}`).not.toContain(
        t.suggestion.topic,
      );
    }
    // At least their very first suggestion is on the list, and most of the day's are.
    expect(person.should).toContain(top[0].suggestion.topic);
    const onList = top.filter((t) => person.should.includes(t.suggestion.topic)).length;
    expect(onList, top.map((t) => t.suggestion.topic).join(",")).toBeGreaterThanOrEqual(
      Math.min(2, top.length),
    );
  });
});
