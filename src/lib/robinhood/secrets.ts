import { createHmac, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";

// What a Robinhood connection keeps encrypted, as one value (one field for key rotation): its tokens,
// and a random key that turns an account number into a reference Jane can recognize next time
// without keeping the number. The key outlives the tokens, so a person who reconnects keeps their
// accounts and their history.

export type RobinhoodSecrets = {
  accessToken: string | null;
  refreshToken: string | null;
  accountKey: string;
};

export const newAccountKey = (): string => randomBytes(32).toString("base64url");

export const sealSecrets = (secrets: RobinhoodSecrets): string => encrypt(JSON.stringify(secrets));

export const openSecrets = (sealed: string): RobinhoodSecrets =>
  JSON.parse(decrypt(sealed)) as RobinhoodSecrets;

// Saved where a Plaid account keeps its id. Keyed per person, so it says nothing about the number
// even to someone holding the database, and two people can't collide.
const refOf = (accountKey: string, kind: string, value: string) =>
  `robinhood:${kind}:${createHmac("sha256", accountKey).update(value).digest("base64url")}`;

export const accountRef = (accountKey: string, accountNumber: string) =>
  refOf(accountKey, "account", accountNumber);

export const orderRef = (accountKey: string, orderId: string) =>
  refOf(accountKey, "order", orderId);

// A security's reference (unique per person, so plain), kept apart from what Plaid or an upload wrote
// for the same ticker, so disconnecting can't take someone's uploaded holding with it.
const SECURITY_REF_PREFIX = "robinhood:security:";
export const CASH_REF = `${SECURITY_REF_PREFIX}cash`;
export const securityRef = (symbol: string) => `${SECURITY_REF_PREFIX}${symbol}`;
