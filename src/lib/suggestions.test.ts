import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { LOOK_VERBS, isHiddenPage, promisesHiddenPage } from "@/config/hidden-pages";
import { PEOPLE } from "@/config/people";
import { runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { forTheBeta, stillChosen } from "./suggestions";

describe("stillChosen", () => {
  it("drops a same-day pick that no longer fires, and keeps the rest and ideas", () => {
    const chosen = [
      { key: "insurance:auto_insurance" },
      { key: "money:emergency_fund" },
      { key: "strategist:idea-1" },
    ];
    // A second upload showed the car insurance payments: that suggestion stopped firing.
    expect(stillChosen(chosen, new Set(["money:emergency_fund"]))).toEqual({
      keep: [{ key: "money:emergency_fund" }, { key: "strategist:idea-1" }],
      outdated: [{ key: "insurance:auto_insurance" }],
    });
  });

  it("keeps everything that still fires", () => {
    const chosen = [{ key: "a:b" }];
    expect(stillChosen(chosen, new Set(["a:b"]))).toEqual({ keep: chosen, outdated: [] });
  });
});

// Founder, 2026-10-30: no suggestion whose button promises a task on a page the beta hides.
describe("forTheBeta", () => {
  const fired = PEOPLE.map((p) => {
    const input = inputFor(p.id);
    return { person: p.id, all: runDetectors({ profile: buildProfile(input), data: input }) };
  });

  it("shows none of the sample people a task on a hidden page, and keeps the rest", () => {
    let dropped = 0;
    for (const { person, all } of fired) {
      const shown = forTheBeta(all);
      for (const s of shown) {
        expect(promisesHiddenPage(s.action), `${person}: ${s.action.label}`).toBe(false);
        for (const m of s.more ?? [])
          expect(promisesHiddenPage(m), `${person}: ${m.label}`).toBe(false);
      }
      const left = all.filter((s) => !shown.includes(s));
      for (const s of left) {
        expect([s.action, ...(s.more ?? [])].some(promisesHiddenPage)).toBe(true);
      }
      dropped += left.length;
    }
    // The sample people do fire some (the check has something to catch).
    expect(dropped).toBeGreaterThan(0);
  });

  it("keeps a look (See …, Check …) that lands on the area page", () => {
    const see = fired.flatMap((f) => forTheBeta(f.all)).filter((s) => isHiddenPage(s.action.href));
    for (const s of see) expect(LOOK_VERBS).toContain(s.action.label.split(" ")[0]);
    // The demo bank's 401(k) match card among them.
    expect(see.map((s) => s.action.label)).toContain("Check your match");
  });

  it("drops one whose extra button promises a task on a hidden page", () => {
    const keep = { action: { label: "Refinance", href: "/loans/refinance" } };
    const extra = {
      action: { label: "Refinance", href: "/loans/refinance" },
      more: [{ label: "Plan a tight month", href: "/loans/tight" }],
    };
    expect(forTheBeta([keep, extra])).toEqual([keep]);
  });
});
