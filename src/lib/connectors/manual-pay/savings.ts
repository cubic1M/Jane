import { SAVINGS_APY_STALE_DAYS } from "@/config/compare";
import type { PrismaClient } from "@/generated/prisma/client";
import { apyDisclosures, apyHeadline } from "@/lib/apy-disclosure";
import { formatCents } from "@/lib/money";
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";
import { todayOf } from "@/lib/today";
import { BadRequest, type ActionDetails, type Connector } from "../types";
import { ownAccount, refuseOpenTwin } from "./guards";

// "Jane shows, you open and move it" (connectors roadmap round 13, Path A): a better savings account
// from the reviewed options, opened by the person on the bank's own page, which then pulls the
// opening deposit from their checking itself. Jane holds nothing, moves nothing and opens nothing:
// it fills in the steps and later sees the deposit leave their account (./settle.ts). Off until its
// REAL_CONNECTORS switch.
//
// It never says the account is FDIC insured: options don't record the insurer yet (round 13's
// savings fields), so it points the person to the FDIC's own BankFind instead (12 CFR 328.102).

const WHY = "Options to compare are the team's list, nobody's own";
const DAY = 86_400_000;

export const NOT_A_BANK =
  "Jane is not a bank and never holds your money. Check the bank on the FDIC's BankFind (banks.data.fdic.gov) before you open it.";

async function freshSavingsOption(optionId: unknown, now: Date, client: PrismaClient) {
  if (typeof optionId !== "string" || !optionId) throw new BadRequest("needs a savings option");
  const option = await systemDb(WHY, client).switchOption.findUnique({ where: { id: optionId } });
  // Only a reviewed option, with a rate checked within the savings limit, and a sign-up page.
  if (
    !option ||
    option.kind !== "savings" ||
    option.apyBps === null ||
    !option.reviewedAt ||
    option.checkedAt.getTime() < now.getTime() - SAVINGS_APY_STALE_DAYS * DAY ||
    !option.signUpUrl?.startsWith("https://")
  ) {
    throw new BadRequest("not a current savings option");
  }
  return option;
}

const words = (details: ActionDetails, key: string): string => {
  const value = details[key];
  if (typeof value !== "string" || !value.trim()) throw new BadRequest(`${key} is missing`);
  return value.trim().slice(0, 200);
};

export const manualOpenSavings: Connector = {
  id: "manual_open_savings",
  name: "Open a better savings account yourself, prepared by Jane",
  category: "own_transfer",
  capabilities: ["prefill", "act"],
  scopes: ["prefill_payments"],
  sandbox: false,
  // The new bank pulls the deposit; Jane moves nothing.
  movesMoney: false,
  // From the database, never the caller's word: the option is current and reviewed, the account the
  // deposit comes from is the person's, it holds the deposit, and no other opening is open for
  // the same option.
  prepare: async (request, { userId, client, now, actionId }) => {
    const option = await freshSavingsOption(request.optionId, now, client);
    const from = await ownAccount(userId, request.fromAccountId, client);
    const amountCents = request.amountCents;
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new BadRequest("amountCents must be a positive whole number of cents");
    }
    // Never more than the account holds, as far as Jane last saw it.
    const held = await scopedFor(userId, client).accounts.findFirst({
      where: { id: from.id },
      select: { currentBalanceCents: true },
    });
    if (held?.currentBalanceCents != null && amountCents > held.currentBalanceCents) {
      throw new BadRequest("more than the account holds");
    }
    await refuseOpenTwin(
      userId,
      "manual_open_savings",
      { optionId: option.id },
      {
        client,
        exceptId: actionId,
      },
    );
    return {
      ...request,
      optionId: option.id,
      provider: option.provider,
      accountName: option.name,
      apyBps: option.apyBps,
      asOf: option.checkedAt.toISOString().slice(0, 10),
      minimumCents: option.minimumBalanceCents,
      signUpUrl: option.signUpUrl,
      fromAccount: from.name,
      fromAccountId: from.id,
      // The person's own day, never the caller's: the deposit is looked for from then on.
      today: await todayOf(userId, { client, now }),
    };
  },
  guard: async (details, { userId, client, now, actionId }) => {
    await freshSavingsOption(details.optionId, now, client);
    await ownAccount(userId, details.fromAccountId, client);
    await refuseOpenTwin(
      userId,
      "manual_open_savings",
      { optionId: String(details.optionId) },
      {
        client,
        exceptId: actionId,
      },
    );
  },
  prefill: (details) => {
    const provider = words(details, "provider");
    const name = words(details, "accountName");
    const from = words(details, "fromAccount");
    const today = words(details, "today");
    const signUpUrl = words(details, "signUpUrl");
    const apyBps = Number(details.apyBps);
    const minimumCents = Number(details.minimumCents ?? 0);
    const amountCents = Number(details.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new BadRequest("bad amount");
    if (amountCents < minimumCents) throw new BadRequest("below the minimum to earn the APY");
    return {
      kind: "manual_open_savings",
      amountCents,
      summary: `Open ${name} at ${provider} and move ${formatCents(amountCents)} from ${from}`,
      steps: [
        { label: "Open", value: `${name} at ${provider}, on their own page: ${signUpUrl}` },
        { label: "Rate", value: apyHeadline(apyBps, words(details, "asOf")) },
        { label: "About the rate", value: apyDisclosures(minimumCents).join(" ") },
        { label: "Link", value: `In their sign-up, link your ${from}` },
        {
          label: "Move",
          value: `Have them pull ${formatCents(amountCents)} from it, from ${today}`,
        },
        { label: "Who moves it", value: "You do, and the bank pulls it. Jane moves nothing." },
        { label: "Jane", value: NOT_A_BANK },
      ],
      details: {
        optionId: words(details, "optionId"),
        provider,
        accountName: name,
        amountCents,
        fromAccount: from,
        fromAccountId: words(details, "fromAccountId"),
        today,
        signUpUrl,
      },
    };
  },
  act: async (draft, context) => ({
    externalRef: `manual_${context.actionId}`,
    state: "handed_off",
    cancelUntil: null,
    note: `Open it at ${String(draft.details.provider)}: ${String(draft.details.signUpUrl)}. Jane checks your ${String(
      draft.details.fromAccount,
    )} for the deposit.`,
  }),
};
