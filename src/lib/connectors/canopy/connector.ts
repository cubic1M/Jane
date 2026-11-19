import { scopedFor } from "@/lib/db-scoped";
import { CANOPY } from "@/config/connectors";
import type { Connector, LinkEvent } from "../types";
import { withCredential } from "../vault";
import { canopyHttp } from "./api";
import { todayOf } from "@/lib/today";
import { samplePull } from "./sample";
import { savePull } from "./save";

// Canopy Connect (read connectors, 11-18; docs.usecanopy.com/reference, read 2026-11-17): reads the
// auto, home, renters and other personal policies a person has with their insurer, and their
// renewal dates, into Jane's insurance. Read only: Jane never changes a policy through it.
//
// Two registrations. The real one calls Canopy with the team's keys and the person's pull id (kept
// in the vault, set when they finish Canopy's hosted link); it reaches nobody until
// REAL_CONNECTORS.canopy_connect, which needs a signed agreement and counsel on its "no services to
// third parties" clause. The sandbox twin reads Canopy's own documented example for sample-data
// people, so the renewal reshop runs end to end on sample data.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Canopy's webhook body (WebhookBody in its OpenAPI): event_type and pull_id. All data ready, or
// updated, is fresh data for the link; MONITORING_RECONNECT means the person must sign in again.
// Anything else (AUTH_STATUS, ERROR, one policy at a time) is ignored. No event id: replays are
// caught by the body's hash.
export function parseCanopyEvent(body: unknown): LinkEvent | null {
  const event = (body ?? {}) as { event_type?: unknown; pull_id?: unknown };
  if (typeof event.pull_id !== "string" || !UUID.test(event.pull_id)) return null;
  const change =
    event.event_type === "COMPLETE" ||
    event.event_type === "POLICIES_AVAILABLE" ||
    event.event_type === "DATA_UPDATED"
      ? "refreshed"
      : event.event_type === "MONITORING_RECONNECT"
        ? "disconnected"
        : null;
  return change ? { kind: "link", eventId: "", linkRef: event.pull_id, change } : null;
}

export const canopyConnect: Connector = {
  id: "canopy_connect",
  name: "Your insurance policies, through Canopy Connect",
  from: "Your insurer, through Canopy Connect (read only: it can't change a policy)",
  category: "insurance",
  capabilities: ["read"],
  scopes: ["read_policies"],
  sandbox: false,
  movesMoney: false,
  // Revoked: the policies it brought in go (source "canopy").
  forget: async ({ userId, client }) =>
    (await scopedFor(userId, client).insurancePolicies.deleteMany({ where: { source: "canopy" } }))
      .count,
  read: ({ userId, client, now }) =>
    withCredential(
      userId,
      "canopy_connect",
      async (pullId) => savePull(userId, await canopyHttp().getPull(pullId), { client }),
      { client, now },
    ),
  webhook: {
    signing: {
      kind: "hmac_sha256_tv",
      secretEnv: CANOPY.webhookSecretEnv,
      header: CANOPY.signatureHeader,
      field: "s",
    },
    parse: parseCanopyEvent,
  },
};

export const sandboxCanopyConnect: Connector = {
  id: "sandbox_canopy_connect",
  name: "Your insurance policies, through Canopy Connect (sandbox)",
  from: "Sample insurance policies (Canopy's own example)",
  category: "insurance",
  capabilities: ["read"],
  scopes: ["read_policies"],
  sandbox: true,
  movesMoney: false,
  // Revoked: the policies it brought in go (source "canopy").
  forget: async ({ userId, client }) =>
    (await scopedFor(userId, client).insurancePolicies.deleteMany({ where: { source: "canopy" } }))
      .count,
  read: async ({ userId, client, now }) =>
    savePull(userId, samplePull(await todayOf(userId, { client, now })), { client }),
};
