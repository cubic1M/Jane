import { MANUAL_PAY_CUTOFF } from "@/config/connectors";
import { formatCents } from "@/lib/money";
import { BadRequest, type ActionDetails, type Connector } from "../types";
import { autopayOn, ownAccount, refuseOpenTwin } from "./guards";
import { billerFor, payOnFor } from "./rules";

// "Jane prepares, you pay" (roadmap Stage 3a): Jane works out the amount and the day, prefills the
// steps and the biller's own pay page, and the person pays it themselves. No partner, no money
// through Jane, no account number typed by Jane. It's a real connector, not a sandbox one (there is
// nothing to simulate), so it stays off until its switch in REAL_CONNECTORS is turned on. Afterwards
// ./settle.ts looks for the payment in the person's transactions.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const day = (details: ActionDetails, key: string): string => {
  const value = details[key];
  if (typeof value !== "string" || !ISO_DAY.test(value))
    throw new BadRequest(`${key} must be a day`);
  return value;
};

const words = (details: ActionDetails, key: string): string => {
  const value = details[key];
  if (typeof value !== "string" || !value.trim()) throw new BadRequest(`${key} is missing`);
  return value.trim().slice(0, 120);
};

export const manualBillPay: Connector = {
  id: "manual_bill_pay",
  name: "Pay a bill yourself, prepared by Jane",
  category: "bills",
  capabilities: ["prefill", "act"],
  scopes: ["prefill_payments"],
  sandbox: false,
  // The person moves the money, not Jane.
  movesMoney: false,
  // From the person's own data, never the caller's word (security review on #1506): the account is
  // theirs and named as it is; autopay doesn't already pay this biller; buy now, pay later is on
  // autopay; and no other payment of this bill and due day is open.
  prepare: async (request, { userId, client, now, actionId }) => {
    const account = await ownAccount(userId, request.fromAccountId, client);
    const name = typeof request.biller === "string" ? request.biller : "";
    const biller = billerFor(name);
    if (biller?.autopayByDefault) throw new BadRequest("buy now, pay later pays itself");
    if (await autopayOn(userId, name, { client, now })) {
      throw new BadRequest("autopay already pays this bill");
    }
    const prepared = { ...request, fromAccount: account.name, fromAccountId: account.id };
    await refuseOpenTwin(
      userId,
      "manual_bill_pay",
      { biller: biller?.biller ?? name.trim(), dueOn: String(request.dueOn ?? "") },
      { client, exceptId: actionId },
    );
    return prepared;
  },
  guard: async (details, { userId, client, now, actionId }) => {
    await ownAccount(userId, details.fromAccountId, client);
    if (await autopayOn(userId, String(details.biller), { client, now })) {
      throw new BadRequest("autopay already pays this bill");
    }
    await refuseOpenTwin(
      userId,
      "manual_bill_pay",
      { biller: String(details.biller), dueOn: String(details.dueOn) },
      { client, exceptId: actionId },
    );
  },
  prefill: (details) => {
    const name = words(details, "biller");
    const amountCents = details.amountCents;
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new BadRequest("amountCents must be a positive whole number of cents");
    }
    const dueOn = day(details, "dueOn");
    const today = day(details, "today");
    const fromAccount = words(details, "fromAccount");
    const viaBankBillPay = details.viaBankBillPay === true;
    const biller = billerFor(name);
    // Autopay is worked out from the person's own lines in prepare; a caller can only add to it.
    if (details.autopayOn === true || biller?.autopayByDefault) {
      throw new BadRequest("autopay already pays this bill");
    }
    const payOn = payOnFor(dueOn, { today, viaBankBillPay });
    const payee = biller?.biller ?? name;
    const where = viaBankBillPay
      ? "Your bank's own bill pay"
      : (biller?.payUrl ?? `${payee}'s own site, or your bank's bill pay`);
    return {
      kind: "manual_pay_bill",
      amountCents,
      summary: `Pay ${payee} ${formatCents(amountCents)} on ${payOn}`,
      steps: [
        { label: "Pay to", value: payee },
        { label: "Amount", value: formatCents(amountCents) },
        { label: "From", value: fromAccount },
        { label: "Pay on", value: `${payOn}, before ${MANUAL_PAY_CUTOFF}` },
        { label: "Where", value: where },
        { label: "Who pays", value: "You do. Jane never sees or types your account numbers." },
      ],
      details: {
        biller: payee,
        amountCents,
        dueOn,
        payOn,
        fromAccount,
        fromAccountId: typeof details.fromAccountId === "string" ? details.fromAccountId : null,
        viaBankBillPay,
        payUrl: viaBankBillPay ? null : (biller?.payUrl ?? null),
      },
    };
  },
  // Nothing to send: the person pays. The action waits, handed off, until ./settle.ts sees it.
  act: async (draft, context) => ({
    externalRef: `manual_${context.actionId}`,
    state: "handed_off",
    cancelUntil: null,
    note: `Pay ${String(draft.details.biller)} ${formatCents(draft.amountCents)} on ${String(
      draft.details.payOn,
    )}. Jane checks your account for it afterwards.`,
  }),
};

