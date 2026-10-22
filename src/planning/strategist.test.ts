import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/detectors/contract";
import { ideaId, vetIdea } from "./strategist";

const s = (topic: string, over: Partial<Suggestion> = {}): Suggestion => ({
  id: `x:${topic}`,
  capability: "x",
  topic: topic as Suggestion["topic"],
  title: topic,
  headline: topic,
  short: topic,
  worthCents: 100_000,
  worthKind: "saves",
  confidence: { percent: 80, reason: `${topic} evidence` },
  urgency: "soon",
  why: "why",
  action: { label: `Do ${topic}`, href: `/${topic}` },
  ...over,
});
const current = new Map(
  [
    s("a"),
    s("b", { confidence: { percent: 62, reason: "b evidence" }, urgency: "now" }),
    s("c", { worthKind: "risk", worthCents: 5_000_000 }),
  ].map((x) => [x.id, x]),
);
const base = { current, allowedCents: [100_000], profile: "standard" as const };

describe("vetting a strategist idea", () => {
  it("builds the idea from its parts: weakest confidence, most urgent, their buttons", () => {
    const out = vetIdea(
      { title: "Do both", body: "These fit together.", based_on: ["x:a", "x:b"] },
      base,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.idea).toMatchObject({
      id: ideaId(["x:a", "x:b"]),
      capability: "strategist",
      topic: "strategist",
      worthCents: 200_000,
      worthKind: "saves",
      urgency: "now",
      confidence: { percent: 62, reason: "the weakest part of this idea: b evidence" },
      action: { label: "Do a", href: "/a" },
      more: [{ label: "Do b", href: "/b" }],
      parts: ["x:a", "x:b"],
    });
    // The id doesn't depend on the order.
    expect(ideaId(["x:b", "x:a"])).toBe(ideaId(["x:a", "x:b"]));
  });

  it("counts a risk avoided only when nothing else is money", () => {
    const risky = vetIdea({ title: "t", body: "b", based_on: ["x:c", "x:a"] }, base);
    expect(risky.ok && risky.idea.worthCents).toBe(100_000);
    const onlyRisk = new Map([
      ["x:c", s("c", { worthKind: "risk" })],
      ["x:d", s("d", { worthKind: "risk" })],
    ]);
    const out = vetIdea(
      { title: "t", body: "b", based_on: ["x:c", "x:d"] },
      { ...base, current: onlyRisk },
    );
    expect(out.ok && out.idea.worthKind).toBe("risk");
  });

  it("refuses what isn't grounded", () => {
    const no = (raw: Parameters<typeof vetIdea>[0], why: RegExp, over = {}) => {
      const out = vetIdea(raw, { ...base, ...over });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(why);
    };
    no({ title: "", body: "b", based_on: ["x:a", "x:b"] }, /title and an explanation/);
    no({ title: "t", body: "b", based_on: ["x:a"] }, /combines 2 to 4/);
    no({ title: "t", body: "b", based_on: ["x:a", "x:a"] }, /combines 2 to 4/);
    no({ title: "t", body: "b", based_on: ["x:a", "x:zzz"] }, /exactly as/);
    no(
      { title: "t", body: "Save $5,000.00 a year.", based_on: ["x:a", "x:b"] },
      /unsupported_dollar_figure/,
    );
    no({ title: "t", body: "A guaranteed win.", based_on: ["x:a", "x:b"] }, /guaranteed_outcome/);
    no({ title: "t".repeat(500), body: "b", based_on: ["x:a", "x:b"] }, /too long/);
  });

  it("allows a figure a tool gave, and a recommendation only in demo advice", () => {
    const text = {
      title: "Use $1,000.00 well",
      body: "I'd put the extra into the car loan.",
      based_on: ["x:a", "x:b"],
    };
    expect(vetIdea(text, base).ok).toBe(true);
    const investing = { ...text, body: "Put some into your stock portfolio and index funds." };
    expect(vetIdea(investing, base).ok).toBe(false);
    expect(vetIdea(investing, { ...base, profile: "demo_advice" }).ok).toBe(true);
  });
});
