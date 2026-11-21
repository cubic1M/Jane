import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PrismaClient } from "@/generated/prisma/client";
import { FORECAST_DAYS } from "@/config/detection";
import { forecastAccounts } from "@/detection/forecast";
import { loadDetectionInput } from "@/detection/input";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { scopedFor } from "@/lib/db-scoped";
import { loadHubTop } from "@/lib/hub/load";
import { cashFlowView, heroView } from "@/lib/hub/view";
import { finishImport } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { answerByRules } from "@/lib/jane-agent/answer";
import { parseIntent } from "@/lib/jane-agent/intents";
import { chatToday } from "@/lib/today";
import { atLocal } from "./diff";

const url = process.env.TEST_DATABASE_URL;
const ZONE = "America/Los_Angeles";

// Upload S7's shape: $1,500 from Stanford on the 1st and the 15th, rent on the 3rd, Comcast on the
// 7th, Jun 1 – Oct 20.
function statement(): string {
  const rows: [string, string, number][] = [];
  for (let m = 6; m <= 10; m += 1) {
    const mm = String(m).padStart(2, "0");
    rows.push([`2026-${mm}-01`, "STANFORD UNIV DES:PAYROLL ID:X", 150_000]);
    if (m > 6) rows.push([`2026-${mm}-03`, "ESSEX PROPERTY DES:RENT ID:XXX", -98_000]);
    rows.push([`2026-${mm}-07`, "COMCAST CALIFORNIA DES:PAYMENT", -8_999]);
    rows.push([`2026-${mm}-15`, "STANFORD UNIV DES:PAYROLL ID:X", 150_000]);
  }
  rows.push(["2026-10-20", "CHECKCARD TRADER JOES #127", -1_499]);
  rows.sort((a, b) => b[0].localeCompare(a[0]));
  let balance = 1_059_707;
  const money = (c: number) => (c / 100).toFixed(2);
  const lines = rows.map(([date, description, cents]) => {
    const [y, m, d] = date.split("-");
    const line = [
      cents < 0 ? "DEBIT" : "CREDIT",
      `${m}/${d}/${y}`,
      `"${description}"`,
      money(cents),
      "ACH_DEBIT",
      money(balance),
      "",
    ].join(",");
    balance -= cents;
    return line;
  });
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...lines,
    "",
  ].join("\n");
}

// Manager, 11-20 (#2203's follow-up): an upload's pay schedule is judged where its statement ends, so
// read long after, what does Home's safe to spend, the forecast and "when do I get paid?" say? Upload
// S7's shape, a statement to Oct 20, read 31, 36, 46 and 200 days on (past BALANCE_ROLL_MAX_DAYS, 35,
// and STALE_UPLOAD_DAYS, 45). With #2203 alone, 46 days on said "Your next payday is Dec 15 (in 10
// days)" and Home's strip marked Dec 15's and Jan 1's pay, 200 days on "Your next payday is May 15":
// nothing else presents now from those statements. A payday from a statement too old to walk to today
// isn't expected (src/detection/paydays.ts), and the chat says where the statements end.
describe.runIf(url)("an S7-shaped statement read long after it ends", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    stubTestKeys();
    vi.stubEnv("SYNC_SNAPSHOTS", "off");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    const uploaded = atLocal("2026-10-21", 9, ZONE);
    vi.setSystemTime(uploaded);
    await client.user.deleteMany({ where: { email: "old-statement-paydays-d2@example.test" } });
    userId = (
      await client.user.create({
        data: { email: "old-statement-paydays-d2@example.test", timezone: ZONE },
      })
    ).id;
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", "Bank of America checking");
    form.set("new.kind", "checking");
    form.append("files", new File([statement()], "statement.csv", { type: "text/csv" }));
    const saved = await saveUpload(scopedFor(userId, client), form, { client });
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(userId, saved.runId, { client, now: uploaded });
  }, 300_000);

  afterAll(async () => {
    vi.useRealTimers();
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const read = async (day: string) => {
    const now = atLocal(day, 15, ZONE);
    vi.setSystemTime(now);
    const top = await loadHubTop(userId, { client, now });
    const asOf = await chatToday(userId, { client, now });
    const ask = async (q: string) =>
      (await answerByRules(userId, parseIntent(q, asOf), { client, now }))?.body ?? null;
    const [account] = forecastAccounts(
      await loadDetectionInput(userId, { client, now }),
      FORECAST_DAYS,
    );
    return {
      safe: top!.home.safeToSpend,
      tile: heroView(top!.hero).safe,
      strip: cashFlowView(top!.cashFlow),
      income: account!.income.map((p) => p.date),
      paid: await ask("when do I get paid"),
      safeChat: await ask("what's safe to spend"),
    };
  };
  const OLD =
    "Your statements end Oct 20, 2026, so I can't say when you're paid next. Upload newer statements and I'll work it out.";

  it("31 days on, walked to today: the payday, said with the estimate", async () => {
    const r = await read("2026-11-20");
    expect(r.safe).toMatchObject({ payday: "2026-12-01" });
    expect(r.tile?.label).toBe("Safe to spend until Dec 1");
    expect(r.paid).toBe(
      "Your next payday is Dec 1 (in 11 days): about $1,500.00 from Stanford Univ.",
    );
    expect(r.safeChat).toContain("+$1,930 of pay and bills expected since your Oct 20 statement");
  });

  for (const [day, days] of [
    ["2026-11-25", 36],
    ["2026-12-05", 46],
    ["2027-05-08", 200],
  ] as const) {
    it(`${days} days on: no payday, bill or safe to spend as if current`, async () => {
      const r = await read(day);
      expect(r.safe).toBeNull();
      expect(r.tile).toBeNull();
      expect(r.income).toEqual([]);
      expect(r.paid).toBe(OLD);
      // From 36 days, not only past STALE_UPLOAD_DAYS: the strip lists none of the statement's bills,
      // which with no pay beside them read as a shortfall, and the chat doesn't ask for a balance
      // (manager, 11-20: Nov 25 listed rent Dec 3 and Comcast Dec 7).
      expect(r.strip.events).toEqual([]);
      expect(r.strip.empty).toBe(
        "Your statements end Oct 20, 2026: upload newer ones to see what's due now.",
      );
      expect(r.safeChat).toBe(
        "Your statements end Oct 20, 2026, so I can't say what's safe to spend today. Upload newer statements and I'll work it out.",
      );
    });
  }
});
