import { describe, expect, it } from "vitest";
import { DEADLINE_KIND_LABELS } from "@/insights/deadlines";
import {
  DEADLINE_EVIDENCE,
  EVIDENCE_CONFIDENCE_CAP,
  deadlineSays,
  type EvidenceKind,
} from "./evidence";

// Honest labels (card-chat mismatch): every kind of deadline says what it needs to be said as a
// fact, and a weak claim is a question or nothing, never a statement. The founder's /deadlines
// had a movie ticket as "Price goes up · ... renews".
describe("what each deadline needs to be said", () => {
  const kinds = Object.keys(DEADLINE_KIND_LABELS);

  it("has a rule for every kind of deadline", () => {
    expect(kinds.filter((k) => !(k in DEADLINE_EVIDENCE))).toEqual([]);
  });

  it.each(kinds)("%s: a category alone, or nothing at all, is never a statement", (kind) => {
    expect(deadlineSays(kind, { kind: "category_only" })).not.toBe("statement");
    expect(deadlineSays(kind, undefined)).toBe("nothing");
  });

  it("says renews only from a seen cycle or a charge naming the plan", () => {
    expect(deadlineSays("renewal", { kind: "pattern", times: 3 })).toBe("statement");
    expect(deadlineSays("renewal", { kind: "pattern", times: 1 })).toBe("question");
    expect(deadlineSays("renewal", { kind: "word" })).toBe("statement");
    expect(deadlineSays("renewal", { kind: "category_only" })).toBe("question");
  });

  it("says a price goes up only from a seen rise or an intro price's flat run", () => {
    expect(deadlineSays("price_rise", { kind: "seen_rise" })).toBe("statement");
    expect(deadlineSays("price_rise", { kind: "pattern", times: 6 })).toBe("statement");
    expect(deadlineSays("price_rise", { kind: "word" })).toBe("nothing");
    expect(deadlineSays("price_rise", { kind: "category_only" })).toBe("nothing");
  });

  it("is never surer than its evidence: a category alone stays under half", () => {
    const caps = EVIDENCE_CONFIDENCE_CAP as Record<EvidenceKind, number>;
    expect(caps.category_only).toBeLessThan(50);
    for (const k of Object.keys(caps) as EvidenceKind[]) expect(caps[k]).toBeLessThanOrEqual(100);
  });
});
