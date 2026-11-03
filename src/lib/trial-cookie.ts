import { cookies, headers } from "next/headers";

// The session cookie for someone trying Jane, who has no sign-in to set it: Auth.js's own, read
// back by Auth.js as any other database session.

// The __Secure- name on HTTPS, the plain one locally.
const cookieName = (secure: boolean) =>
  secure ? "__Secure-authjs.session-token" : "authjs.session-token";

// The same rule as Auth.js, which reads the cookie back: secure when the site's own address
// (AUTH_URL) is HTTPS, or, without one, when the request came over HTTPS. A production build
// served over plain HTTP (the end-to-end tests) then uses the plain name both ways.
function secureCookies(forwardedProto: string | null, authUrl = process.env.AUTH_URL) {
  if (authUrl) return authUrl.startsWith("https:");
  return forwardedProto === "https";
}

export async function setTrialSession(sessionToken: string, expires: Date): Promise<void> {
  const secure = secureCookies((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(cookieName(secure), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires,
  });
}

export async function clearTrialSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(cookieName(false));
  jar.delete(cookieName(true));
}
