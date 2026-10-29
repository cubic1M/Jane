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
// counted: trial people (spec step 138), the team (admin role, ADMIN_EMAILS or FOUNDER_EMAILS),
// and people whose only accounts are the demo bank. computeBetaMetrics is pure, so each rule is tested; the beta is
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

// The founders' own accounts that aren't admins (a personal email with their own bank data),
// comma-separated in FOUNDER_EMAILS.
export function isFounderEmail(email: string): boolean {
  return (process.env.FOUNDER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

const isTeam = (email: string, role: string) =>
  role === "admin" || isAdminEmail(email) || isFounderEmail(email);

export type BetaPeople = {
  real: Set<string>;
  // Who was left out and why, each person once (trial first, then team, then demo bank).
  excluded: { trial: number; team: number; demoOnly: number };
};

// Who counts as a real beta user: not a trial person, not the team, and not someone whose
// only accounts are the demo bank (someone looking around, not their own money).
export function betaPeople(rows: Pick<BetaRows, "users" | "accounts">): BetaPeople {
  const accountsOf = new Map<string, BetaRows["accounts"]>();
  for (const a of rows.accounts) accountsOf.set(a.userId, [...(accountsOf.get(a.userId) ?? []), a]);
  const real = new Set<string>();
  const excluded = { trial: 0, team: 0, demoOnly: 0 };
  for (const u of rows.users) {
    const own = accountsOf.get(u.id) ?? [];
    if (isTrialUser(u.id) || isTrialEmail(u.email)) excluded.trial++;
    else if (isTeam(u.email, u.role)) excluded.team++;
    else if (own.length > 0 && own.every((a) => a.demo)) excluded.demoOnly++;
    else real.add(u.id);
  }
  return { real, excluded };
}

export function computeBetaMetrics(rows: BetaRows): BetaMetrics {
  const { real } = betaPeople(rows);
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
        .filter(
          (email) =>
            !isTrialEmail(email) &&
            !team.has(email) &&
            !isAdminEmail(email) &&
            !isFounderEmail(email),
        ),
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

type Row<K extends keyof BetaRows> = BetaRows[K][number];

// The same rows with their dates, so /admin/numbers can show each number as of an earlier day.
export type DatedBetaRows = {
  users: (Row<"users"> & { createdAt: Date })[];
  invited: BetaRows["invited"];
  accounts: (Row<"accounts"> & { createdAt: Date })[];
  findings: (Row<"findings"> & { id: string; createdAt: Date; updatedAt: Date })[];
  decisions: (Row<"decisions"> & { createdAt: Date })[];
  outcomes: (Row<"outcomes"> & {
    suggestionKey: string;
    createdAt: Date;
    doneAt: Date | null;
    verifiedAt: Date | null;
  })[];
};

export async function loadBetaRows({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<DatedBetaRows> {
  const [users, invited, accounts, findings, decisions, outcomes] = await Promise.all([
    client.user.findMany({
      where: { id: REAL },
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    client.betaAccess.findMany({ select: { email: true } }),
    client.account.findMany({
      where: { userId: REAL },
      select: {
        userId: true,
        source: true,
        createdAt: true,
        item: { select: { plaidItemId: true } },
      },
    }),
    client.finding.findMany({
      where: { userId: REAL },
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        confidence: true,
        annualSavingsCents: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    client.decision.findMany({
      where: { userId: REAL },
      select: { userId: true, choice: true, undoneAt: true, createdAt: true },
    }),
    client.suggestionOutcome.findMany({
      where: { userId: REAL },
      select: {
        userId: true,
        suggestionKey: true,
        status: true,
        confirmedCents: true,
        createdAt: true,
        doneAt: true,
        verifiedAt: true,
      },
    }),
  ]);
  return {
    users,
    invited,
    accounts: accounts.map((a) => ({
      userId: a.userId,
      source: a.source,
      demo: a.item ? isDemoItemId(a.item.plaidItemId) : false,
      createdAt: a.createdAt,
    })),
    findings,
    decisions: decisions.map((d) => ({
      userId: d.userId,
      choice: d.choice,
      undone: !!d.undoneAt,
      createdAt: d.createdAt,
    })),
    outcomes,
  };
}

export async function loadBetaMetrics(options: { client?: PrismaClient } = {}) {
  return computeBetaMetrics(await loadBetaRows(options));
}
