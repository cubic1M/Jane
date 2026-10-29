import { notFound } from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/founder-numbers", () => ({ loadFounderNumbers: vi.fn() }));

import type { FounderNumbers, Snapshot } from "@/lib/founder-numbers";
import { loadFounderNumbers } from "@/lib/founder-numbers";
import { requireAdmin } from "@/lib/session";
import { change, formatDuration, LINES } from "./lines";
import FounderNumbersPage from "./page";

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  signedUp: 14,
  added: 12,
  withFinding: 10,
  foundMedianCents: 38000,
  foundMeanCents: 41000,
  fixesDone: 6,
  verified: { people: 2, cents: 12000 },
  weeklyActive: 9,
  medianMsToFirstFinding: 4 * 60_000,
  ...over,
});

const numbers: FounderNumbers = {
  asOf: new Date("2026-10-28T18:00:00Z"),
  now: snap(),
  trend: [snap({ signedUp: 10, fixesDone: 2 }), ...Array.from({ length: 6 }, () => snap()), snap()],
  excluded: { trial: 31, team: 2, demoOnly: 5 },
  copyLine: "14 beta users · $380/yr found per person · 6 fixes made",
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");

describe("/admin/numbers", () => {
  it("is a 404 for anyone but a signed-in founder, before any numbers are read", async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async () => notFound());
    await expect(FounderNumbersPage()).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(loadFounderNumbers).not.toHaveBeenCalled();
  });

  it("shows the copy-ready line, every number with its week's change, and what was left out", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      id: "adm",
      role: "admin",
      email: "f@jane.test",
    } as never);
    vi.mocked(loadFounderNumbers).mockResolvedValueOnce(numbers);
    const html = renderToStaticMarkup(await FounderNumbersPage());
    const page = text(html);
    expect(html).toContain("data-copy-line");
    expect(page).toContain("14 beta users · $380/yr found per person · 6 fixes made");
    for (const line of LINES) expect(page).toContain(line.name);
    expect(page).toMatch(/Signed up 14 10 \+4/);
    expect(page).toMatch(/Fixes marked done 6 2 \+4/);
    expect(page).toMatch(/Weekly active people 9 9 no change/);
    expect(page).toMatch(/Sign-up to first finding \(median\) 4 min/);
    expect(page).toContain(
      "31 trial people (sample data), 2 team and founder accounts, 5 demo-bank-only accounts.",
    );
    // No loading state: the numbers are in the first response.
    expect(html).not.toMatch(/loading/i);
  });
});

describe("the rows", () => {
  it("say a duration in minutes, hours or days", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration(3 * 3.6e6)).toBe("3 hours");
    expect(formatDuration(3.6e6)).toBe("1 hour");
    expect(formatDuration(3 * 86_400_000)).toBe("3 days");
  });

  it("show a change with its sign, in the row's own unit", () => {
    const found = LINES.find((l) => l.name.startsWith("Found per person per year (median)"))!;
    expect(change(found, 30000, 38000)).toBe("+$80");
    expect(change(found, 38000, 30000)).toBe("−$80");
    expect(change(found, null, 38000)).toBe("–");
    expect(change(found, 100, 100)).toBe("no change");
  });
});
