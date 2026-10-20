import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/card-interest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/card-interest")>()),
  addCardPromo: vi.fn(),
  removeCardPromo: vi.fn(),
  sendRateRequest: vi.fn(),
}));

import {
  CardInterestError,
  addCardPromo,
  removeCardPromo,
  sendRateRequest,
} from "@/lib/card-interest";
import { addPromoAction, removePromoAction, sendRateAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("a promotion", () => {
  it("is added for the signed-in person, deferred only when ticked", async () => {
    vi.mocked(addCardPromo).mockResolvedValueOnce();
    await expect(
      addPromoAction(
        form({
          cardName: "Store",
          balance: "900",
          startedOn: "2026-06-01",
          endsOn: "2027-02-01",
          goToApr: "26.99",
          deferred: "on",
        }),
      ),
    ).rejects.toThrow("REDIRECT /loans/interest?added=1");
    expect(addCardPromo).toHaveBeenCalledWith("u1", {
      cardName: "Store",
      balance: "900",
      startedOn: "2026-06-01",
      endsOn: "2027-02-01",
      goToApr: "26.99",
      deferred: true,
    });
  });
  it("shows why when it can't, and can be removed", async () => {
    vi.mocked(addCardPromo).mockRejectedValueOnce(new CardInterestError("Which card?"));
    await expect(addPromoAction(form({}))).rejects.toThrow(
      "REDIRECT /loans/interest?error=Which+card%3F",
    );
    vi.mocked(removeCardPromo).mockResolvedValueOnce();
    await expect(removePromoAction(form({ promoId: "p1" }))).rejects.toThrow(
      "REDIRECT /loans/interest?removed=1",
    );
    expect(removeCardPromo).toHaveBeenCalledWith("u1", "p1");
  });
});

describe("a request for a lower rate", () => {
  it("is sent for the signed-in person, only on the tap", async () => {
    vi.mocked(sendRateRequest).mockResolvedValueOnce({ cardName: "Card" });
    await expect(sendRateAction(form({ requestId: "account:a1:2026-10" }))).rejects.toThrow(
      "REDIRECT /loans/interest?sent=1",
    );
    expect(sendRateRequest).toHaveBeenCalledWith("u1", "account:a1:2026-10");
  });
});
