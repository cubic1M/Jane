import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { AssetError, addAsset, listAssets, removeAsset, updateAsset } from "./owned-assets";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("things you own against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  async function person() {
    const user = await client.user.create({
      data: { email: `asset-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = (name: string, type: string, subtype: string, balance: number | null) =>
      client.account.create({
        data: {
          userId: user.id,
          source: "plaid",
          name,
          type,
          subtype,
          currentBalanceCents: balance,
        },
      });
    return {
      id: user.id,
      mortgage: await account("Home Loan", "loan", "mortgage", 31_240_000),
      carLoan: await account("Car Loan", "loan", "auto", null),
      checking: await account("Checking", "depository", "checking", 250_000),
    };
  }
  const form = (overrides = {}) => ({
    kind: "home",
    name: "Our house",
    value: "450000",
    valuedOn: "2026-09-01",
    loanAccountId: "",
    ...overrides,
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

  it("adds a home with its mortgage and shows the equity", async () => {
    const me = await person();
    await addAsset(me.id, form({ loanAccountId: me.mortgage.id }), opts());

    expect(await listAssets(me.id, opts())).toEqual([
      {
        id: expect.any(String),
        kind: "home",
        name: "Our house",
        valueCents: 45_000_000,
        valuedOn: "2026-09-01",
        stale: false,
        loan: { id: me.mortgage.id, name: "Home Loan", balanceCents: 31_240_000 },
        equityCents: 45_000_000 - 31_240_000,
      },
    ]);
    // Never an amount in analytics.
    expect(track).toHaveBeenCalledWith(me.id, "asset_added", { kind: "home", with_loan: true });
  });

  it("has no equity without a loan balance, and marks a value over a year old", async () => {
    const me = await person();
    await addAsset(
      me.id,
      form({ kind: "vehicle", name: "Car", value: "18000", valuedOn: "2025-09-30" }),
      opts(),
    );
    await addAsset(
      me.id,
      form({ kind: "vehicle", name: "Truck", value: "9000", loanAccountId: me.carLoan.id }),
      opts(),
    );
    const [car, truck] = await listAssets(me.id, opts());
    expect(car).toMatchObject({ name: "Car", stale: true, loan: null, equityCents: null });
    expect(truck).toMatchObject({ name: "Truck", stale: false, equityCents: null });
    expect(truck.loan?.balanceCents).toBeNull();
  });

  it("updates and removes, tracking each without amounts", async () => {
    const me = await person();
    const id = await addAsset(me.id, form(), opts());

    await updateAsset(
      me.id,
      id,
      form({ value: "475,000", valuedOn: "2026-10-18", loanAccountId: me.mortgage.id }),
      opts(),
    );
    const [line] = await listAssets(me.id, opts());
    expect(line).toMatchObject({ valueCents: 47_500_000, valuedOn: "2026-10-18" });
    expect(line.loan?.id).toBe(me.mortgage.id);
    expect(track).toHaveBeenCalledWith(me.id, "asset_updated", { kind: "home", with_loan: true });

    await removeAsset(me.id, id, { client });
    expect(await listAssets(me.id, opts())).toEqual([]);
    expect(track).toHaveBeenCalledWith(me.id, "asset_removed");
    await expect(removeAsset(me.id, id, { client })).rejects.toBeInstanceOf(AssetError);
  });

  it("only links the person's own loan accounts", async () => {
    const me = await person();
    const other = await person();
    // Another person's mortgage.
    await expect(
      addAsset(me.id, form({ loanAccountId: other.mortgage.id }), opts()),
    ).rejects.toThrow("isn't one of your accounts");
    // Their own account, but not a loan.
    await expect(
      addAsset(me.id, form({ loanAccountId: me.checking.id }), opts()),
    ).rejects.toBeInstanceOf(AssetError);

    const id = await addAsset(me.id, form(), opts());
    await expect(
      updateAsset(me.id, id, form({ loanAccountId: other.mortgage.id }), opts()),
    ).rejects.toBeInstanceOf(AssetError);
    expect((await listAssets(me.id, opts()))[0].loan).toBeNull();
    expect(track).not.toHaveBeenCalledWith(me.id, "asset_updated", expect.anything());
  });

  it("keeps each person's things to themselves", async () => {
    const me = await person();
    const other = await person();
    const id = await addAsset(me.id, form(), opts());

    expect(await listAssets(other.id, opts())).toEqual([]);
    await expect(updateAsset(other.id, id, form({ value: "1" }), opts())).rejects.toThrow(
      "isn't one of yours",
    );
    await expect(removeAsset(other.id, id, { client })).rejects.toBeInstanceOf(AssetError);
    expect((await listAssets(me.id, opts()))[0].valueCents).toBe(45_000_000);
  });

  it("keeps the thing when its loan account goes away", async () => {
    const me = await person();
    await addAsset(me.id, form({ loanAccountId: me.mortgage.id }), opts());
    await client.account.delete({ where: { id: me.mortgage.id } });
    const [line] = await listAssets(me.id, opts());
    expect(line).toMatchObject({ valueCents: 45_000_000, loan: null, equityCents: null });
  });
});
