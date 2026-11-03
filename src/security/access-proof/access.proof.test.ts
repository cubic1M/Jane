import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The access proof (docs/security/access-proof.md), after OWASP's authorization testing matrix: every
// route handler, server action and page, called as nobody, as a stranger with the victim's ids, as a
// trial person and as a household partner, against a real database whose every owned table holds a
// marked row of the victim's. Run with ACCESS_PROOF=1 and TEST_DATABASE_URL on a throwaway local
// database; CI has a job of its own for it.

const acting = vi.hoisted(() => {
  if (process.env.ACCESS_PROOF === "1") {
    const url = process.env.TEST_DATABASE_URL ?? "";
    // This writes all over the database it is given: never anything but a local one.
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("The access proof runs only on a local TEST_DATABASE_URL.");
    }
    process.env.DATABASE_URL = url;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    process.env.AUTH_SECRET = "access-proof";
    // Not real: enough for email to reach the point where the probes stop and read it.
    process.env.RESEND_API_KEY = "not-a-real-key";
    process.env.EMAIL_FROM = "access-proof@example.com";
  }
  return { cookie: null as string | null, after: [] as (() => unknown)[] };
});

// Auth.js itself can't load outside Next.js, so its session lookup is this: the same adapter read
// and the same payload (src/auth.ts), on the session cookie. The rest of src/lib/session.ts is real.
vi.mock("@/auth", async () => {
  const { db } = await import("@/lib/db");
  const { createAuthAdapter } = await import("@/lib/auth-adapter");
  const { sessionPayload } = await import("@/lib/auth-session");
  const adapter = createAuthAdapter(db);
  const none = async () => new Response(null, { status: 404 });
  return {
    auth: async () => {
      if (!acting.cookie) return null;
      const found = await adapter.getSessionAndUser!(acting.cookie);
      if (!found || found.session.expires <= new Date()) return null;
      return sessionPayload(found);
    },
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: { GET: none, POST: none },
    googleEnabled: false,
  };
});
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => {
  const jar = () => {
    const values = new Map<string, string>(
      acting.cookie ? [["authjs.session-token", acting.cookie]] : [],
    );
    return {
      get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
      has: (name: string) => values.has(name),
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => void values.set(name, value),
      delete: (name: string) => void values.delete(name),
    };
  };
  return {
    cookies: async () => jar(),
    headers: async () =>
      new Headers({
        "user-agent": "access-proof",
        "x-forwarded-for": "127.0.0.1",
        host: "localhost",
      }),
    draftMode: async () => ({ isEnabled: false }),
  };
});
vi.mock("next/font/google", () => {
  const font = () => ({ className: "", variable: "", style: {} });
  return { Playfair_Display: font, Geist: font, Geist_Mono: font };
});
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
  unstable_cache: (fn: unknown) => fn,
  unstable_noStore: () => undefined,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
  after: (work: unknown) => {
    if (typeof work === "function") acting.after.push(work as () => unknown);
  },
}));

import { ACCESS_MAP, accessKind, type AccessKind } from "@/config/access-map";
import { invitePartner } from "@/lib/household";
import { callsOf, type Answer, type RouteOptions } from "./invoke";
import {
  asSystem,
  clearRateLimits,
  closeSystem,
  installProbes,
  installWriteLog,
  removeWriteLog,
  seen,
  setVictims,
  takeWrites,
  watch,
} from "./probe";
import { findMarker } from "./scan";
import { allSurfaces, type Surface } from "./surfaces";
import { describe as say, judge, type Attacker } from "./verdict";
import {
  leaveHouseholdRow,
  makeReal,
  PEOPLE,
  plantHousehold,
  plantPerson,
  restorePerson,
  SHARED_MARKER,
  type Person,
} from "./world";

const FIXTURE = "src/security/access-proof/fixtures/broken-surfaces.ts";

// A write a call may make on someone else's rows, and why it's fine.
const ALLOWED_WRITES: Record<string, { attacker?: Attacker; tables: string[]; why: string }> = {
  "GET /api/digest/click": {
    tables: ["digests", "analytics_events"],
    why: "An emailed link: its id is the secret. It marks that digest opened, nothing else.",
  },
  "src/app/household/actions.ts#leave": {
    attacker: "partner",
    tables: ["shared_charges", "settlements", "household_invites"],
    why: "Leaving ends what the pair shared: their shared bills, settlements and open invites.",
  },
};

