import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ROBINHOOD_CALLBACK_PATH,
  ROBINHOOD_LIMITS,
  ROBINHOOD_SCOPE,
  robinhoodAddressAllowed,
  robinhoodServer,
} from "@/config/robinhood";
import type { PrismaClient } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { siteOrigin } from "@/lib/site-origin";
import { systemDb } from "@/lib/system-db";
import { cappedText } from "./capped";

// Signing in with Robinhood: its server's metadata, registering this app once, the authorization
// code flow with PKCE and state, and refreshing tokens. The person signs in on Robinhood's page, so
// Jane never sees a password. Tokens leave this file only to be encrypted (./secrets.ts).

const WHY = "This app's registration with Robinhood isn't anyone's own";

export class RobinhoodOAuthError extends Error {
  constructor(readonly code: string) {
    super(`Robinhood sign-in failed: ${code}`);
    this.name = "RobinhoodOAuthError";
  }
}

// Robinhood no longer accepts the refresh token, or the server says the grant is gone.
export class RobinhoodGrantGoneError extends Error {
  constructor() {
    super("Robinhood no longer accepts this connection.");
    this.name = "RobinhoodGrantGoneError";
  }
}

export type Metadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string | null;
};

export type Tokens = {
  accessToken: string;
  // Absent when the server keeps the one it already gave.
  refreshToken: string | null;
  expiresAt: Date | null;
};

const timeout = () => AbortSignal.timeout(ROBINHOOD_LIMITS.callTimeoutMs);

// Every call here: no redirects, so nothing sent can be carried to another address, and failures
// come back as a code of ours, never the server's words.
async function call(url: string, init: RequestInit): Promise<Response> {
  if (!robinhoodAddressAllowed(url)) throw new RobinhoodOAuthError("address_refused");
  try {
    return await fetch(url, { ...init, redirect: "error", signal: timeout() });
  } catch {
    throw new RobinhoodOAuthError("unreachable");
  }
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  let text: string | null;
  try {
    text = await cappedText(response, ROBINHOOD_LIMITS.signInAnswerBytes);
  } catch {
    return {};
  }
  if (text === null) throw new RobinhoodOAuthError("too_large");
  try {
    const body = JSON.parse(text) as unknown;
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// A token or client id, as OAuth defines them: printable, and short enough to save.
const isOAuthValue = (value: unknown): value is string =>
  typeof value === "string" && /^[\x20-\x7e]{1,16384}$/.test(value);
// Past this it isn't a lifetime, and a date from it can't be saved.
const MOST_EXPIRES_IN = 10 * 365 * 24 * 60 * 60;

const METADATA_MS = 60 * 60 * 1000;
let remembered: { key: string; at: number; metadata: Metadata } | null = null;

export async function loadMetadata(now = Date.now()): Promise<Metadata> {
  const { metadataUrl } = robinhoodServer();
  if (remembered?.key === metadataUrl && now - remembered.at < METADATA_MS) {
    return remembered.metadata;
  }
  const response = await call(metadataUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new RobinhoodOAuthError(`metadata_http_${response.status}`);
  const body = await jsonOf(response);
  const required = (key: string) => {
    const value = body[key];
    // Each address is checked here too: the answer isn't what decides where tokens may go.
    if (typeof value !== "string" || !robinhoodAddressAllowed(value)) {
      throw new RobinhoodOAuthError("metadata_address");
    }
    return value;
  };
  const revocation = body.revocation_endpoint;
  const metadata: Metadata = {
    // A key for this app's registration, so it has to fit in one and be Robinhood's.
    issuer:
      typeof body.issuer === "string" &&
      body.issuer.length <= 300 &&
      robinhoodAddressAllowed(body.issuer)
        ? body.issuer
        : metadataUrl,
    authorizationEndpoint: required("authorization_endpoint"),
    tokenEndpoint: required("token_endpoint"),
    registrationEndpoint: required("registration_endpoint"),
    // Robinhood's metadata had none on 2026-11-05; used if one appears.
    revocationEndpoint:
      typeof revocation === "string" && robinhoodAddressAllowed(revocation) ? revocation : null,
  };
  remembered = { key: metadataUrl, at: now, metadata };
  return metadata;
}

// This app's client id for the address it comes back to, registering it the first time.
async function clientFor(
  metadata: Metadata,
  redirectUri: string,
  client: PrismaClient,
): Promise<string> {
  const where = { issuer: metadata.issuer, redirectUri };
  const known = await systemDb(WHY, client).robinhoodOauthClient.findFirst({
    where,
    select: { clientId: true },
  });
  if (known) return known.clientId;
  const response = await call(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Jane",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // The only way its metadata offers: a public client, which proves itself with PKCE.
      token_endpoint_auth_method: "none",
      scope: ROBINHOOD_SCOPE,
    }),
  });
  if (!response.ok) throw new RobinhoodOAuthError(`register_http_${response.status}`);
  const clientId = (await jsonOf(response)).client_id;
  if (!isOAuthValue(clientId)) throw new RobinhoodOAuthError("register_answer");
  // Two first connections at once: the later one's is as good, and each sign-in carries its own.
  await systemDb(WHY, client).robinhoodOauthClient.upsert({
    where: { issuer_redirectUri: where },
    create: { ...where, clientId },
    update: { clientId },
  });
  return clientId;
}

