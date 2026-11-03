import { randomBytes } from "node:crypto";
import { TERMS_VERSION } from "@/config/legal";
import { PROBE_TIMEOUT_MS } from "@/config/health";
import { TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX, TRIAL_SESSION_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { encryptBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The hourly check that signing in works and one person can't see another (docs/incident.md). It
// makes two sample people with a marker in their rows, then calls the running site as them over
// HTTP, through the proxy, real sessions and the database's row lock. No real person's data is
// involved. They are trial people (src/lib/trial.ts): never emailed, never counted, and deleted at
// the end, or by the next run or the daily clean-up if this one dies. Session tokens stay on the
// server. A real magic link isn't sent: that needs a mailbox and would spend Resend's daily quota.

export const PROBE_ID_PREFIX = `${TRIAL_ID_PREFIX}probe_`;

export type ProbeCheck = { name: string; ok: boolean; detail?: string };
export type ProbeResult = { ok: boolean; checks: ProbeCheck[] };

export class ProbeFailed extends Error {
  constructor(readonly result: ProbeResult) {
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
    super(`The hourly probe failed: ${failed.join(", ")}`);
    this.name = "ProbeFailed";
  }
}

type Person = {
  id: string;
  sessionToken: string;
  marker: string;
  findingId: string;
  documentId: string;
};

type Options = { client?: PrismaClient; fetcher?: typeof fetch; now?: Date };

async function plantPerson(client: PrismaClient, now: Date): Promise<Person> {
  const id = `${PROBE_ID_PREFIX}${randomBytes(12).toString("hex")}`;
  const marker = `probemarker${randomBytes(12).toString("hex")}`;
  const sessionToken = `${TRIAL_SESSION_PREFIX}${randomBytes(32).toString("hex")}`;
  await client.user.create({
    data: {
      id,
      email: `${id}@${TRIAL_EMAIL_DOMAIN}`,
      name: "Sample person",
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: now,
      createdAt: now,
    },
  });
  await client.session.create({
    data: { sessionToken, userId: id, expires: new Date(now.getTime() + 60 * 60 * 1000) },
  });
  const db = scopedFor(id, client);
  const finding = await db.findings.create({
    data: {
      userId: id,
      type: "bank_fees",
      key: "probe",
      title: marker,
      confidence: "low",
    },
    select: { id: true },
  });
  const document = await db.documents.create({
    data: {
      userId: id,
      kind: "other",
      fileName: `${marker}.pdf`,
      contentType: "application/pdf",
      sizeBytes: marker.length,
      encryptedBytes: encryptBytes(Buffer.from(marker)),
    },
    select: { id: true },
  });
  return { id, sessionToken, marker, findingId: finding.id, documentId: document.id };
}

export async function removeProbePeople(client: PrismaClient = defaultClient): Promise<number> {
  const { count } = await client.user.deleteMany({
    where: { id: { startsWith: PROBE_ID_PREFIX } },
  });
  return count;
}

export async function runProbe(
  base: string,
  { client = defaultClient, fetcher = fetch, now = new Date() }: Options = {},
): Promise<ProbeResult> {
  const checks: ProbeCheck[] = [];
  const call = async (path: string, person?: Person, init: RequestInit = {}) => {
    const response = await fetcher(new URL(path, base), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        ...init.headers,
        ...(person
          ? {
              cookie: `__Secure-authjs.session-token=${person.sessionToken}; authjs.session-token=${person.sessionToken}`,
            }
          : {}),
      },
    });
    return { status: response.status, body: await response.text() };
  };
  // Says what went wrong in a status code or an error's class, never a response's words.
  const check = async (name: string, run: () => Promise<true | string>) => {
    try {
      const outcome = await run();
      checks.push(outcome === true ? { name, ok: true } : { name, ok: false, detail: outcome });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.name : "unknown error",
      });
    }
  };

  await removeProbePeople(client);
  try {
    const alice = await plantPerson(client, now);
    const bob = await plantPerson(client, now);

    await check("sign-in page loads", async () => {
      const { status } = await call("/login");
      return status === 200 || `HTTP ${status}`;
    });
    await check("email sign-in is configured", async () => {
      const providers = await call("/api/auth/providers");
      const csrf = await call("/api/auth/csrf");
      if (providers.status !== 200 || csrf.status !== 200) {
        return `HTTP ${providers.status} and ${csrf.status}`;
      }
      if (!providers.body.includes('"resend"')) return "no email sign-in";
      return csrf.body.includes("csrfToken") || "no csrf token";
    });
    await check("signed out gets nothing", async () => {
      const { status, body } = await call("/api/export");
      if (body.includes(alice.marker) || body.includes(bob.marker)) return "marker in the answer";
      return status === 401 || `HTTP ${status}`;
    });
    // If this fails the checks below prove nothing, and the run fails anyway.
    const own = await call("/api/export", alice).catch(() => null);
    await check("a session opens the person's own data", async () => {
      if (!own) return "no answer";
      if (own.status !== 200) return `HTTP ${own.status}`;
      return own.body.includes(alice.marker) || "own marker missing";
    });
    await check("the export holds nobody else's data", async () => {
      if (!own) return "no answer";
      return !own.body.includes(bob.marker) || "marker in the answer";
    });
    await check("a person's own document opens", async () => {
      const { status, body } = await call(`/api/documents/${alice.documentId}`, alice);
      if (status !== 200) return `HTTP ${status}`;
      return body.includes(alice.marker) || "own marker missing";
    });
    await check("someone else's document is refused", async () => {
      const { status, body } = await call(`/api/documents/${bob.documentId}`, alice);
      if (body.includes(bob.marker)) return "marker in the answer";
      return status === 404 || `HTTP ${status}`;
    });
    await check("someone else's finding page shows nothing", async () => {
      const { body } = await call(`/report/${bob.findingId}`, alice);
      return !body.includes(bob.marker) || "marker in the answer";
    });
    await check("someone else's finding can't be decided", async () => {
      const { status } = await call("/api/decisions", alice, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingId: bob.findingId,
          choice: "no",
          cardHash: "0".repeat(64),
        }),
      });
      const written = await scopedFor(bob.id, client).decisions.count();
      if (written > 0) return "a decision was written";
      return (status >= 400 && status < 500) || `HTTP ${status}`;
    });
    await check("the database's scope holds", async () => {
      const row = await scopedFor(alice.id, client).findings.findFirst({
        where: { id: bob.findingId },
      });
      return row === null || "a row came back";
    });
  } catch (error) {
    checks.push({
      name: "sample people could be set up",
      ok: false,
      detail: error instanceof Error ? error.name : "unknown error",
    });
  } finally {
    await removeProbePeople(client).catch(() => 0);
  }
  return { ok: checks.every((item) => item.ok), checks };
}
