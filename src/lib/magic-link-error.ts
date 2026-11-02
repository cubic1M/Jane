import { AuthError } from "next-auth";

// A sign-in email that couldn't be sent. A plain error reaches Auth.js as "Configuration", which
// reads "Something went wrong"; this one reaches /login as what happened, and the access log.
export class MagicLinkSendError extends AuthError {
  static type = "EmailSignInError";
  kind = "signIn" as const;
}
