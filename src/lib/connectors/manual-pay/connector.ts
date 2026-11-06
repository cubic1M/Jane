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
