import { AGENT_FIRST_TYPES, agentRehearsal } from "@/config/agent-rollout";
import { SECTOR_LABELS, type Sector } from "@/config/autopilot-sectors";
import { specialistInfo, YES_CAP_CENTS, type SpecialistKey } from "@/config/specialists";
import type { ActionType, DecisionSource, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { mayAct } from "@/lib/sector-autopilot";
import { isSimulated, realSpecialistOn } from "@/lib/specialists/registry";
import { withGrant } from "./gate";
import { actsStopped } from "./stop";

// The one permission check every connector and the email agent must pass before acting. It asks, in
// order: has the person stopped everything; may this person have this specialist at all (real
// accounts stay read-only until a licensed partner, counsel and the flags say otherwise); is there
// their yes, or a standing limit that covers it; does it fit the cap; is there an undo window.
// Allowed or refused, it writes to audit_log. Allowed, it writes the act to the record of what Jane
// did (jane_acts). Connectors can't be called outside it (./gate.ts).

export type Authority =
  // The person's own yes. With a decision, it must still stand.
  | { kind: "yes"; because?: string; decisionId?: string }
  // A standing limit they set: their level and caps for this sector.
  | { kind: "standing"; sector: Sector; needs: "safe" | "all" };

export type Undo =
  // Until when it can be taken back, and where.
  | { kind: "window"; until: Date; href?: string }
  // It waited out its hold (AGENT_HOLD_HOURS): the time to take it back runs until then.
  | { kind: "held"; until: Date }
  // Nothing to take back (a simulated fill). Never enough for a real specialist on a standing limit.
  | { kind: "none"; why: string };

export type ActRequest = {
  specialist: SpecialistKey;
  // What Jane is about to do, in the person's words.
  what: string;
  sector: string;
  // What it moves or commits, in cents; 0 for an email.
  cents: number;
  authority: Authority;
  undo: Undo;
  // The agent's action this is part of, and what the rollout asks about it.
  agent?: { actionId: string; actionType: ActionType; source: DecisionSource };
};

export type RefuseReason =
  | "stopped"
  | "read_only"
  | "no_yes"
  | "level"
  | "action_cap"
  | "monthly_cap"
  | "over_cap"
  | "no_undo"
  | "not_yet";

export type Verdict =
  | { ok: true; simulated: boolean; why: string; undoUntil: Date | null }
  | { ok: false; reason: RefuseReason };

const REFUSED_WORDS: Record<RefuseReason, string> = {
  stopped: "You've stopped everything Jane does. Turn it back on to go ahead.",
  read_only: "Jane only reads real accounts for now, so that's yours to do.",
  no_yes: "That needs your yes first.",
  level: "That's more than you've let Jane do on its own.",
  action_cap: "That's over your limit for one action.",
  monthly_cap: "That's over your limit for this month.",
  over_cap: "That's over what Jane can do in one go.",
  no_undo: "Jane can't do that on its own without a way to undo it.",
  not_yet: "Jane doesn't handle that kind of request yet, so that's yours to do.",
};

export class PermissionRefused extends Error {
  constructor(readonly reason: RefuseReason) {
    super(REFUSED_WORDS[reason]);
    this.name = "PermissionRefused";
  }
}

type Options = { client?: PrismaClient; now?: Date };

// Whether the person may have this specialist: a stand-in for the demo bank and sample people, a
// real one only when it's on. Everyone else is read-only.
async function allowedFor(userId: string, key: SpecialistKey, client: PrismaClient) {
  if (specialistInfo(key).kind === "real") return realSpecialistOn(key);
  return (await conciergeMode(userId, { client })) || (await adviceMode(userId, { client }));
}

// How the email agent starts on real accounts (src/config/agent-rollout.ts): low-risk requests first,
// one yes per action, and a rule's yes only with the area handed over and its hold waited out.
async function rolloutRefusal(
  userId: string,
  request: ActRequest,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<RefuseReason | null> {
  const { agent, undo } = request;
  if (!agent) return null;
  if (!AGENT_FIRST_TYPES.includes(agent.actionType)) return "not_yet";
  if (agent.source !== "rule" && agent.source !== "auto") return null;
  const may = await mayAct(userId, "bills", { needs: "safe", cents: 0 }, { client, now });
  if (!may.ok) return may.reason === "stopped" ? "stopped" : "level";
  return undo.kind === "held" && undo.until.getTime() <= now.getTime() ? null : "no_undo";
}

// The check alone: no side effects. throughPermission is the only way to act on it.
export async function checkPermission(
  userId: string,
  request: ActRequest,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Verdict> {
  const info = specialistInfo(request.specialist);
  if (await actsStopped(userId, { client })) return { ok: false, reason: "stopped" };
  if (!(await allowedFor(userId, request.specialist, client))) {
    return { ok: false, reason: "read_only" };
  }
  if (info.kind === "real" || agentRehearsal()) {
    const refusal = await rolloutRefusal(userId, request, { client, now });
    if (refusal) return { ok: false, reason: refusal };
  }
  const { authority, undo } = request;
  const hasWindow = undo.kind === "window" && undo.until.getTime() > now.getTime();
  let why: string;
  if (authority.kind === "yes") {
    if (authority.decisionId) {
      const decision = await scopedFor(userId, client).decisions.findFirst({
        where: { id: authority.decisionId, choice: "yes", undoneAt: null },
        select: { id: true },
      });
      if (!decision) return { ok: false, reason: "no_yes" };
    }
    if (request.cents > YES_CAP_CENTS[info.kind]) return { ok: false, reason: "over_cap" };
    why = authority.because ?? "You said yes.";
  } else {
    const may = await mayAct(
      userId,
      authority.sector,
      { needs: authority.needs, cents: request.cents },
      { client, now },
    );
    if (!may.ok) return { ok: false, reason: may.reason === "stopped" ? "stopped" : may.reason };
    // Always with an undo window; a stand-in has nothing real to take back.
    if (!hasWindow && undo.kind !== "held" && info.kind === "real") {
      return { ok: false, reason: "no_undo" };
    }
    why = `${SECTOR_LABELS[authority.sector]} is on your autopilot, and this was within the limits you set.`;
  }
  return {
    ok: true,
    simulated: isSimulated(request.specialist, userId),
    why,
    undoUntil: hasWindow && undo.kind === "window" ? undo.until : null,
  };
}

// Runs an act only if the check passes. Audited either way, and on the record once allowed.
export async function throughPermission<T>(
  userId: string,
  request: ActRequest,
  { client = defaultClient, now = new Date() }: Options,
  act: () => Promise<T>,
): Promise<T> {
  const verdict = await checkPermission(userId, request, { client, now });
  const about = {
    user_id: userId,
    specialist: request.specialist,
    authority: request.authority.kind,
    cents: request.cents,
  };
  if (!verdict.ok) {
    await logAudit(
      SYSTEM_ACTOR,
      "jane_act_refused",
      { type: "user", id: userId },
      { ...about, reason: verdict.reason },
    );
    throw new PermissionRefused(verdict.reason);
  }
  await logAudit(
    SYSTEM_ACTOR,
    "jane_act_allowed",
    { type: "user", id: userId },
    { ...about, simulated: verdict.simulated },
  );
  const db = scopedFor(userId, client);
  const row = await db.janeActs.create({
    data: {
      userId,
      specialist: request.specialist,
      sector: request.sector,
      what: request.what.slice(0, 300),
      why: verdict.why,
      cents: Math.max(0, Math.round(request.cents)),
      simulated: verdict.simulated,
      authority: request.authority.kind,
      undoUntil: verdict.undoUntil,
      undoHref: request.undo.kind === "window" ? (request.undo.href ?? null) : null,
      actionId: request.agent?.actionId ?? null,
      status: "started",
      createdAt: now,
    },
    select: { id: true },
  });
  try {
    const result = await withGrant({ specialist: request.specialist, userId }, act);
    await db.janeActs.updateMany({ where: { id: row.id }, data: { status: "done" } });
    return result;
  } catch (error) {
    await db.janeActs.updateMany({ where: { id: row.id }, data: { status: "failed" } });
    throw error;
  }
}
