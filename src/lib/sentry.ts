import { randomBytes } from "node:crypto";
import { SENTRY_TIMEOUT_MS } from "@/config/health";
import { errorKind, safePath } from "@/lib/error-kind";
import { log, logText } from "@/lib/log";

// Server errors to Sentry, off until SENTRY_DSN is set. This posts to Sentry's documented envelope
// address rather than using its SDK, which rewrites the build and adds to every page even when
// it's off. Sentry's terms forbid personal data without a signed DPA (docs/security/vendors.md), so
// an event holds the kind of error, its cleaned message, code locations and a path with ids taken
// out. No user, no request, no IP address. Never throws: reporting must not cause another error.

type Options = { fetcher?: typeof fetch; env?: Record<string, string | undefined> };

export type SentryError = {
  message: string;
  stack?: string | null;
  path?: string | null;
  routeType?: string | null;
};

export function parseDsn(dsn: string | undefined): { url: string; key: string } | null {
  try {
    const { protocol, host, username, pathname } = new URL(dsn?.trim() ?? "");
    const project = pathname.replace(/^\//, "");
    if (!username || !/^\d+$/.test(project)) return null;
    return { url: `${protocol}//${host}/api/${project}/envelope/`, key: username };
  } catch {
    return null;
  }
}

// Only "at function (file:line:column)": the stack's first lines repeat the message.
function frames(stack: string | null | undefined) {
  const found = [...(stack ?? "").matchAll(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/gm)];
  return found
    .map(([, fn, file, line, column]) => ({
      function: fn ? logText(fn) : undefined,
      filename: file.replace(/^.*\/(\.next|node_modules|src)\//, "$1/"),
      lineno: Number(line),
      colno: Number(column),
    }))
    .reverse();
}

// Ids in a message could be matched to a person, so they go too.
const withoutIds = (text: string) => text.replace(/\b[a-z0-9_]{20,}\b/gi, "[id]");

export function sentryEvent(error: SentryError, env: Options["env"] = process.env) {
  const kind = errorKind(error.message);
  const value = withoutIds(logText(error.message.slice(kind.length).replace(/^:\s*/, "")));
  return {
    event_id: randomBytes(16).toString("hex"),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: env?.VERCEL_ENV ?? env?.NODE_ENV ?? "unknown",
    release: env?.VERCEL_GIT_COMMIT_SHA,
    transaction: safePath(error.path),
    tags: { route_type: error.routeType ?? "none" },
    exception: { values: [{ type: kind, value, stacktrace: { frames: frames(error.stack) } }] },
  };
}

export async function reportToSentry(
  error: SentryError,
  { fetcher = fetch, env = process.env }: Options = {},
): Promise<void> {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;
  try {
    const event = sentryEvent(error, env);
    const payload = JSON.stringify(event);
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({
        type: "event",
        length: Buffer.byteLength(payload),
        content_type: "application/json",
      }),
      payload,
    ].join("\n");
    const response = await fetcher(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=jane/1.0, sentry_key=${dsn.key}`,
      },
      body,
      signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
    });
    if (!response.ok) log.warn("Sentry refused an event", { status: response.status });
  } catch (failure) {
    log.warn("Sentry report failed", {
      error: failure instanceof Error ? failure.name : "unknown",
    });
  }
}
