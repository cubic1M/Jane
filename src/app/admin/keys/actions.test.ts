import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/key-rotation", () => ({ rotateKeys: vi.fn() }));

import { rotateKeys } from "@/lib/key-rotation";
import { requireAdmin } from "@/lib/session";
import { rotateNow } from "./actions";

describe("rotateNow", () => {
  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("notFound"));
    await expect(rotateNow()).rejects.toThrow("notFound");
    expect(rotateKeys).not.toHaveBeenCalled();
  });

  it("runs one time-boxed rotation as the admin and shows the counts", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin_1", role: "admin" } as never);
    vi.mocked(rotateKeys).mockResolvedValueOnce({
      target: "k2",
      rotated: 7,
      failed: 1,
      done: false,
    });
    const started = Date.now();
    await expect(rotateNow()).rejects.toThrow("redirect:/admin/keys?rotated=7&failed=1&done=0");
    const [actor, options] = vi.mocked(rotateKeys).mock.calls[0];
    expect(actor).toEqual({ type: "admin", id: "admin_1" });
    expect(options?.deadline).toBeGreaterThanOrEqual(started + 20_000);
  });

  it("shows a plain error, never the reason, when the current key isn't usable", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin_1", role: "admin" } as never);
    vi.mocked(rotateKeys).mockRejectedValueOnce(new Error('TOKEN_ENCRYPTION_KEY_CURRENT is "k2"'));
    await expect(rotateNow()).rejects.toThrow("redirect:/admin/keys?error=1");
  });
});
