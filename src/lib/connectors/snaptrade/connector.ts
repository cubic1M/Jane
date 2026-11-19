import { SNAPTRADE } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import type { Connector, LinkEvent } from "../types";
import { storeCredential, withCredential } from "../vault";
import { snaptradeHttp, type SnaptradeApi, type SnaptradeUser } from "./api";
import { readable, snaptradeRead } from "./normalize";
import { sampleAccount, samplePositions } from "./sample";
import { saveSnaptradeReads } from "./save";

// SnapTrade (read connectors, batch 2; docs.snaptrade.com, read 2026-11-19): a person's brokerage
// holdings, read only, into Jane's own investment accounts, securities and holdings, so the investing
// pages and detectors read them like Plaid Investments'. Never trades: the Connection Portal is asked
// for a "read" connection, and nothing here places, previews or cancels an order.
//
// Two registrations. The real one reaches nobody until REAL_CONNECTORS.snaptrade_holdings; its
// SnapTrade user (an id Jane makes up, and SnapTrade's secret for it) is kept in the vault, with the
// id as the link's ref for SnapTrade's webhooks. The sandbox twin reads SnapTrade's own documented
// examples for sample data.

type Events = Record<string, LinkEvent["change"]>;
const EVENTS: Events = {
  CONNECTION_ADDED: "refreshed",
  NEW_ACCOUNT_AVAILABLE: "refreshed",
  ACCOUNT_HOLDINGS_UPDATED: "refreshed",
  CONNECTION_BROKEN: "disconnected",
  CONNECTION_FIXED: "reconnected",
};

// SnapTrade's webhook body: { webhookId, userId, eventType, eventTimestamp, ... }. Found by the
// SnapTrade user (Jane's link ref). Its deprecated `webhookSecret` field is never read.
export function parseSnaptradeEvent(body: unknown): LinkEvent | null {
  const event = (body ?? {}) as { webhookId?: unknown; userId?: unknown; eventType?: unknown };
  const change = typeof event.eventType === "string" ? EVENTS[event.eventType] : undefined;
  if (!change || typeof event.userId !== "string" || !event.userId) return null;
  return {
    kind: "link",
    eventId: typeof event.webhookId === "string" ? event.webhookId : "",
    linkRef: event.userId,
    change,
  };
}

async function credentialId(userId: string, connectorId: string, client: PrismaClient) {
  const row = await scopedFor(userId, client).connectorCredentials.findUniqueOrThrow({
    where: { userId_connectorId: { userId, connectorId } },
    select: { id: true },
  });
  return row.id;
}

export const userOf = (secret: string): SnaptradeUser => {
  const parsed = JSON.parse(secret) as Partial<SnaptradeUser>;
  return { userId: String(parsed.userId ?? ""), userSecret: String(parsed.userSecret ?? "") };
};

async function readAll(api: SnaptradeApi, user: SnaptradeUser) {
  const accounts = (await api.accounts(user)).filter(readable);
  const reads = [];
  for (const account of accounts) {
    reads.push(snaptradeRead(account, await api.positions(user, account.id)));
  }
  return reads;
}

export const snaptradeHoldings: Connector = {
  id: "snaptrade_holdings",
  name: "Your brokerage holdings, read only, through SnapTrade",
  category: "investing",
  capabilities: ["read"],
  scopes: ["read_holdings"],
  sandbox: false,
  movesMoney: false,
  read: async ({ userId, client, now }) =>
    withCredential(
      userId,
      "snaptrade_holdings",
      async (secret) =>
        saveSnaptradeReads(
          userId,
          await credentialId(userId, "snaptrade_holdings", client),
          await readAll(snaptradeHttp(), userOf(secret)),
          { client },
        ),
      { client, now },
    ),
  webhook: {
    signing: {
      kind: "canonical_json_hmac",
      secretEnv: SNAPTRADE.consumerKeyEnv,
      header: SNAPTRADE.signatureHeader,
      timestampField: "eventTimestamp",
    },
    parse: parseSnaptradeEvent,
  },
};

export const sandboxSnaptradeHoldings: Connector = {
  id: "sandbox_snaptrade_holdings",
  name: "Your brokerage holdings, read only, through SnapTrade (sandbox)",
  category: "investing",
  capabilities: ["read"],
  scopes: ["read_holdings"],
  sandbox: true,
  movesMoney: false,
  read: async ({ userId, client, now }) => {
    // The twin's own connection, so revoking it takes these accounts back like the real one.
    await storeCredential(userId, "sandbox_snaptrade_holdings", "sandbox-user", { client });
    return saveSnaptradeReads(
      userId,
      await credentialId(userId, "sandbox_snaptrade_holdings", client),
      [snaptradeRead(sampleAccount(), samplePositions(await todayOf(userId, { client, now })))],
      { client },
    );
  },
};
