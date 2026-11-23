import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/connectors/stuck", () => ({ markStuck: vi.fn(async () => true) }));

import { markStuck } from "@/lib/connectors/stuck";
import { requireAdmin } from "@/lib/session";
import { markStuckAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("marking a stuck connector action", () => {
  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("notFound"));
    await expect(markStuckAction(form({ actionId: "a1", outcome: "failed" }))).rejects.toThrow(
      "notFound",
    );
    expect(markStuck).not.toHaveBeenCalled();
  });

  it("marks done or failed, and nothing else", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    await markStuckAction(form({ actionId: "a1", outcome: "succeeded" }));
    expect(markStuck).toHaveBeenCalledWith("a1", "succeeded", "admin_1");
    vi.mocked(markStuck).mockClear();
    await markStuckAction(form({ actionId: "a1", outcome: "reversed" }));
    await markStuckAction(form({ actionId: "a1; drop", outcome: "failed" }));
    expect(markStuck).not.toHaveBeenCalled();
  });
});
