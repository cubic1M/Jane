// The session cookie a sample person is signed in with ("Try it with sample data" and the /try
// link): Auth.js's own, so every page reads it as an ordinary session.

// Auth.js's session cookie: the __Secure- name on HTTPS, the plain one locally.
export const sessionCookieName = (secure: boolean) =>
  secure ? "__Secure-authjs.session-token" : "authjs.session-token";

// The same rule as Auth.js, which reads the cookie back: secure when the site's own address
// (AUTH_URL) is HTTPS, or, without one, when the request came over HTTPS. A production build
// served over plain HTTP (the end-to-end tests) then uses the plain name both ways.
export function secureCookies(forwardedProto: string | null, authUrl = process.env.AUTH_URL) {
  if (authUrl) return authUrl.startsWith("https:");
  return forwardedProto === "https";
}

// Everything but the name and value, for a session that ends at `expires`.
export const sessionCookieOptions = (secure: boolean, expires: Date) =>
  ({ httpOnly: true, sameSite: "lax", secure, path: "/", expires }) as const;
