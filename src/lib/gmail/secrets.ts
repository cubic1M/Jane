import { decrypt, encrypt } from "@/lib/crypto";

// What a connected Gmail mailbox keeps encrypted, as one value (one field for key rotation): the
// access token Jane reads with, and the refresh token that gets the next one. The only file that
// opens it. Nothing here logs, and no error it throws carries what was inside.

export type GmailSecrets = {
  accessToken: string | null;
  refreshToken: string | null;
};

// A mailbox whose tokens were wiped: Google stopped accepting them, or the mailbox was connected to
// another Jane account. Frozen, so no caller can leave a token in what everyone seals as "none".
export const NO_SECRETS: Readonly<GmailSecrets> = Object.freeze({
  accessToken: null,
  refreshToken: null,
});

// Only the two tokens are sealed, whatever else the object handed in carries.
export const sealSecrets = ({ accessToken, refreshToken }: GmailSecrets): string =>
  encrypt(JSON.stringify({ accessToken, refreshToken }));

// JSON's own error quotes the text it couldn't read, which here was a secret: so none is thrown.
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const tokenOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

// Throws for anything sealSecrets didn't make: text that was never encrypted (the access proof
// plants some), a value under a key that is gone, or something else sealed with the same key (a
// sign-in cookie, a Connect link).
export function openSecrets(sealed: string): GmailSecrets {
  const opened = parsed(decrypt(sealed));
  const inside: Record<string, unknown> =
    typeof opened === "object" && opened !== null ? (opened as Record<string, unknown>) : {};
  const { accessToken, refreshToken } = inside;
  if (!tokenOrNull(accessToken) || !tokenOrNull(refreshToken)) {
    throw new Error("Not a mailbox's sealed tokens");
  }
  return { accessToken, refreshToken };
}
