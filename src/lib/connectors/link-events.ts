import type { PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { LinkEvent } from "./types";

// What a partner's word about a person's link does (connectors roadmap round 4, "connection-level
// events routed to the link, not an action"): a broken link is marked to reconnect, a working one
// active again, fresh data stamped. Only through the person's own door, and audited.
export async function applyLinkEvent(
  userId: string,
  connectorId: string,
  change: LinkEvent["change"],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<void> {
  const data =
    change === "disconnected"
      ? { status: "needs_relink" }
      : change === "reconnected"
        ? { status: "active" }
        : { refreshedAt: now };
  await scopedFor(userId, client).connectorCredentials.updateMany({ where: { connectorId }, data });
  await logAudit(
    SYSTEM_ACTOR,
    "connector_link_changed",
    { type: "user", id: userId },
    { connector: connectorId, change },
  );
}
