import { createHmac } from "node:crypto";
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

// A webhook like most partners send: HMAC-SHA256 of "<timestamp>.<body>", hex, in its own headers.
export const FAKE_WEBHOOK_SECRET_ENV = "FAKE_CONNECTOR_WEBHOOK_SECRET";
export const fakeWebhook: NonNullable<Connector["webhook"]> = {
  signing: {
    kind: "hmac_sha256",
    secretEnv: FAKE_WEBHOOK_SECRET_ENV,
    signatureHeader: "x-fake-signature",
    timestampHeader: "x-fake-timestamp",
  },
  parse: (body) => {
    const event = body as { id?: unknown; ref?: unknown; outcome?: unknown };
    if (typeof event.ref !== "string") return null;
    const outcome = ["done", "failed", "reversed", "undone", "info"].includes(String(event.outcome))
      ? (event.outcome as "done" | "failed" | "reversed" | "undone" | "info")
      : "info";
    return {
      eventId: typeof event.id === "string" ? event.id : "",
      externalRef: event.ref,
      outcome,
      note: `The partner said ${outcome}`,
    };
  },
};

export function signedHeaders(rawBody: string, secret: string, at = new Date()): Headers {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return new Headers({ "x-fake-timestamp": timestamp, "x-fake-signature": signature });
}
