import type { PlaidApi } from "plaid";
import {
  demoHoldings,
  demoInvestmentTransactions,
  demoOrderTransactions,
  demoSecurities,
  type DemoOrder,
} from "@/data-sources/demo/demo-holdings";
import {
  addDays,
  DEMO_EXTRAS,
  DEMO_INSTITUTION,
  type DemoExtra,
  demoAccounts,
  demoLiabilities,
  demoSwitchTransactions,
  demoTransactions,
  type DemoSeed,
  type DemoSwitch,
} from "@/data-sources/demo/demo-bank";
import { isPersonId, personById, type PersonId } from "@/config/people";
import { demoGoalsFor } from "@/data-sources/demo/demo-goals";
import {
  DEMO_SECOND_LOGINS,
  secondLoginAccounts,
  secondLoginTransactions,
} from "@/data-sources/demo/demo-people";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { plaidEnabled } from "./client";

// The demo bank (spec step 75): a stand-in for Plaid's API while there are no keys. A demo
// item is an ordinary plaid_items row whose ids start with "demo-" and whose (encrypted)
// access token names the demo seed and the day it was linked, so the normal sync, removal
// and daily refresh all work on it. It never talks to Plaid.

const DEMO_ITEM_PREFIX = "demo-";
// Books QA: a sample person's second bank login (DEMO_SECOND_LOGINS) is a demo item of its own,
// "demo-<seed>-<login>". The person's demo bank is always the other one.
const MAIN_DEMO_ITEM = {
  plaidItemId: { startsWith: DEMO_ITEM_PREFIX },
  NOT: Object.values(DEMO_SECOND_LOGINS).map((l) => ({
    plaidItemId: { endsWith: `-${l!.login}` },
  })),
};
const DEMO_TOKEN_PREFIX = "demo:";

export const isDemoItemId = (plaidItemId: string) => plaidItemId.startsWith(DEMO_ITEM_PREFIX);
export const isDemoToken = (accessToken: string) => accessToken.startsWith(DEMO_TOKEN_PREFIX);

// Offered when Plaid isn't set up and this isn't production; DEMO_BANK=1 turns it on
// anywhere (e.g. a deployed preview before the Plaid keys arrive).
export function demoBankEnabled(): boolean {
  if (process.env.DEMO_BANK === "1") return true;
  return !plaidEnabled() && process.env.NODE_ENV !== "production";
}

function seedOf(accessToken: string): DemoSeed {
  const [, seed, anchor, person, login] = accessToken.split(":");
  if (!seed || !/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? "")) throw new Error("Not a demo token");
  // The fourth part is a sample person (spec step 252); the original demo bank has none. The
  // fifth is a second bank login of theirs (books QA).
  if (!person || !isPersonId(person)) return { seed, anchor };
  return login ? { seed, anchor, person, login } : { seed, anchor, person };
}

// Whether a demo token is a sample person's second bank login, which syncs only its accounts.
export const isSecondLoginToken = (accessToken: string) =>
  isDemoToken(accessToken) && Boolean(seedOf(accessToken).login);

// A second login answers with just the shared account and its transactions.
function secondLoginApi(demo: DemoSeed, now: Date): PlaidApi {
  const through = yesterday(now);
  const accounts = secondLoginAccounts(demo);
  const api = {
    transactionsSync: async ({ cursor }: { cursor?: string }) => {
      const after = cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : null;
      return {
        data: {
          accounts,
          added:
            after !== null && after >= through ? [] : secondLoginTransactions(demo, after, through),
          modified: [],
          removed: [],
          next_cursor: after !== null && after > through ? after : through,
          has_more: false,
        },
      };
    },
    transactionsRecurringGet: async () => ({ data: { outflow_streams: [], inflow_streams: [] } }),
    liabilitiesGet: async () => ({
      data: { accounts, liabilities: { credit: [], mortgage: [], student: [] } },
    }),
    investmentsHoldingsGet: async () => ({ data: { accounts: [], holdings: [], securities: [] } }),
    investmentsTransactionsGet: async () => ({
      data: {
        accounts: [],
        investment_transactions: [],
        securities: [],
        total_investment_transactions: 0,
      },
    }),
    itemRemove: async () => ({ data: {} }),
  };
  return api as unknown as PlaidApi;
}

