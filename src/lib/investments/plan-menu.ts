import { DEMO_PLAN_NAME, MENU_MIN_SAVING_CENTS, MENU_SUBTYPES } from "@/config/plan-menu";
import { FUND_FACTS, DEMO_EMPLOYER_PLAN_MENU } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { payrollPartner } from "@/lib/payroll/partner";
import { hasDemoBank } from "@/lib/plaid/demo";
import { profileSummary } from "@/planning/investor-profile";
import {
  cheapestMix,
  currentAllocation,
  parseDisclosure,
  targetDateCheck,
  targetFor,
  weightedBps,
  yearlyCents,
  type Allocation,
  type MenuFund,
} from "@/planning/plan-menu";
import { loadInvestments, type Investments } from "./holdings";
import { profileOf } from "./profile";

// The workplace plan's menu, used well (spec step 232, demo advice), for its page, Jane's
// answers and its buttons. The menu is read from a fee disclosure the person pastes, shown
// back for them to confirm, and only then used. The suggestion is the cheapest mix of the
// plan's own funds that matches their target; a change goes to the payroll stand-in on
// their tap.

type Options = { client?: PrismaClient; now?: Date; investments?: Investments };

export class PlanMenuError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// A sample disclosure for demo-bank people, made from the demo fund facts.
export function sampleDisclosure(): string {
  const kind = (t: string) => {
    const c = FUND_FACTS[t].category.toLowerCase();
    return c.includes("target")
      ? "Target date"
      : c.includes("international")
        ? "International stock"
        : c.includes("bond")
          ? "Bond"
          : c.includes("stable")
            ? "Stable value"
            : "US stock";
  };
  return [
    "Plan fee disclosure (annual operating expenses)",
    ...DEMO_EMPLOYER_PLAN_MENU.map(
      (t) =>
        `${t}  ${FUND_FACTS[t].category}  ${(FUND_FACTS[t].expenseRatioBps / 100).toFixed(2)}%  ${kind(t)}`,
    ),
  ].join("\n");
}

export type MenuView = {
  id: string;
  planName: string;
  status: string;
  funds: MenuFund[];
};

export type PlanMenuView = {
  advice: boolean;
  demo: boolean;
  proposed: MenuView | null;
  menu: MenuView | null;
  plan: {
    accountId: string;
    accountName: string;
    balanceCents: number;
    current: Allocation;
    currentBps: number;
    suggested: Allocation;
    suggestedBps: number;
    missing: string[];
    savingCents: number;
    targetDates: ReturnType<typeof targetDateCheck>[];
    riskLevel: number;
  } | null;
  pending: boolean;
};

const fundsOf = (json: unknown): MenuFund[] => (Array.isArray(json) ? (json as MenuFund[]) : []);

export async function loadPlanMenu(
  userId: string,
  { client = defaultClient, now = new Date(), investments: loaded }: Options = {},
): Promise<PlanMenuView> {
  const db = scopedFor(userId, client);
  const [advice, rows, investments, answers, demo, changes] = await Promise.all([
    adviceMode(userId, { client }),
    db.planMenus.findMany({ orderBy: { createdAt: "desc" } }),
    loaded ?? loadInvestments(userId, { client, now }),
    profileOf(userId, { client }),
    hasDemoBank(userId, { client }),
    db.planChanges.findMany({ orderBy: { createdAt: "desc" }, take: 1 }),
  ]);
  const view = (r: (typeof rows)[number]): MenuView => ({
    id: r.id,
    planName: r.planName,
    status: r.status,
    funds: fundsOf(r.funds),
  });
  const confirmed = rows.find((r) => r.status === "confirmed");
  const proposed = rows.find((r) => r.status === "proposed");
  const profile = profileSummary(answers, iso(now));
  const account = investments.accounts.find((a) =>
    MENU_SUBTYPES.includes((a.subtype ?? "").toLowerCase()),
  );
  let plan: PlanMenuView["plan"] = null;
  if (confirmed && account && profile.complete) {
    const funds = fundsOf(confirmed.funds);
    const balance = account.holdingsCents;
    const current = currentAllocation(
      funds,
      account.holdings.map((h) => ({ ticker: h.ticker, valueCents: h.valueCents })),
    );
    const mix = cheapestMix(funds, targetFor(profile.riskLevel));
    const currentBps = weightedBps(current);
    const lastChange = changes[0];
    plan = {
      accountId: account.id,
      accountName: account.name,
      balanceCents: balance,
      current,
      currentBps,
      suggested: mix.allocation,
      suggestedBps: mix.bps,
      missing: mix.missing,
      savingCents: Math.max(0, yearlyCents(balance, currentBps - mix.bps)),
      targetDates: funds
        .filter((f) => f.kind === "target_date")
        .map((f) => targetDateCheck(funds, f, balance)),
      riskLevel: profile.riskLevel,
    };
    void lastChange;
  }
  return {
    advice,
    demo,
    proposed: proposed ? view(proposed) : null,
    menu: confirmed ? view(confirmed) : null,
    plan,
    pending:
      changes.length > 0 &&
      !!changes[0] &&
      now.getTime() - changes[0].createdAt.getTime() < 14 * 86_400_000,
  };
}

