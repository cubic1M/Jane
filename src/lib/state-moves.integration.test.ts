import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { SAMPLE_DRAFT_NAME } from "@/config/documents";
import { encrypt, encryptBytes } from "@/lib/crypto";
import { adviceMode } from "./advice-mode";
import { deleteAllData } from "./account-deletion";
import { createCalendarToken, userForCalendarToken } from "./calendar";
import { DEMO_TOKEN_PREFIX } from "./plaid/demo";
import { signOutOtherSessions } from "./user-sessions";

// What a person could do in one state and still have in the next.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T12:00:00Z");

describe.runIf(url)("moving between states", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `moves-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user;
  }
  async function demoPerson() {
    const user = await person();
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt(`${DEMO_TOKEN_PREFIX}1:2026-01-01`),
      },
    });
    return user;
  }
  const document = (userId: string, fileName: string, extractionSource = "none") =>
    client.document.create({
      data: {
        userId,
        kind: "tax_return",
        fileName,
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: encryptBytes(Buffer.from("pdf")),
        extractionSource,
      },
    });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  describe("a document of their own, then the demo bank", () => {
    it("gives no sample advice with a real document on file", async () => {
      const { id } = await demoPerson();
      expect(await adviceMode(id, { client })).toBe(true);
      await document(id, "2025 return.pdf");
      expect(await adviceMode(id, { client })).toBe(REAL_ACCOUNT_ADVICE);
    });

    it("isn't turned off by the sample draft or a demo switch's papers", async () => {
      const { id } = await demoPerson();
      await document(id, SAMPLE_DRAFT_NAME);
      await document(id, "Lighthouse declarations.pdf", "partner");
      expect(await adviceMode(id, { client })).toBe(true);
    });
  });

  it("stops a copied calendar link when they sign out their other devices", async () => {
    const { id } = await person();
    const token = await createCalendarToken(id, { client, now: NOW });
    await client.session.createMany({
      data: [
        { sessionToken: `here-${id}`, userId: id, expires: new Date("2031-01-01") },
        { sessionToken: `there-${id}`, userId: id, expires: new Date("2031-01-01") },
      ],
    });
    expect(await userForCalendarToken(token, { client })).toBe(id);
    expect(await signOutOtherSessions(id, `here-${id}`, { client, now: NOW })).toBe(1);
    expect(await userForCalendarToken(token, { client })).toBeNull();
  });

  it("forgets the address on a code locked to it, and nobody else can use that code", async () => {
    const { id, email } = await person();
    const code = `LOCKED-${crypto.randomUUID()}`;
    await client.inviteCode.create({ data: { code, email, maxUses: 1 } });
    await deleteAllData(id, { client });
    const left = await client.inviteCode.findUniqueOrThrow({ where: { code } });
    expect(left.email).toBeNull();
    expect(left.revokedAt).not.toBeNull();
    await client.inviteCode.delete({ where: { code } });
  });
});