const today = (now: Date) => now.toISOString().slice(0, 10);
const yesterday = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

// Just the calls the app makes, answered with the demo bank's data. The cursor is the last
// day already sent, so each sync adds only the days since.
export function demoPlaidApi(
  accessToken: string,
  now: Date = new Date(),
  // Switches the person made, so their new bills show up (spec step 77).
  switches: DemoSwitch[] = [],
  // Simulated orders the person placed (spec step 133), so the holdings show them.
  orders: DemoOrder[] = [],
  // Loans a new lender paid off (spec step 112): at zero from that day, details gone.
  payoffs: { plaidAccountId: string; day: string }[] = [],
  // Extra stand-in accounts the person linked (spec step 159).
  extras: readonly DemoExtra[] = [],
): PlaidApi {
  const demo = seedOf(accessToken);
  if (demo.login) return secondLoginApi(demo, now);
  const through = yesterday(now);
  const holdings = demoHoldings(demo, through, orders, extras);
  const securities = demoSecurities(
    through,
    demo.anchor,
    new Set(holdings.map((h) => h.security_id)),
  );
  // A bank or card balance moves with its own transactions since the day the bank was linked
  // (real-user QA: a fixed balance next to each day's new charges made the books check say the
  // card was $51.56 off). Plaid's amounts are money out positive: down in checking, up owed on
  // a card.
  const moved = new Map<string, number>();
  // The first sync (on the day it was linked) brings everything through the day before.
  const linkedThrough = addDays(demo.anchor, -1);
  for (const t of [
    ...demoTransactions(demo, linkedThrough, through),
    ...demoSwitchTransactions(demo, switches, linkedThrough, through),
  ]) {
    moved.set(t.account_id, (moved.get(t.account_id) ?? 0) + Math.round(t.amount * 100));
  }
  const movedBalance = (a: ReturnType<typeof demoAccounts>[number]) => {
    const cents = moved.get(a.account_id) ?? 0;
    if (cents === 0 || a.balances.current === null || a.balances.current === undefined) return a;
    const sign = a.type === "credit" ? 1 : a.type === "depository" ? -1 : 0;
    if (sign === 0) return a;
    return {
      ...a,
      balances: {
        ...a.balances,
        current: Math.round(a.balances.current * 100 + sign * cents) / 100,
      },
    };
  };
  // An investment account's balance is what it holds (deposits from step 134 add to it).
  const invested = demoAccounts(demo, extras)
    .map(movedBalance)
    .map((a) =>
      a.type === "investment"
        ? {
            ...a,
            balances: {
              ...a.balances,
              current:
                holdings
                  .filter((h) => h.account_id === a.account_id)
                  .reduce((s, h) => s + Math.round(h.institution_value * 100), 0) / 100,
            },
          }
        : a,
    );
  const paidOff = new Set(payoffs.filter((p) => p.day <= today(now)).map((p) => p.plaidAccountId));
  const accounts = () =>
    invested.map((a) =>
      paidOff.has(a.account_id) ? { ...a, balances: { ...a.balances, current: 0 } } : a,
    );
  const liabilities = () => {
    const all = demoLiabilities(demo, today(now));
    const keep = <T extends { account_id?: string | null }>(list: T[] | null | undefined) =>
      (list ?? []).filter((l) => !paidOff.has(l.account_id ?? ""));
    return {
      ...all,
      credit: keep(all.credit),
      mortgage: keep(all.mortgage),
      student: keep(all.student),
      loan: keep((all as { loan?: { account_id?: string | null }[] }).loan),
    } as typeof all;
  };
  const api = {
    transactionsSync: async ({ cursor }: { cursor?: string }) => {
      const after = cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : null;
      return {
        data: {
          accounts: accounts(),
          added:
            after !== null && after >= through
              ? []
              : [
                  ...demoTransactions(demo, after, through),
                  ...demoSwitchTransactions(demo, switches, after, through),
                ],
          modified: [],
          removed: [],
          next_cursor: after !== null && after > through ? after : through,
          has_more: false,
        },
      };
    },
    // No recurring streams: Jane's own detection finds the recurring charges.
    transactionsRecurringGet: async () => ({ data: { outflow_streams: [], inflow_streams: [] } }),
    liabilitiesGet: async () => ({
      data: { accounts: accounts(), liabilities: liabilities() },
    }),
    // What the investment accounts hold (spec step 128).
    investmentsHoldingsGet: async () => ({
      data: {
        accounts: accounts().filter((a) => a.type === "investment"),
        holdings,
        securities,
      },
    }),
    investmentsTransactionsGet: async ({
      start_date,
      end_date,
      options,
    }: {
      start_date: string;
      end_date: string;
      options?: { count?: number; offset?: number };
    }) => {
      const start = addDays(start_date, -1);
      const end = end_date < today(now) ? end_date : today(now);
      const all = [
        ...demoInvestmentTransactions(demo, start, end < through ? end : through, extras),
        // Orders show the day they filled.
        ...demoOrderTransactions(demo, orders, start, end),
      ];
      const offset = options?.offset ?? 0;
      return {
        data: {
          accounts: accounts().filter((a) => a.type === "investment"),
          investment_transactions: all.slice(offset, offset + (options?.count ?? 100)),
          securities,
          total_investment_transactions: all.length,
        },
      };
    },
    itemRemove: async () => ({ data: {} }),
  };
  return api as unknown as PlaidApi;
}

