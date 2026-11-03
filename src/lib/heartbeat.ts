import { HEARTBEAT_TIMEOUT_MS } from "@/config/health";
import { log } from "@/lib/log";

// Tells Healthchecks.io a scheduled job started, finished or failed, so a job that never runs at
// all still reaches someone's phone (src/lib/health.ts can only notice that from inside another
// job). Off until HEALTHCHECKS_PING_KEY is set. A check is made the first time its job pings.
// The key is in the address, so the address is never logged, and a ping can never break a job.

export type HeartbeatSignal = "start" | "success" | "fail";

type Options = { fetcher?: typeof fetch; env?: Record<string, string | undefined> };

export function heartbeatUrl(
  job: string,
  signal: HeartbeatSignal,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env.HEALTHCHECKS_PING_KEY?.trim();
  if (!key) return null;
  const base = (env.HEALTHCHECKS_URL?.trim() || "https://hc-ping.com").replace(/\/$/, "");
  const suffix = signal === "success" ? "" : `/${signal}`;
  return `${base}/${key}/jane-${job}${suffix}?create=1`;
}

export async function heartbeat(
  job: string,
  signal: HeartbeatSignal,
  { fetcher = fetch, env = process.env }: Options = {},
): Promise<void> {
  const url = heartbeatUrl(job, signal, env);
  if (!url) return;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
    if (!response.ok) log.warn("Heartbeat refused", { job, signal, status: response.status });
  } catch (error) {
    log.warn("Heartbeat failed", {
      job,
      signal,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
