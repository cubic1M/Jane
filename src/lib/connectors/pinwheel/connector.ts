import { PINWHEEL } from "@/config/connectors";
import { saveBenefitsFromStub } from "@/lib/insurance/benefits";
import type { Paystub } from "@/lib/insurance/payroll";
import { todayOf } from "@/lib/today";
import type { Connector, LinkEvent, ReadResult } from "../types";
import { storeCredential, withCredential } from "../vault";
import { pinwheelHttp } from "./api";
import { pinwheelPaystubs } from "./normalize";
import { PINWHEEL_DOCS_EMPLOYMENT, samplePaystubs } from "./sample";

// Pinwheel (read connectors, batch 2; docs.pinwheelapi.com, read 2026-11-19): a person's employer and
// newest pay stubs through their payroll login. What the stub shows comes out of pay for cover through
// work (health, dental, vision, life, disability, HSA, FSA) is saved as found benefits, the same way
// the demo's stub is (src/lib/insurance/benefits.ts), for the person to confirm. Read only: Pinwheel's
// direct-deposit switching is never used.
//
// Two registrations. The real one reaches nobody until REAL_CONNECTORS.pinwheel_payroll; it reads the
// connected payroll account kept in the vault (its id is the link's ref for Pinwheel's webhooks). Link
// (Pinwheel's modal, and keeping the account from its account.added event) isn't built. The sandbox
// twin reads Pinwheel's own documented employment and pay stub for sample data.

const FRESH = new Set([
  "paystubs.added",
  "paystubs.seven_days_synced",
  "paystubs.fully_synced",
  "employment.added",
]);

// Pinwheel's webhook body: { event, event_id, payload: { account_id, outcome, ... } }. Fresh pay stubs
// or employment for that account read again; anything else is ignored.
export function parsePinwheelEvent(body: unknown): LinkEvent | null {
  const event = (body ?? {}) as {
    event?: unknown;
    event_id?: unknown;
    payload?: { account_id?: unknown; outcome?: unknown };
  };
  const account = event.payload?.account_id;
  if (typeof event.event !== "string" || !FRESH.has(event.event)) return null;
  if (typeof account !== "string" || !account || event.payload?.outcome === "error") return null;
  return {
    kind: "link",
    eventId: typeof event.event_id === "string" ? event.event_id : "",
    linkRef: account,
    change: "refreshed",
  };
}

async function save(
  userId: string,
  stubs: Paystub[],
  { client, demo }: Parameters<typeof saveBenefitsFromStub>[2],
): Promise<ReadResult> {
  const [newest] = stubs;
  if (!newest) return { saved: 0, note: "No pay stubs found yet." };
  const found = await saveBenefitsFromStub(userId, newest, { client, demo });
  return {
    saved: found,
    note:
      found === 0
        ? `Your pay stub from ${newest.employer} shows no new benefits through work.`
        : `${found} ${found === 1 ? "benefit" : "benefits"} through ${newest.employer} found on your pay stub, for you to check.`,
  };
}

export const pinwheelPayroll: Connector = {
  id: "pinwheel_payroll",
  name: "Your pay stubs and employer, through Pinwheel",
  category: "payroll",
  capabilities: ["read"],
  scopes: ["read_pay"],
  sandbox: false,
  movesMoney: false,
  read: async ({ userId, client, now }) =>
    withCredential(
      userId,
      "pinwheel_payroll",
      async (secret) => {
        const accountId = String((JSON.parse(secret) as { accountId?: unknown }).accountId ?? "");
        const api = pinwheelHttp();
        const [employment, stubs] = await Promise.all([
          api.employment(accountId),
          api.paystubs(accountId),
        ]);
        return save(userId, pinwheelPaystubs(employment, stubs), { client, demo: false });
      },
      { client, now },
    ),
  webhook: {
    signing: {
      kind: "pinwheel_v2",
      secretEnv: PINWHEEL.apiSecretEnv,
      header: PINWHEEL.signatureHeader,
      timestampHeader: PINWHEEL.timestampHeader,
    },
    parse: parsePinwheelEvent,
  },
};

export const sandboxPinwheelPayroll: Connector = {
  id: "sandbox_pinwheel_payroll",
  name: "Your pay stubs and employer, through Pinwheel (sandbox)",
  category: "payroll",
  capabilities: ["read"],
  scopes: ["read_pay"],
  sandbox: true,
  movesMoney: false,
  read: async ({ userId, client, now }) => {
    // The twin's own connection, so revoking it is like the real one.
    await storeCredential(userId, "sandbox_pinwheel_payroll", "sandbox-account", { client });
    const stubs = samplePaystubs(await todayOf(userId, { client, now }));
    return save(userId, pinwheelPaystubs(PINWHEEL_DOCS_EMPLOYMENT, stubs), { client, demo: true });
  },
};
