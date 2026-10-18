import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/checklist", () => ({ dismissChecklist: vi.fn() }));

import { revalidatePath } from "next/cache";
import { dismissChecklist } from "@/lib/checklist";
import { hideChecklist } from "./actions";

describe("home actions", () => {
  it("hides the checklist for the signed-in person", async () => {
    await hideChecklist();
    expect(dismissChecklist).toHaveBeenCalledWith("u1");
    expect(revalidatePath).toHaveBeenCalledWith("/home");
  });
});
