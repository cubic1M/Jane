import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/jane-agent/attention-load", () => {
  class AttentionError extends Error {}
  return {
    AttentionError,
    resumeKind: vi.fn(async (_user: string, source: string) => {
      if (source === "heads_ups") throw new AttentionError("never stopped");
      return "budget check-ins";
    }),
  };
});

import { revalidatePath } from "next/cache";
import { resumeKind } from "@/lib/jane-agent/attention-load";
import { bringBack } from "./attention-actions";

// Spec step 147: "Bring them back" in Settings, for the signed-in person only.
describe("bringBack", () => {
  const form = (source: string) => {
    const data = new FormData();
    data.set("source", source);
    return data;
  };

  it("brings a stopped kind back for the signed-in person and refreshes Settings", async () => {
    await bringBack(form("budgets"));
    expect(resumeKind).toHaveBeenCalledWith("u1", "budgets");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("ignores a kind that was never stopped", async () => {
    await expect(bringBack(form("heads_ups"))).resolves.toBeUndefined();
  });
});
