import type { ActorType } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// Every sensitive event goes through logAudit. Add new events here so the log stays
// queryable by a known set of names.
export type AuditEvent = "user_signed_up" | "user_signed_in";

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
