import type { AccessKind } from "@/config/access-map";
import type { Answer } from "./invoke";
import type { Traffic, Write } from "./probe";
import { findMarker } from "./scan";

// Whether one call went wrong, from everything seen of it. Pure, so the attack's own judgement has
// tests that need no database (verdict.test.ts).

export type Attacker = "nobody" | "stranger" | "trial" | "partner";

export type Observation = {
  access: AccessKind;
  attacker: Attacker;
  answer: Answer;
  writes: Write[];
  traffic: Traffic;
  victim: { userId: string; marker: string };
  actorId: string | null;
  // Writes this surface may make on the victim's rows, and why (ALLOWED_WRITES).
  allowedWrites?: string[];
  // A column of the attacker's own that may hold the victim's id, and why (ALLOWED_POINTERS).
  allowedPointers?: string[];
};

const SIGN_IN_PAGES = /^(https?:\/\/[^/]+)?\/(login|mfa|terms\/accept|signup)\b/;

// The door stayed shut: sent to sign in, or told no.
export function refused(answer: Answer, allow: (status: number) => boolean): boolean {
  if (answer.redirect !== undefined) return SIGN_IN_PAGES.test(answer.redirect);
  return answer.status !== undefined && allow(answer.status);
}

const SHUT: Record<Exclude<AccessKind, "public">, (status: number) => boolean> = {
  "signed-in": (s) => s === 401 || s === 403 || s === 404,
  admin: (s) => s === 401 || s === 403 || s === 404,
  cron: (s) => s === 401 || s === 403,
  // A webhook checks its signature before it believes anything; some reject a bad body first.
  webhook: (s) => s === 400 || s === 401 || s === 403 || s === 404,
};

function stringify(value: unknown) {
  try {
    return JSON.stringify(value, (_, inner) => (typeof inner === "bigint" ? String(inner) : inner));
  } catch {
    return "a value with a loop in it";
  }
}

export function judge(seen: Observation): string[] {
  const { access, attacker, answer, writes, traffic, victim, actorId } = seen;
  const problems: string[] = [];

  const where = findMarker(answer.value, victim.marker);
  if (where) problems.push(`leak: the victim's marker is in ${where}`);
  if (findMarker(answer.redirect, victim.marker))
    problems.push("leak: the marker is in a redirect");
  for (const line of traffic.outbound) {
    if (line.toLowerCase().includes(victim.marker))
      problems.push(`leak: the marker left in ${line}`);
  }

  for (const write of writes) {
    const onVictim = write.owner === victim.userId || write.old_owner === victim.userId;
    const label = `${write.op} on ${write.tbl}`;
    if (onVictim && !seen.allowedWrites?.includes(write.tbl)) {
      problems.push(`wrote to the victim's rows: ${label}`);
    }
    if (
      !onVictim &&
      write.points_at &&
      !seen.allowedPointers?.includes(`${write.tbl}.${write.points_at}`)
    ) {
      problems.push(`linked a row to the victim's: ${write.tbl}.${write.points_at}`);
    }
    if (attacker === "trial" && write.tbl === "analytics_events" && write.owner === actorId) {
      problems.push("a trial person went into analytics");
    }
  }
  // Every email goes out through Resend, and the probes stop it there.
  const emails = traffic.outbound.filter((line) => line.includes("api.resend.com"));
  if (attacker === "trial" && emails.length > 0) {
    problems.push(`a trial person caused an email: ${emails[0].slice(0, 200)}`);
  }

  // A door that should have held, for who this is.
  const shouldRefuse = access !== "public" && (attacker === "nobody" || access !== "signed-in");
  if (shouldRefuse && !refused(answer, SHUT[access as Exclude<AccessKind, "public">])) {
    problems.push(`not refused (${access}): ${describe(answer)}`);
  }
  if (shouldRefuse && writes.length > 0 && !seen.allowedWrites?.length) {
    problems.push(`wrote without access: ${writes.map((w) => w.tbl).join(", ")}`);
  }
  return problems;
}

export function describe(answer: Answer): string {
  if (answer.redirect !== undefined) return `redirect ${answer.redirect}`;
  if (answer.status !== undefined) return `status ${answer.status}`;
  if (answer.threw) return `threw ${answer.threw.slice(0, 120)}`;
  return `returned ${String(stringify(answer.value)).slice(0, 120)}`;
}
