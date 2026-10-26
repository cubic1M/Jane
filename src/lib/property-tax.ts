import { COMPARABLES_WANTED, type Exemption } from "@/config/property-tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { loadHomeTaxes, type HomeTaxesView } from "@/lib/home-taxes";
import { propertyPartnerFor } from "@/lib/property";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import {
  appealWindow,
  assessmentGap,
  draftAppeal,
  exemptionsToClaim,
  propertyOf,
  type Comparable,
  type Gap,
  type Window,
} from "@/planning/property-tax";
import { isoDay as iso } from "@/lib/dates";

// Property tax that's too high (spec step 221), for its page, the chat and Claude: the
// home's assessed value against its market value (the person's own figures, or the property
// partner's stand-in record), the county's appeal window as a deadline, a drafted appeal with
// comparable sales, and exemptions not yet claimed. Recommendations are demo advice: where
// advice is off, Jane shows the facts and suggests nothing. Jane files nothing: the drafted
// appeal goes to the team or the person on their tap.

type Options = { client?: PrismaClient; now?: Date };

export class PropertyTaxError extends Error {}

export type PropertyAppealView = {
  id: string;
  year: number;
  board: string;
  draft: string;
  savingCents: number;
  status: "drafted" | "team" | "self" | "dropped";
};

export type PropertyTaxView = {
  year: number;
  advice: boolean;
  state: string | null;
  countyName: string;
  homeowner: boolean;
  address: string;
  // Where each figure came from: what the person told Jane, or the stand-in record.
  assessedCents: number | null;
  marketCents: number | null;
  assessedYear: number | null;
  figuresFrom: "you" | "partner" | null;
  gap: Gap | null;
  comps: Comparable[];
  window: Window;
  // An appeal is worth suggesting (advice, over the config threshold, window not closed,
  // comparables in hand).
  suggested: boolean;
  appeal: PropertyAppealView | null;
  exemptions: { eligible: Exemption[]; ask: string[] };
  facts: { age: number | null; veteran: boolean | null; disabled: boolean | null };
  taxPaidCents: number;
};

const windowTitle = (year: number) => `Appeal your ${year} property tax assessment`;

export async function loadPropertyTax(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & {
    loaded?: { estimate: TaxEstimateView; advice: boolean; home?: HomeTaxesView };
  } = {},
): Promise<PropertyTaxView> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [advice, home, loans, profile, appeal, partner] = await Promise.all([
    loaded ? loaded.advice : adviceMode(userId, { client }),
    loaded?.home ?? loadHomeTaxes(userId, { client, now, loaded: { estimate } }),
    db.liabilities.findMany({
      where: { kind: "mortgage" },
      select: { account: { select: { currentBalanceCents: true } } },
      orderBy: [{ account: { name: "asc" } }, { id: "asc" }],
    }),
    db.taxProfiles.findFirst({
      select: {
        homeMarketCents: true,
        homeAssessedCents: true,
        homeAssessedYear: true,
        homeNoticeOn: true,
        ownerAge: true,
        ownerVeteran: true,
        ownerDisabled: true,
        exemptionsClaimed: true,
      },
    }),
    db.propertyAppeals.findFirst({ where: { year: estimate.year } }),
    propertyPartnerFor(userId, { client }),
  ]);
  const state = estimate.input.state;
  const record =
    partner?.lookup({
      mortgageBalanceCents: loans[0]?.account.currentBalanceCents ?? null,
      today,
    }) ?? null;
  const marketCents = profile?.homeMarketCents ?? record?.marketCents ?? null;
  const assessedCents = profile?.homeAssessedCents ?? record?.assessedCents ?? null;
  const own = profile?.homeMarketCents != null || profile?.homeAssessedCents != null;
  const taxPaidCents = home.propertyTax?.cents ?? 0;
  const gap =
    marketCents !== null && assessedCents !== null
      ? assessmentGap({ assessedCents, marketCents, taxPaidCents, state })
      : null;
  const window = appealWindow(
    state,
    today,
    profile?.homeNoticeOn ? iso(profile.homeNoticeOn) : null,
  );
  const comps = advice && record ? record.comps : [];
  const facts = {
    age: profile?.ownerAge ?? null,
    veteran: profile?.ownerVeteran ?? null,
    disabled: profile?.ownerDisabled ?? null,
  };
  const homeowner = home.homeowner || own || record !== null;
  return {
    year: estimate.year,
    advice,
    state,
    countyName: propertyOf(state).window.board,
    homeowner,
    address: record?.address ?? "your home",
    assessedCents,
    marketCents,
    assessedYear: profile?.homeAssessedYear ?? record?.assessedYear ?? null,
    figuresFrom: own ? "you" : record ? "partner" : null,
    gap,
    comps,
    window,
    suggested: Boolean(
      advice &&
      gap?.worthAppealing &&
      window.status !== "closed" &&
      comps.length >= COMPARABLES_WANTED,
    ),
    appeal: appeal
      ? {
          id: appeal.id,
          year: appeal.year,
          board: appeal.board,
          draft: appeal.draft,
          savingCents: appeal.savingCents,
          status: appeal.status as PropertyAppealView["status"],
        }
      : null,
    exemptions: homeowner
      ? exemptionsToClaim(state, { ...facts, claimed: profile?.exemptionsClaimed ?? [] })
      : { eligible: [], ask: [] },
    facts,
    taxPaidCents,
  };
}

