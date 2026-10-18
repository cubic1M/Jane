import { COUNSEL_INSURANCE_REFERRALS, isStateCode } from "@/config/referrals";
import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Which referral partner, if any, a card uses for a person, and checking what the team
// enters at /admin/partners.

type Options = { client?: PrismaClient };

export type CardPartner = { key: string; name: string; disclosure: string };

const ACTION_TYPES: readonly ActionType[] = [
  "cancel_subscription",
  "fight_price_increase",
  "recover_bank_fees",
  "move_idle_cash",
  "insurance_reshop",
  "card_interest",
  "review_cash_flow",
  "request_refund",
  "negotiate_bill",
];

// Insurance partners stay off until counsel's answer is recorded as approved.
export function partnerAllowed(actionType: ActionType): boolean {
  return actionType !== "insurance_reshop" || COUNSEL_INSURANCE_REFERRALS.approved;
}

// The active partner for this action in the person's state, or null. No state, no partner.
export async function partnerFor(
  actionType: ActionType,
  state: string | null,
  { client = defaultClient }: Options = {},
): Promise<CardPartner | null> {
  if (!state || !partnerAllowed(actionType)) return null;
  return client.referralPartner.findFirst({
    where: { actionType, active: true, allowedStates: { has: state } },
    orderBy: { key: "asc" },
    select: { key: true, name: true, disclosure: true },
  });
}

export async function partnerForUser(
  userId: string,
  actionType: ActionType,
  { client = defaultClient }: Options = {},
): Promise<CardPartner | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { state: true } });
  return partnerFor(actionType, user?.state ?? null, { client });
}

export type PartnerInput = {
  key: string;
  name: string;
  actionType: string;
  disclosure: string;
  referralUrl: string;
  allowedStates: string;
  revenuePerConversion: string;
  active: boolean;
};

const MAX_DISCLOSURE = 500;

export function validatePartner(input: PartnerInput):
  | {
      ok: true;
      data: {
        key: string;
        name: string;
        actionType: ActionType;
        disclosure: string;
        referralUrl: string;
        allowedStates: string[];
        revenuePerConversionCents: number | null;
        active: boolean;
      };
    }
  | { ok: false; message: string } {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(key)) {
    return { ok: false, message: "Key: 2 to 40 lower-case letters, numbers or dashes." };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the partner a name." };
  if (!(ACTION_TYPES as readonly string[]).includes(input.actionType)) {
    return { ok: false, message: "Pick an action type." };
  }
  const actionType = input.actionType as ActionType;
  const disclosure = input.disclosure.trim();
  if (!disclosure) {
    return { ok: false, message: "A partner needs its disclosure: cards show it word for word." };
  }
  if (disclosure.length > MAX_DISCLOSURE)
    return { ok: false, message: "That disclosure is too long." };
  let referralUrl: URL;
  try {
    referralUrl = new URL(input.referralUrl.trim());
  } catch {
    return { ok: false, message: "The referral link must be a full https:// address." };
  }
  if (referralUrl.protocol !== "https:") {
    return { ok: false, message: "The referral link must be a full https:// address." };
  }
  const allowedStates = [
    ...new Set(
      input.allowedStates
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
  const unknown = allowedStates.filter((s) => !isStateCode(s));
  if (unknown.length > 0) return { ok: false, message: `Unknown state: ${unknown.join(", ")}.` };
  let revenuePerConversionCents: number | null = null;
  if (input.revenuePerConversion.trim()) {
    const dollars = Number(input.revenuePerConversion.replace(/[$,]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 0) {
      return { ok: false, message: "Revenue per conversion must be an amount like 40." };
    }
    revenuePerConversionCents = Math.round(dollars * 100);
  }
  if (input.active && !partnerAllowed(actionType)) {
    return {
      ok: false,
      message:
        "Insurance referrals stay off until counsel's answer is recorded in src/config/referrals.ts.",
    };
  }
  return {
    ok: true,
    data: {
      key,
      name,
      actionType,
      disclosure,
      referralUrl: referralUrl.toString(),
      allowedStates,
      revenuePerConversionCents,
      active: input.active,
    },
  };
}
