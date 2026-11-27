import { describe, expect, it, vi } from "vitest";

// With the what-if page shown, its link carries the months the reply ran for. (With it hidden the
// reply draws no link: replies-sweep-2.test.ts.)
vi.mock("@/config/hidden-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/hidden-pages")>()),
  isHiddenPage: () => false,
}));

import { whatIfReply } from "./replies-whatif";
import { shownLink } from "./types";
import type { ScenarioRun } from "@/planning/what-if";

describe("the what-if details link", () => {
  it("carries the months the reply ran for when the page is shown", () => {
    const run = {
      scenario: "job_loss",
      label: "Losing your job",
      params: { months: 6, extraMonthlyCents: 0 },
      before: { lowestCents: 100_000 },
      sectors: {
        forecast: "Cash dips.",
        debt: "",
        taxes: "",
        investing: "",
        goals: [],
        insurance: [],
      },
      plan: [],
    } as unknown as ScenarioRun;
    const links = whatIfReply(run).actions.map((a) => ("href" in a ? a.href : ""));
    expect(links).toContain("/what-if?s=job_loss&m=6");
    expect(shownLink("See it", "/what-if")).toHaveLength(1);
  });
});
