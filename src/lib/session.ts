import type { Session } from "next-auth";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { after, connection } from "next/server";
import { auth } from "@/auth";
import { TERMS_VERSION } from "@/config/legal";
import { adminSessionState, sessionTokenFrom } from "@/lib/admin-gate";
import { noteSessionSeen } from "@/lib/user-sessions";

export type SessionUser = Session["user"];

export { HOME_PATH } from "@/config/home";

export type SessionState = { user: SessionUser; mfaPending: boolean };

// The signed-in person, including one who still owes a two-factor code. Only /mfa uses
// this directly; everything else goes through getCurrentUser or requireUser.
export async function getSessionState(): Promise<SessionState | null> {
  // Auth.js makes a random CSRF token on every session lookup. Waiting for the
  // request first keeps Next.js from treating that as part of a prerender.
  await connection();
  // auth() reads the sessions table on every call, so a session signed out from another
  // device (spec step 73) stops working on its very next request.
  const session = await auth();
  if (!session?.user) return null;
  await noteDevice();
  return { user: session.user, mfaPending: session.mfaPending };
}

// Which device this session is on and when it was last used (spec step 73), written after
// the response so pages don't wait for it. A failure here never breaks the page.
// Once per request: a page often looks the person up more than once (requireUser, then
// scopedDb), and reading cookies() again after the first after() is registered makes Next.js
// reject the render ("used cookies() inside after()").
const noteDevice = cache(async (): Promise<void> => {
  const token = sessionTokenFrom(await cookies());
  if (!token) return;
  const userAgent = (await headers()).get("user-agent");
  after(() =>
    noteSessionSeen(token, userAgent).catch((error) =>
      console.error("Couldn't note the session's device", { error }),
    ),
  );
});

// Signed in, with the two-factor code entered if two-factor is on. Null otherwise, so
// API routes treat a session that still owes a code as signed out.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const state = await getSessionState();
  return state && !state.mfaPending ? state.user : null;
}

// Signed in, past two-factor and on the current Terms version; otherwise sign in, enter
// the code, or accept the Terms once.
export async function requireUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.mfaPending) redirect("/mfa");
  const { user } = state;
  if (user.termsVersion !== TERMS_VERSION) redirect("/terms/accept");
  return user;
}

// Admin pages answer 404 to everyone else, so their existence isn't revealed. Admins
// must also have entered a two-factor code in this session.
export async function requireAdmin(): Promise<SessionUser> {
  const state = await getSessionState();
  const user = state?.user;
  if (user?.role !== "admin") notFound();
  if (state?.mfaPending) redirect("/mfa");
  if (user.termsVersion !== TERMS_VERSION) redirect("/terms/accept");
  const gate = await adminSessionState(sessionTokenFrom(await cookies()));
  if (gate === "needs_mfa") redirect("/mfa");
  if (gate !== "verified") notFound();
  return user;
}
