import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { rentReceived, rentTransfers, type RentTransfer } from "@/detection/rent-transfers";
import type { DetectionInput } from "@/detection/types";
import { setMerchantCategory } from "@/lib/categories";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// "Is this your rent?" (CSV bench, round 24): rent sent by Zelle or Venmo to a landlord who is a
// person reads as a transfer, so it's missing from spending, bills and the idle-cash cushion.
// Jane asks about the payee (src/detection/rent-transfers.ts) instead of guessing. The answer is
// the person's own rule for that payee, the same as setting a category on /transactions: a yes
// files every payment to them as rent, past and future; a no keeps them as transfers. Either
// way the payee has a rule, so Jane never asks again.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export const RENT_CATEGORY = "RENT_AND_UTILITIES_RENT";
export const NOT_RENT_CATEGORY = "TRANSFER_OUT_ACCOUNT_TRANSFER";

// The payees and payers the person has answered for (their own rules).
async function answeredKeys(userId: string, client: PrismaClient): Promise<Set<string>> {
  const rules = await scopedFor(userId, client).merchantCategories.findMany({
    where: { source: "user" },
    select: { merchantKey: true },
  });
  return new Set(rules.map((r) => r.merchantKey));
}

// The payee to ask about now, the biggest first, or null.
export async function loadRentQuestion(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options = {},
): Promise<RentTransfer | null> {
  const [data, answered] = await Promise.all([
    input ?? loadDetectionInput(userId, { client, now }),
    answeredKeys(userId, client),
  ]);
  return rentTransfers(data, answered)[0] ?? null;
}

export async function answerRentQuestion(
  userId: string,
  merchantKey: string,
  isRent: boolean,
  { client = defaultClient }: Options = {},
): Promise<{ updated: number }> {
  return setMerchantCategory(userId, merchantKey, isRent ? RENT_CATEGORY : NOT_RENT_CATEGORY, {
    client,
  });
}

// "Is it rent you collect?" (debugger 11-01): money in by Zelle or Venmo from one person near each
// month's start, filed as a transfer. A yes files it as rental income (the tax estimate's Schedule
// E source), past and future; a no keeps it a transfer (a roommate's share of the person's rent).
export const RENTAL_INCOME_CATEGORY = "INCOME_RENTAL";
export const NOT_RENTAL_CATEGORY = "TRANSFER_IN_ACCOUNT_TRANSFER";

export async function loadRentInQuestion(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options = {},
): Promise<RentTransfer | null> {
  const [data, answered] = await Promise.all([
    input ?? loadDetectionInput(userId, { client, now }),
    answeredKeys(userId, client),
  ]);
  return rentReceived(data, answered)[0] ?? null;
}

export async function answerRentInQuestion(
  userId: string,
  merchantKey: string,
  isRental: boolean,
  { client = defaultClient }: Options = {},
): Promise<{ updated: number }> {
  return setMerchantCategory(
    userId,
    merchantKey,
    isRental ? RENTAL_INCOME_CATEGORY : NOT_RENTAL_CATEGORY,
    { client },
  );
}