// Read a pasted disclosure and keep it to confirm. Nothing is used until the person confirms.
export async function proposeMenu(
  userId: string,
  text: string,
  source: "you" | "demo",
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const answers = await profileOf(userId, { client });
  const profile = profileSummary(answers, iso(now));
  const { funds, skipped } = parseDisclosure(text.slice(0, 20_000), {
    today: iso(now),
    risk: profile.complete ? profile.riskLevel : 3,
  });
  if (funds.length < 2)
    throw new PlanMenuError(
      "I couldn't read at least two funds with their costs. Lines like “KTSIX  Total Stock Index Fund  0.03%  US stock” work best.",
    );
  const db = scopedFor(userId, client);
  await db.planMenus.deleteMany({ where: { status: "proposed" } });
  const row = await db.planMenus.create({
    data: {
      userId,
      planName: source === "demo" ? DEMO_PLAN_NAME : "Your workplace plan",
      funds: funds as never,
      source,
    },
    select: { id: true },
  });
  return { id: row.id, funds, skipped };
}

export async function confirmMenu(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
) {
  const db = scopedFor(userId, client);
  const { count } = await db.planMenus.updateMany({
    where: { id, status: "proposed" },
    data: { status: "confirmed" },
  });
  if (count === 0) throw new PlanMenuError("That menu was already confirmed or replaced.");
  await db.planMenus.deleteMany({ where: { status: "confirmed", id: { not: id } } });
  await logAudit(
    { type: "user", id: userId },
    "plan_menu_confirmed",
    { type: "plan_menu", id },
    {},
  );
}

// Tap: send the suggested mix to the payroll partner. Only funds on the confirmed menu.
export async function requestPlanChange(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadPlanMenu(userId, { client, now });
  if (!view.advice) throw new PlanMenuError("This is only in demo advice mode for now.");
  if (!view.menu || !view.plan) throw new PlanMenuError("Confirm your plan's fund list first.");
  if (view.pending) throw new PlanMenuError("A change to your plan's funds is already requested.");
  const menu = new Set(view.menu.funds.map((f) => f.ticker));
  const allocation = view.plan.suggested.map((a) => ({
    ticker: a.ticker,
    share: Math.round(a.share * 10_000) / 10_000,
  }));
  if (allocation.some((a) => !menu.has(a.ticker)))
    throw new PlanMenuError("A fund isn't on your plan's menu.");
  const partner = payrollPartner();
  const { partnerRef } = await partner.requestAllocationChange(allocation);
  const row = await scopedFor(userId, client).planChanges.create({
    data: { userId, menuId: view.menu.id, partner: partner.name, partnerRef, allocation },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "plan_change_requested",
    { type: "plan_change", id: row.id },
    { simulated: partner.simulated },
  );
  await track(userId, "plan_change_requested", {});
  return { savingCents: view.plan.savingCents, funds: allocation.length };
}

export { MENU_MIN_SAVING_CENTS };
