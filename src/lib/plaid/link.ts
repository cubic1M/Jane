import { CountryCode, Products, type PlaidApi } from "plaid";
import { TRANSACTION_DAYS_REQUESTED } from "@/config/plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { plaid, plaidCall, webhookUrl } from "./client";

// Plaid Link from our side: a link token to open Link, and the exchange that turns
// Link's public token into a stored item. The access token is encrypted before it is
// saved and never leaves the server.

const CLIENT_NAME = "Financial Controller";

type Options = { client?: PrismaClient; api?: PlaidApi };

export class ItemNotFoundError extends Error {
  constructor() {
    super("That linked account doesn't exist.");
  }
}

// A link token for a new item, or, given an item id, for Link's update mode so the person
// can sign in to their bank again.
export async function createLinkToken(
  userId: string,
  itemId: string | null,
  { client = defaultClient, api = plaid() }: Options = {},
): Promise<string> {
  let accessToken: string | undefined;
  if (itemId) {
    const item = await scopedFor(userId, client).plaidItems.findFirst({
      where: { id: itemId },
      select: { accessTokenEncrypted: true },
    });
    if (!item) throw new ItemNotFoundError();
    accessToken = decrypt(item.accessTokenEncrypted);
  }

  const data = await plaidCall(
    api.linkTokenCreate({
      client_name: CLIENT_NAME,
      language: "en",
      country_codes: [CountryCode.Us],
      user: { client_user_id: userId },
      webhook: webhookUrl(),
      ...(accessToken
        ? { access_token: accessToken }
        : {
            products: [Products.Transactions],
            transactions: { days_requested: TRANSACTION_DAYS_REQUESTED },
          }),
    }),
  );
  await track(userId, "link_started", { update_mode: Boolean(itemId) });
  return data.link_token;
}

// Saves a newly linked item and returns its id. The first sync is the caller's job.
export async function exchangePublicToken(
  userId: string,
  publicToken: string,
  institutionName: string | null,
  { client = defaultClient, api = plaid() }: Options = {},
): Promise<string> {
  const data = await plaidCall(api.itemPublicTokenExchange({ public_token: publicToken }));
  const item = await scopedFor(userId, client).plaidItems.create({
    data: {
      userId,
      plaidItemId: data.item_id,
      accessTokenEncrypted: encrypt(data.access_token),
      institutionName,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "item_linked",
    { type: "plaid_item", id: item.id },
    {
      institution: institutionName,
    },
  );
  await track(userId, "link_succeeded", { institution: institutionName });
  return item.id;
}
