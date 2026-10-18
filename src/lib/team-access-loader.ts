import { TEAM_ACCESS_PAGE_LIMIT } from "@/config/team-access";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { SHOWN_EVENTS, teamAccessEntries, type TeamAccessEntry } from "@/lib/team-access";

// Who saw my data (spec step 74): when the concierge team or Jane's agent viewed or acted
// on the person's data, from the audit log. audit_log isn't a user-owned table, so the
// query names the person itself, and teamAccessEntries checks every row again.

const titleOf = (snapshot: unknown) => {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "Your request";
};

// The company the agent writes to, as the finding names it (src/lib/agent/run.ts also
// looks up the bank for bank fees; here those just say "the company").
const companyOf = (evidence: unknown) => {
  const merchant = (evidence as { merchant?: unknown } | null)?.merchant;
  return typeof merchant === "string" && merchant.trim() ? merchant : null;
};

export async function teamAccessFor(
  userId: string,
  {
    client = defaultClient,
    // Null for every entry ("Download my data").
    limit = TEAM_ACCESS_PAGE_LIMIT,
  }: { client?: PrismaClient; limit?: number | null } = {},
): Promise<TeamAccessEntry[]> {
  const actions = await scopedFor(userId, client).actions.findMany({
    select: {
      id: true,
      decision: { select: { cardSnapshot: true, finding: { select: { evidence: true } } } },
    },
  });
  const rows = await client.auditLog.findMany({
    where: {
      event: { in: SHOWN_EVENTS },
      actorType: { in: ["admin", "system"] },
      AND: [
        // Not their own doing as an admin. (A plain NOT would also drop the agent's rows,
        // whose actor id is null.)
        { OR: [{ actorId: null }, { actorId: { not: userId } }] },
        {
          OR: [
            // Queue views name the person (one entry per person shown).
            { targetType: "user", targetId: userId },
            { targetType: "action", targetId: { in: actions.map((a) => a.id) } },
            // Actions since undone are gone, but their events still carry the person's id.
            { targetType: "action", metadata: { path: ["user_id"], equals: userId } },
          ],
        },
      ],
    },
    select: {
      id: true,
      event: true,
      actorType: true,
      actorId: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(limit === null ? {} : { take: limit }),
  });
  const entries = teamAccessEntries(rows, {
    userId,
    actions: new Map(
      actions.map((a) => [
        a.id,
        {
          title: titleOf(a.decision.cardSnapshot),
          company: companyOf(a.decision.finding.evidence),
        },
      ]),
    ),
  });
  return limit === null ? entries : entries.slice(0, limit);
}
