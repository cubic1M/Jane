import { cappedText } from "@/lib/capped-text";
import { parseCspReports } from "@/lib/csp-report";
import { db } from "@/lib/db";
import { recordError } from "@/lib/error-log";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

class CspViolation extends Error {
  name = "CspViolation";
}

// Far more than a browser's batch of reports.
const MAX_BODY = 64 * 1024;

// Browsers post here when the Content-Security-Policy blocks something (src/proxy.ts). Each
// report becomes a scrubbed line in /admin/errors, so a rule that breaks a page shows up there
// rather than only in someone's browser console. Limited per IP; nothing is sent back.
export async function POST(request: Request) {
  const limited =
    (await limitOrNull("cspReport", ipKey(request.headers))) ??
    (await limitOrNull("errorReportsEveryone", "csp"));
  if (limited) return limited;
  const body = await cappedText(request, MAX_BODY);
  if (body === null) return new Response(null, { status: 413 });
  for (const violation of parseCspReports(body)) {
    await recordError(
      new CspViolation(`${violation.directive} blocked ${violation.blocked}`),
      { path: violation.page ?? undefined, method: "GET", routeType: "csp" },
      db,
    );
  }
  return new Response(null, { status: 204 });
}
