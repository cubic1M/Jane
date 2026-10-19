"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hit, ipKey } from "@/lib/rate-limit";
import { TrialError, startTrial } from "@/lib/trial";

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
  const h = await headers();
  if (!(await hit("trial", ipKey(h))).ok) {
    return { error: "Lots of people are trying Jane from here. Please try again in an hour." };
  }
  let session: { sessionToken: string; expires: Date };
  try {
    session = await startTrial({ userAgent: h.get("user-agent") });
  } catch (error) {
    if (error instanceof TrialError) return { error: error.message };
    throw error;
  }
  const secure = h.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  (await cookies()).set(cookieName(secure), session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: session.expires,
  });
  redirect("/chat");
}
