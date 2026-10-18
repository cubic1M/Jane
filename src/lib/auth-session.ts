import type { Session } from "next-auth";
import type { AdapterSession, AdapterUser } from "next-auth/adapters";

// What a session lookup returns, to the server and to the browser (/api/auth/session).
// Built field by field so the session token, which works as a password, never leaves the
// cookie it lives in.
export function sessionPayload({
  session,
  user,
}: {
  session: Pick<AdapterSession, "expires" | "mfaVerified">;
  user: AdapterUser;
}): Session {
  return {
    expires: new Date(session.expires).toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      termsVersion: user.termsVersion,
    },
    mfaPending: user.mfaEnabled && session.mfaVerified !== true,
  };
}