// `ACCESS_ONLY=documents npm run test:access` attacks just the files with that in their path.
const only = process.env.ACCESS_ONLY;
const surfacesToAttack = () =>
  allSurfaces().filter((surface) => !only || surface.file.includes(only));

// How many calls must get the victim's id as far as a database query. Set a little under what a run
// reaches, so a change that stops the attacks at validation fails instead of quietly proving less.
const FLOORS: Record<string, Record<string, number>> = {
  stranger: { action: 75, route: 5 },
  trial: { action: 70, route: 5 },
  "real-on-trial": { action: 75, route: 5 },
  partner: { action: 90, route: 5, page: 20 },
};

// How many of a person's own pages must show their marker when they look.
const OWNER_SEES_FLOOR = 100;

function expectFloors(label: string, tally: Tally) {
  if (only) return;
  for (const [kind, floor] of Object.entries(FLOORS[label] ?? {})) {
    expect(
      tally.landed[kind] ?? 0,
      `${label}: ${kind}s reaching the database`,
    ).toBeGreaterThanOrEqual(floor);
  }
}

type Failure = { attacker: string; call: string; problems: string[] };
type Tally = {
  calls: number;
  landed: Record<string, number>;
  failures: Failure[];
  // What the id never got as far as the database in, and how each one answered: where the attack
  // proved less. Read this before believing a green run on a new action.
  stopped: string[];
  // Queries that read the victim's marker and went no further. Not a failure (a read followed by an
  // ownership check is fine), but it's where a leak would start.
  readMarker: string[];
};

const reports: Record<string, unknown> = {};

async function runCall(
  name: string,
  surface: Surface,
  access: AccessKind,
  attacker: Attacker,
  actor: Person | null,
  victim: Person,
  run: () => Promise<Answer>,
) {
  await clearRateLimits();
  await takeWrites();
  acting.cookie = actor?.sessionToken ?? null;
  watch(victim);
  const answer = await run();
  for (const work of acting.after.splice(0)) {
    await Promise.resolve()
      .then(work)
      .catch(() => undefined);
  }
  const writes = await takeWrites();
  const traffic = seen();
  const allowance = ALLOWED_WRITES[name];
  const allowed = !allowance?.attacker || allowance.attacker === attacker ? allowance : undefined;
  const problems = judge({
    access,
    attacker,
    answer,
    writes,
    traffic,
    victim,
    actorId: actor?.userId ?? null,
    allowedWrites: allowed?.tables,
  });
  return { name, answer, writes, traffic, problems };
}

// Every way in on the list, with one attacker and one victim.
async function attackAll(
  label: string,
  attacker: Attacker,
  actor: Person | null,
  victim: Person,
  surfaces: Surface[],
  { restore, options }: { restore?: () => Promise<void>; options?: RouteOptions } = {},
): Promise<Tally> {
  const tally: Tally = { calls: 0, landed: {}, failures: [], stopped: [], readMarker: [] };
  const started = Date.now();
  await setVictims([victim.rowId]);
  for (const surface of surfaces) {
    const access = accessKind(ACCESS_MAP[surface.file]);
    for (const { name, run } of await callsOf(surface, victim, options)) {
      const result = await runCall(name, surface, access, attacker, actor, victim, run);
      tally.calls++;
      if (result.traffic.landed) {
        tally.landed[surface.kind] = (tally.landed[surface.kind] ?? 0) + 1;
      } else {
        tally.stopped.push(`${name}: ${say(result.answer)}`);
      }
      for (const query of result.traffic.markerRead) tally.readMarker.push(`${name}: ${query}`);
      if (result.problems.length > 0) {
        tally.failures.push({ attacker: label, call: name, problems: result.problems });
      }
      // Their own account changed, signed out, or left the household: put them back for the next.
      const touched = result.writes.some(
        (w) =>
          w.tbl === "users" ||
          w.tbl === "household_members" ||
          (w.tbl === "sessions" && w.op === "DELETE"),
      );
      if (actor && touched) await restore?.();
    }
  }
  reports[label] = { ...tally, seconds: Math.round((Date.now() - started) / 1000) };
  console.log(
    `[access proof] ${label}: ${tally.calls} calls, id reached the database in`,
    tally.landed,
  );
  return tally;
}

