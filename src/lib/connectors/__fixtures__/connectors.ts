import type { ActContext, ActionDetails, ActionDraft, Connector } from "../types";

// Fake connectors for the framework's own tests: one that pretends to be a real partner (never
// registered outside tests) and one sandbox. Each records the calls that reached it.

export type FakeCalls = { act: ActContext[]; cancel: string[] };

const draftOf = (details: ActionDetails): ActionDraft => {
  const cents = typeof details.amountCents === "number" ? details.amountCents : 0;
  return {
    kind: "pay_bill",
    amountCents: cents,
    summary: `Pay ${String(details.payee ?? "a bill")} $${(cents / 100).toFixed(2)}`,
    steps: [
      { label: "Pay to", value: String(details.payee ?? "") },
      { label: "Amount", value: `$${(cents / 100).toFixed(2)}` },
    ],
    details,
  };
};

export function fakeConnector(overrides: Partial<Connector> = {}): {
  connector: Connector;
  calls: FakeCalls;
} {
  const calls: FakeCalls = { act: [], cancel: [] };
  const connector: Connector = {
    id: "fake_bills",
    name: "Fake Bills",
    category: "bills",
    capabilities: ["prefill", "act"],
    scopes: ["pay_bills"],
    sandbox: false,
    movesMoney: true,
    prefill: draftOf,
    act: async (_draft, context) => {
      calls.act.push(context);
      return {
        externalRef: `ext_${context.actionId}`,
        state: "pending",
        cancelUntil: null,
        note: "Sent",
      };
    },
    cancel: async (externalRef) => {
      calls.cancel.push(externalRef);
      return true;
    },
    ...overrides,
  };
  return { connector, calls };
}

export const fakeSandbox = (overrides: Partial<Connector> = {}) =>
  fakeConnector({ id: "fake_sandbox", name: "Fake Sandbox", sandbox: true, ...overrides });
