import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/credit-report-fixes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-report-fixes")>()),
  sendReportLetter: vi.fn(),
}));

import { CreditFixError, sendReportLetter } from "@/lib/credit-report-fixes";
import { sendLetterAction } from "./actions";

const form = () => {
  const data = new FormData();
  data.set("letterId", "validation:c1");
  return data;
};

describe("send a letter", () => {
  it("sends it for the signed-in person, only on the tap", async () => {
    vi.mocked(sendReportLetter).mockResolvedValueOnce({} as never);
    await expect(sendLetterAction(form())).rejects.toThrow("REDIRECT /loans/report?sent=1");
    expect(sendReportLetter).toHaveBeenCalledWith("u1", "validation:c1");
  });
  it("shows why when it can't", async () => {
    vi.mocked(sendReportLetter).mockRejectedValueOnce(new CreditFixError("Already sent."));
    await expect(sendLetterAction(form())).rejects.toThrow(
      "REDIRECT /loans/report?error=Already+sent.",
    );
  });
});
