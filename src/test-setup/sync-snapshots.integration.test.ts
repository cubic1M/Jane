import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { findingFingerprint } from "@/lib/jane-agent/snapshot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { fingerprint, rowOf, rowsOf } from "./sync-snapshots";

// The demo-sync snapshots (src/test-setup/sync-snapshots.ts) give a person exactly what their own
// sync would have written: a person synced for real and one given a copy hold the same rows in
// every table, ids and timestamps aside, and stay the same through a second, real sync.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const LATER = new Date("2026-10-25T15:00:00Z");

it("masks an id whole, even one holding a long run of hex characters", () => {
  const row = (id: string) => ({
    key: `renewal:${id}:2026-10`,
    hash: "3f9a0c4e1b7d2a6f8e5c0b9a1d3f7e2c",
  });
  const plain = fingerprint({ findings: [row("cmvq0b6p70000abcdxyz12345")] }, {}, {});
  const hexy = fingerprint({ findings: [row("cmvq0123456789abcdef0g885")] }, {}, {});
  expect(hexy).toBe(plain);
  expect(plain).toContain("renewal:<id>:2026-10");
  expect(plain).toContain("<hex>");
});

describe.runIf(url)("demo-sync snapshots", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(id: "family" | undefined, snapshots: "on" | "off") {
    const user = await client.user.create({
      data: { email: `snapshot-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    vi.stubEnv("SYNC_SNAPSHOTS", snapshots === "off" ? "off" : "");
    await syncItem(itemId, { client, api: plaid, now: NOW });
    vi.stubEnv("SYNC_SNAPSHOTS", "");
    return { userId: user.id, itemId };
  }
  const state = async (p: { userId: string; itemId: string }) =>
    fingerprint(
      await rowsOf(client, p.userId),
      (await rowOf(client, "users", p.userId))!,
      (await rowOf(client, "plaid_items", p.itemId))!,
    );

  it.each([undefined, "family"] as const)("a copy holds what was copied (%s)", async (id) => {
    // The first is synced for real and kept; the next, the same in every way, gets a copy. (The
    // demo bank's amounts follow its random seed, so two real syncs differ too, by design.)
    const kept = await person(id, "on");
    const copy = await person(id, "on");
    const counts = async (u: string) =>
      Object.fromEntries(Object.entries(await rowsOf(client, u)).map(([t, r]) => [t, r.length]));
    expect(await counts(copy.userId)).toEqual(await counts(kept.userId));
    expect(await state(copy)).toBe(await state(kept));
    // A message about a finding still matches it: its fingerprint is the copied finding's.
    const messages = await client.janeMessage.findMany({ where: { userId: copy.userId } });
    let checked = 0;
    for (const m of messages) {
      const refs = m.refs as { findingId?: string; fingerprint?: string } | null;
      if (!refs?.findingId || !refs.fingerprint) continue;
      const finding = await client.finding.findUniqueOrThrow({ where: { id: refs.findingId } });
      expect(finding.userId).toBe(copy.userId);
      expect(refs.fingerprint).toBe(findingFingerprint(finding));
      checked += 1;
    }
    // The plain demo person's first scan posts messages about findings (the others' may not).
    if (id === undefined) expect(checked).toBeGreaterThan(0);
    // A later sync, for real on both, adds the same accounts and transactions. (What it finds in
    // them follows each item's own seed, as for any two people.)
    await syncItem(kept.itemId, { client, api: plaid, now: LATER });
    await syncItem(copy.itemId, { client, api: plaid, now: LATER });
    const a = await counts(kept.userId);
    const b = await counts(copy.userId);
    for (const t of ["accounts", "transactions", "liabilities", "holdings"])
      expect(b[t], t).toBe(a[t]);
  });

  it("a person with anything different syncs for real", async () => {
    vi.stubEnv("SYNC_SNAPSHOTS", "debug");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.map(String).join(" "));
    });
    const first = await person(undefined, "on");
    const user = await client.user.create({
      data: { email: `snapshot-${crypto.randomUUID()}@example.com`, timezone: "Europe/Paris" },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    vi.stubEnv("SYNC_SNAPSHOTS", "debug");
    await syncItem(itemId, { client, api: plaid, now: NOW });
    spy.mockRestore();
    expect(first.userId).not.toBe(user.id);
    expect(logs.filter((l) => l.includes("[sync-snapshots] copy"))).toEqual([]);
  });
});
