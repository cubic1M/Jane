import { expect, it, vi } from "vitest";
import baseline from "./detector-sweep-baseline.json";
import { runSweep } from "./detector-sweep";

vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(), getCurrentUser: vi.fn() }));

// What fires on uploaded statements today must keep firing (docs/detector-sweep.md). A detector
// that starts firing is welcome: add it to the baseline with its pull request.
it("no detector that fires on uploaded statements goes quiet, and none throws", async () => {
  const { rows } = await runSweep();
  const fires = new Set(rows.filter((r) => r.people > 0).map((r) => r.id));
  expect(baseline.filter((id) => !fires.has(id))).toEqual([]);
  expect(rows.filter((r) => r.threw > 0).map((r) => r.id)).toEqual([]);
});

it("never runs an advice topic: those stay blocked on real accounts", async () => {
  const { rows, adviceBlocked } = await runSweep(["tuning"]);
  const ran = new Set(rows.map((r) => r.id));
  expect(adviceBlocked.length).toBeGreaterThan(0);
  for (const id of adviceBlocked) expect(ran.has(id), id).toBe(false);
});
