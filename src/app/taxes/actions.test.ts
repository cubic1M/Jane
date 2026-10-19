import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/tax-withholding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-withholding")>()),
  recordW4Change: vi.fn(),
  clearW4Change: vi.fn(),
  keepRefund: vi.fn(),
}));
vi.mock("@/lib/deadlines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deadlines")>()),
  addDeadline: vi.fn(),
}));
vi.mock("@/lib/tax-savings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-savings")>()),
  dismissSaving: vi.fn(),
  loadTaxSavings: vi.fn(async () => ({
    year: 2026,
    advice: true,
    savings: [
      {
        key: "retirement",
        title: "t",
        why: "w",
        estimateCents: 100,
        action: { kind: "task", title: "Raise my 401(k)", dueOn: "2026-10-25", note: "n" },
      },
    ],
  })),
}));
vi.mock("@/lib/tax-refund", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-refund")>()),
  applyRefundPlan: vi.fn(async () => ({ reminders: 2 })),
  dismissRefund: vi.fn(),
}));
vi.mock("@/lib/tax-organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-organizer")>()),
  markTaxForm: vi.fn(async () => ({ form: "W-2", from: "ACME" })),
}));

vi.mock("@/lib/tax-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-documents")>()),
  decideDocument: vi.fn(async () => ({ form: "W-2", from: "ACME CORP PAYROLL" })),
}));

vi.mock("@/lib/tax-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-plan")>()),
  addPlanMove: vi.fn(async () => ({ task: { title: "Make your IRA contribution (2026 taxes)" } })),
  dismissPlanMove: vi.fn(),
}));

import { adviceMode } from "@/lib/advice-mode";
import { TaxPlanError, addPlanMove, dismissPlanMove } from "@/lib/tax-plan";
import { TaxDocumentError, decideDocument } from "@/lib/tax-documents";
import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";
import { clearW4Change, keepRefund, recordW4Change } from "@/lib/tax-withholding";
import { addDeadline } from "@/lib/deadlines";
import { dismissSaving } from "@/lib/tax-savings";
import { applyRefundPlan, dismissRefund } from "@/lib/tax-refund";
import {
  documentAction,
  planAction,
  markForm,
  refundAction,
  savingAction,
  w4Action,
} from "./actions";

// Spec step 119: "I have it" and "Not yet" on /taxes.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("markForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ticks a form off for the signed-in person, and back", async () => {
    expect(await markForm(null, form({ year: "2026", key: "w2:acme", received: "1" }))).toEqual({
      ok: true,
      message: "Ticked off: W-2 from ACME.",
    });
    expect(markTaxForm).toHaveBeenCalledWith("u1", 2026, "w2:acme", true, { via: "page" });
    expect(await markForm(null, form({ year: "2026", key: "w2:acme", received: "0" }))).toEqual({
      ok: true,
      message: "OK, still waiting.",
    });
  });

  it("says what went wrong", async () => {
    expect(await markForm(null, form({ year: "x", key: "w2:acme" }))).toMatchObject({ ok: false });
    vi.mocked(markTaxForm).mockRejectedValueOnce(
      new TaxOrganizerError("That form isn't on your list anymore."),
    );
    expect(await markForm(null, form({ year: "2026", key: "nope", received: "1" }))).toEqual({
      ok: false,
      message: "That form isn't on your list anymore.",
    });
  });
});

