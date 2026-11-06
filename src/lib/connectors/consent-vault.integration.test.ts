import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Consent and the vault against a real, migrated Postgres, through the settings page's own actions.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId })),
  getCurrentUser: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { allowConnector, revokeConnector } from "@/app/settings/connections/actions";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { keyIdOf } from "@/lib/crypto";
import { rotateKeys } from "@/lib/key-rotation";
import { systemDb } from "@/lib/system-db";
import { fakeConnector, fakeSandbox } from "./__fixtures__/connectors";
import { realPerson, removePeople, samplePerson, trialPerson } from "./__fixtures__/people";
import {
  ConsentError,
  connectionsView,
  consentCovers,
  currentScopes,
  grantConsent,
  revokeConsent,
} from "./consent";
import { useConnectorsForTests } from "./registry";
import {
  NoCredential,
  deleteCredential,
  hasCredential,
  storeCredential,
  withCredential,
} from "./vault";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the vault and consent wrote", db);
const KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET = "partner-secret-6f1c2a9e-never-shown";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of [value].flat()) data.append(name, one);
  }
  return data;
};

describe.runIf(url)("connector consent and the vault", () => {
  const people: string[] = [];
  const said: string[] = [];
  let real: string;
  let other: string;
  let sample: string;
  let trial: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    real = await realPerson(db);
    other = await realPerson(db);
    sample = await samplePerson(db);
    trial = await trialPerson(db);
    people.push(real, other, sample, trial);
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    // A real fake connector, switched on for this test only through the sandbox flag's opposite:
    // the sandbox one serves sample people, and the "real" one is refused (switched off in code).
    useConnectorsForTests([fakeConnector().connector, fakeSandbox().connector]);
    said.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(() => {
    useConnectorsForTests(null);
    vi.restoreAllMocks();
  });

  describe("the vault", () => {
    it("keeps a credential encrypted and opens it only inside a callback", async () => {
      await storeCredential(real, "fake_bills", SECRET);
      const row = await system().connectorCredential.findUniqueOrThrow({
        where: { userId_connectorId: { userId: real, connectorId: "fake_bills" } },
      });
      expect(row.secretEncrypted).not.toContain(SECRET);
      expect(row.secretEncrypted.startsWith("v1.")).toBe(true);
      await expect(withCredential(real, "fake_bills", async (s) => s.length)).resolves.toBe(
        SECRET.length,
      );
      expect(await hasCredential(real, "fake_bills")).toBe(true);
    });

    it("never opens one person's credential for another", async () => {
      await storeCredential(real, "fake_bills", SECRET);
      await expect(withCredential(other, "fake_bills", async (s) => s)).rejects.toThrow(
        NoCredential,
      );
      expect(await hasCredential(other, "fake_bills")).toBe(false);
      expect(await deleteCredential(other, "fake_bills")).toBe(false);
      expect(await hasCredential(real, "fake_bills")).toBe(true);
    });

    it("refuses an expired credential, and one that won't decrypt, without saying why", async () => {
      const now = new Date("2026-11-06T12:00:00Z");
      await storeCredential(real, "fake_bills", SECRET, { expiresAt: new Date(now.getTime() - 1) });
      await expect(withCredential(real, "fake_bills", async (s) => s, { now })).rejects.toThrow(
        NoCredential,
      );
      await storeCredential(real, "fake_bills", SECRET);
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
      const error = await withCredential(real, "fake_bills", async (s) => s).catch((e) => e);
      expect(error).toBeInstanceOf(NoCredential);
      expect(String(error)).not.toContain(SECRET);
    });

    it("rotates with the other secrets", async () => {
      await storeCredential(real, "fake_bills", SECRET);
      vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${Buffer.alloc(32, 3).toString("base64")}`);
      vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "k2");
      try {
        await rotateKeys({ type: "system", id: null }, { client: db, userIds: [real] });
        const row = await system().connectorCredential.findUniqueOrThrow({
          where: { userId_connectorId: { userId: real, connectorId: "fake_bills" } },
        });
        expect(keyIdOf(row.secretEncrypted)).toBe("k2");
        await expect(withCredential(real, "fake_bills", async (s) => s === SECRET)).resolves.toBe(
          true,
        );
      } finally {
        vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
        vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
      }
    });

    it("never writes the secret to the audit log or the console", async () => {
      await storeCredential(real, "fake_bills", SECRET);
      await withCredential(real, "fake_bills", async () => null);
      await deleteCredential(real, "fake_bills");
      const audit = await system().auditLog.findMany({
        where: { targetId: real, event: { startsWith: "connector_credential" } },
      });
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      expect(said.join("\n")).not.toContain(SECRET);
    });
  });

  describe("consent", () => {
    it("is refused while CONNECTORS is off", async () => {
      vi.stubEnv("CONNECTORS", "");
      await expect(grantConsent(sample, "fake_sandbox", ["pay_bills"])).rejects.toMatchObject({
        reason: "off",
      });
    });

    it("gives the sandbox to sample data only, and a real connector to nobody yet", async () => {
      await expect(grantConsent(real, "fake_sandbox", ["pay_bills"])).rejects.toMatchObject({
        reason: "sandbox_for_samples",
      });
      await expect(grantConsent(real, "fake_bills", ["pay_bills"])).rejects.toMatchObject({
        reason: "switched_off",
      });
      await expect(grantConsent(trial, "fake_bills", ["pay_bills"])).rejects.toMatchObject({
        reason: "trial",
      });
      await expect(grantConsent(sample, "fake_bills", ["pay_bills"])).rejects.toMatchObject({
        reason: "real_for_real",
      });
    });

    it("takes only the scopes the connector asks for", async () => {
      await expect(grantConsent(sample, "fake_sandbox", ["move_own_money"])).rejects.toThrow(
        ConsentError,
      );
      await expect(grantConsent(sample, "fake_sandbox", ["made_up"])).rejects.toThrow(ConsentError);
      await expect(grantConsent(sample, "nope", ["pay_bills"])).rejects.toMatchObject({
        reason: "unknown",
      });
    });

    it("records the grant, covers the connector, and keeps history when revoked", async () => {
      const { connector } = fakeSandbox();
      await grantConsent(sample, "fake_sandbox", ["pay_bills"]);
      expect(await currentScopes(sample, "fake_sandbox")).toEqual(["pay_bills"]);
      expect(await consentCovers(sample, connector)).toBe(true);
      await storeCredential(sample, "fake_sandbox", SECRET);
      expect(await revokeConsent(sample, "fake_sandbox")).toBe(true);
      expect(await consentCovers(sample, connector)).toBe(false);
      expect(await hasCredential(sample, "fake_sandbox")).toBe(false);
      expect(await revokeConsent(sample, "fake_sandbox")).toBe(false);
      const view = await connectionsView(sample);
      expect(view.current).toEqual([]);
      expect(view.past[0]).toMatchObject({
        connectorId: "fake_sandbox",
        connectorName: "Fake Sandbox",
      });
      expect(view.available.map((c) => c.id)).toEqual(["fake_sandbox"]);
      const events = await system().auditLog.findMany({
        where: { targetId: sample, event: { startsWith: "connector_consent" } },
        select: { event: true },
      });
      expect(events.map((e) => e.event)).toEqual(
        expect.arrayContaining(["connector_consent_granted", "connector_consent_revoked"]),
      );
    });

    it("never shows a real person the sandbox, nor anything while off", async () => {
      expect((await connectionsView(real)).available).toEqual([]);
      vi.stubEnv("CONNECTORS", "");
      expect((await connectionsView(sample)).available).toEqual([]);
    });
  });

  describe("the settings page's actions", () => {
    it("allow and revoke for the signed-in person", async () => {
      session.userId = sample;
      await allowConnector(form({ connectorId: "fake_sandbox", scope: ["pay_bills"] }));
      expect(await currentScopes(sample, "fake_sandbox")).toEqual(["pay_bills"]);
      await revokeConnector(form({ connectorId: "fake_sandbox" }));
      expect(await currentScopes(sample, "fake_sandbox")).toBeNull();
    });

    it("can't revoke someone else's consent or reach their credential", async () => {
      const victim = await samplePerson(db);
      const attacker = await samplePerson(db);
      people.push(victim, attacker);
      await grantConsent(victim, "fake_sandbox", ["pay_bills"]);
      await storeCredential(victim, "fake_sandbox", SECRET);
      session.userId = attacker;
      await revokeConnector(form({ connectorId: "fake_sandbox" }));
      await revokeConnector(form({ connectorId: "fake_sandbox", userId: victim }));
      expect(await currentScopes(victim, "fake_sandbox")).toEqual(["pay_bills"]);
      expect(await hasCredential(victim, "fake_sandbox")).toBe(true);
      expect(await currentScopes(attacker, "fake_sandbox")).toBeNull();
    });

    it("answer 404 while CONNECTORS is off", async () => {
      vi.stubEnv("CONNECTORS", "");
      session.userId = sample;
      await expect(
        allowConnector(form({ connectorId: "fake_sandbox", scope: ["pay_bills"] })),
      ).rejects.toThrow();
      await expect(revokeConnector(form({ connectorId: "fake_sandbox" }))).rejects.toThrow();
    });
  });
});
