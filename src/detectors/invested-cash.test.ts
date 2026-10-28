import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

const invested = (id: string) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "invested_cash",
  );
};

describe("cash waiting inside investment accounts", () => {
  it("reaches the people who have it and leaves a watch, never the ones on a must-not list", () => {
    for (const p of PEOPLE) {
      const s = invested(p.id);
      if ((p.mustNot as readonly string[]).includes("invested_cash"))
        expect(s, p.id).toBeUndefined();
      if ((p.should as readonly string[]).includes("invested_cash")) {
        expect(s, p.id).toBeDefined();
        expect(s!.watch).toMatchObject({ kind: "cash_invested" });
        expect(s!.worthKind).toBe("earns");
        expect(s!.why).toMatch(/inside your investment accounts/);
      }
    }
  });
  it("counts what is above the cushion for trades, not all of it", () => {
    const s = invested("equity")!;
    const w = s.watch as { beforeCents: number; excessCents: number };
    expect(w.excessCents).toBe(w.beforeCents - 100_000);
  });
});
