import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/saveonphone", () => ({
  stageSaveOnPhonePlans: vi.fn(async () => ({ added: 3, updated: 1 })),
}));

import { logAudit } from "@/lib/audit";
import { stageSaveOnPhonePlans } from "@/lib/saveonphone";
import { requireAdmin } from "@/lib/session";
import { fetchPhonePlans } from "./actions";

// The admin's "Get phone plans from SaveOnPhone" (src/lib/saveonphone.ts).

describe("fetchPhonePlans on /admin/options", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(stageSaveOnPhonePlans).mockClear();
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("not an admin"));
    await expect(fetchPhonePlans()).rejects.toThrow("not an admin");
    expect(stageSaveOnPhonePlans).not.toHaveBeenCalled();
  });

  it("stages the plans and audits how many", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    await fetchPhonePlans();
    expect(stageSaveOnPhonePlans).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "switch_options_fetched",
      { type: "switch_option", id: "saveonphone" },
      { source: "saveonphone", added: 3, updated: 1 },
    );
  });
});
