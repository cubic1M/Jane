import { IP_PIN, SIGNS, type SignKey, type StepKey } from "@/config/tax-identity";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { filingYear } from "@/lib/tax-filing";
import { listTaxNotices } from "@/lib/tax-notices";
import {
  caseView,
  inIpPinSeason,
  isStep,
  noticeLooksLikeTheft,
  stepsFor,
  type CaseView,
} from "@/planning/tax-identity";

// A protected tax identity (spec step 218): the January IP PIN reminder, and, on a sign of
// tax identity theft, a case with its steps in order, tracked to done. Jane never contacts
// the IRS or a bureau: every step is the person's, and it keeps the list.

type Options = { client?: PrismaClient; now?: Date };

export class IdentityError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type IdentityView = {
  year: number;
  season: boolean;
  havePin: boolean;
  reminded: boolean;
  case: (CaseView & { id: string }) | null;
  // Signs Jane noticed and hasn't asked about: a rejected return, a letter that reads as one.
  candidates: { sign: SignKey; key: string; detail: string }[];
};

function toCase(row: {
  id: string;
  sign: string;
  openedOn: Date;
  steps: unknown;
}): CaseView & { id: string } {
  return {
    id: row.id,
    ...caseView({
      sign: row.sign as SignKey,
      openedOn: iso(row.openedOn),
      done: (row.steps && typeof row.steps === "object" ? row.steps : {}) as Partial<
        Record<StepKey, string>
      >,
    }),
  };
}

export async function loadIdentity(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<IdentityView> {
  const today = iso(now);
  const year = Number(today.slice(0, 4));
  const db = scopedFor(userId, client);
  const [profile, open, rejected, notices] = await Promise.all([
    db.taxProfiles.findFirst({ select: { ipPinHaveYear: true, ipPinRemindedYear: true } }),
    db.taxIdentityCases.findFirst({
      where: { closedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    db.taxReturns.findFirst({
      where: { year: filingYear(today), status: "rejected" },
      select: { id: true, year: true },
    }),
    listTaxNotices(userId, { client }),
  ]);
  const candidates: IdentityView["candidates"] = [];
  if (rejected) {
    candidates.push({
      sign: "efile_rejected",
      key: `rejected:${rejected.id}`,
      detail: `Your ${rejected.year} return was rejected.`,
    });
  }
  for (const n of notices) {
    if (n.status === "confirmed" && noticeLooksLikeTheft(n.kind, n.fields.reason)) {
      candidates.push({
        sign: "irs_letter",
        key: `notice:${n.id}`,
        detail: "A letter you uploaded reads like an identity problem.",
      });
    }
  }
  return {
    year,
    season: inIpPinSeason(today),
    havePin: profile?.ipPinHaveYear === year,
    reminded: profile?.ipPinRemindedYear === year,
    case: open ? toCase(open) : null,
    candidates: open ? [] : candidates,
  };
}

// The person has a sign: opens the case (one at a time).
export async function openCase(
  userId: string,
  sign: SignKey,
  source: "told" | "rejected" | "notice",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CaseView & { id: string }> {
  if (!Object.hasOwn(SIGNS, sign)) throw new IdentityError("I don't know that sign.");
  const db = scopedFor(userId, client);
  const existing = await db.taxIdentityCases.findFirst({ where: { closedAt: null } });
  if (existing) throw new IdentityError("You already have a case open. Finish its steps first.");
  const row = await db.taxIdentityCases.create({
    data: { userId, sign, source, openedOn: new Date(`${iso(now)}T00:00:00Z`) },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_identity_case_opened",
    { type: "user", id: userId },
    { sign, source },
  );
  await track(userId, "tax_identity_case_opened", { sign, source });
  return toCase(row);
}

// A step done: the first not-done step needn't be the one (a phone call can come first),
// but a step the case doesn't have is refused. The last step closes the case.
export async function markStep(
  userId: string,
  step: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CaseView & { id: string }> {
  if (!isStep(step)) throw new IdentityError("I don't know that step.");
  const db = scopedFor(userId, client);
  const row = await db.taxIdentityCases.findFirst({ where: { closedAt: null } });
  if (!row) throw new IdentityError("There's no case open.");
  if (!stepsFor(row.sign as SignKey).some((s) => s.key === step)) {
    throw new IdentityError("That step isn't part of this case.");
  }
  const done = {
    ...((row.steps && typeof row.steps === "object" ? row.steps : {}) as Record<string, string>),
  };
  done[step] = iso(now);
  const view = caseView({ sign: row.sign as SignKey, openedOn: iso(row.openedOn), done });
  await db.taxIdentityCases.updateMany({
    where: { id: row.id },
    data: { steps: done, closedAt: view.complete ? now : null },
  });
  if (step === "ip_pin") {
    const year = Number(iso(now).slice(0, 4));
    await db.taxProfiles.upsert({
      where: { userId },
      create: { userId, ipPinHaveYear: year },
      update: { ipPinHaveYear: year },
    });
  }
  await track(userId, "tax_identity_step_done", { step });
  return { id: row.id, ...view };
}

// "I have my IP PIN" for this year.
export async function markHavePin(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const year = Number(iso(now).slice(0, 4));
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ipPinHaveYear: year },
    update: { ipPinHaveYear: year },
  });
  await track(userId, "tax_ip_pin_have", {});
}

// The January reminder on the deadlines: due the last day of January, or a week out after.
export async function remindIpPin(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<string> {
  const view = await loadIdentity(userId, { client, now });
  if (!view.season) throw new IdentityError("The IP PIN reminder is for January to April.");
  if (view.havePin) throw new IdentityError("You already have your IP PIN for this year.");
  if (view.reminded) throw new IdentityError("That reminder is already on your deadlines.");
  const today = iso(now);
  const planned = `${view.year}-${IP_PIN.remindOn}`;
  const dueOn = planned >= today ? planned : iso(new Date(now.getTime() + 7 * 86_400_000));
  await addDeadline(
    userId,
    {
      title: "Get your IRS Identity Protection PIN",
      dueOn,
      kind: "other",
      note: `${IP_PIN.who} Do it before you file.`,
    },
    { client, now },
  );
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ipPinRemindedYear: view.year },
    update: { ipPinRemindedYear: view.year },
  });
  await track(userId, "tax_ip_pin_reminded", { via });
  return dueOn;
}

// At the levels that let Jane act: the January reminder goes on the deadlines by itself.
export async function remindIpPinWhenDue(userId: string, options: Options = {}): Promise<boolean> {
  try {
    await remindIpPin(userId, { ...options, via: "autopilot" });
    return true;
  } catch (error) {
    if (error instanceof IdentityError) return false;
    throw error;
  }
}
