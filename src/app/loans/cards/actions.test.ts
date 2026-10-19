import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/credit-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-cards")>()),
  applyForCard: vi.fn(),
}));

import { CreditCardError, applyForCard } from "@/lib/credit-cards";
import { applyCardAction } from "./actions";

describe("apply for a card", () => {
  const form = () => {
    const data = new FormData();
    data.set("productId", "fern-flat-2");
    return data;
  };

  it("applies for the signed-in person only on the tap, and shows what the issuer said", async () => {
    vi.mocked(applyForCard).mockResolvedValueOnce({ status: "approved" } as never);
    await expect(applyCardAction(form())).rejects.toThrow(
      "REDIRECT /loans/cards?applied=approved#applications",
    );
    expect(applyForCard).toHaveBeenCalledWith("u1", "fern-flat-2");
  });

  it("shows why when it can't", async () => {
    vi.mocked(applyForCard).mockRejectedValueOnce(new CreditCardError("Already applied."));
    await expect(applyCardAction(form())).rejects.toThrow(
      "REDIRECT /loans/cards?error=Already+applied.",
    );
  });
});
