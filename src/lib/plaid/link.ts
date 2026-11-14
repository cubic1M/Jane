import { CountryCode, Products, type PlaidApi } from "plaid";
import { TRANSACTION_DAYS_REQUESTED } from "@/config/plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { PlaidRequestError, plaid, plaidCall, plaidInvestmentsEnabled, webhookUrl } from "./client";
import { isDemoItemId } from "@/lib/plaid/demo-ids";
import {
  type ItemSlot,
  LinkingClosedError,
  linkAvailability,
  releaseItemClaim,
  releaseItemSlot,
  reserveItemSlot,
} from "./item-slots";

// Plaid Link from our side: a link token to open Link, and the exchange that turns
// Link's public token into a stored item. The access token is encrypted before it is
// saved and never leaves the server.

// What Plaid's window calls us ("Jane uses Plaid to connect your account"); beta walk 11-12: it
// said "Financial Controller", a name the person has never seen.
const CLIENT_NAME = "Jane";

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
  let chooseAccounts = false;
  // A new Item needs a free slot. This is a guard: the count happens at the exchange, so a Link
  // someone abandons costs nothing. Update mode keeps the same Item, so it never asks.
  if (!itemId) {
    const link = await linkAvailability(userId, { client });
    if (!link.open) {
      await track(userId, "link_refused", { reason: link.reason, at: "link_token" });
      throw new LinkingClosedError(link.reason);
    }
  }
  if (itemId) {
    const item = await scopedFor(userId, client).plaidItems.findFirst({
      where: { id: itemId },
      select: { accessTokenEncrypted: true, newAccountsAvailable: true },
    });
    if (!item) throw new ItemNotFoundError();
    accessToken = decrypt(item.accessTokenEncrypted);
    // Plaid's NEW_ACCOUNTS_AVAILABLE: update mode lets them pick the new accounts to share.
    chooseAccounts = item.newAccountsAvailable;
  }

  const data = await plaidCall(
    api.linkTokenCreate({
      client_name: CLIENT_NAME,
      language: "en",
      country_codes: [CountryCode.Us],
      user: { client_user_id: userId },
      webhook: webhookUrl(),
      ...(accessToken
        ? {
            access_token: accessToken,
            ...(chooseAccounts ? { update: { account_selection_enabled: true } } : {}),
          }
        : {
            products: [Products.Transactions],
            // Loans and card rates (spec step 65) and investment balances (step 66) where
            // the bank supports them; billed only then, and it doesn't limit which banks
            // can be picked. Investments only once it's on our Plaid plan (PLAID_INVESTMENTS).
            optional_products: [
              Products.Liabilities,
              ...(plaidInvestmentsEnabled() ? [Products.Investments] : []),
            ],
            transactions: { days_requested: TRANSACTION_DAYS_REQUESTED },
          }),
    }),
  );
  await track(userId, "link_started", { update_mode: Boolean(itemId) });
  return data.link_token;
}

// After Link's update mode finishes: the bank is signed in again (or has its new accounts
// shared), so it stops asking. The caller syncs it. Plaid's LOGIN_REPAIRED webhook says the same
// for a repair that happened outside Link; either way the state is set, never toggled.
export async function markItemRepaired(
  userId: string,
  itemId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).plaidItems.updateMany({
    where: { id: itemId },
    data: {
      status: "active",
      newAccountsAvailable: false,
      lastErrorCode: null,
      lastErrorAt: null,
      reconnectBy: null,
    },
  });
  if (count === 0) throw new ItemNotFoundError();
  await logAudit({ type: "user", id: userId }, "item_relinked", { type: "plaid_item", id: itemId });
}

// Plaid answered no, so it made no access token. With no answer, or a failure of Plaid's own, it
// may have, so the slot stays taken.
const noTokenMade = (error: unknown) =>
  error instanceof PlaidRequestError &&
  error.status !== null &&
  error.status >= 400 &&
  error.status < 500;

// The save failed, so this is the only copy of the token: with it gone, nothing could ever end the
// Item at Plaid. The person can try again; Plaid's count stays, since the token was made. Not when
// the row already exists, because then the Item is in use and removing it would cut that bank off.
async function dropUnsavedItem(
  { access_token, item_id }: { access_token: string; item_id: string },
  slot: ItemSlot | null,
  saveError: unknown,
  { client, api }: Required<Options>,
): Promise<void> {
  if ((saveError as { code?: string }).code === "P2002") return;
  if (!isDemoItemId(item_id)) {
    await plaidCall(api.itemRemove({ access_token })).catch((error) =>
      log.error("Couldn't remove a bank link that failed to save", { error }),
    );
  }
  if (slot) await releaseItemClaim(slot, { client }).catch(() => undefined);
}

// Saves a newly linked item and returns its id. The first sync is the caller's job. Every
// Production access token counts for good, so the slot is taken before asking Plaid for one.
export async function exchangePublicToken(
  userId: string,
  publicToken: string,
  institutionName: string | null,
  { client = defaultClient, api = plaid() }: Options = {},
): Promise<string> {
  // A key that can't encrypt fails here, not after Plaid has made an Item and used up one of a
  // lifetime's count. Every try would, and it would look like nothing but a failed link.
  encrypt("key check");
  let slot: ItemSlot | null;
  try {
    slot = await reserveItemSlot(userId, { client });
  } catch (error) {
    if (error instanceof LinkingClosedError) {
      await track(userId, "link_refused", { reason: error.reason, at: "exchange" });
    }
    throw error;
  }
  const data = await plaidCall(api.itemPublicTokenExchange({ public_token: publicToken })).catch(
    async (error) => {
      if (slot && noTokenMade(error)) await releaseItemSlot(slot, { client });
      // No clear answer: Plaid may have made one, so the count stays. The person's own claim doesn't:
      // "try again" must be able to work, and it held the only one they get. Counted, because each
      // takes another of the lifetime count: past a few a day, reserveItemSlot waits for tomorrow.
      else if (slot) {
        // The claim first: a failure counting this can't leave them locked out for good.
        await releaseItemClaim(slot, { client }).catch(() => undefined);
        await hit("plaidUnclearExchange", userId, { client });
        await hit("plaidUnclearExchangeEveryone", "all", { client });
      }
      throw error;
    },
  );
  const db = scopedFor(userId, client);
  // The same exchange again (a retry) gives the Item already saved, which has its slot.
  const saved = await db.plaidItems.findFirst({
    where: { plaidItemId: data.item_id },
    select: { id: true },
  });
  if (slot && (saved || isDemoItemId(data.item_id))) await releaseItemSlot(slot, { client });
  if (saved) return saved.id;
  let item: { id: string };
  try {
    item = await db.plaidItems.create({
      data: {
        userId,
        plaidItemId: data.item_id,
        accessTokenEncrypted: encrypt(data.access_token),
        institutionName,
        liabilities: true,
        investments: plaidInvestmentsEnabled(),
      },
      select: { id: true },
    });
  } catch (error) {
    await dropUnsavedItem(data, slot, error, { client, api });
    throw error;
  }
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
