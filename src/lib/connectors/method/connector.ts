import { METHOD } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import type { Connector, LinkEvent } from "../types";
import { storeCredential, withCredential } from "../vault";
import { methodHttp } from "./api";
import { methodReads } from "./normalize";
import { sampleAccounts } from "./sample";
import { saveMethodReads } from "./save";

// Method (read connectors, batch 2; docs.methodfi.com, read 2026-11-19): a person's loans and cards,
// federal student loans included, found through a soft-pull credit report on their verified
// identity rather than a bank sign-in, into Jane's own accounts and liabilities, so the Loans pages,
// the payoff planner and the student-loan cards read them like Plaid's. Read only; Method's payments
// are never used.
//
// Two registrations. The real one asks for the person's soft credit pull (`soft_credit_pull`, an
// FCRA written instruction): an exact-text scope with no approved text here, so nobody can consent to
// it until Method's and counsel's words are added, and it reaches nobody until
// REAL_CONNECTORS.method_liabilities. Its entity (the verified person at Method) is kept in the vault;
// creating and verifying it, and the Connect, aren't built: they need the person's identity and that
// consent. The sandbox twin reads Method's own documented examples for sample data.

const ENTITY = /^\/entities\/(ent_[A-Za-z0-9]+)\/connect\//;

// Method's webhook body: { id, type, op, path }. A Connect completed or updated is fresh data for
// that entity (Jane's link id). Account and payment events carry no entity: ignored here.
export function parseMethodEvent(body: unknown): LinkEvent | null {
  const event = (body ?? {}) as { id?: unknown; type?: unknown; path?: unknown };
  const match = typeof event.path === "string" ? ENTITY.exec(event.path) : null;
  if (!match?.[1] || (event.type !== "connect.available" && event.type !== "connect.update")) {
    return null;
  }
  return {
    kind: "link",
    eventId: typeof event.id === "string" ? `${event.type}:${event.id}` : "",
    linkRef: match[1],
    change: "refreshed",
  };
}

async function credentialId(userId: string, connectorId: string, client: PrismaClient) {
  const row = await scopedFor(userId, client).connectorCredentials.findUniqueOrThrow({
    where: { userId_connectorId: { userId, connectorId } },
    select: { id: true },
  });
  return row.id;
}

export const methodLiabilities: Connector = {
  id: "method_liabilities",
  name: "Your loans and cards from your credit report, through Method",
  from: "Your credit report, through Method (read only: it can't make a payment)",
  category: "credit",
  capabilities: ["read"],
  scopes: ["read_credit", "soft_credit_pull"],
  sandbox: false,
  movesMoney: false,
  read: async ({ userId, client, now }) =>
    withCredential(
      userId,
      "method_liabilities",
      async (entityId) =>
        saveMethodReads(
          userId,
          await credentialId(userId, "method_liabilities", client),
          methodReads(await methodHttp().liabilities(entityId)),
          { client },
        ),
      { client, now },
    ),
  webhook: {
    signing: {
      kind: "hmac_sha256",
      secretEnv: METHOD.webhookSecretEnv,
      signatureHeader: METHOD.signatureHeader,
      timestampHeader: METHOD.timestampHeader,
      separator: ":",
    },
    parse: parseMethodEvent,
  },
};

export const sandboxMethodLiabilities: Connector = {
  id: "sandbox_method_liabilities",
  name: "Your loans and cards from your credit report, through Method (sandbox)",
  from: "Sample loans and cards (Method's own examples)",
  category: "credit",
  capabilities: ["read"],
  scopes: ["read_credit"],
  sandbox: true,
  movesMoney: false,
  read: async ({ userId, client, now }) => {
    // The twin's own connection, so revoking it takes these accounts back like the real one.
    await storeCredential(userId, "sandbox_method_liabilities", "sandbox-entity", { client });
    return saveMethodReads(
      userId,
      await credentialId(userId, "sandbox_method_liabilities", client),
      methodReads(sampleAccounts(await todayOf(userId, { client, now }))),
      { client },
    );
  },
};
