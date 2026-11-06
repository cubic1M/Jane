import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { loadCreditCards } from "./credit-cards";
import { loadTightMoney } from "./tight-money";

// Night round 11-06, sample people at 3pm and 7pm in Los Angeles, when UTC is already tomorrow:
// the debt person's tight-money answer went from "8 requests could ease it" to "7", and the
// family's best card from "about $924.22 a year after its fee" to "$923.27". Both took UTC's day
// while the detection input they read takes the person's.
const url = process.env.TEST_DATABASE_URL;
const AFTERNOON = new Date("2026-11-05T23:00:00Z");
const EVENING = new Date("2026-11-06T03:00:00Z");

describe.runIf(url)("debt answers across the evening", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const person = async (life: "debt" | "family") => {
    const id = await createCheckPerson({ client, now: AFTERNOON, person: life });
    made.push(id);
    return id;
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    for (const id of made) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it("keeps tight money's requests the same at 3pm and 7pm", async () => {
    const id = await person("debt");
    const afternoon = await loadTightMoney(id, { client, now: AFTERNOON });
    const evening = await loadTightMoney(id, { client, now: EVENING });
    expect(afternoon.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(evening)).toBe(JSON.stringify(afternoon));
  });

  it("keeps the card picks the same at 3pm and 7pm", async () => {
    const id = await person("family");
    const afternoon = await loadCreditCards(id, { client, now: AFTERNOON });
    const evening = await loadCreditCards(id, { client, now: EVENING });
    expect(JSON.stringify(evening)).toBe(JSON.stringify(afternoon));
  });
});
