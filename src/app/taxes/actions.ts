"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { adviceMode } from "@/lib/advice-mode";
import { DeadlineError, addDeadline } from "@/lib/deadlines";
import { GoalError, addGoal } from "@/lib/goals";
import { dismissSaving, loadTaxSavings } from "@/lib/tax-savings";
import { RefundError, applyRefundPlan, dismissRefund } from "@/lib/tax-refund";
import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";
import { TaxDocumentError, decideDocument } from "@/lib/tax-documents";
import { TaxPlanError, addPlanMove, dismissPlanMove } from "@/lib/tax-plan";
import { AuditRecordsError, remindRetention } from "@/lib/audit-records";
import { GivingError, markReceipt, openDonorFund } from "@/lib/giving";
import { WithholdingError, clearW4Change, keepRefund, recordW4Change } from "@/lib/tax-withholding";

// /taxes (spec step 119): "I have it" on a tax form Jane expects, or "Not yet" to undo it.

export type FormState = { ok: boolean; message: string } | null;

export async function markForm(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const year = Number(formData.get("year"));
  const key = String(formData.get("key") ?? "");
  const received = formData.get("received") === "1";
  if (!Number.isInteger(year)) return { ok: false, message: "Something went wrong. Try again." };
  try {
    const form = await markTaxForm(user.id, year, key, received, { via: "page" });
    revalidatePath("/taxes");
    revalidatePath("/tax-pack");
    return {
      ok: true,
      message: received ? `Ticked off: ${form.form} from ${form.from}.` : "OK, still waiting.",
    };
  } catch (error) {
    if (error instanceof TaxOrganizerError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 121: the W-4 change the person sent, undoing it, or keeping a big refund.
export async function w4Action(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "sent") {
      if (!(await adviceMode(user.id)))
        return { ok: false, message: "That's only in demo advice mode." };
      const step = String(formData.get("step") ?? "");
      const amountCents = Number(formData.get("amountCents"));
      if (step !== "4b" && step !== "4c")
        return { ok: false, message: "Something went wrong. Try again." };
      await recordW4Change(user.id, { step, amountCents }, { via: "page" });
    } else if (intent === "undo") {
      await clearW4Change(user.id, { via: "page" });
    } else if (intent === "keep") {
      const year = Number(formData.get("year"));
      if (!Number.isInteger(year))
        return { ok: false, message: "Something went wrong. Try again." };
      await keepRefund(user.id, year, { via: "page" });
    } else {
      return { ok: false, message: "Something went wrong. Try again." };
    }
    revalidatePath("/taxes");
    return {
      ok: true,
      message:
        intent === "sent"
          ? "Saved. Your estimate counts it from your next paycheck."
          : intent === "undo"
            ? "OK, your estimate no longer counts it."
            : "OK. Jane won't bring it up again this year.",
    };
  } catch (error) {
    if (error instanceof WithholdingError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 122: a way to pay less, from /taxes. Demo advice mode only; each through its
// feature's own code.
export async function savingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await adviceMode(user.id)))
    return { ok: false, message: "That's only in demo advice mode." };
  const intent = String(formData.get("intent") ?? "");
  const year = Number(formData.get("year"));
  const key = String(formData.get("key") ?? "");
  const { savings } = await loadTaxSavings(user.id);
  const saving = savings.find((s) => s.key === key);
  if (!saving || !Number.isInteger(year))
    return { ok: false, message: "That suggestion isn't open anymore." };
  try {
    if (intent === "no") {
      await dismissSaving(user.id, year, saving.key, { via: "page" });
      revalidatePath("/taxes");
      return { ok: true, message: "OK. Jane won't suggest it again this year." };
    }
    const action = saving.action;
    if (intent === "task" && action.kind === "task") {
      await addDeadline(user.id, {
        title: action.title,
        dueOn: action.dueOn,
        kind: "other",
        note: action.note,
      });
      return { ok: true, message: "Added to your deadlines. Jane will remind you." };
    }
    if (intent === "goal" && action.kind === "goal") {
      await addGoal(user.id, {
        name: action.name,
        target: (action.targetCents / 100).toFixed(2),
        targetDate: action.targetDate,
        accountId: "",
        saved: "",
      });
      return { ok: true, message: "Goal started." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof DeadlineError || error instanceof GoalError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

// Spec step 125: a refund's plan: set it up (goals and reminders) or leave it.
export async function refundAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("transactionId") ?? "");
  try {
    if (formData.get("intent") === "apply") {
      const { reminders } = await applyRefundPlan(user.id, id, { via: "page" });
      revalidatePath("/taxes");
      return {
        ok: true,
        message: `Done: ${reminders} ${reminders === 1 ? "reminder" : "reminders"} on your deadlines.`,
      };
    }
    await dismissRefund(user.id, id, { via: "page" });
    revalidatePath("/taxes");
    return { ok: true, message: "OK. It's yours to use as you like." };
  } catch (error) {
    if (error instanceof RefundError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 166: on a collected form that doesn't match the accounts, "It's right, use it"
// or "I'll ask them" (a reminder on the deadlines).
export async function documentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const year = Number(formData.get("year"));
  const key = String(formData.get("key") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!Number.isInteger(year) || (decision !== "right" && decision !== "ask")) {
    return { ok: false, message: "Something went wrong. Try again." };
  }
  try {
    const form = await decideDocument(user.id, year, key, decision, { via: "page" });
    revalidatePath("/taxes");
    return {
      ok: true,
      message:
        decision === "right"
          ? `Using your ${form.form} from ${form.from} as it is.`
          : `Asking ${form.from} for a corrected form is on your deadlines.`,
    };
  } catch (error) {
    if (error instanceof TaxDocumentError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 167: a tax move on the deadlines, or not for me.
export async function planAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("move") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!id || (intent !== "add" && intent !== "no")) {
    return { ok: false, message: "Something went wrong. Try again." };
  }
  try {
    if (intent === "add") {
      const move = await addPlanMove(user.id, id, { via: "page" });
      revalidatePath("/taxes");
      return { ok: true, message: `"${move.task.title}" is on your deadlines.` };
    }
    await dismissPlanMove(user.id, id, { via: "page" });
    revalidatePath("/taxes");
    return { ok: true, message: "OK. Jane won't bring it up again this year." };
  } catch (error) {
    if (error instanceof TaxPlanError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 168: a gift's receipt, or a donor-advised fund through the stand-in.
export async function givingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "receipt") {
      const gift = await markReceipt(user.id, String(formData.get("gift") ?? ""), {
        via: "page",
      });
      revalidatePath("/taxes");
      return { ok: true, message: `Got it: your gift to ${gift.payee} has its receipt.` };
    }
    if (intent === "fund") {
      const fund = await openDonorFund(user.id, { via: "page" });
      revalidatePath("/taxes");
      return {
        ok: true,
        message: `${fund.fundName} is open. Putting money in is on your deadlines.`,
      };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof GivingError) return { ok: false, message: error.message };
    throw error;
  }
}

// Spec step 171: a reminder before a year's records can be thrown away.
export async function recordsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const year = Number(formData.get("year"));
  if (!Number.isInteger(year)) return { ok: false, message: "Something went wrong. Try again." };
  try {
    const r = await remindRetention(user.id, year, { via: "page" });
    revalidatePath("/taxes");
    return { ok: true, message: `A reminder about your ${r.year} records is on your deadlines.` };
  } catch (error) {
    if (error instanceof AuditRecordsError) return { ok: false, message: error.message };
    throw error;
  }
}
