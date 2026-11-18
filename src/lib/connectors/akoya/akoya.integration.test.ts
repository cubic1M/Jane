import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { documentPartnerFor } from "@/lib/tax-docs";
import { collectTaxDocuments, loadTaxDocuments } from "@/lib/tax-documents";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { realPerson, removePeople } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";

// Akoya's Tax API against a real, migrated Postgres, on the demo bank: a sample person who allows
// the sandbox twin has their 2026 forms collected in February through Akoya's shape and mapping,
// agreeing with their accounts like the demo partner's; nobody else is collected for through Akoya.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const FEB = new Date("2027-02-10T16:00:00Z");
const network = vi.fn(() => {
  throw new Error("no network in tests");
});

describe.runIf(url)("Akoya as the tax document partner", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  let sample: string;
  let real: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `akoya-${crypto.randomUUID()}@example.com` },
    });
    sample = user.id;
    created.push(sample);
    const { itemId } = await linkDemoBank(sample, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    real = await realPerson(client);
    created.push(real);
  }, 120_000);
  afterAll(async () => {
    await removePeople(client, created);
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps the demo partner until the person allows Akoya, and with connectors off", async () => {
    expect((await documentPartnerFor(sample, { client }))?.name).toBe("demo");
    vi.stubEnv("CONNECTORS", "");
    expect((await documentPartnerFor(sample, { client }))?.name).toBe("demo");
  });

  it("collects a sample person's forms through Akoya once they allow it, and they check out", async () => {
    await grantConsent(sample, "sandbox_akoya_tax", ["read_accounts"], { client });
    expect((await documentPartnerFor(sample, { client }))?.name).toBe("akoya (sandbox)");
    const { collected } = await collectTaxDocuments(sample, { client, now: FEB, tick: false });
    expect(collected).toBeGreaterThan(0);
    const view = await loadTaxDocuments(sample, 2026, { client, now: FEB });
    const fromAkoya = view.forms.filter((f) => f.document?.partner === "akoya (sandbox)");
    expect(fromAkoya.length).toBe(collected);
    // The finding it feeds: forms that arrived on their own and agree with the accounts.
    expect(fromAkoya.every((f) => f.usable)).toBe(true);
    // Akoya doesn't carry W-2s: those stay to be asked for.
    expect(fromAkoya.some((f) => f.formKey === "w2")).toBe(false);
  });

  it("never collects through Akoya for a real person", async () => {
    await expect(
      grantConsent(real, "akoya_tax", ["read_accounts"], { client }),
    ).rejects.toBeInstanceOf(ConsentError);
    await expect(
      grantConsent(real, "sandbox_akoya_tax", ["read_accounts"], { client }),
    ).rejects.toBeInstanceOf(ConsentError);
    expect(await documentPartnerFor(real, { client })).toBeNull();
  });
});
