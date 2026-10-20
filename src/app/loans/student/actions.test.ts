import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/student-long-game", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/student-long-game")>()),
  saveStudentDates: vi.fn(),
}));

import { StudentDatesError, saveStudentDates } from "@/lib/student-long-game";
import { saveDates } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("save the student loan dates", () => {
  it("saves them for the signed-in person", async () => {
    vi.mocked(saveStudentDates).mockResolvedValueOnce();
    await expect(
      saveDates(
        form({ loanType: "federal", lastCertifiedOn: "2025-12-15", recertifyOn: "2026-11-30" }),
      ),
    ).rejects.toThrow("REDIRECT /loans/student?dates=1#long-game");
    expect(saveStudentDates).toHaveBeenCalledWith("u1", {
      loanType: "federal",
      lastCertifiedOn: "2025-12-15",
      recertifyOn: "2026-11-30",
    });
  });
  it("shows why when it can't", async () => {
    vi.mocked(saveStudentDates).mockRejectedValueOnce(new StudentDatesError("Pick the date."));
    await expect(saveDates(form({}))).rejects.toThrow(
      "REDIRECT /loans/student?error=Pick+the+date.#long-game",
    );
  });
});
