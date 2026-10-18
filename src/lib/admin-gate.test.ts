import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import type { PrismaClient } from "@/generated/prisma/client";
import { isAdminSession } from "./admin-gate";

const NOW = new Date("2026-10-18T12:00:00Z");
const clientWith = (session: unknown) =>
  ({ session: { findUnique: vi.fn().mockResolvedValue(session) } }) as unknown as PrismaClient;

describe("isAdminSession", () => {
  it("is true only for a live admin session", async () => {
    const live = { expires: new Date("2026-10-19T00:00:00Z") };
    expect(
      await isAdminSession("t", {
        client: clientWith({ ...live, user: { role: "admin" } }),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      await isAdminSession("t", {
        client: clientWith({ ...live, user: { role: "user" } }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      await isAdminSession("t", {
        client: clientWith({ expires: new Date("2026-10-17T00:00:00Z"), user: { role: "admin" } }),
        now: NOW,
      }),
    ).toBe(false);
    expect(await isAdminSession("t", { client: clientWith(null), now: NOW })).toBe(false);
    expect(await isAdminSession(undefined, { client: clientWith(null), now: NOW })).toBe(false);
  });
});