export type PropertyAnswers = {
  marketCents: number | null;
  assessedCents: number | null;
  assessedYear: number | null;
  noticeOn: string | null;
  age: number | null;
  veteran: boolean | null;
  disabled: boolean | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// What the person tells Jane about their home and themselves. Checked here, whatever sent it.
export async function savePropertyAnswers(
  userId: string,
  a: PropertyAnswers,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const money = (n: number | null) => n === null || (Number.isInteger(n) && n > 0);
  if (!money(a.marketCents) || !money(a.assessedCents)) {
    throw new PropertyTaxError("Give the values in dollars, above zero.");
  }
  if (
    a.assessedYear !== null &&
    (!Number.isInteger(a.assessedYear) || Math.abs(a.assessedYear - now.getUTCFullYear()) > 5)
  ) {
    throw new PropertyTaxError("Give the year the assessment is for.");
  }
  if (
    a.noticeOn !== null &&
    (!DATE.test(a.noticeOn) || Number.isNaN(Date.parse(a.noticeOn)) || a.noticeOn > iso(now))
  ) {
    throw new PropertyTaxError("Give the date the notice was mailed, today or earlier.");
  }
  if (a.age !== null && (!Number.isInteger(a.age) || a.age < 18 || a.age > 120)) {
    throw new PropertyTaxError("Give your age as a number from 18 to 120.");
  }
  const data = {
    homeMarketCents: a.marketCents,
    homeAssessedCents: a.assessedCents,
    homeAssessedYear: a.assessedYear,
    homeNoticeOn: a.noticeOn ? new Date(`${a.noticeOn}T00:00:00Z`) : null,
    ownerAge: a.age,
    ownerVeteran: a.veteran,
    ownerDisabled: a.disabled,
  };
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "property", via },
  );
  await track(userId, "tax_profile_answered", { fields: "property", via });
}

