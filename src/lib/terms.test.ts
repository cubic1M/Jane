import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { TERMS_VERSION } from "@/config/legal";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { acceptTerms } from "./terms";

describe("acceptTerms", () => {
  it("stores the current version with the time, and audit-logs it", async () => {
    const update = vi.fn();
    const now = new Date("2026-10-19T12:00:00Z");

    await acceptTerms("u1", {
      client: { user: { update } } as unknown as PrismaClient,
      now,
      via: "signup",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now },
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "u1" },
      "terms_accepted",
      { type: "user", id: "u1" },
      { version: TERMS_VERSION, via: "signup" },
    );
  });
});
