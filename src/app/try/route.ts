import { NextResponse, after, type NextRequest } from "next/server";
import { TRY_LINK_READY_WAIT_MS } from "@/config/trial";
import { syncItem } from "@/lib/plaid/sync";
import { hit, ipKey } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";
import { TrialError, startTrial, trialEnabled } from "@/lib/trial";
import { secureCookies, sessionCookieName, sessionCookieOptions } from "@/lib/trial-cookie";
import { afterClaim, claimReadyPerson } from "@/lib/trial-pool";
import { phaseTimer } from "@/lib/trial-timing";
import { isLinkPreview, isPrefetch } from "@/lib/try-link";

// The one-tap demo link for people reviewing Jane: opening /try signs the visitor in as their
// own sample person and opens the report, with Jane's findings, the checkup and how sure Jane is
// of each, in a second or two and with no sign-up. The person was made and scanned ahead
// (src/lib/trial-pool.ts); with none ready, one is made now and the report fills in as its scan
// goes. Limited per IP like "Try it with sample data" (the same counter), never for link
// previews or prefetches, and never a second person for someone already signed in.

// With none ready, the scan finishes after the response.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function go(request: NextRequest, path: string, how?: "ready" | "new"): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  // Which way the visitor got their person, for the end-to-end timings.
  if (how) response.headers.set("X-Try", how);
  return response;
}

export async function GET(request: NextRequest) {
  const h = request.headers;
  if (!trialEnabled()) return go(request, "/");
  if (isPrefetch(h)) return new NextResponse(null, { status: 204, headers: NO_STORE });
  // A link preview gets the landing page's own title and picture.
  if (isLinkPreview(h)) return go(request, "/");
  // Opened again, or by someone signed in: their own report, never a new person.
  if (await getSessionState()) return go(request, "/report");
  if (!(await hit("trial", ipKey(h))).ok) return go(request, "/try/busy");

  const timing = phaseTimer("try_link");
  const userAgent = h.get("user-agent");
  let session = await claimReadyPerson({ userAgent });
  timing.mark("claim");
  const how = session ? "ready" : "new";
  if (session) {
    const { userId } = session;
    after(() => afterClaim(userId));
  } else {
    // None ready: made now, and the report opens once the accounts and transactions are in.
    let started;
    try {
      started = await startTrial({ userAgent, defer: true, termsVia: "try_link" });
    } catch (error) {
      if (error instanceof TrialError) return go(request, "/");
      throw error;
    }
    session = started;
    let ready!: () => void;
    const readied = new Promise<void>((resolve) => (ready = resolve));
    const scan = syncItem(started.itemId, { progressive: true, onReady: ready })
      .catch((error) =>
        console.error("Sample person's first sync failed", { error: String(error) }),
      )
      .finally(ready);
    let waited: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      readied,
      new Promise<void>((resolve) => (waited = setTimeout(resolve, TRY_LINK_READY_WAIT_MS))),
    ]);
    clearTimeout(waited);
    timing.mark("ready");
    after(async () => {
      await scan;
      // Its own card text came with its scan; the pool is filled for the next visitor.
      await afterClaim(null);
    });
  }
  const secure = secureCookies(h.get("x-forwarded-proto"));
  const response = go(request, "/report", how);
  response.cookies.set(
    sessionCookieName(secure),
    session.sessionToken,
    sessionCookieOptions(secure, session.expires),
  );
  timing.done({ how });
  return response;
}
