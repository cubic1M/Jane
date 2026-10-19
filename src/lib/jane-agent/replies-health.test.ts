import { describe, expect, it } from "vitest";
import { HEALTH_NEVER_SAY } from "@/config/health-score";
import type { HealthView } from "@/lib/health-score";
import { healthChange, healthScore, type HealthInput } from "@/planning/health-score";
import { healthNote, healthReply } from "./replies-health";
import type { Snapshot } from "./snapshot";
import { healthSource } from "./sources/health";

// Spec step 146: the money health score in the chat, said kindly, the first time and then
// once a month when it moved enough to matter.

const NOW = new Date("2026-10-19T13:00:00Z");
const input: HealthInput = {
  cashCents: 600_000,
  monthlySpendingCents: 400_000,
  monthlyIncomeCents: 480_000,
  slips: 0,
  cardBalanceCents: null,
  goals: { onTrack: 1, total: 1 },
};

function view(over: Partial<HealthInput> = {}, last?: Partial<HealthInput>): HealthView {
  const score = healthScore({ ...input, ...over })!;
  const before = last ? healthScore({ ...input, ...last })! : null;
  return {
    ...score,
    month: "2026-10",
    before: before && { month: "2026-09", score: before.score, band: before.band },
    change: before && healthChange(score, before),
  };
}

const snapshot = (health: HealthView | null) =>
  ({ asOf: "2026-10-19", health }) as unknown as Snapshot;
const gathered = (health: HealthView | null) =>
  healthSource.gather(snapshot(health), {
    now: NOW,
    local: { date: "2026-10-19", hour: 9 },
    trigger: "open",
  } as never);

describe("healthReply", () => {
  it("gives the score, each part and the step with most room", () => {
    const reply = healthReply(view());
    expect(reply.body).toMatch(
      /^Your money health score is \d+ out of 100 \((?:Strong|Steady|Building)\)\. /,
    );
    expect(reply.body).toContain(
      "Cash cushion: 13 of 25. Your cash would cover about 1.5 months of spending.",
    );
    expect(reply.body).toContain("To raise it: Building toward 3 months raises this");
    expect(reply.body).toContain("Not counted yet: card balances.");
    expect(reply.actions).toEqual([expect.objectContaining({ id: "open", href: "/jane#health" })]);
    expect(reply.body).not.toMatch(HEALTH_NEVER_SAY);
  });

  it("says how it moved since last month and why", () => {
    expect(healthReply(view({}, { cashCents: 100_000 })).body).toMatch(
      /That's up \d+ since September, mostly from cash cushion\./,
    );
    expect(healthNote(view({ cashCents: 100_000 }, {})).body).toMatch(
      /That's \d+ lower since September, mostly from cash cushion\./,
    );
  });

  it("asks for accounts when there's nothing to score", () => {
    expect(healthReply(null).body).toMatch(/^Once your accounts are linked/);
  });
});

describe("healthSource", () => {
  it("says it the first time", () => {
    const [said] = gathered(view());
    expect(said).toMatchObject({ kind: "heads_up", dedupeKey: "first" });
    expect(said.body).toMatch(/The most room is in cash cushion: /);
  });

  it("then once a month, only when it moved enough to matter", () => {
    expect(gathered(view({}, { slips: 0, cashCents: 590_000 }))).toEqual([]);
    expect(gathered(view({}, { cashCents: 100_000 }))).toEqual([
      expect.objectContaining({ dedupeKey: "2026-10" }),
    ]);
    expect(gathered(null)).toEqual([]);
  });
});
