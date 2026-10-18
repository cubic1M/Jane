import type { ActorType } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// Every sensitive event goes through logAudit. Add new events here so the log stays
// queryable by a known set of names.
export type AuditEvent =
  | "user_signed_up"
  | "user_signed_in"
  | "import_completed"
  // Finding data was sent to Claude for card text.
  | "explanations_generated"
  | "decision_made"
  | "decision_undone"
  | "item_linked"
  // Admin tools: every view of user data and every status change.
  | "admin_viewed_queue"
  | "admin_viewed_action"
  | "admin_viewed_metrics"
  | "action_status_changed"
  | "membership_paid"
  | "item_removed"
  | "user_data_deleted"
  | "admin_mfa_enrolled"
  | "admin_mfa_verified"
  | "admin_mfa_failed"
  | "user_made_admin"
  | "invite_code_created"
  | "terms_accepted"
  | "data_exported"
  | "admin_drafted_message";

export type AuditActor = { type: ActorType; id: string | null };

export type AuditTarget = { type: string; id: string } | null;

// Never put secrets (tokens, keys, raw bank data) in metadata.
export type AuditMetadata = Record<string, string | number | boolean | null>;

export const SYSTEM_ACTOR: AuditActor = { type: "system", id: null };

export async function logAudit(
  actor: AuditActor,
  event: AuditEvent,
  target: AuditTarget,
  metadata: AuditMetadata = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id,
      event,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      metadata,
    },
  });
}
