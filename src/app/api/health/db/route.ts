import { connection } from "next/server";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";

// The uptime check's database probe (.github/workflows/uptime.yml): whether the database answers
// a trivial query within a few seconds. It says ok or not, nothing more: no error text, no
// timing, no names. Public, like /api/health, and never cached.
const TIMEOUT_MS = 5_000;

export async function GET() {
  await connection();
  const headers = { "cache-control": "no-store" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // Through the door the app's other queries use, so it fails if they would.
      systemDb("Health probe: SELECT 1 touches no one's data").$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    log.error("Database health check failed", { error: String(error).slice(0, 200) });
    return Response.json({ ok: false }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
