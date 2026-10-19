import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { exportUserData } from "@/lib/data-export";
import { dismissGap, saveHousehold } from "./household";
import {
  EMPTY_POLICY_INPUT,
  PolicyError,
  addPolicy,
  listPolicies,
  removePolicy,
  updatePolicy,
} from "./policies";
import { DEMO_POLICY, ensureDemoPolicies, loadInsurance } from "./profile";
import { confirmReading, listReadings } from "./readings";

// The insurance profile against a real, migrated Postgres (spec step 102).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T12:00:00Z");

describe.runIf(url)("the insurance profile against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  async function person() {
    const user = await client.user.create({
      data: { email: `ins-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    return user.id;
  }
  const account = (userId: string, type: string, subtype: string) =>
    client.account.create({
      data: { userId, source: "plaid", name: `${subtype} account`, type, subtype },
    });
  const policyDocument = (userId: string, over: Record<string, unknown> = {}) =>
    client.document.create({
      data: {
        userId,
        kind: "insurance_policy",
        fileName: "policy.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        encryptedBytes: Buffer.from("x"),
        provider: "State Farm",
        policyType: "renters",
        premiumCents: 1_500,
        premiumFrequency: "monthly",
        renewalDate: new Date("2027-02-01T00:00:00Z"),
        coverageSummary: "Your belongings and liability cover.",
        extractionSource: "claude",
        ...over,
      },
    });
  const opts = () => ({ client, now: NOW });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(() => vi.mocked(track).mockClear());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("adds, updates and removes a typed policy, only the person's own", async () => {
    const me = await person();
    const other = await person();
    const id = await addPolicy(
      me,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "auto",
        carrier: "Progressive",
        premium: "600",
        premiumFrequency: "semiannual",
        deductible: "500",
        coverage: { collision: "yes", comprehensive: "no" },
      },
      opts(),
    );
    expect(track).toHaveBeenCalledWith(me, "insurance_policy_added", {
      kind: "auto",
      source: "typed",
    });
    const [saved] = await listPolicies(me, opts());
    expect(saved).toMatchObject({
      id,
      carrier: "Progressive",
      premiumCents: 60_000,
      premiumFrequency: "semiannual",
      deductibleCents: 50_000,
      coverage: { collision: true, comprehensive: false },
      source: "typed",
      status: "active",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: me },
      "insurance_policy_saved",
      { type: "insurance_policy", id },
      { kind: "auto" },
    );

    await expect(
      updatePolicy(other, id, { ...EMPTY_POLICY_INPUT, carrier: "Mine now" }, opts()),
    ).rejects.toThrow(PolicyError);
    await expect(removePolicy(other, id, opts())).rejects.toThrow(PolicyError);

    await updatePolicy(
      me,
      id,
      { ...EMPTY_POLICY_INPUT, carrier: "Progressive", deductible: "1000" },
      opts(),
    );
    expect((await listPolicies(me, opts()))[0].deductibleCents).toBe(100_000);
    await removePolicy(me, id, opts());
    expect(await listPolicies(me, opts())).toEqual([]);
    expect(await client.insurancePolicy.count({ where: { id } })).toBe(0);
  });

  it("reads each uploaded policy document to confirm, adding it once, even after it's removed", async () => {
    const me = await person();
    const doc = await policyDocument(me);
    await policyDocument(me, { provider: null });
    await client.document.create({
      data: {
        userId: me,
        kind: "receipt",
        fileName: "r.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        encryptedBytes: Buffer.from("x"),
        provider: "Target",
      },
    });
    // Spec step 151: read for the person to confirm; nothing is on their insurance before.
    expect(await listPolicies(me, opts())).toEqual([]);
    await loadInsurance(me, opts());
    const [reading, ...others] = await listReadings(me, opts());
    expect(others).toEqual([]);
    await confirmReading(me, reading.id, opts());
    const [policy, ...rest] = await listPolicies(me, opts());
    expect(rest).toEqual([]);
    expect(policy).toMatchObject({
      kind: "renters",
      carrier: "State Farm",
      source: "document",
      premiumCents: 1_500,
      premiumFrequency: "monthly",
      renewalDate: "2027-02-01",
      covers: "Your belongings and liability cover.",
      documentId: doc.id,
    });
    await removePolicy(me, policy.id, opts());
    await loadInsurance(me, opts());
    expect(await listPolicies(me, opts())).toEqual([]);
    expect(await listReadings(me, opts())).toHaveLength(1);
    // Kept as removed, so the document doesn't add it back.
    expect(await client.insurancePolicy.findUnique({ where: { id: policy.id } })).toMatchObject({
      status: "removed",
    });
  });

  it("reads the household from the accounts, takes what the person says, and finds gaps", async () => {
    const me = await person();
    await account(me, "loan", "mortgage");
    await account(me, "loan", "auto");
    let profile = await loadInsurance(me, opts());
    expect(profile.household.housing).toEqual({ value: "own", from: "accounts" });
    expect(profile.household.vehicles).toEqual({ value: 1, from: "accounts" });
    expect(profile.gaps.map((g) => g.key)).toEqual(["home", "auto"]);

    await saveHousehold(me, { housing: "rent", vehicles: "0", dependants: "1", pets: "" }, opts());
    profile = await loadInsurance(me, opts());
    expect(profile.gaps.map((g) => g.key)).toEqual(["renters", "life"]);

    expect(await dismissGap(me, "life", opts())).toBe(true);
    expect(await dismissGap(me, "life", opts())).toBe(false);
    profile = await loadInsurance(me, opts());
    expect(profile.gaps.map((g) => g.key)).toEqual(["renters"]);
    // Saving the facts again keeps the dismissed gap.
    await saveHousehold(me, { housing: "rent", vehicles: "0", dependants: "1", pets: "1" }, opts());
    // A pet brings up pet cover too (spec step 149).
    expect((await loadInsurance(me, opts())).gaps.map((g) => g.key)).toEqual(["renters", "pet"]);
  });

  it("sees rent payments as renting", async () => {
    const me = await person();
    const checking = await account(me, "depository", "checking");
    await client.transaction.create({
      data: {
        userId: me,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: 180_000,
        description: "RENT",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    expect((await loadInsurance(me, opts())).household.housing).toEqual({
      value: "rent",
      from: "accounts",
    });
  });

  it("adds the demo bank's sample policy once", async () => {
    const me = await person();
    expect(await ensureDemoPolicies(me, opts())).toBe(true);
    expect(await ensureDemoPolicies(me, opts())).toBe(false);
    const [policy] = await listPolicies(me, opts());
    expect(policy).toMatchObject({
      carrier: "GEICO",
      source: "demo",
      premiumCents: DEMO_POLICY.premiumCents,
      renewalDate: "2026-11-28",
    });
    await removePolicy(me, policy.id, opts());
    expect(await ensureDemoPolicies(me, opts())).toBe(false);
  });

  it("puts every policy and the household in the data download", async () => {
    const me = await person();
    await addPolicy(me, { ...EMPTY_POLICY_INPUT, kind: "pet", carrier: "Lemonade" }, opts());
    await saveHousehold(me, { housing: "own", vehicles: "", dependants: "", pets: "1" }, opts());
    const data = await exportUserData(me, { client });
    expect(data.insurance.policies).toHaveLength(1);
    expect(data.insurance.policies[0]).toMatchObject({ kind: "pet", carrier: "Lemonade" });
    expect(data.insurance.household).toMatchObject({ housing: "own", pets: 1 });
  });
});