export class DemoBankError extends Error {}

// Links a demo bank for the person, or returns the one they already have. The caller runs
// the first sync.
export async function linkDemoBank(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    person,
  }: { client?: PrismaClient; now?: Date; person?: PersonId } = {},
): Promise<{ itemId: string; created: boolean }> {
  if (!demoBankEnabled()) throw new DemoBankError("The demo bank isn't available here.");
  const db = scopedFor(userId, client);
  const existing = await db.plaidItems.findFirst({
    where: MAIN_DEMO_ITEM,
    select: { id: true },
  });
  if (existing) return { itemId: existing.id, created: false };
  const seed = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const item = await db.plaidItems.create({
    data: {
      userId,
      plaidItemId: `${DEMO_ITEM_PREFIX}${seed}`,
      accessTokenEncrypted: encrypt(
        `${DEMO_TOKEN_PREFIX}${seed}:${today(now)}${person ? `:${person}` : ""}`,
      ),
      institutionName: DEMO_INSTITUTION,
      liabilities: true,
      investments: true,
    },
    select: { id: true },
  });
  // A sample person comes with their tax profile answered: how they file and who they claim
  // (src/lib/sample-tax-answers.ts).
  if (person) {
    const { seedSampleTaxAnswers } = await import("@/lib/sample-tax-answers");
    await seedSampleTaxAnswers(userId, person, { client });
  }
  // Spec step 241: a sample person comes with their goals (tracked by hand: no account yet).
  const goals = demoGoalsFor(person, today(now));
  if (goals.length > 0 && (await db.savingsGoals.count()) === 0) {
    await db.savingsGoals.createMany({
      data: goals.map((g) => ({
        userId,
        name: g.name,
        targetCents: g.targetCents,
        targetDate: new Date(`${g.targetDate}T00:00:00Z`),
        manualSavedCents: g.savedCents,
      })),
    });
  }
  // Spec step 139: a sample person comes with what Jane already did for them, so "What Jane
  // saved you" has their own confirmed wins (src/lib/sample-wins.ts). Never a real account.
  if (person) {
    const { seedSampleWins } = await import("@/lib/sample-wins");
    await seedSampleWins(userId, person, { client, now });
  }
  await logAudit(
    { type: "user", id: userId },
    "item_linked",
    { type: "plaid_item", id: item.id },
    { institution: DEMO_INSTITUTION, demo: true },
  );
  await track(userId, "link_succeeded", { institution: DEMO_INSTITUTION, demo: true });
  return { itemId: item.id, created: true };
}

