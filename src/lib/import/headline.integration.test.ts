import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));
vi.mock("@/lib/jane-agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jane-agent/run")>()),
  runJaneAgentSafely: vi.fn(),
}));

import { setUploadedBalance } from "./account-balance";
import { finishImport } from "./background";
import { saveUpload } from "./upload";
import { scopedFor } from "@/lib/db-scoped";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { loadNetWorthHistory } from "@/lib/net-worth-history";

// The headline is the latest balance anyone knows (founder: Home showed a figure months stale
// when an account's months were uploaded oldest first), and the line ends there, moving on every
// day money moved. Against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

// Chase checking with a running balance. July–August, then September–October.
const HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
const older = [
  HEADER,
  "DEBIT,08/20/2026,VERIZON WIRELESS,-85.00,ACH_DEBIT,3915.00,,",
  "CREDIT,08/01/2026,ACME CORP PAYROLL PPD,2000.00,ACH_CREDIT,4000.00,,",
  "CREDIT,07/01/2026,ACME CORP PAYROLL PPD,2000.00,ACH_CREDIT,2000.00,,",
].join("\n");
const newer = [
  HEADER,
  "DEBIT,10/20/2026,VERIZON WIRELESS,-85.00,ACH_DEBIT,7745.00,,",
  "CREDIT,10/01/2026,ACME CORP PAYROLL PPD,2000.00,ACH_CREDIT,7830.00,,",
  "DEBIT,09/20/2026,VERIZON WIRELESS,-85.00,ACH_DEBIT,5830.00,,",
  "CREDIT,09/01/2026,ACME CORP PAYROLL PPD,2000.00,ACH_CREDIT,5915.00,,",
].join("\n");

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("Home's net worth after uploads, against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  const person = async () => {
    const id = (
      await client.user.create({ data: { email: `headline-${crypto.randomUUID()}@example.com` } })
    ).id;
    users.push(id);
    return id;
  };
  // Upload then the background's work, as the chip waits for it.
  const upload = async (
    userId: string,
    fields: Record<string, string>,
    name: string,
    text: string,
  ) => {
    const result = await saveUpload(scopedFor(userId, client), form(fields, name, text));
    if (!result.ok) throw new Error(result.error);
    await finishImport(userId, result.runId, { client, now: NOW });
    return result.accountId;
  };
  const NEW = { accountId: "new", "new.name": "Chase checking", "new.kind": "checking" };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("takes the newest statement's balance, whichever order the months come in", async () => {
    const oldestFirst = await person();
    const account = await upload(oldestFirst, NEW, "jul-aug.CSV", older);
    await upload(oldestFirst, { accountId: account }, "sep-oct.CSV", newer);
    expect((await loadNetWorthHistory(oldestFirst, { client, now: NOW }))?.todayCents).toBe(774500);

    const newestFirst = await person();
    const other = await upload(newestFirst, NEW, "sep-oct.CSV", newer);
    await upload(newestFirst, { accountId: other }, "jul-aug.CSV", older);
    expect((await loadNetWorthHistory(newestFirst, { client, now: NOW }))?.todayCents).toBe(774500);
  });

  it("keeps a balance the person typed over a statement that ends before it", async () => {
    const id = await person();
    const account = await upload(id, NEW, "sep-oct.CSV", newer);
    await setUploadedBalance(scopedFor(id, client), account, 800000);
    await upload(id, { accountId: account }, "sep-oct (1).CSV", newer);
    expect((await loadNetWorthHistory(id, { client, now: NOW }))?.todayCents).toBe(800000);
  });

  it("draws a line that ends at the headline and steps on each day money moved", async () => {
    const id = await person();
    const account = await upload(id, NEW, "jul-aug.CSV", older);
    await upload(id, { accountId: account }, "sep-oct.CSV", newer);
    const today = (await loadNetWorthHistory(id, { client, now: NOW }))!.todayCents;
    const line = await netWorthHistory(id, today, { client, now: NOW });
    const on = (day: string) => line.find((p) => p.date === day)?.cents;
    expect(line.at(-1)).toEqual({ date: "2026-10-27", cents: 774500 });
    // The day before today is the same money: no jump at the end.
    expect(on("2026-10-26")).toBe(774500);
    // Every day the statements moved, the line moved with them.
    expect(on("2026-09-01")).toBe(591500);
    expect(on("2026-09-20")).toBe(583000);
    expect(on("2026-10-01")).toBe(783000);
    expect(on("2026-10-20")).toBe(774500);
  });
});