// The same move: between the same two accounts, of the same amount, on the same day.
const twinOf = (details: ActionDetails, fromAccountId: string, toAccountId: string) => ({
  fromAccountId,
  toAccountId,
  amountCents: typeof details.amountCents === "number" ? details.amountCents : null,
  on: typeof details.on === "string" ? details.on : String(details.today ?? ""),
});

// "Jane prepares, you move it": a move between two of the person's own accounts, in their own
// bank's app. Same as the bill: Jane fills in from, to, amount and day; the person moves it; the
// two lines in their transactions settle it (./settle.ts). Off until its REAL_CONNECTORS switch.
export const manualOwnTransfer: Connector = {
  id: "manual_own_transfer",
  name: "Move money between your accounts yourself, prepared by Jane",
  category: "own_transfer",
  capabilities: ["prefill", "act"],
  scopes: ["prefill_payments"],
  sandbox: false,
  movesMoney: false,
  // Both accounts are the person's own, named from their rows (security review on #1508): a name
  // or id from a request, a chat or a message is never taken as theirs. And no twin is open.
  prepare: async (request, { userId, client, actionId }) => {
    const from = await ownAccount(userId, request.fromAccountId, client);
    const to = await ownAccount(userId, request.toAccountId, client);
    if (from.id === to.id) throw new BadRequest("the same account on both sides");
    await refuseOpenTwin(userId, "manual_own_transfer", twinOf(request, from.id, to.id), {
      client,
      exceptId: actionId,
    });
    return {
      ...request,
      fromAccount: from.name,
      fromAccountId: from.id,
      toAccount: to.name,
      toAccountId: to.id,
    };
  },
  guard: async (details, { userId, client, actionId }) => {
    const from = await ownAccount(userId, details.fromAccountId, client);
    const to = await ownAccount(userId, details.toAccountId, client);
    await refuseOpenTwin(userId, "manual_own_transfer", twinOf(details, from.id, to.id), {
      client,
      exceptId: actionId,
    });
  },
  prefill: (details) => {
    const from = words(details, "fromAccount");
    const to = words(details, "toAccount");
    const amountCents = details.amountCents;
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new BadRequest("amountCents must be a positive whole number of cents");
    }
    const today = day(details, "today");
    const on = typeof details.on === "string" ? day(details, "on") : today;
    if (on < today) throw new BadRequest("the day has passed");
    const fromAccountId = typeof details.fromAccountId === "string" ? details.fromAccountId : null;
    const toAccountId = typeof details.toAccountId === "string" ? details.toAccountId : null;
    if (from === to || (fromAccountId !== null && fromAccountId === toAccountId)) {
      throw new BadRequest("the same account on both sides");
    }
    return {
      kind: "manual_move_own",
      amountCents,
      summary: `Move ${formatCents(amountCents)} from ${from} to ${to} on ${on}`,
      steps: [
        { label: "From", value: from },
        { label: "To", value: to },
        { label: "Amount", value: formatCents(amountCents) },
        { label: "On", value: on },
        { label: "Where", value: "Your bank's app or site: Transfers, between your own accounts" },
        { label: "Who moves it", value: "You do. Jane never sees or types your account numbers." },
      ],
      details: { fromAccount: from, toAccount: to, amountCents, on, fromAccountId, toAccountId },
    };
  },
  act: async (draft, context) => ({
    externalRef: `manual_${context.actionId}`,
    state: "handed_off",
    cancelUntil: null,
    note: `Move ${formatCents(draft.amountCents)} from ${String(draft.details.fromAccount)} to ${String(
      draft.details.toAccount,
    )} on ${String(draft.details.on)}. Jane checks your accounts for it afterwards.`,
  }),
};
