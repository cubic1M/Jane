import { STANDING_AREAS } from "@/config/agent-rollout";
import { SECTORS, type Sector } from "@/config/autopilot-sectors";
import { RULE_DEFAULT_MONTHLY_LIMIT } from "@/config/rules";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PermissionRefused } from "@/lib/permission/check";
import { sectorAutopilots, setSectorAutopilot } from "@/lib/sector-autopilot";

// One tap per area (Stage 2): "handle it, under this limit" or back to "ask me", on the levels and
// caps that already exist (src/lib/sector-autopilot.ts). Real accounts stay read-only: both refuse.
// Whether a person hands an area over is the number the roadmap calls authority granted.

type Options = { client?: PrismaClient; now?: Date };

export type StandingArea = (typeof STANDING_AREAS)[number] & {
  on: boolean;
  usedThisMonthCents: number;
};

export async function standingAreas(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StandingArea[]> {
  const settings = await sectorAutopilots(userId, { client, now });
  return STANDING_AREAS.map((area) => {
    const setting = settings.find((s) => s.sector === area.sector)!;
    return {
      ...area,
      on: setting.level !== "ask",
      actionCapCents: setting.level !== "ask" ? setting.actionCapCents : area.actionCapCents,
      monthlyCapCents: setting.level !== "ask" ? setting.monthlyCapCents : area.monthlyCapCents,
      usedThisMonthCents: setting.usedThisMonthCents,
    };
  });
}

const areaOf = (sector: Sector) => STANDING_AREAS.find((a) => a.sector === sector)!;

// Only the rules this area turns on.
async function setRules(userId: string, sector: Sector, enabled: boolean, client: PrismaClient) {
  const db = scopedFor(userId, client);
  for (const key of areaOf(sector).rules) {
    await db.standingRules.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, enabled, monthlyLimit: RULE_DEFAULT_MONTHLY_LIMIT },
      update: { enabled },
    });
  }
}

export async function grantArea(
  userId: string,
  sector: Sector,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (!(await conciergeMode(userId, { client }))) throw new PermissionRefused("read_only");
  const user = await client.user.findUnique({ where: { id: userId }, select: { autopilot: true } });
  const db = scopedFor(userId, client);
  // Someone who had no level yet: this tap is the only thing they've handed over, so every other
  // area is written down as "ask", or "custom" would turn them on by default.
  if (user?.autopilot !== "safe" && user?.autopilot !== "all" && user?.autopilot !== "custom") {
    const others = SECTORS.filter((s) => s !== sector);
    await db.autopilotSectors.createMany({
      data: others.map((s) => ({
        userId,
        sector: s,
        level: "ask",
        actionCapCents: 0,
        monthlyCapCents: 0,
      })),
      skipDuplicates: true,
    });
    await client.user.update({ where: { id: userId }, data: { autopilot: "custom" } });
  }
  const area = areaOf(sector);
  await setSectorAutopilot(
    userId,
    sector,
    {
      level: "safe",
      actionCapCents: area.actionCapCents,
      monthlyCapCents: area.monthlyCapCents,
    },
    { client, now },
  );
  await setRules(userId, sector, true, client);
  await logAudit(
    { type: "user", id: userId },
    "standing_permission_granted",
    { type: "user", id: userId },
    { sector, action_cap_cents: area.actionCapCents, monthly_cap_cents: area.monthlyCapCents },
  );
  await track(userId, "standing_permission_granted", { sector });
}

// Back to asking. Nothing new runs under it; what's in its undo window can still be taken back.
export async function revokeArea(
  userId: string,
  sector: Sector,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { autopilot: true } });
  if (user?.autopilot && user.autopilot !== "ask") {
    await setSectorAutopilot(
      userId,
      sector,
      { level: "ask", actionCapCents: 0, monthlyCapCents: 0 },
      { client, now },
    );
  }
  await setRules(userId, sector, false, client);
  await logAudit(
    { type: "user", id: userId },
    "standing_permission_revoked",
    { type: "user", id: userId },
    { sector },
  );
  await track(userId, "standing_permission_revoked", { sector });
}
