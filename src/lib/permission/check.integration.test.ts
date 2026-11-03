import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { SPECIALISTS, YES_CAP_CENTS } from "@/config/specialists";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { PrismaClient } from "@/generated/prisma/client";

const audits: { event: string; metadata: Record<string, unknown> }[] = [];
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  SYSTEM_ACTOR: { type: "system", id: null },
  logAudit: vi.fn(
    async (_actor: unknown, event: string, _target: unknown, metadata: Record<string, unknown>) => {
      audits.push({ event, metadata });
    },
  ),
}));

import { linkDemoBank } from "@/lib/plaid/demo";
import { standInPartner } from "@/lib/money-movement/partner";
import { mayAct, setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadTimeline } from "@/lib/timeline";
import { checkPermission, PermissionRefused, throughPermission, type ActRequest } from "./check";
import { actsStopped, setActsStopped } from "./stop";

// The one permission check, against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const LATER = new Date("2026-10-19T15:00:00Z");

const request = (over: Partial<ActRequest> = {}): ActRequest => ({
  specialist: "money_movement",
  what: "Scheduled $25.00 to Chase",
  sector: "bills",
  cents: 2_500,
  authority: { kind: "yes" },
  undo: { kind: "window", until: LATER, href: "/transfers" },
  ...over,
});
const standing = { kind: "standing", sector: "bills", needs: "safe" } as const;

