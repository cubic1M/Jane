import { parseCspReports } from "@/lib/csp-report";
import { db } from "@/lib/db";
import { recordError } from "@/lib/error-log";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

class CspViolation extends Error {
  name = "CspViolation";
}

// Browsers post here when the Content-Security-Policy blocks something (src/proxy.ts). Each
// report becomes a scrubbed line in /admin/errors, so a rule that breaks a page shows up there
// rather than only in someone's browser console. Limited per IP; nothing is sent back.
export async function POST(request: Request) {
  const limited = await limitOrNull("cspReport", ipKey(request.headers));
  if (limited) return limited;
  for (const violation of parseCspReports(await request.text())) {
    await recordError(
      new CspViolation(`${violation.directive} blocked ${violation.blocked}`),
      { path: violation.page ?? undefined, method: "GET", routeType: "csp" },
      db,
    );
  }
  return new Response(null, { status: 204 });
}