// Whether the person is looking at demo data, for the banner.
export async function hasDemoBank(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const count = await scopedFor(userId, client).plaidItems.count({
    where: MAIN_DEMO_ITEM,
  });
  return count > 0;
}

// The day a person's demo bank was linked (spec step 156: the price feed starts there), or
// null without one.
export async function demoAnchorFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const item = await scopedFor(userId, client).plaidItems.findFirst({
    where: MAIN_DEMO_ITEM,
    select: { accessTokenEncrypted: true },
  });
  if (!item) return null;
  try {
    return seedOf(decrypt(item.accessTokenEncrypted)).anchor;
  } catch {
    return null;
  }
}

// Which sample person (spec step 252) a demo bank is, or null for the original demo bank and
// for people without one.
export async function demoPersonFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<PersonId | null> {
  const item = await scopedFor(userId, client).plaidItems.findFirst({
    where: MAIN_DEMO_ITEM,
    select: { accessTokenEncrypted: true },
  });
  if (!item) return null;
  try {
    const person = seedOf(decrypt(item.accessTokenEncrypted)).person;
    return person && isPersonId(person) ? person : null;
  } catch {
    return null;
  }
}

// Whether a demo-bank person has an employer (the original demo bank does; the freelancer, the
// retiree and the business owner do not), for the sample pay stub and the sample FSA.
export async function demoHasEmployer(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const person = await demoPersonFor(userId, { client });
  return person === null || personById(person)?.facts.income === "salary";
}

// The extras a demo item has, keeping only ones the demo bank knows (spec step 159).
export const demoExtrasOf = (stored: readonly string[]): DemoExtra[] =>
  stored.filter((e): e is DemoExtra => (DEMO_EXTRAS as readonly string[]).includes(e));

// Links a stand-in extra (a demo HSA, spec step 159) to the person's demo bank. Returns the
// demo item's id, or null without a demo bank. The caller refreshes the investments.
export async function addDemoExtra(
  userId: string,
  extra: DemoExtra,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const db = scopedFor(userId, client);
  const item = await db.plaidItems.findFirst({
    where: MAIN_DEMO_ITEM,
    select: { id: true, demoExtras: true },
  });
  if (!item) return null;
  if (!item.demoExtras.includes(extra)) {
    await db.plaidItems.updateMany({
      where: { id: item.id },
      data: { demoExtras: [...item.demoExtras, extra] },
    });
    await logAudit(
      { type: "user", id: userId },
      "item_linked",
      { type: "plaid_item", id: item.id },
      { demo: true, extra },
    );
  }
  return item.id;
}

// Books QA: a sample person with a second bank login (the Reyes' joint savings, through each
// parent's login) gets it as a second demo item, once, after their demo bank's first sync.
// Returns the new item's id for the caller to sync, or null.
export async function ensureDemoSecondLogin(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const db = scopedFor(userId, client);
  const main = await db.plaidItems.findFirst({
    where: MAIN_DEMO_ITEM,
    select: { accessTokenEncrypted: true },
  });
  if (!main) return null;
  const demo = seedOf(decrypt(main.accessTokenEncrypted));
  const login = demo.person ? DEMO_SECOND_LOGINS[demo.person as PersonId] : undefined;
  if (!login) return null;
  const plaidItemId = `${DEMO_ITEM_PREFIX}${demo.seed}-${login.login}`;
  if (await db.plaidItems.findFirst({ where: { plaidItemId }, select: { id: true } })) return null;
  const item = await db.plaidItems.create({
    data: {
      userId,
      plaidItemId,
      accessTokenEncrypted: encrypt(
        `${DEMO_TOKEN_PREFIX}${demo.seed}:${demo.anchor}:${demo.person}:${login.login}`,
      ),
      institutionName: DEMO_INSTITUTION,
      liabilities: false,
      investments: false,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "item_linked",
    { type: "plaid_item", id: item.id },
    { institution: DEMO_INSTITUTION, demo: true, login: login.login },
  );
  return item.id;
}
