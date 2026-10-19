import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/jane-agent/preferences", () => ({ deletePreference: vi.fn(async () => true) }));

import { revalidatePath } from "next/cache";
import { deletePreference } from "@/lib/jane-agent/preferences";
import { forgetPreference } from "./memory-actions";

// Spec step 91: "Forget" in Settings deletes one thing Jane remembers, for the signed-in
// person only.
describe("forgetPreference", () => {
  it("deletes it for the signed-in person and refreshes Settings", async () => {
    const form = new FormData();
    form.set("preferenceId", "p1");
    await forgetPreference(form);
    expect(deletePreference).toHaveBeenCalledWith("u1", "p1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
