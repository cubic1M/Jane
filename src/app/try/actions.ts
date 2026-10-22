"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { pickPerson } from "@/lib/people";
import { hit, ipKey } from "@/lib/rate-limit";
import { phaseTimer } from "@/lib/trial-timing";
import { syncItem } from "@/lib/plaid/sync";
import { TrialError, cleanUpTrials, startTrial } from "@/lib/trial";

// "Try it with sample data" (spec step 138): a sample person with the demo bank, signed in
// for a day with an ordinary Auth.js database session, then on to Jane's chat. Limited per
// IP (only a hash of it is kept, for the counter), and never counted in analytics.

export type TryState = { error: string } | null;

// Auth.js's session cookie: the __Secure- name on HTTPS, the plain one locally.
const cookieName = (secure: boolean) =>
  secure ? "__Secure-authjs.session-token" : "authjs.session-token";

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
  const secure = h.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  (await cookies()).set(cookieName(secure), session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: session.expires,
  });
  timing.done();
  after(async () => {
    try {
      await syncItem(session.itemId, { progressive: true });
    } catch (error) {
      console.error("Sample person's first sync failed", { error: String(error) });
    }
    await cleanUpTrials().catch((error) =>
      console.error("Cleaning up trials failed", { error: String(error) }),
    );
  });
  redirect("/scanning?then=chat");
}
