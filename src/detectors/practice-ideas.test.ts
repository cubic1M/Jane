import { PEOPLE } from "@/config/people";
import { describe, expect, it } from "vitest";
import {
  parsePracticeIdeaId,
  PRACTICE_RANK_FLOOR_CENTS,
  PRACTICE_SETTINGS_HREF,
  PRACTICE_TOPIC,
} from "@/config/practice-suggestions";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { buildProfile, type PracticeIdea } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { rankSuggestions } from "@/planning/suggestion-rank";
import { shortFormProblems } from "./harness";
import { runDetectors } from "./index";
import { PRACTICE_IDEA_DETECTORS } from "./practice-ideas";

// The practice portfolio's ideas as suggestions (Phase AW): one detector per kind, fed by the
// ideas the scan kept; each idea is its own suggestion with its kind's topic; the button acts
// in practice or opens the settings; every topic is demo advice only.

const idea = (over: Partial<PracticeIdea> = {}): PracticeIdea => ({
  key: "cash_drag:2026-10:w2",
  kind: "cash_drag",
  scannedAt: "2026-10-08T21:30:00.000Z",
  label: "Put idle cash to work",
  headline: "Invest idle practice cash, about $20 a year more",
  short: "$500.00 has waited 37 days above your buffer, earning nothing.",
  worthCents: 2_000,
  worthKind: "earns",
  figures: [{ label: "Cash waiting", value: "$500.00" }],
  caps: ["At most 20% of the portfolio", "At most 2 a month"],
  confidence: { percent: 80, reason: "The cash has sat for days" },
  trades: 3,
  ...over,
});

function run(ideas: PracticeIdea[]) {
  const data = inputFor("renter");
  const withIdeas = {
    ...data,
    extras: { householdMembers: 1, ...data.extras, practiceIdeas: ideas },
  };
  return runDetectors(
    { profile: buildProfile(withIdeas), data: withIdeas },
    PRACTICE_IDEA_DETECTORS,
  );
}

describe("practice ideas as suggestions", () => {
  it("brings a waiting idea as its own suggestion, under its kind's topic", () => {
    const [s] = run([idea()]);
    expect(s.topic).toBe("practice_cash_drag");
    expect(parsePracticeIdeaId(s.id)).toEqual({
      topic: "practice_cash_drag",
      opportunityKey: "cash_drag:2026-10:w2",
    });
    expect(shortFormProblems(s)).toEqual([]);
    expect(s.confidence).toEqual({ percent: 80, reason: "The cash has sat for days" });
    // Why? has the rule, the numbers and the caps.
    expect(s.why).toMatch(/The rule: put idle cash to work\./);
    expect(s.why).toMatch(/The numbers: Cash waiting \$500\.00\./);
    expect(s.why).toMatch(/The caps: At most 20% of the portfolio; At most 2 a month\./);
    expect(s.why).toMatch(/nothing real is bought or sold/);
  });

  it("acts in practice when the idea has trades, and otherwise opens the settings", () => {
    const [trade] = run([idea()]);
    expect(trade.action.label).toBe("Do it in practice");
    const [safety] = run([
      idea({
        key: "max_drop_near:2026-10",
        kind: "max_drop_near",
        headline: "Step down a level: down $1,200, near your limit",
        worthCents: 120_000,
        worthKind: "risk",
        trades: 0,
      }),
    ]);
    expect(safety.action.href).toBe(PRACTICE_SETTINGS_HREF);
    expect(safety.urgency).toBe("now");
  });

  it("brings only the newest idea of each kind, and nothing without ideas", () => {
    const older = idea({ key: "cash_drag:2026-10:w1", scannedAt: "2026-10-01T21:30:00.000Z" });
    const out = run([idea(), older]);
    expect(out.map((s) => s.id)).toEqual(["investing:practice_cash_drag:cash_drag:2026-10:w2"]);
    expect(run([])).toEqual([]);
  });

  it("ranks sample money at least at its kind's floor, safety kinds highest", () => {
    const [s] = run([idea({ worthCents: 10 })]);
    expect(s.rankCents).toBe(PRACTICE_RANK_FLOOR_CENTS.cash_drag);
    const floors = PRACTICE_RANK_FLOOR_CENTS;
    for (const k of ["drift_warning", "glide_path", "risk_mismatch", "max_drop_near"] as const) {
      expect(floors[k]).toBeGreaterThanOrEqual(Math.max(floors.cash_drag, floors.dip_buy));
    }
    expect(rankSuggestions([s])[0].score).toBeGreaterThan(0);
  });

  it("is demo advice only: every practice topic is an advice topic", () => {
    for (const topic of Object.values(PRACTICE_TOPIC)) {
      expect(ADVICE_TOPICS as readonly string[]).toContain(topic);
    }
  });

  it("reaches a sample person with every kind, from their auto-started practice portfolio", () => {
    const reached = new Set<string>();
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const fired = runDetectors({ profile: buildProfile(data), data }, PRACTICE_IDEA_DETECTORS);
      for (const s of fired) {
        reached.add(s.topic);
        // Each is on that person's written list (src/config/people.ts).
        expect(p.should as readonly string[], `${p.id} ${s.topic}`).toContain(s.topic);
        expect(s.confidence.percent).toBeGreaterThan(0);
      }
    }
    expect([...reached].sort()).toEqual(Object.values(PRACTICE_TOPIC).sort());
  });
});
