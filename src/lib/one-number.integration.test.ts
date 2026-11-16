import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { plansFor } from "@/lib/digest/send";
import { explainFigure } from "@/lib/figures";
import { loadHubTop } from "@/lib/hub/load";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { loadMoneyHub } from "@/lib/hubs/money";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadClose, runMonthClose } from "@/lib/month-close";
import { formatCents } from "@/lib/money";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (mvp-ready.md): a figure shown in more than one place is the
// same to the cent everywhere, for every sample person on the demo bank, whose second login is an
// account linked twice. Each surface is loaded the way its page, tool or email loads it; the
// figures and the one function each comes from are listed in docs/one-number.md.

const url = process.env.TEST_DATABASE_URL;
// Wednesday Nov 4, 2026, 9am in Los Angeles: October's close has run, and a week back is inside
// every person's history.
const NOW = new Date("2026-11-04T17:00:00Z");

type Shown = Record<string, number | string | null>;

// Every surface's net worth today, in cents; a surface that only says it in words counts as the
// headline's cents when its words are the headline's, and shows its own words when not.
async function netWorths(userId: string, client: PrismaClient) {
  const o = { client, now: NOW };
  const headline = (await loadNetWorthHistory(userId, o))!.todayCents;
  const said = (words: string | null) => (words === formatCents(headline) ? headline : words);
  const [top, money, hub, chat, working, plans] = await Promise.all([
    loadHubTop(userId, o),
    loadMoneyArea(userId, o),
    loadMoneyHub(userId, o),
    runChatTool(userId, "net_worth", {}, o),
    explainFigure(userId, "net_worth", o),
    plansFor(userId, NOW, client),
  ]);
  await runMonthClose(userId, o);
  const close = await loadClose(userId, { client, month: "2026-10" });
  const line = await netWorthHistory(userId, headline, o);
  const shown: Shown = {
    "home headline": top!.hero.netWorth?.todayCents ?? null,
    "home line, today": line.at(-1)!.cents,
    "money page": money!.have.netCents,
    "money hub": hub.netWorth.netCents,
    "weekly email": plans.netWorth?.nowCents ?? null,
    "month close": close?.figures.netWorthCents ?? null,
    chat: said((JSON.parse(chat.content) as { netWorth: string | null }).netWorth),
    "explain figure": said(working!.value),
  };
  return { headline, shown, line };
}

// The last day of a YYYY-MM month.
const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

describe.runIf(url)("one number, one source", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const person = async (id: PersonId) => {
    const user = await client.user.create({
      data: { email: `one-number-${id}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, now: NOW });
    return user.id;
  };

  it.each(PEOPLE.map((p) => p.id))("%s: net worth is the headline's everywhere", async (id) => {
    const userId = await person(id);
    const { headline, shown, line } = await netWorths(userId, client);
    expect(shown).toEqual(Object.fromEntries(Object.keys(shown).map((k) => [k, headline])));

    // And on every day of the line, as the month-end figures say: the line reads what the
    // headline reads, so an account linked twice counts once on every day, not only today.
    const months = (await loadNetWorthHistory(userId, { client, now: NOW }))!.months;
    const onLine = new Map(line.map((p) => [p.date, p.cents]));
    const ends = months
      .slice(0, -1)
      .flatMap((m) =>
        m.netCents !== null && onLine.has(monthEnd(m.month))
          ? [{ month: m.month, monthly: m.netCents, line: onLine.get(monthEnd(m.month)) }]
          : [],
      );
    expect(ends.length).toBeGreaterThan(0);
    expect(ends.map((m) => [m.month, m.line])).toEqual(ends.map((m) => [m.month, m.monthly]));
  });
});