const listed = (kinds: Surface["kind"][]) =>
  surfacesToAttack().filter((surface) => kinds.includes(surface.kind));

describe.runIf(process.env.ACCESS_PROOF === "1")("the access proof", () => {
  const { alice, bob, dana, tess, hana } = PEOPLE;
  const replant: Record<string, () => Promise<unknown>> = {
    bob: async () => {
      await plantPerson(bob);
      await makeReal(bob);
    },
    tess: () => plantPerson(tess),
    dana: async () => {
      await plantPerson(dana);
      await plantHousehold(hana, dana);
    },
  };

  beforeAll(async () => {
    installProbes();
    await installWriteLog();
    const planted = await plantPerson(alice);
    await plantPerson(tess);
    await replant.bob();
    await plantPerson(hana);
    await replant.dana();
    await takeWrites();
    // A table a victim has no row in is a table this proves nothing about.
    expect([...planted.failures]).toEqual([]);
  }, 600_000);

  afterAll(async () => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/access-proof.json", JSON.stringify(reports, null, 1));
    await removeWriteLog();
    await closeSystem();
  });

  it("can see a leak when there is one", async () => {
    // The victim, reading their own export: if this is empty the marker isn't where it should be.
    const [own] = await callsOf({ file: "src/app/api/export/route.ts", kind: "route" }, alice);
    const mine = await runCall(
      own.name,
      { file: "", kind: "route" },
      "signed-in",
      "stranger",
      alice,
      alice,
      own.run,
    );
    expect(findMarker(mine.answer.value, alice.marker), say(mine.answer)).toBeTruthy();

    // The broken ways in (fixtures/broken-surfaces.ts): each one must be caught, for the right reason.
    const broken = await callsOf({ file: FIXTURE, kind: "action" }, alice);
    const named = (name: string) => broken.find((c) => c.name.endsWith(`#${name}`))!;
    const surface = { file: FIXTURE, kind: "action" as const };
    const read = await runCall(
      "read",
      surface,
      "signed-in",
      "stranger",
      bob,
      alice,
      named("readsAnyonesRow").run,
    );
    expect(read.problems.join()).toContain("leak");
    const wrote = await runCall(
      "write",
      surface,
      "signed-in",
      "stranger",
      bob,
      alice,
      named("writesAnyonesRow").run,
    );
    expect(wrote.problems.join()).toContain("wrote to the victim's rows");
    const open = await runCall(
      "open",
      surface,
      "signed-in",
      "nobody",
      null,
      alice,
      named("GET").run,
    );
    expect(open.problems.join()).toContain("not refused");
  });

  it("the owner sees their marker on their own pages, so its absence means something", async () => {
    const reads = surfacesToAttack().filter(
      (surface) =>
        accessKind(ACCESS_MAP[surface.file]) === "signed-in" &&
        (surface.kind === "page" || /\/(export|download)\//.test(surface.file)),
    );
    const showing: string[] = [];
    const blank: string[] = [];
    for (const surface of reads) {
      for (const { name, run } of await callsOf(surface, alice)) {
        const seenByOwner = await runCall(
          name,
          surface,
          "signed-in",
          "stranger",
          alice,
          alice,
          run,
        );
        (findMarker(seenByOwner.answer.value, alice.marker) ? showing : blank).push(name);
      }
    }
    reports.owner = { showing, blank };
    console.log(`[access proof] owner: marker on ${showing.length} of ${reads.length} pages`);
    if (!only) expect(showing.length).toBeGreaterThanOrEqual(OWNER_SEES_FLOOR);
  }, 300_000);

  it("every way in refuses nobody", async () => {
    const { failures } = await attackAll("nobody", "nobody", null, alice, surfacesToAttack());
    expect(failures).toEqual([]);
  }, 600_000);

  it("a stranger with the victim's ids gets nothing and changes nothing", async () => {
    const tally = await attackAll("stranger", "stranger", bob, alice, surfacesToAttack(), {
      restore: () => restorePerson(bob, replant.bob),
    });
    expect(tally.failures).toEqual([]);
    expectFloors("stranger", tally);
  }, 900_000);

  it("a trial person gets nothing of a real person's, and leaves no trace outside", async () => {
    const tally = await attackAll("trial", "trial", tess, alice, listed(["route", "action"]), {
      restore: () => restorePerson(tess, replant.tess),
    });
    expect(tally.failures).toEqual([]);
    expectFloors("trial", tally);

    // A trial's time is up: the same session opens nothing.
    const route = { file: "src/app/api/export/route.ts", kind: "route" as const };
    const [exportCall] = await callsOf(route, alice);
    await asSystem((sql) =>
      sql(`UPDATE sessions SET expires = now() - interval '1 hour' WHERE user_id = $1`, [
        tess.userId,
      ]),
    );
    const ended = await runCall(
      exportCall.name,
      route,
      "signed-in",
      "nobody",
      tess,
      alice,
      exportCall.run,
    );
    expect(ended.problems).toEqual([]);
    await restorePerson(tess, replant.tess);
  }, 600_000);

  it("a real person gets nothing of a trial person's", async () => {
    const tally = await attackAll(
      "real-on-trial",
      "stranger",
      bob,
      tess,
      listed(["route", "action"]),
      {
        restore: () => restorePerson(bob, replant.bob),
      },
    );
    expect(tally.failures).toEqual([]);
    expectFloors("real-on-trial", tally);
  }, 600_000);

  it("a household partner sees what's shared and nothing else, until they leave", async () => {
    const page = { file: "src/app/household/page.tsx", kind: "page" as const };
    const [view] = await callsOf(page, hana);
    const shared = await runCall(view.name, page, "signed-in", "partner", dana, hana, view.run);
    // What was shared really shows, so the rest of this proves something.
    expect(findMarker(shared.answer.value, SHARED_MARKER), say(shared.answer)).toBeTruthy();
    expect(shared.problems).toEqual([]);

    const tally = await attackAll("partner", "partner", dana, hana, surfacesToAttack(), {
      restore: async () => {
        await restorePerson(dana, replant.dana);
        await leaveHouseholdRow(dana);
        await plantHousehold(hana, dana);
      },
    });
    expect(tally.failures).toEqual([]);
    expectFloors("partner", tally);

    await leaveHouseholdRow(dana);
    const after = await runCall(view.name, page, "signed-in", "partner", dana, hana, view.run);
    expect(findMarker(after.answer.value, SHARED_MARKER)).toBeNull();
    expect(after.problems).toEqual([]);

    // An invite for someone else, used by a stranger who got hold of the link: they stay out.
    const { token } = await invitePartner(
      { id: hana.userId, email: hana.email },
      "someone-else@example.com",
    );
    const actions = { file: "src/app/household/actions.ts", kind: "action" as const };
    const form = new FormData();
    form.set("token", token);
    acting.cookie = bob.sessionToken;
    const { join } = await import("@/app/household/actions");
    expect(await join(null, form)).toMatchObject({ ok: false });
    const [bobView] = await callsOf(page, hana);
    const stranger = await runCall(
      bobView.name,
      actions,
      "signed-in",
      "stranger",
      bob,
      hana,
      bobView.run,
    );
    expect(findMarker(stranger.answer.value, SHARED_MARKER)).toBeNull();
    expect(stranger.problems).toEqual([]);
  }, 900_000);

  it("a wrong secret opens no cron job and no webhook", async () => {
    process.env.CRON_SECRET = "right-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_right";
    const surfaces = surfacesToAttack().filter((s) => {
      const kind = accessKind(ACCESS_MAP[s.file]);
      return kind === "cron" || kind === "webhook";
    });
    const { failures } = await attackAll("wrong secret", "stranger", bob, alice, surfaces, {
      options: {
        headers: {
          authorization: "Bearer wrong-secret",
          "stripe-signature": "t=1,v1=wrong",
          "plaid-verification": "wrong",
          "svix-id": "wrong",
          "svix-timestamp": "1",
          "svix-signature": "v1,wrong",
        },
      },
    });
    delete process.env.CRON_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(failures).toEqual([]);
  }, 300_000);
});
