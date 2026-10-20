import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/medical-bills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/medical-bills")>()),
  addMedicalBill: vi.fn(),
  sendMedicalItem: vi.fn(),
}));

import { MedicalBillError, addMedicalBill, sendMedicalItem } from "@/lib/medical-bills";
import { addBillAction, sendRequestAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("add a bill", () => {
  it("adds it for the signed-in person", async () => {
    vi.mocked(addMedicalBill).mockResolvedValueOnce();
    await expect(
      addBillAction(form({ provider: "Mercy", amount: "2400", billedOn: "2026-09-01" })),
    ).rejects.toThrow("REDIRECT /loans/medical?added=1");
    expect(addMedicalBill).toHaveBeenCalledWith("u1", {
      provider: "Mercy",
      amount: "2400",
      billedOn: "2026-09-01",
    });
  });
  it("shows why when it can't", async () => {
    vi.mocked(addMedicalBill).mockRejectedValueOnce(new MedicalBillError("Who is the bill from?"));
    await expect(addBillAction(form({}))).rejects.toThrow(
      "REDIRECT /loans/medical?error=Who+is+the+bill+from%3F",
    );
  });
});

describe("send a request", () => {
  it("sends one request, only on the tap", async () => {
    vi.mocked(sendMedicalItem).mockResolvedValueOnce({} as never);
    await expect(sendRequestAction(form({ itemId: "plan:typed:b1" }))).rejects.toThrow(
      "REDIRECT /loans/medical?sent=1",
    );
    expect(sendMedicalItem).toHaveBeenCalledWith("u1", "plan:typed:b1");
  });
});
