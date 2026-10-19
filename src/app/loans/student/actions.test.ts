import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/student-loans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/student-loans")>()),
  saveStudentProfile: vi.fn(),
  markStudentStep: vi.fn(),
}));

import { StudentProfileError, markStudentStep, saveStudentProfile } from "@/lib/student-loans";
import { saveProfile, stepDone } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("the student loan page", () => {
  it("saves what the plans are compared with, for the signed-in person", async () => {
    await expect(
      saveProfile(
        form({
          agi: "52000",
          familySize: "2",
          dependants: "1",
          borrower: "new",
          publicService: "on",
          countedBefore: "30",
        }),
      ),
    ).rejects.toThrow("REDIRECT /loans/student?saved=1");
    expect(saveStudentProfile).toHaveBeenCalledWith("u1", {
      agi: "52000",
      familySize: "2",
      dependants: "1",
      borrower: "new",
      publicService: true,
      countedBefore: "30",
    });
  });

  it("shows a problem", async () => {
    vi.mocked(saveStudentProfile).mockRejectedValueOnce(new StudentProfileError("Enter it."));
    await expect(saveProfile(form({}))).rejects.toThrow(
      "REDIRECT /loans/student?error=Enter+it.#about-you",
    );
  });

  it("marks a step done", async () => {
    await expect(stepDone()).rejects.toThrow("REDIRECT /loans/student#steps");
    expect(markStudentStep).toHaveBeenCalledWith("u1");
  });
});
