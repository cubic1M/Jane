import { notFound } from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/invariants/accuracy", async (original) => ({
  ...(await original<typeof import("@/lib/invariants/accuracy")>()),
  latestAccuracy: vi.fn(),
}));

import { ACCURACY_CHECKS, latestAccuracy } from "@/lib/invariants/accuracy";
import { requireAdmin } from "@/lib/session";
import AccuracyPage from "./page";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const admin = { id: "adm", role: "admin", email: "f@jane.test" } as never;

describe("/admin/accuracy", () => {
  it("is a 404 for anyone but the team, before anything is read", async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async () => notFound());
    await expect(AccuracyPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(latestAccuracy).not.toHaveBeenCalled();
  });

  it("shows each check's counts from the last run, failures marked", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(admin);
    vi.mocked(latestAccuracy).mockResolvedValueOnce({
      at: new Date("2026-11-12T12:01:00Z"),
      summary: {
        people: 12,
        checked: 11,
        notChecked: 0,
        errored: 1,
        checks: ACCURACY_CHECKS.map((c) => ({
          name: c.name,
          passed: 10,
          failed: c.name === "no_stale_pending" ? 2 : 0,
          notApplicable: 1,
        })),
        failing: ["no_stale_pending"],
      },
    });
    const page = text(renderToStaticMarkup(await AccuracyPage()));
    expect(page).toContain("11 of 12 real people checked, 1 threw · run at 2026-11-12 12:01 UTC");
    for (const c of ACCURACY_CHECKS) expect(page).toContain(c.name);
    expect(page).toContain("no_stale_pending [FAIL] 10 passed · 2 failed · 1 not applicable");
    expect(page).toContain("no_future_transactions 10 passed · 0 failed · 1 not applicable");
  });

  it("says so before the first run", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(admin);
    vi.mocked(latestAccuracy).mockResolvedValueOnce(null);
    expect(text(renderToStaticMarkup(await AccuracyPage()))).toContain(
      "The daily accuracy checks haven't run yet.",
    );
  });
});
