import { cancelRoute, type CancelRoute } from "../cancel/route";
import { sandboxLetters } from "./letters";
import { BadRequest, type Connector } from "../types";
import { SIMULATED, cancelUntil, cents, dollars, sandboxRef, text } from "./shared";

// The sandbox adapters (docs/connectors.md): one per kind of thing Jane will do through a partner,
// each shaped like the partner the connector plan picked for it, so the pipeline, the page and the
// tests run end to end on sample data. None calls anybody. Real partners replace them one at a time,
// behind REAL_CONNECTORS.

// Paying a bill from the person's own account (Spinwheel Pay or Method later; "Jane prepares, you
// pay" before either). Prefill needs the payee, the amount, the account it comes from and the day.
const billPay: Connector = {
  id: "sandbox_bill_pay",
  name: "Bill pay (sandbox)",
  category: "bills",
  capabilities: ["prefill", "act"],
  scopes: ["pay_bills"],
  sandbox: true,
  movesMoney: true,
  prefill: (details) => {
    const payee = text(details, "payee");
    const amount = cents(details, "amountCents");
    const from = text(details, "fromAccount");
    const sendOn = text(details, "sendOn");
    return {
      kind: "pay_bill",
      amountCents: amount,
      summary: `Pay ${payee} ${dollars(amount)} from ${from}`,
      steps: [
        { label: "Pay to", value: payee },
        { label: "Amount", value: dollars(amount) },
        { label: "From", value: from },
        { label: "Sends on", value: sendOn },
      ],
      details: { payee, amountCents: amount, fromAccount: from, sendOn },
    };
  },
  act: async (draft, context) => ({
    externalRef: sandboxRef("sbx_bill", context.idempotencyKey),
    state: "done",
    cancelUntil: cancelUntil(context.now),
    note: `${SIMULATED} Bill payment of ${dollars(draft.amountCents)} scheduled.`,
  }),
  cancel: async () => true,
};

// Moving money between two of the person's own accounts (Dwolla or Astra later).
const ownTransfer: Connector = {
  id: "sandbox_own_transfer",
  name: "Move between your accounts (sandbox)",
  category: "own_transfer",
  capabilities: ["prefill", "act"],
  scopes: ["move_own_money"],
  sandbox: true,
  movesMoney: true,
  prefill: (details) => {
    const from = text(details, "fromAccount");
    const to = text(details, "toAccount");
    const amount = cents(details, "amountCents");
    if (from === to) throw new BadRequest("the same account on both sides");
    return {
      kind: "move_own",
      amountCents: amount,
      summary: `Move ${dollars(amount)} from ${from} to ${to}`,
      steps: [
        { label: "From", value: from },
        { label: "To", value: to },
        { label: "Amount", value: dollars(amount) },
      ],
      details: { fromAccount: from, toAccount: to, amountCents: amount },
    };
  },
  act: async (draft, context) => ({
    externalRef: sandboxRef("sbx_move", context.idempotencyKey),
    state: "done",
    cancelUntil: cancelUntil(context.now),
    note: `${SIMULATED} Move of ${dollars(draft.amountCents)} between your accounts started.`,
  }),
  cancel: async () => true,
};

// Cancelling a subscription, by the route the merchant allows (../cancel/route.ts): the steps for
// the person first, the app store's when it bills the charge, an email only where the merchant
// documents one, a letter where written notice is the way. Moves no money: the amount is 0, and what
// it saves goes in the steps.
const HOW: Record<CancelRoute["channel"], string> = {
  app_store: "In the app store that bills it: only it can cancel this",
  guided: "You, with these steps",
  email: "Jane emails them, the way they accept",
  letter: "Jane sends a letter, the way they ask for",
};

const subscriptionCancel: Connector = {
  id: "sandbox_subscription_cancel",
  name: "Cancel a subscription (sandbox)",
  category: "subscriptions",
  capabilities: ["prefill", "act"],
  scopes: ["cancel_subscriptions"],
  sandbox: true,
  movesMoney: false,
  prefill: (details) => {
    const merchant = text(details, "merchant");
    const monthly = cents(details, "monthlyCents");
    const descriptor = typeof details.descriptor === "string" ? details.descriptor : null;
    const route = cancelRoute({ merchant, descriptor });
    return {
      kind: "cancel_subscription",
      amountCents: 0,
      summary: `Cancel ${route.merchant}`,
      steps: [
        { label: "Cancel", value: route.merchant },
        { label: "Saves", value: `${dollars(monthly)} a month` },
        { label: "How", value: HOW[route.channel] },
        ...(route.email ? [{ label: "Email to", value: route.email }] : []),
        ...route.steps,
      ],
      details: {
        merchant: route.merchant,
        monthlyCents: monthly,
        descriptor,
        channel: route.channel,
        email: route.email,
      },
    };
  },
  act: async (draft, context) => {
    const ref = sandboxRef("sbx_cancel", context.idempotencyKey);
    const merchant = String(draft.details.merchant);
    const channel = draft.details.channel;
    if (channel === "email" || channel === "letter") {
      const sent = channel === "email" ? `An email to ${String(draft.details.email)}` : "A letter";
      return {
        externalRef: ref,
        state: "done",
        cancelUntil: null,
        note: `${SIMULATED} ${sent} asking ${merchant} to cancel.`,
      };
    }
    // Guided and app-store routes: nothing for Jane to send; the steps are the person's.
    return {
      externalRef: ref,
      state: "handed_off",
      cancelUntil: null,
      note: `${SIMULATED} Your steps to cancel ${merchant} are ready.`,
    };
  },
};

// Asking for an insurance quote in the person's name (Coverage Cat or Canopy later). A quote, never
// a purchase: binding a policy stays with the broker.
const insuranceQuote: Connector = {
  id: "sandbox_insurance_quote",
  name: "Insurance quotes (sandbox)",
  category: "insurance",
  capabilities: ["prefill", "act"],
  scopes: ["request_quotes"],
  sandbox: true,
  movesMoney: false,
  prefill: (details) => {
    const coverage = text(details, "coverage");
    const premium = cents(details, "currentMonthlyCents");
    const state = text(details, "state");
    return {
      kind: "insurance_quote",
      amountCents: 0,
      summary: `Ask for ${coverage} insurance quotes`,
      steps: [
        { label: "Coverage", value: coverage },
        { label: "You pay now", value: `${dollars(premium)} a month` },
        { label: "State", value: state },
      ],
      details: { coverage, currentMonthlyCents: premium, state },
    };
  },
  act: async (draft, context) => {
    const current = Number(draft.details.currentMonthlyCents);
    // A sample quote 12% under what they pay, so the page has something to show.
    const quoted = Math.round(current * 0.88);
    return {
      externalRef: sandboxRef("sbx_quote", context.idempotencyKey),
      state: "done",
      cancelUntil: null,
      note: `${SIMULATED} Sample quote: ${dollars(quoted)} a month for ${String(draft.details.coverage)}.`,
    };
  },
};

export const SANDBOX_CONNECTORS: readonly Connector[] = [
  billPay,
  ownTransfer,
  subscriptionCancel,
  insuranceQuote,
  sandboxLetters,
];
