import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A partner's word about a person's link, through the real webhook intake against a real database:
// found by the partner's id for the link, applied only to that person's link, replays ignored, and
// a link Jane hasn't stored yet sent back for later.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { randomBytes } from "node:crypto";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import {
  FAKE_WEBHOOK_SECRET_ENV,
  fakeConnector,
  fakeWebhook,
  signedHeaders,
} from "./__fixtures__/connectors";
import { realPerson, removePeople } from "./__fixtures__/people";
import { useConnectorsForTests } from "./registry";
import type { Connector, LinkEvent } from "./types";
import { storeCredential } from "./vault";
import { receiveWebhook } from "./webhooks";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "fake-webhook-secret-for-tests";
const system = () => systemDb("Test: reads what a link event changed", db);

// The fake partner also sends link events: {"link": "<its id>", "change": "..."}.
const linking: Connector = {
  ...fakeConnector().connector,
  webhook: {
    signing: fakeWebhook.signing,
    parse: (body) => {
      const event = body as { id?: string; link?: string; change?: LinkEvent["change"] };
      if (typeof event.link === "string" && event.change) {
        return { kind: "link", eventId: event.id ?? "", linkRef: event.link, change: event.change };
      }
      return fakeWebhook.parse(body);
    },
  },
};

describe.runIf(url)("link events through the webhook intake", () => {
  const people: string[] = [];
  const env = { CONNECTORS: "1", [FAKE_WEBHOOK_SECRET_ENV]: SECRET };
  const send = (body: object, now = new Date()) => {
    const raw = JSON.stringify(body);
    return receiveWebhook(linking.id, raw, signedHeaders(raw, SECRET, now), {
      client: db,
      now,
      env,
    });
  };
  const status = async (userId: string) =>
    system().connectorCredential.findUniqueOrThrow({
      where: { userId_connectorId: { userId, connectorId: linking.id } },
      select: { status: true, refreshedAt: true },
    });

  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    useConnectorsForTests([linking]);
  });
  afterEach(() => {
    useConnectorsForTests(null);
    vi.unstubAllEnvs();
  });
  afterAll(async () => removePeople(db, people));

  it("marks only the named link to reconnect, then active again, and stamps fresh data", async () => {
    const mine = await realPerson(db);
    const theirs = await realPerson(db);
    people.push(mine, theirs);
    const ref = `link_${randomBytes(6).toString("hex")}`;
    await storeCredential(mine, linking.id, "token-mine", { client: db, linkRef: ref });
    await storeCredential(theirs, linking.id, "token-theirs", {
      client: db,
      linkRef: `${ref}_other`,
    });

    expect(await send({ id: `${ref}-1`, link: ref, change: "disconnected" })).toMatchObject({
      status: 200,
    });
    expect((await status(mine)).status).toBe("needs_relink");
    expect((await status(theirs)).status).toBe("active");

    // The same delivery again is a repeat, nothing more.
    expect((await send({ id: `${ref}-1`, link: ref, change: "disconnected" })).body).toMatchObject({
      repeat: true,
    });

    const at = new Date();
    await send({ id: `${ref}-2`, link: ref, change: "refreshed" }, at);
    expect((await status(mine)).refreshedAt?.getTime()).toBe(at.getTime());
    await send({ id: `${ref}-3`, link: ref, change: "reconnected" });
    expect((await status(mine)).status).toBe("active");

    const audit = await system().auditLog.findMany({
      where: { targetId: mine, event: "connector_link_changed" },
      select: { metadata: true },
    });
    expect(audit.map((a) => (a.metadata as { change: string }).change).sort()).toEqual([
      "disconnected",
      "reconnected",
      "refreshed",
    ]);
  });

  it("sends back a link it doesn't know yet, so the partner tries again later", async () => {
    const unknown = `link_${randomBytes(6).toString("hex")}`;
    expect(await send({ id: `${unknown}-1`, link: unknown, change: "disconnected" })).toMatchObject(
      { status: 409 },
    );
    // Not remembered as delivered: the retry is taken once the link is stored.
    const person = await realPerson(db);
    people.push(person);
    await storeCredential(person, linking.id, "token", { client: db, linkRef: unknown });
    expect(await send({ id: `${unknown}-1`, link: unknown, change: "disconnected" })).toMatchObject(
      { status: 200 },
    );
    expect((await status(person)).status).toBe("needs_relink");
  });

  it("puts a link back to active when the person links again", async () => {
    const person = await realPerson(db);
    people.push(person);
    const ref = `link_${randomBytes(6).toString("hex")}`;
    await storeCredential(person, linking.id, "token", { client: db, linkRef: ref });
    await send({ id: `${ref}-1`, link: ref, change: "disconnected" });
    await storeCredential(person, linking.id, "token-new", { client: db, linkRef: ref });
    expect((await status(person)).status).toBe("active");
  });
});
