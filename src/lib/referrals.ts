import {
  COUNSEL_INSURANCE_REFERRALS,
  PAY_DISCLOSURES,
  isPayModel,
  isStateCode,
  type PayModel,
} from "@/config/referrals";
import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";

// Which referral partner, if any, a card uses for a person, and checking what the team
// enters at /admin/partners.

type Options = { client?: PrismaClient };

export type CardPartner = {
  key: string;
  name: string;
  disclosure: string;
  // Insurance only: how Jane is paid, said word for word after the partner's own disclosure
  // (connectors roadmap round 14).
  payDisclosure?: string;
};

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

// Insurance partners stay off until counsel's answer is recorded as approved. Then, by how the
// partner pays (connectors roadmap round 14): unpaid follows that answer; a flat fee or per-quote pay
// also needs counsel's approval for that pay model in this state; per sale is never allowed.
export function partnerAllowed(
  actionType: ActionType,
  payModel: PayModel = "none",
  state: string | null = null,
): boolean {
  if (actionType !== "insurance_reshop") return true;
  if (!COUNSEL_INSURANCE_REFERRALS.approved || payModel === "per_policy") return false;
  if (payModel === "none") return true;
  const states = COUNSEL_INSURANCE_REFERRALS.approvedStates[payModel] ?? [];
  return state !== null && states.includes(state);
}

// Whether Jane may be paid by this partner at all. An unpaid insurance partner's card tells the
// person "Jane isn't paid for this", so no revenue may be recorded or expected from it; per policy
// sold is never allowed (round 14). Other partners pay as their row says.
export function paysJane(actionType: string, payModel: string): boolean {
  if (actionType !== "insurance_reshop") return true;
  return isPayModel(payModel) && payModel !== "none" && payModel !== "per_policy";
}

// The active partner for this action in the person's state, or null. No state, no partner.
export async function partnerFor(
  actionType: ActionType,
  state: string | null,
  { client = defaultClient }: Options = {},
): Promise<CardPartner | null> {
  if (!state || !partnerAllowed(actionType)) return null;
  const partners = await systemDb(
    "Referral partners are shared reference data, no one's own",
    client,
  ).referralPartner.findMany({
    where: { actionType, active: true, allowedStates: { has: state } },
    orderBy: { key: "asc" },
    select: { key: true, name: true, disclosure: true, payModel: true },
  });
  // The first whose way of paying is allowed here; a pay model Jane doesn't know never is.
  const found = partners.find(
    (p) => isPayModel(p.payModel) && partnerAllowed(actionType, p.payModel, state),
  );
  if (!found || !isPayModel(found.payModel) || found.payModel === "per_policy") return null;
  return {
    key: found.key,
    name: found.name,
    disclosure: found.disclosure,
    ...(actionType === "insurance_reshop" && { payDisclosure: PAY_DISCLOSURES[found.payModel] }),
  };
}

export async function partnerForUser(
  userId: string,
  actionType: ActionType,
  { client = defaultClient }: Options = {},
): Promise<CardPartner | null> {
  const user = await scopedFor(userId, client).me.findUnique({
    where: { id: userId },
    select: { state: true },
  });
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
  // Optional: unpaid unless said.
  payModel?: string;
  lines?: string;
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
        payModel: PayModel;
        lines: string[];
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
  const payModel = (input.payModel ?? "none").trim() || "none";
  if (!isPayModel(payModel)) return { ok: false, message: "Pick how the partner pays." };
  if (actionType === "insurance_reshop" && payModel === "per_policy") {
    return {
      ok: false,
      message:
        "Insurance partners can't pay per policy sold: an unlicensed referrer can't be paid per sale.",
    };
  }
  const lines = [
    ...new Set(
      (input.lines ?? "")
        .split(/[\s,]+/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (lines.some((l) => !["auto", "home", "renters", "life"].includes(l))) {
    return { ok: false, message: "Lines are auto, home, renters or life." };
  }
  if (input.active && !partnerAllowed(actionType)) {
    return {
      ok: false,
      message:
        "Insurance referrals stay off until counsel's answer is recorded in src/config/referrals.ts.",
    };
  }
  if (revenuePerConversionCents !== null && !paysJane(actionType, payModel)) {
    return {
      ok: false,
      message:
        "This partner is set as unpaid, and its card says Jane isn't paid: leave revenue per conversion empty.",
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
      payModel,
      lines,
      active: input.active,
    },
  };
}