// A reminder for the appeal window's last day, once. Reminding is safe at any autopilot
// level that lets Jane act; the appeal itself is never filed by it.
export async function remindAppealWindow(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<string> {
  const view = await loadPropertyTax(userId, { client, now });
  const closes = view.window.closesOn;
  if (!closes || view.window.status === "closed") {
    throw new PropertyTaxError(
      "I don't have the appeal deadline yet. Tell me the date on your assessment notice.",
    );
  }
  const title = windowTitle(view.year);
  const db = scopedFor(userId, client);
  if ((await db.deadlines.count({ where: { title } })) === 0) {
    await addDeadline(
      userId,
      {
        title,
        dueOn: closes,
        kind: "other",
        note: `Appeals go to ${view.window.board}. ${view.window.text} ESTIMATE TO VERIFY against the date on your notice.`,
      },
      { client, now },
    );
    await track(userId, "property_appeal_deadline", { via });
  }
  return closes;
}

// At the levels that let Jane act: the deadline for an appeal worth making.
export async function remindAppealWhenSuggested(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const view = await loadPropertyTax(userId, { client, now });
  if (!view.suggested || !view.window.closesOn) return false;
  const had = await scopedFor(userId, client).deadlines.count({
    where: { title: windowTitle(view.year) },
  });
  if (had > 0) return false;
  await remindAppealWindow(userId, { client, now, via: "autopilot" });
  return true;
}

// Drafts the appeal from the comparable sales, and puts the deadline on the plan. Nothing
// is filed.
export async function draftPropertyAppeal(
  userId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<PropertyAppealView> {
  const view = await loadPropertyTax(userId, { client, now });
  if (!view.advice) {
    throw new PropertyTaxError("Drafting an appeal comes once Jane works with a tax professional.");
  }
  if (!view.suggested || !view.gap || view.assessedCents === null) {
    throw new PropertyTaxError(
      "The assessment isn't far enough above the home's value to be worth appealing.",
    );
  }
  if (view.appeal && view.appeal.status !== "dropped") {
    throw new PropertyTaxError("An appeal is already drafted.");
  }
  const draft = draftAppeal({
    year: view.year,
    board: view.window.board,
    address: view.address,
    assessedCents: view.assessedCents,
    comps: view.comps,
  });
  const data = {
    assessedCents: view.assessedCents,
    marketCents: view.marketCents!,
    savingCents: view.gap.savingCents,
    board: view.window.board,
    comps: view.comps,
    draft,
    status: "drafted",
    handledAt: null,
  };
  const row = await scopedFor(userId, client).propertyAppeals.upsert({
    where: { userId_year: { userId, year: view.year } },
    create: { userId, year: view.year, ...data },
    update: data,
  });
  if (view.window.closesOn) await remindAppealWindow(userId, { client, now, via: "chat" });
  await track(userId, "property_appeal_drafted", { via });
  return {
    id: row.id,
    year: row.year,
    board: row.board,
    draft: row.draft,
    savingCents: row.savingCents,
    status: "drafted",
  };
}

// "My team files it" or "I'll file it": a record of who, on the person's tap. The team's
// filing is the concierge queue (a stand-in); Jane files nothing itself.
export async function chooseFiler(
  userId: string,
  by: "team" | "you" | "drop",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PropertyAppealView> {
  const db = scopedFor(userId, client);
  const view = await loadPropertyTax(userId, { client, now });
  const appeal = view.appeal;
  if (!appeal || appeal.status !== "drafted") throw new PropertyTaxError("Draft the appeal first.");
  const status = by === "you" ? "self" : by === "team" ? "team" : "dropped";
  await db.propertyAppeals.updateMany({
    where: { id: appeal.id, status: "drafted" },
    data: { status, handledAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "property_appeal_handled",
    { type: "property_appeal", id: appeal.id },
    { by },
  );
  await track(userId, "property_appeal_handled", { by });
  return { ...appeal, status };
}

// "I already have it": those exemptions are claimed and Jane stops mentioning them.
export async function markClaimed(
  userId: string,
  keys: readonly string[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const view = await loadPropertyTax(userId, { client, now });
  const valid = view.exemptions.eligible.map((e) => e.key).filter((k) => keys.includes(k));
  if (valid.length === 0) throw new PropertyTaxError("That one isn't on your list.");
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findFirst({ select: { exemptionsClaimed: true } });
  const exemptionsClaimed = [...new Set([...(existing?.exemptionsClaimed ?? []), ...valid])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, exemptionsClaimed },
    update: { exemptionsClaimed },
  });
  await track(userId, "property_exemption_claimed", { count: valid.length });
}

// "Remind me to apply": a deadline a month out, once. Applying is the person's, with their
// county.
export async function remindExemption(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Exemption> {
  const view = await loadPropertyTax(userId, { client, now });
  const e = view.exemptions.eligible.find((x) => x.key === key);
  if (!e) throw new PropertyTaxError("That one isn't on your list.");
  const title = `Apply for the ${e.name}`;
  const db = scopedFor(userId, client);
  if ((await db.deadlines.count({ where: { title } })) === 0) {
    const due = new Date(now);
    due.setUTCDate(due.getUTCDate() + 30);
    await addDeadline(
      userId,
      {
        title,
        dueOn: iso(due),
        kind: "other",
        note: `${e.who} ${e.benefit} Apply with your county assessor.`,
      },
      { client, now },
    );
  }
  return e;
}