const randomValue = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

// The site's own address for the way back: from settings, except on a developer's machine.
export function callbackOrigin(request: Request): string | null {
  const configured =
    siteOrigin() ??
    (URL.canParse(process.env.AUTH_URL ?? "") ? new URL(process.env.AUTH_URL ?? "").origin : null);
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
}

// A browser saying this came from another site. Older browsers send nothing, and the session cookie
// (SameSite=Lax) is still what stops a form posted from elsewhere.
export function fromAnotherSite(request: Request): boolean {
  const from = request.headers.get("sec-fetch-site");
  return Boolean(from) && from !== "same-origin" && from !== "none";
}

const redirectUriFor = (origin: string) => `${origin}${ROBINHOOD_CALLBACK_PATH}`;

type SignIn = {
  state: string;
  verifier: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  at: number;
};

export const SIGN_IN_COOKIE = "jane_robinhood_sign_in";

// Where to send the person, and what the browser keeps until they come back: encrypted, so the
// verifier stays secret, and naming them, so it only works for the person who started.
export async function startSignIn(
  userId: string,
  origin: string,
  { client = defaultClient, now = Date.now() }: { client?: PrismaClient; now?: number } = {},
): Promise<{ url: string; cookie: string }> {
  const metadata = await loadMetadata(now);
  const redirectUri = redirectUriFor(origin);
  const clientId = await clientFor(metadata, redirectUri, client);
  const signIn: SignIn = {
    state: randomValue(),
    verifier: randomValue(),
    clientId,
    userId,
    redirectUri,
    at: now,
  };
  const url = new URL(metadata.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ROBINHOOD_SCOPE,
    state: signIn.state,
    code_challenge: challengeOf(signIn.verifier),
    code_challenge_method: "S256",
    resource: robinhoodServer().mcpUrl,
  }).toString();
  return { url: url.toString(), cookie: encrypt(JSON.stringify(signIn)) };
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// The sign-in this browser started, if this answer belongs to it: the same person, within the time
// and with the state that went out.
export function matchSignIn(
  cookie: string | undefined,
  { userId, state, now = Date.now() }: { userId: string; state: string | null; now?: number },
): SignIn | null {
  if (!cookie || !state) return null;
  let signIn: SignIn;
  try {
    signIn = JSON.parse(decrypt(cookie)) as SignIn;
  } catch {
    return null;
  }
  const fresh = now - signIn.at < ROBINHOOD_LIMITS.signInMinutes * 60 * 1000;
  return fresh && signIn.userId === userId && sameText(signIn.state, state) ? signIn : null;
}

async function tokenRequest(
  metadata: Metadata,
  fields: Record<string, string>,
  now: number,
): Promise<Tokens> {
  const response = await call(metadata.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  });
  const body = await jsonOf(response);
  if (!response.ok) {
    if (body.error === "invalid_grant") throw new RobinhoodGrantGoneError();
    throw new RobinhoodOAuthError(`token_http_${response.status}`);
  }
  const accessToken = body.access_token;
  if (!isOAuthValue(accessToken)) throw new RobinhoodOAuthError("token_answer");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    accessToken,
    refreshToken: isOAuthValue(body.refresh_token) ? body.refresh_token : null,
    expiresAt:
      expiresIn !== null && expiresIn > 0 && expiresIn <= MOST_EXPIRES_IN
        ? new Date(now + expiresIn * 1000)
        : null,
  };
}

export async function exchangeCode(
  signIn: Pick<SignIn, "clientId" | "redirectUri" | "verifier">,
  code: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<Tokens> {
  return tokenRequest(
    await loadMetadata(now),
    {
      grant_type: "authorization_code",
      code,
      client_id: signIn.clientId,
      redirect_uri: signIn.redirectUri,
      code_verifier: signIn.verifier,
      resource: robinhoodServer().mcpUrl,
    },
    now,
  );
}

export async function refreshTokens(
  clientId: string,
  refreshToken: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<Tokens> {
  return tokenRequest(
    await loadMetadata(now),
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource: robinhoodServer().mcpUrl,
    },
    now,
  );
}

// Ends the tokens at Robinhood if it offers a way. It doesn't today, so this reports false, and the
// person is told. Never throws: disconnecting and deleting an account can't wait on another company.
export async function revokeTokens(clientId: string, tokens: readonly string[]): Promise<boolean> {
  try {
    const { revocationEndpoint } = await loadMetadata();
    if (!revocationEndpoint) return false;
    let done = tokens.length > 0;
    for (const token of tokens) {
      const response = await call(revocationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, client_id: clientId }).toString(),
      });
      done &&= response.ok;
    }
    return done;
  } catch {
    return false;
  }
}

// Tests only: another test's fake server has another address, but the same address can be restarted.
export function forgetMetadataForTests(): void {
  remembered = null;
}
