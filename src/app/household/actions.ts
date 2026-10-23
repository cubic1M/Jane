"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appBase } from "@/lib/digest/links";
import { sendEmail } from "@/lib/email";
import {
  HouseholdError,
  acceptInvite,
  invitePartner,
  leaveHousehold,
  setAccountSharing,
} from "@/lib/household";
import {
  MoneyForTwoError,
  approveBigMove,
  declineBigMove,
  setBigMoveLimit,
  setGoalSharing,
  setSplitRule,
} from "@/lib/money-for-two";
import { requireUser } from "@/lib/session";
import { SharedBillError, settleUp, splitCharge, unsplitCharge } from "@/lib/shared-bills";

export type HouseholdState = { ok: boolean; message: string; link?: string } | null;

export async function invite(
  _previous: HouseholdState,
  formData: FormData,
): Promise<HouseholdState> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "");
  let token: string;
  try {
    ({ token } = await invitePartner({ id: user.id, email: user.email ?? "" }, email));
  } catch (error) {
    if (error instanceof HouseholdError) return { ok: false, message: error.message };
    throw error;
  }
  const link = `${appBase()}/household/join?${new URLSearchParams({ token })}`;
  // Email it when email is set up; the link is shown either way, so it can be sent by hand.
  if (process.env.RESEND_API_KEY) {
    await sendEmail({
      to: email.trim(),
      subject: `${user.email} invited you to share a household on Financial Controller`,
      text: `${user.email} invited you to see some of their accounts, and share some of yours if you like.\n\nJoin: ${link}\n\nThe link works for 7 days, only when you sign in with this email.`,
      html: `<p>${user.email} invited you to see some of their accounts, and share some of yours if you like.</p><p><a href="${link}">Join their household</a></p><p>The link works for 7 days, only when you sign in with this email.</p>`,
    }).catch((error) => console.error("Household invite email failed", { error: String(error) }));
  }
  revalidatePath("/household");
  return { ok: true, message: "Invite created. Send your partner this link:", link };
}

export async function share(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setAccountSharing(
    user.id,
    String(formData.get("accountId") ?? ""),
    formData.get("shared") === "true",
  );
  revalidatePath("/household");
}

export async function leave(): Promise<void> {
  const user = await requireUser();
  await leaveHousehold(user.id);
  revalidatePath("/household");
}

export async function join(_previous: HouseholdState, formData: FormData): Promise<HouseholdState> {
  const user = await requireUser();
  try {
    await acceptInvite(
      { id: user.id, email: user.email ?? "" },
      String(formData.get("token") ?? ""),
    );
  } catch (error) {
    if (error instanceof HouseholdError) return { ok: false, message: error.message };
    throw error;
  }
  redirect("/household");
}

// Splits a charge on a shared account, half each unless a share is given (percent).
export async function split(formData: FormData): Promise<void> {
  const user = await requireUser();
  const percent = Number(formData.get("percent") ?? 50);
  try {
    await splitCharge(
      user.id,
      String(formData.get("transactionId") ?? ""),
      Math.round(percent * 100),
    );
  } catch (error) {
    if (!(error instanceof SharedBillError)) throw error;
  }
  revalidatePath("/household");
}

export async function unsplit(formData: FormData): Promise<void> {
  const user = await requireUser();
  await unsplitCharge(user.id, String(formData.get("sharedChargeId") ?? ""));
  revalidatePath("/household");
}

export async function settle(): Promise<void> {
  const user = await requireUser();
  await settleUp(user.id);
  revalidatePath("/household");
}

// Money for two (spec step 242): either partner's tap sets how bills split for both.
export async function chooseSplit(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await setSplitRule(user.id, String(formData.get("rule") ?? ""));
  } catch (error) {
    if (!(error instanceof MoneyForTwoError)) throw error;
  }
  revalidatePath("/household");
}

export async function chooseBigMove(formData: FormData): Promise<void> {
  const user = await requireUser();
  const dollars = Number(String(formData.get("amount") ?? "").replace(/[$,\s]/g, ""));
  try {
    await setBigMoveLimit(user.id, Math.round(dollars * 100));
  } catch (error) {
    if (!(error instanceof MoneyForTwoError)) throw error;
  }
  revalidatePath("/household");
}

export async function shareGoal(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setGoalSharing(
    user.id,
    String(formData.get("goalId") ?? ""),
    formData.get("shared") === "true",
  );
  revalidatePath("/household");
  revalidatePath("/goals");
}

// The second tap on a partner's big move.
export async function answerBigMove(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("transferId") ?? "");
  try {
    if (formData.get("answer") === "approve") await approveBigMove(user.id, id);
    else await declineBigMove(user.id, id);
  } catch (error) {
    if (!(error instanceof MoneyForTwoError)) throw error;
  }
  revalidatePath("/household");
  revalidatePath("/transfers");
}
