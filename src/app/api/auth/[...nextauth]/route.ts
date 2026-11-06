import { handlers } from "@/auth";
import { ipKey, limitOrNull } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { isStatementTrialUser } from "@/lib/trial-ids";

const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token=/;

// Auth.js sets the session cookie again on every read of /api/auth/session, with 30 days on it.
// Someone trying Jane with their own statement has a cookie that ends when the browser closes
// (src/lib/trial-cookie.ts), as the privacy page promises, so the next person at a shared computer
// doesn't find their statement. A link to that endpoint would otherwise turn it into a 30-day one.
export async function GET(request: Request) {
  const response = await handlers.GET(request as Parameters<typeof handlers.GET>[0]);
  const cookies = response.headers.getSetCookie();
  if (!cookies.some((c) => SESSION_COOKIE.test(c)) || !(await fromStatementTrial(request))) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of cookies) {
    headers.append(
      "set-cookie",
      SESSION_COOKIE.test(cookie) ? cookie.replace(/;\s*(?:expires|max-age)=[^;]*/gi, "") : cookie,
    );
  }
  return new Response(response.body, { status: response.status, headers });
}

async function fromStatementTrial(request: Request): Promise<boolean> {
  const token = /(?:^|;\s*)(?:__Secure-)?authjs\.session-token=([^;]+)/.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
  if (!token) return false;
  const session = await systemDb("Auth: whose session this is, before anyone is signed in")
    .session.findUnique({ where: { sessionToken: token }, select: { userId: true } })
    .catch(() => null);
  return isStatementTrialUser(session?.userId);
}

// Sign-in requests (email links, OAuth callbacks) are rate limited per IP.
export async function POST(request: Request) {
  const limited = await limitOrNull("auth", ipKey(request.headers));
  if (limited) return limited;
  return handlers.POST(request as Parameters<typeof handlers.POST>[0]);
}
