import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tight-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tight-money")>()),
  sendTightItem: vi.fn(),
}));

import { TightMoneyError, sendTightItem } from "@/lib/tight-money";
import { sendRequestAction } from "./actions";

const form = () => {
  const data = new FormData();
  data.set("itemId", "hardship:account:card");
  return data;
};

describe("send a request", () => {
  it("sends the one request for the signed-in person, only on the tap", async () => {
    vi.mocked(sendTightItem).mockResolvedValueOnce({} as never);
    await expect(sendRequestAction(form())).rejects.toThrow("REDIRECT /loans/tight?sent=1");
    expect(sendTightItem).toHaveBeenCalledWith("u1", "hardship:account:card");
  });
  it("shows why when it can't", async () => {
    vi.mocked(sendTightItem).mockRejectedValueOnce(new TightMoneyError("Already sent."));
    await expect(sendRequestAction(form())).rejects.toThrow(
      "REDIRECT /loans/tight?error=Already+sent.",
    );
  });
});
