import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/investments/profile", () => ({ saveProfileForm: vi.fn() }));

import { saveProfileForm } from "@/lib/investments/profile";
import { ProfileError } from "@/planning/investor-profile";
import { saveProfile } from "./actions";

// Spec step 129: the investor profile form.

const form = () => {
  const data = new FormData();
  data.set("age", "40");
  data.set("horizon", "over_20");
  data.set("dropReaction", "fine");
  data.append("goals", "retirement");
  data.append("goals", "growth");
  return data;
};

describe("saveProfile", () => {
  it("saves every answer for the signed-in person and goes back with a confirmation", async () => {
    await expect(saveProfile(null, form())).rejects.toThrow(
      "REDIRECT /investments/profile?saved=1",
    );
    expect(saveProfileForm).toHaveBeenCalledWith("u1", {
      age: "40",
      horizon: "over_20",
      dropReaction: "fine",
      goals: ["retirement", "growth"],
    });
  });

  it("keeps what they typed on a problem", async () => {
    vi.mocked(saveProfileForm).mockRejectedValueOnce(
      new ProfileError("Enter an age from 18 to 100."),
    );
    expect(await saveProfile(null, form())).toMatchObject({
      message: "Enter an age from 18 to 100.",
      input: { age: "40" },
    });
  });
});
