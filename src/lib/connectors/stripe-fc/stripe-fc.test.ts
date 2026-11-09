import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STRIPE_FC } from "@/config/connectors";
import { definitionProblems, whyUnavailable } from "../registry";
import { signatureValid } from "../webhooks";
import { STRIPE_FC_SIGNING, parseStripeFcEvent, stripeFc } from "./connector";
import { balanceRefreshDue, historyFrom, sameBankAccount } from "./refresh";

// Connectors roadmap round 20: Stripe Financial Connections, registered and off.

const NOW = new Date("2026-11-06T12:00:00Z");

describe("the stripe_fc connector", () => {
  it("is real, read only, moves no money, and is off for everyone until its switch", () => {
    expect(definitionProblems(stripeFc)).toEqual([]);
    expect(stripeFc).toMatchObject({ sandbox: false, movesMoney: false, capabilities: ["read"] });
    expect(
      whyUnavailable(stripeFc, { userId: "user_real", sampleData: false }, { CONNECTORS: "1" }),
    ).toBe("switched_off");
    expect(
      whyUnavailable(stripeFc, { userId: "trial_abc", sampleData: true }, { CONNECTORS: "1" }),
    ).toBe("trial");
  });

  it("checks Stripe's t=,v1= signature with the existing signing kind", () => {
    const secret = "test-signing-value-not-a-key";
    const body = JSON.stringify({
      id: "evt_1",
      type: "financial_connections.account.refreshed_transactions",
    });
    const t = Math.floor(NOW.getTime() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const env = { [STRIPE_FC.secretEnv]: secret };
    const signed = new Headers({ "Stripe-Signature": `t=${t},v1=${v1}` });
    expect(signatureValid(STRIPE_FC_SIGNING, body, signed, { env, now: NOW })).toBe(true);
    expect(signatureValid(STRIPE_FC_SIGNING, `${body} `, signed, { env, now: NOW })).toBe(false);
    // Without the secret set, nothing is believed.
    expect(signatureValid(STRIPE_FC_SIGNING, body, signed, { env: {}, now: NOW })).toBe(false);
  });
});

describe("refreshing", () => {
  it("asks for a balance at most weekly, since each call costs", () => {
    expect(balanceRefreshDue(null, NOW)).toBe(true);
    expect(balanceRefreshDue(new Date("2026-11-01T12:00:00Z"), NOW)).toBe(false);
    expect(balanceRefreshDue(new Date("2026-10-30T12:00:00Z"), NOW)).toBe(true);
  });

  it("can reach 180 days of history", () => {
    expect(historyFrom(NOW)).toBe("2026-05-10");
  });
});

describe("the same account through Plaid and Stripe", () => {
  it("is the same bank, the same last four and the same kind", () => {
    const plaid = { institution: "Chase", mask: "4417", type: "depository" };
    expect(
      sameBankAccount(plaid, {
        institution: "JPMorgan Chase Bank, N.A.".replace("JPMorgan ", ""),
        mask: "4417",
        type: "depository",
      }),
    ).toBe(true);
    expect(sameBankAccount(plaid, { institution: "Chase", mask: "9012", type: "depository" })).toBe(
      false,
    );
    expect(sameBankAccount(plaid, { institution: "Chase", mask: "4417", type: "credit" })).toBe(
      false,
    );
    expect(
      sameBankAccount(plaid, { institution: "Wells Fargo", mask: "4417", type: "depository" }),
    ).toBe(false);
    // Without a mask, never assumed the same.
    expect(sameBankAccount({ ...plaid, mask: null }, { ...plaid, mask: null })).toBe(false);
  });
});

describe("Stripe's Financial Connections events", () => {
  const event = (type: string, object: Record<string, unknown> = {}) => ({
    id: "evt_123",
    type,
    data: { object: { id: "fca_abc", ...object } },
  });

  it("are link events on the account they name", () => {
    expect(parseStripeFcEvent(event("financial_connections.account.disconnected"))).toEqual({
      kind: "link",
      eventId: "evt_123",
      linkRef: "fca_abc",
      change: "disconnected",
    });
    expect(parseStripeFcEvent(event("financial_connections.account.deactivated"))?.change).toBe(
      "disconnected",
    );
    expect(parseStripeFcEvent(event("financial_connections.account.reactivated"))?.change).toBe(
      "reconnected",
    );
  });

  it("count a refresh only when it succeeded", () => {
    const ok = { transaction_refresh: { status: "succeeded" } };
    expect(
      parseStripeFcEvent(event("financial_connections.account.refreshed_transactions", ok))?.change,
    ).toBe("refreshed");
    expect(
      parseStripeFcEvent(
        event("financial_connections.account.refreshed_transactions", {
          transaction_refresh: { status: "failed" },
        }),
      ),
    ).toBeNull();
    expect(
      parseStripeFcEvent(
        event("financial_connections.account.refreshed_balance", {
          balance_refresh: { status: "succeeded" },
        }),
      )?.change,
    ).toBe("refreshed");
    expect(parseStripeFcEvent(event("financial_connections.account.refreshed_balance"))).toBeNull();
  });

  it("ignore anything else, or an object that isn't a Financial Connections account", () => {
    expect(parseStripeFcEvent(event("financial_connections.account.created"))).toBeNull();
    expect(parseStripeFcEvent(event("payment_intent.succeeded"))).toBeNull();
    expect(
      parseStripeFcEvent({
        id: "evt_1",
        type: "financial_connections.account.disconnected",
        data: { object: { id: "cus_1" } },
      }),
    ).toBeNull();
    expect(parseStripeFcEvent(null)).toBeNull();
    expect(stripeFc.webhook?.signing).toBe(STRIPE_FC_SIGNING);
  });
});
