import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { CONTROLLER_DETECTORS } from "./controller";

// CodeRabbit sweep 1c, det-01 finding 12: when the five charges shown were all uncategorized, the
// link filtered to "no category", hiding a sixth, categorized catch-all charge that also holds the close.
const detector = CONTROLLER_DETECTORS.find((d) => d.topic === "month_close")!;
const base = inputFor("freelancer");
const account = base.accounts.find((a) => a.type === "depository")!.id;
const big = (i: number) => ({
  id: `u${i}`,
  date: "2026-09-12",
  amountCents: 100_000 + i,
  description: `MYSTERY SHOP ${i}`,
  pfc: null,
  accountId: account,
});
const run = (rows: ReturnType<typeof big>[]) => {
  const data = { ...base, transactions: [...base.transactions, ...rows] };
  return detector.detect({ profile: buildProfile(data), data });
};

describe("the close link's filter", () => {
  it("does not filter to uncategorized charges while a categorized catch-all one still holds the close", () => {
    const s = run([1, 2, 3, 4, 5].map(big));
    expect(s?.action.href).toMatch(/^\/transactions\?from=2026-09-01&to=2026-09-30$/);
  });

  it("filters to uncategorized charges when every charge holding the close is one", () => {
    const data = {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !t.date.startsWith("2026-09") || t.amountCents < 0),
        ...[1, 2].map(big),
      ],
    };
    const s = detector.detect({ profile: buildProfile(data), data });
    expect(s?.action.href).toMatch(/^\/transactions\?category=none&from=2026-09-01/);
  });
});
