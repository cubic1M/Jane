import { sumMoneyFound } from "@/detection/engine";
import type {
  Confidence,
  DecisionChoice,
  FindingStatus,
  FindingType,
  PrismaClient,
} from "@/generated/prisma/client";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { db as defaultClient } from "@/lib/db";
import { isAdminEmail } from "@/lib/invites";
import { median } from "@/lib/metrics";
import { isDemoItemId } from "@/lib/plaid/demo";
import { isTrialEmail, isTrialUser } from "@/lib/trial-ids";

// The closed beta's traction numbers, all time, on /admin/metrics: real people only. Never
// counted: trial people (spec step 138), admins (role or ADMIN_EMAILS), and people whose only
// accounts are the demo bank. computeBetaMetrics is pure, so each rule is tested; the beta is
// small, so loadBetaMetrics reads the rows rather than asking Postgres for the sums.

export type BetaRows = {
  users: { id: string; email: string; role: "user" | "admin" }[];
  // Emails let in by an invite code (beta_access).
  invited: { email: string }[];
  accounts: { userId: string; source: "csv" | "plaid"; demo: boolean }[];
  findings: {
    userId: string;
    type: FindingType;
    status: FindingStatus;
    confidence: Confidence;
    annualSavingsCents: number | null;
  }[];
  decisions: { userId: string; choice: DecisionChoice; undone: boolean }[];
  // The verified savings record (suggestion_outcomes).
  outcomes: { userId: string; status: string; confirmedCents: number | null }[];
};

export type BetaMetrics = {
  invited: number;
  signedUp: number;
  uploaded: { users: number; accounts: number };
  linked: { users: number; accounts: number };
  withFinding: number;
  // Yearly savings found per person who added an account.
  found: { users: number; totalCents: number; medianCents: number | null };
  acted: number;
  verified: { users: number; cents: number };
};

// A yes (ours or do-it-yourself) or a done on the verified record.
const ACTED_OUTCOMES = ["open", "partial", "not_seen", "confirmed", "unverifiable"];
const VERIFIED_OUTCOMES = ["confirmed", "partial"];

const isTeam = (email: string, role: string) => role === "admin" || isAdminEmail(email);

export function computeBetaMetrics(rows: BetaRows): BetaMetrics {
  const accountsOf = new Map<string, BetaRows["accounts"]>();
  for (const a of rows.accounts) accountsOf.set(a.userId, [...(accountsOf.get(a.userId) ?? []), a]);

  const real = new Set(
    rows.users
      .filter((u) => !isTrialUser(u.id) && !isTrialEmail(u.email) && !isTeam(u.email, u.role))
      // Only the demo bank: someone looking around, not a beta user's own money.
      .filter((u) => {
        const own = accountsOf.get(u.id) ?? [];
        return own.length === 0 || own.some((a) => !a.demo);
      })
      .map((u) => u.id),
  );
  const team = new Set(rows.users.filter((u) => isTeam(u.email, u.role)).map((u) => u.email));

  const realAccounts = rows.accounts.filter((a) => real.has(a.userId) && !a.demo);
  const bySource = (source: "csv" | "plaid") => {
    const list = realAccounts.filter((a) => a.source === source);
    return { users: new Set(list.map((a) => a.userId)).size, accounts: list.length };
  };
  const withAccount = [...new Set(realAccounts.map((a) => a.userId))];

  const realFindings = rows.findings.filter((f) => real.has(f.userId));
  // What the report's total counts, plus findings already done: those were found too.
  const foundCents = withAccount.map((id) =>
    sumMoneyFound(
      realFindings
        .filter((f) => f.userId === id)
        .map((f) => (f.status === "done" ? { ...f, status: "approved" as const } : f)),
    ),
  );

  const acted = new Set([
    ...rows.decisions
      .filter((d) => real.has(d.userId) && d.choice !== "no" && !d.undone)
      .map((d) => d.userId),
    ...rows.outcomes
      .filter((o) => real.has(o.userId) && ACTED_OUTCOMES.includes(o.status))
      .map((o) => o.userId),
  ]);
  const verified = rows.outcomes.filter(
    (o) =>
      real.has(o.userId) && VERIFIED_OUTCOMES.includes(o.status) && (o.confirmedCents ?? 0) > 0,
  );

  return {
    invited: new Set(
      rows.invited
        .map((i) => i.email.toLowerCase())
        .filter((email) => !isTrialEmail(email) && !team.has(email) && !isAdminEmail(email)),
    ).size,
    signedUp: real.size,
    uploaded: bySource("csv"),
    linked: bySource("plaid"),
    withFinding: new Set(realFindings.map((f) => f.userId)).size,
    found: {
      users: withAccount.length,
      totalCents: foundCents.reduce((sum, c) => sum + c, 0),
      medianCents: median(foundCents),
    },
    acted: acted.size,
    verified: {
      users: new Set(verified.map((o) => o.userId)).size,
      cents: verified.reduce((sum, o) => sum + (o.confirmedCents ?? 0), 0),
    },
  };
}

// Trial people can be many at once, so they're left out in the query too.
const REAL = { not: { startsWith: TRIAL_ID_PREFIX } };

export async function loadBetaRows({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<BetaRows> {
  const [users, invited, accounts, findings, decisions, outcomes] = await Promise.all([
    client.user.findMany({ where: { id: REAL }, select: { id: true, email: true, role: true } }),
    client.betaAccess.findMany({ select: { email: true } }),
    client.account.findMany({
      where: { userId: REAL },
      select: { userId: true, source: true, item: { select: { plaidItemId: true } } },
    }),
    client.finding.findMany({
      where: { userId: REAL },
      select: {
        userId: true,
        type: true,
        status: true,
        confidence: true,
        annualSavingsCents: true,
      },
    }),
    client.decision.findMany({
      where: { userId: REAL },
      select: { userId: true, choice: true, undoneAt: true },
    }),
    client.suggestionOutcome.findMany({
      where: { userId: REAL },
      select: { userId: true, status: true, confirmedCents: true },
    }),
  ]);
  return {
    users,
    invited,
    accounts: accounts.map((a) => ({
      userId: a.userId,
      source: a.source,
      demo: a.item ? isDemoItemId(a.item.plaidItemId) : false,
    })),
    findings,
    decisions: decisions.map((d) => ({ userId: d.userId, choice: d.choice, undone: !!d.undoneAt })),
    outcomes,
  };
}

export async function loadBetaMetrics(options: { client?: PrismaClient } = {}) {
  return computeBetaMetrics(await loadBetaRows(options));
}
