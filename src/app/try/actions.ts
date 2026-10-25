"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { pickPerson } from "@/lib/people";
import { hit, ipKey } from "@/lib/rate-limit";
import { phaseTimer } from "@/lib/trial-timing";
import { syncItem } from "@/lib/plaid/sync";
import { TrialError, cleanUpTrials, startTrial } from "@/lib/trial";

// "Try it with sample data" (spec step 138): a sample person with the demo bank, signed in
// for a day with an ordinary Auth.js database session, then on to Jane's chat. Limited per
// IP (only a hash of it is kept, for the counter), and never counted in analytics.

// How long the click waits for the chat to be able to open before showing /scanning instead.
const TRY_READY_WAIT_MS = 8000;

// Where the browser goes next, or why not. The action returns this instead of redirecting:
// a redirect from an action that waited for the scan left some browsers on the landing page.
export type TryState = { error: string } | { next: string } | null;

// Auth.js's session cookie: the __Secure- name on HTTPS, the plain one locally.
const cookieName = (secure: boolean) =>
  secure ? "__Secure-authjs.session-token" : "authjs.session-token";

// The same rule as Auth.js, which reads the cookie back: secure when the site's own address
// (AUTH_URL) is HTTPS, or, without one, when the request came over HTTPS. A production build
// served over plain HTTP (the end-to-end tests) then uses the plain name both ways.
function secureCookies(forwardedProto: string | null, authUrl = process.env.AUTH_URL) {
  if (authUrl) return authUrl.startsWith("https:");
  return forwardedProto === "https";
}

export async function tryJane(_previous: TryState, formData: FormData): Promise<TryState> {
  // As at sign-up: the Terms are agreed to before anything is made.
  if (formData.get("consent") !== "on") {
    return { error: "Tick the box to agree to the Terms and Privacy Policy first." };
  }
  const timing = phaseTimer("try_click");
  const h = await headers();
  if (!(await hit("trial", ipKey(h))).ok) {
    return { error: "Lots of people are trying Jane from here. Please try again in an hour." };
  }
  timing.mark("rate_limit");
  let session: { itemId: string; sessionToken: string; expires: Date };
  try {
    // Only the minimum before the redirect; the scan runs after the response.
    session = await startTrial({
      userAgent: h.get("user-agent"),
      defer: true,
      person: pickPerson(formData.get("person")),
    });
  } catch (error) {
    if (error instanceof TrialError) return { error: error.message };
    throw error;
  }
  timing.mark("start_trial");
  const secure = secureCookies(h.get("x-forwarded-proto"));
  (await cookies()).set(cookieName(secure), session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: session.expires,
  });
  timing.done();
  // The scan starts now, and the click waits for the chat to be able to open (accounts and
  // transactions saved, about two seconds), then goes straight to the chat: no /scanning page,
  // no polling, no second page load. The rest of the scan carries on after the response. If it
  // is slow or fails, /scanning shows the progress as before.
  let ready!: () => void;
  let chatReady = false;
  const readied = new Promise<void>((resolve) => (ready = resolve));
  const scan = syncItem(session.itemId, {
    progressive: true,
    onReady: () => {
      chatReady = true;
      ready();
    },
  })
    .catch((error) => console.error("Sample person's first sync failed", { error: String(error) }))
    .finally(ready);
  let waited: ReturnType<typeof setTimeout> | undefined;
  const opened = await Promise.race([
    readied.then(() => chatReady),
    new Promise<boolean>(
      (resolve) => (waited = setTimeout(() => resolve(false), TRY_READY_WAIT_MS)),
    ),
  ]);
  clearTimeout(waited);
  after(async () => {
    await scan;
    await cleanUpTrials().catch((error) =>
      console.error("Cleaning up trials failed", { error: String(error) }),
    );
  });
  return { next: opened ? "/home" : "/scanning?then=home" };
}
