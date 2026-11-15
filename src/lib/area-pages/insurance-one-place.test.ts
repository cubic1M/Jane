import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debugger 11-15: a demo-bank student's Insurance tree had "Disability cover, $3k/mo short"
// under Your perfect coverage and "Disability cover, Not on file" under Cover that looks
// missing: one gap, said twice in two branches. A cover shown short is shown once, where its
// amount is, and keeps the missing one's urgency.

const need = (kind: string, gapCents: number) => ({
  kind,
  policyId: null,
  gapCents,
  haveCents: 0,
  needCents: gapCents,
  unit: kind === "disability" ? "per_month" : "total",
  summary: "",
  opened: false,
});

const input = (over: Partial<InsuranceTreeInput>): InsuranceTreeInput =>
  ({
    asOf: "2026-11-15",
    needs: [],
    policies: [],
    gaps: [],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household: [],
    risks: [],
    health: null,
    ...over,
  }) as InsuranceTreeInput;

const labels = (tree: ReturnType<typeof insuranceTree>["tree"]) =>
  tree.branches.flatMap((b) => b.items.map((i) => `${b.id}: ${i.label}`));

describe("a cover gap on the insurance tree", () => {
  it("is shown once when its need is short", () => {
    const { tree } = insuranceTree(
      input({
        needs: [need("disability", 300_000)],
        gaps: [{ key: "disability", why: "You get paid. No disability policy is on file." }],
      } as Partial<InsuranceTreeInput>),
    );
    expect(labels(tree).filter((l) => l.endsWith("Disability cover"))).toEqual([
      "needs: Disability cover",
    ]);
  });

  it("keeps an urgent missing cover urgent where it's shown", () => {
    const { tree } = insuranceTree(
      input({
        needs: [need("life", 120_000_000)],
        gaps: [{ key: "life", why: "Two people depend on you. No life policy is on file." }],
      } as Partial<InsuranceTreeInput>),
    );
    const life = tree.branches.flatMap((b) => b.items).filter((i) => i.label === "Life cover");
    expect(life.map((i) => [i.id, i.status])).toEqual([["needs:life", "act"]]);
  });

  it("stays in the missing branch when no need covers it", () => {
    const { tree } = insuranceTree(
      input({
        needs: [need("life", 0)],
        gaps: [{ key: "disability", why: "You get paid. No disability policy is on file." }],
      } as Partial<InsuranceTreeInput>),
    );
    expect(labels(tree)).toContain("missing: Disability cover");
  });
});
