import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-notices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-notices")>()),
  confirmTaxNotice: vi.fn(),
  dismissTaxNotice: vi.fn(),
  chooseResponse: vi.fn(),
  sendResponse: vi.fn(),
}));

import {
  NoticeError,
  chooseResponse,
  confirmTaxNotice,
  dismissTaxNotice,
  sendResponse,
} from "@/lib/tax-notices";
import { letterAction } from "./actions";
import { fieldsFrom } from "./fields";

// Spec step 217: confirming a notice, choosing a reply and handing it over, each a tap.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("letters actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only the fields that were filled in", () => {
    expect(fieldsFrom(form({ kind: "CP14", amount: " 1,500 ", payer: "", other: "x" }))).toEqual({
      kind: "CP14",
      amount: "1,500",
    });
  });

  it("confirms, dismisses, drafts and hands over, each only on its own intent", async () => {
    expect(
      await letterAction(null, form({ intent: "confirm", id: "n1", kind: "CP14" })),
    ).toMatchObject({ ok: true });
    expect(confirmTaxNotice).toHaveBeenCalledWith("u1", "n1", { fields: { kind: "CP14" } });
    expect(await letterAction(null, form({ intent: "dismiss", id: "n1" }))).toMatchObject({
      ok: true,
    });
    expect(dismissTaxNotice).toHaveBeenCalledWith("u1", "n1");
    expect(await letterAction(null, form({ intent: "pay", id: "n1" }))).toMatchObject({ ok: true });
    expect(chooseResponse).toHaveBeenCalledWith("u1", "n1", "pay");
    expect(sendResponse).not.toHaveBeenCalled();
    expect(await letterAction(null, form({ intent: "team", id: "n1" }))).toEqual({
      ok: true,
      message: "Jane's team has it and will send it.",
    });
    expect(sendResponse).toHaveBeenCalledWith("u1", "n1", "team");
    expect(await letterAction(null, form({ intent: "you", id: "n1" }))).toMatchObject({ ok: true });
    expect(await letterAction(null, form({ intent: "send-everything", id: "n1" }))).toMatchObject({
      ok: false,
    });
  });

  it("says what's wrong", async () => {
    vi.mocked(sendResponse).mockRejectedValueOnce(new NoticeError("This one's already been sent."));
    expect(await letterAction(null, form({ intent: "team", id: "n1" }))).toEqual({
      ok: false,
      message: "This one's already been sent.",
    });
  });
});
