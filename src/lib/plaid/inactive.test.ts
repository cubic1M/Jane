import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { inactivityStep } from "./inactive";

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("inactivityStep", () => {
  it("does nothing for people who used the app in the last 53 days", () => {
    expect(inactivityStep({ lastActive: daysAgo(52), warnedAt: null }, NOW)).toBe("none");
  });

  it("warns at 53 quiet days, a week before removal", () => {
    expect(inactivityStep({ lastActive: daysAgo(53), warnedAt: null }, NOW)).toBe("warn");
  });

  it("removes once the warning is a week old and they're 60 days quiet", () => {
    expect(inactivityStep({ lastActive: daysAgo(60), warnedAt: daysAgo(7) }, NOW)).toBe("remove");
    expect(inactivityStep({ lastActive: daysAgo(60), warnedAt: daysAgo(6) }, NOW)).toBe("none");
  });

  it("cancels the warning when the person comes back", () => {
    // Active after the warning: the old warning no longer stands, and they're not quiet.
    expect(inactivityStep({ lastActive: daysAgo(2), warnedAt: daysAgo(5) }, NOW)).toBe("none");
  });
});
