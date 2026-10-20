import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/home-equity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-equity")>()),
  saveHomeFacts: vi.fn(),
  markHomeRequestSent: vi.fn(),
}));

import { HomeEquityError, markHomeRequestSent, saveHomeFacts } from "@/lib/home-equity";
import { requestSentAction, saveFactsAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("a home loan's facts", () => {
  it("are saved for the signed-in person, blank meaning not given", async () => {
    vi.mocked(saveHomeFacts).mockResolvedValueOnce();
    await expect(
      saveFactsAction(form({ originalValue: "$500,000", yearlyTax: "4000", yearlyInsurance: "" })),
    ).rejects.toThrow("REDIRECT /loans/equity?saved=1");
    expect(saveHomeFacts).toHaveBeenCalledWith("u1", {
      originalValueCents: 50_000_000,
      yearlyTaxCents: 400_000,
      yearlyInsuranceCents: null,
    });
  });
  it("show why when an amount isn't one", async () => {
    await expect(saveFactsAction(form({ originalValue: "lots" }))).rejects.toThrow(
      "REDIRECT /loans/equity?error=The+home%27s+original+value+should+be+a+dollar+amount.",
    );
    vi.mocked(saveHomeFacts).mockRejectedValueOnce(new HomeEquityError("Too much."));
    await expect(saveFactsAction(form({ yearlyTax: "5" }))).rejects.toThrow(
      "REDIRECT /loans/equity?error=Too+much.",
    );
  });
});

describe("a drafted request", () => {
  it("is recorded as sent only for PMI or escrow", async () => {
    vi.mocked(markHomeRequestSent).mockResolvedValueOnce();
    await expect(requestSentAction(form({ which: "pmi" }))).rejects.toThrow(
      "REDIRECT /loans/equity?sent=1",
    );
    expect(markHomeRequestSent).toHaveBeenCalledWith("u1", "pmi");
    await expect(requestSentAction(form({ which: "other" }))).rejects.toThrow(
      "REDIRECT /loans/equity",
    );
    expect(markHomeRequestSent).toHaveBeenCalledTimes(1);
  });
});