describe("w4Action (spec step 121)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the W-4 the person sent, in demo advice mode only", async () => {
    expect(
      await w4Action(
        null,
        form({ intent: "sent", step: "4b", amountCents: "6169800", year: "2026" }),
      ),
    ).toEqual({ ok: true, message: "Saved. Your estimate counts it from your next paycheck." });
    expect(recordW4Change).toHaveBeenCalledWith(
      "u1",
      { step: "4b", amountCents: 6_169_800 },
      { via: "page" },
    );
    vi.mocked(adviceMode).mockResolvedValueOnce(false);
    expect(await w4Action(null, form({ intent: "sent", step: "4b", amountCents: "100" }))).toEqual({
      ok: false,
      message: "That's only in demo advice mode.",
    });
    expect(recordW4Change).toHaveBeenCalledTimes(1);
  });

  it("undoes it, and keeps a refund for the year", async () => {
    expect(await w4Action(null, form({ intent: "undo" }))).toMatchObject({ ok: true });
    expect(clearW4Change).toHaveBeenCalledWith("u1", { via: "page" });
    expect(await w4Action(null, form({ intent: "keep", year: "2026" }))).toMatchObject({
      ok: true,
    });
    expect(keepRefund).toHaveBeenCalledWith("u1", 2026, { via: "page" });
    expect(await w4Action(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});

describe("savingAction (spec step 122)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets the reminder for a way to pay less, in demo advice mode only", async () => {
    expect(
      await savingAction(null, form({ intent: "task", key: "retirement", year: "2026" })),
    ).toEqual({
      ok: true,
      message: "Added to your deadlines. Jane will remind you.",
    });
    expect(addDeadline).toHaveBeenCalledWith("u1", {
      title: "Raise my 401(k)",
      dueOn: "2026-10-25",
      kind: "other",
      note: "n",
    });
    vi.mocked(adviceMode).mockResolvedValueOnce(false);
    expect(
      await savingAction(null, form({ intent: "task", key: "retirement", year: "2026" })),
    ).toMatchObject({ ok: false });
  });

  it("Not for me, and refuses a suggestion that isn't open", async () => {
    expect(
      await savingAction(null, form({ intent: "no", key: "retirement", year: "2026" })),
    ).toMatchObject({ ok: true });
    expect(dismissSaving).toHaveBeenCalledWith("u1", 2026, "retirement", { via: "page" });
    expect(await savingAction(null, form({ intent: "no", key: "ira", year: "2026" }))).toEqual({
      ok: false,
      message: "That suggestion isn't open anymore.",
    });
  });
});

describe("refundAction (spec step 125)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets up a refund's plan or leaves it, for the signed-in person", async () => {
    expect(await refundAction(null, form({ intent: "apply", transactionId: "t1" }))).toEqual({
      ok: true,
      message: "Done: 2 reminders on your deadlines.",
    });
    expect(applyRefundPlan).toHaveBeenCalledWith("u1", "t1", { via: "page" });
    expect(await refundAction(null, form({ intent: "no", transactionId: "t1" }))).toMatchObject({
      ok: true,
    });
    expect(dismissRefund).toHaveBeenCalledWith("u1", "t1", { via: "page" });
  });
});

describe("a collected form that doesn't match (spec step 166)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses it as it is, or puts asking the payer on the deadlines", async () => {
    expect(
      await documentAction(null, form({ year: "2026", key: "w2:acme", decision: "right" })),
    ).toEqual({ ok: true, message: "Using your W-2 from ACME CORP PAYROLL as it is." });
    expect(decideDocument).toHaveBeenCalledWith("u1", 2026, "w2:acme", "right", { via: "page" });
    expect(
      await documentAction(null, form({ year: "2026", key: "w2:acme", decision: "ask" })),
    ).toEqual({
      ok: true,
      message: "Asking ACME CORP PAYROLL for a corrected form is on your deadlines.",
    });
  });

  it("refuses anything else, and says what's wrong", async () => {
    expect(
      await documentAction(null, form({ year: "2026", key: "w2:acme", decision: "file" })),
    ).toMatchObject({ ok: false });
    vi.mocked(decideDocument).mockRejectedValueOnce(
      new TaxDocumentError("That form isn't collected anymore."),
    );
    expect(
      await documentAction(null, form({ year: "2026", key: "w2:gone", decision: "right" })),
    ).toEqual({ ok: false, message: "That form isn't collected anymore." });
  });
});

describe("a tax plan move (spec step 167)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts it on the deadlines, or not for me", async () => {
    expect(await planAction(null, form({ move: "2026:ira", intent: "add" }))).toEqual({
      ok: true,
      message: '"Make your IRA contribution (2026 taxes)" is on your deadlines.',
    });
    expect(addPlanMove).toHaveBeenCalledWith("u1", "2026:ira", { via: "page" });
    expect(await planAction(null, form({ move: "2026:ira", intent: "no" }))).toMatchObject({
      ok: true,
    });
    expect(dismissPlanMove).toHaveBeenCalledWith("u1", "2026:ira", { via: "page" });
  });

  it("says when it's past its deadline", async () => {
    vi.mocked(addPlanMove).mockRejectedValueOnce(new TaxPlanError("That's past its deadline now."));
    expect(await planAction(null, form({ move: "2025:ira", intent: "add" }))).toEqual({
      ok: false,
      message: "That's past its deadline now.",
    });
    expect(await planAction(null, form({ move: "2026:ira", intent: "pay" }))).toMatchObject({
      ok: false,
    });
  });
});