describe.runIf(url)("the permission check", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const options = () => ({ client, now: NOW });
  const act = vi.fn(async () => "did it");

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    audits.length = 0;
    act.mockClear();
  });

  async function person(id?: string) {
    const user = await client.user.create({
      data: { ...(id ? { id } : {}), email: `permission-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function demoPerson() {
    const userId = await person();
    await linkDemoBank(userId, { client, now: NOW });
    return userId;
  }
  // A real account: statements they uploaded.
  async function realPerson() {
    const userId = await person();
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    return userId;
  }
  const refused = () => audits.filter((a) => a.event === "jane_act_refused");
  const allowed = () => audits.filter((a) => a.event === "jane_act_allowed");

  it("the flags that keep real accounts read-only are all off", () => {
    expect(REAL_MONEY_MOVEMENT).toBe(false);
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(CONCIERGE_ACTIONS.realAccounts).toBe(false);
    expect(SPECIALISTS.every((s) => s.kind === "stand_in")).toBe(true);
  });

  it("refuses every acting specialist on a real account, and audits it", async () => {
    const userId = await realPerson();
    for (const s of SPECIALISTS.filter((x) => x.access === "acts")) {
      await expect(
        throughPermission(userId, request({ specialist: s.key }), options(), act),
      ).rejects.toMatchObject({ reason: "read_only" });
    }
    expect(act).not.toHaveBeenCalled();
    expect(refused().length).toBe(SPECIALISTS.filter((x) => x.access === "acts").length);
    expect(await client.janeAct.count({ where: { userId } })).toBe(0);
  });

  it("a yes passes on the demo bank, with the act on the record, audited and simulated", async () => {
    const userId = await demoPerson();
    await expect(throughPermission(userId, request(), options(), act)).resolves.toBe("did it");
    expect(act).toHaveBeenCalledTimes(1);
    expect(allowed()).toHaveLength(1);
    expect(allowed()[0].metadata).toMatchObject({
      specialist: "money_movement",
      authority: "yes",
      cents: 2_500,
      simulated: true,
    });
    const [row] = await client.janeAct.findMany({ where: { userId } });
    expect(row).toMatchObject({
      status: "done",
      simulated: true,
      what: "Scheduled $25.00 to Chase",
      why: "You said yes.",
      undoHref: "/transfers",
    });
    expect(row.undoUntil).toEqual(LATER);
  });

  it("the grant lets the connector run inside, only there", async () => {
    const userId = await demoPerson();
    const { partnerRef } = await throughPermission(userId, request(), options(), () =>
      standInPartner.schedule({
        fromAccountId: "a",
        toAccountId: null,
        toName: "Chase",
        amountCents: 2_500,
        runOn: "2026-10-19",
        memo: "bill",
      }),
    );
    expect(partnerRef).toMatch(/^SIMXFER-/);
  });

  it("marks the act failed when the connector fails, and doesn't swallow it", async () => {
    const userId = await demoPerson();
    await expect(
      throughPermission(userId, request(), options(), async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    const [row] = await client.janeAct.findMany({ where: { userId } });
    expect(row.status).toBe("failed");
    expect(await loadTimeline(userId, { client, now: NOW })).toEqual([]);
  });

  it("the stop-all switch stops yeses and standing limits alike, and can be turned back", async () => {
    const userId = await demoPerson();
    await setActsStopped(userId, true, options());
    expect(await actsStopped(userId, { client })).toBe(true);
    expect(audits.map((a) => a.event)).toContain("jane_acts_stopped");
    await expect(throughPermission(userId, request(), options(), act)).rejects.toMatchObject({
      reason: "stopped",
    });
    await expect(
      throughPermission(userId, request({ authority: standing }), options(), act),
    ).rejects.toMatchObject({ reason: "stopped" });
    // What runs on its own hears it from mayAct, with no error to catch.
    expect(await mayAct(userId, "bills", { needs: "safe", cents: 0 }, options())).toMatchObject({
      ok: false,
      reason: "stopped",
    });
    expect(act).not.toHaveBeenCalled();
    expect(refused()[0].metadata).toMatchObject({ reason: "stopped" });

    await setActsStopped(userId, false, options());
    await expect(throughPermission(userId, request(), options(), act)).resolves.toBe("did it");
  });

  it("a standing limit needs their level and fits their caps", async () => {
    const userId = await demoPerson();
    // "Ask me first" is the default: no standing limit at all.
    expect(await checkPermission(userId, request({ authority: standing }), options())).toEqual({
      ok: false,
      reason: "level",
    });
    await client.user.update({ where: { id: userId }, data: { autopilot: "safe" } });
    await setSectorAutopilot(
      userId,
      "bills",
      { level: "safe", actionCapCents: 3_000, monthlyCapCents: 4_000 },
      options(),
    );
    const ok = await checkPermission(userId, request({ authority: standing }), options());
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.why).toContain("within the limits you set");
    expect(
      await checkPermission(userId, request({ authority: standing, cents: 3_001 }), options()),
    ).toEqual({ ok: false, reason: "action_cap" });
    await client.autopilotAct.create({
      data: { userId, sector: "bills", cents: 3_000, what: "x", createdAt: NOW },
    });
    expect(await checkPermission(userId, request({ authority: standing }), options())).toEqual({
      ok: false,
      reason: "monthly_cap",
    });
  });

  it("a yes has a cap too", async () => {
    const userId = await demoPerson();
    expect(
      await checkPermission(userId, request({ cents: YES_CAP_CENTS.stand_in + 1 }), options()),
    ).toEqual({ ok: false, reason: "over_cap" });
  });

  it("a yes on a decision must still stand", async () => {
    const userId = await demoPerson();
    expect(
      await checkPermission(
        userId,
        request({ authority: { kind: "yes", decisionId: "no-such-decision" } }),
        options(),
      ),
    ).toEqual({ ok: false, reason: "no_yes" });
  });

  it("keeps an undo window only while it's open", async () => {
    const userId = await demoPerson();
    const open = await checkPermission(userId, request(), options());
    expect(open).toMatchObject({ ok: true, undoUntil: LATER });
    const passed = await checkPermission(userId, request(), {
      client,
      now: new Date(LATER.getTime() + 1),
    });
    expect(passed).toMatchObject({ ok: true, undoUntil: null });
    const none = await checkPermission(
      userId,
      request({ undo: { kind: "none", why: "A simulated fill." } }),
      options(),
    );
    expect(none).toMatchObject({ ok: true, undoUntil: null });
  });

  it("a trial person only ever gets a simulated act", async () => {
    const userId = await person(`${TRIAL_ID_PREFIX}${crypto.randomUUID()}`);
    const verdict = await checkPermission(
      userId,
      request({ specialist: "email_agent", cents: 0 }),
      options(),
    );
    expect(verdict).toMatchObject({ ok: true, simulated: true });
  });

  it("PermissionRefused says why, in the person's words", () => {
    expect(new PermissionRefused("read_only").message).toContain("only reads real accounts");
  });

  it("the record shows each act once, labelled simulated, with the older row folded in", async () => {
    const userId = await demoPerson();
    await throughPermission(userId, request(), options(), act);
    // The sector's own record of the same act, as recordAct leaves it.
    await client.autopilotAct.create({
      data: { userId, sector: "bills", cents: 2_500, what: "the same act", createdAt: NOW },
    });
    // And a different one, with no act behind it: still listed.
    await client.autopilotAct.create({
      data: { userId, sector: "goals", cents: 0, what: "tuned a budget", createdAt: NOW },
    });
    const timeline = await loadTimeline(userId, { client, now: NOW });
    expect(timeline.map((e) => e.what).sort()).toEqual([
      "Scheduled $25.00 to Chase",
      "tuned a budget",
    ]);
    expect(timeline.find((e) => e.what.startsWith("Scheduled"))).toMatchObject({
      simulated: true,
      by: "you",
      undoHref: "/transfers",
    });
    // Past its window it can't be undone from here.
    const later = await loadTimeline(userId, { client, now: new Date(LATER.getTime() + 1) });
    expect(later.find((e) => e.what.startsWith("Scheduled"))?.undoHref).toBeNull();
  });
});
