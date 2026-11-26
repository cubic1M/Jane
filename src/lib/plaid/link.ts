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

// The bank was linked again with accounts that are all linked already (debug 3, 11-16: a second
// link of the same bank made every account twice and doubled every charge on them).
export class AlreadyLinkedError extends Error {
  constructor(institutionName: string) {
    super(`You've already linked ${institutionName}, so nothing new was added.`);
  }
}

// A link token for a new item, or, given an item id, for Link's update mode so the person
// can sign in to their bank again.
export async function createLinkToken(
  userId: string,
  itemId: string | null,
  { client = defaultClient, api: given }: Options = {},
): Promise<string> {
  const api = given ?? (await plaid());
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
            // Loans and card rates (spec step 65) and holdings (step 66): the person agrees to
            // them in this same Link, but Plaid bills each only from Jane's first read of it, and
            // sync reads it only for a link with that kind of account (./sync.ts). In
            // optional_products they were billed when the link was made, at every bank that offers
            // them, cards or not (plaid.com/docs/link/initializing-products, read 2026-11-17: this
            // is Plaid's own advice for a personal-finance app). They don't limit which banks can
            // be picked. Investments only once it's on our Plaid plan (PLAID_INVESTMENTS).
            additional_consented_products: [
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

// An account is the same one when the bank gives it the same type and last four digits (its name,
// when there are none).
const accountKey = (a: { type: string; mask: string | null; name: string }) =>
  a.mask ? `${a.type}|${a.mask}` : `${a.type}|name:${a.name}`;

// Whether every account a new link shares is already linked from a bank of the same name. Only
// ever a guard: if Plaid can't list them, the link goes ahead as before.
async function sameAccountsLinked(
  db: ReturnType<typeof scopedFor>,
  api: PlaidApi,
  accessToken: string,
  institutionName: string,
): Promise<boolean> {
  try {
    return await accountsAllLinked(db, api, accessToken, institutionName);
  } catch (error) {
    // A guard only: a failure here must not leave Plaid's Item made and its token unsaved.
    log.error("Couldn't check whether a new link was linked already", { error });
    return false;
  }
}

async function accountsAllLinked(
  db: ReturnType<typeof scopedFor>,
  api: PlaidApi,
  accessToken: string,
  institutionName: string,
): Promise<boolean> {
  const sameBank = { equals: institutionName, mode: "insensitive" as const };
  const before = await db.plaidItems.findFirst({
    where: { institutionName: sameBank },
    select: { id: true },
  });
  if (!before) return false;
  const [shared, linked] = await Promise.all([
    Promise.resolve()
      .then(() => plaidCall(api.accountsGet({ access_token: accessToken })))
      .then(
        (data) => data.accounts,
        (error) => {
          log.error("Couldn't list a new link's accounts", { error });
          return [];
        },
      ),
    db.accounts.findMany({
      where: { source: "plaid", item: { institutionName: sameBank } },
      select: { type: true, mask: true, name: true },
    }),
  ]);
  const have = new Set(linked.map(accountKey));
  return (
    shared.length > 0 &&
    shared.every((a) => have.has(accountKey({ type: String(a.type), mask: a.mask, name: a.name })))
  );
}

// Saves a newly linked item and returns its id. The first sync is the caller's job. Every
// Production access token counts for good, so the slot is taken before asking Plaid for one.
export async function exchangePublicToken(
  userId: string,
  publicToken: string,
  institutionName: string | null,
  { client = defaultClient, api: given }: Options = {},
): Promise<string> {
  const api = given ?? (await plaid());
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
  // A lookup that fails counts as "not saved": the create below then decides (a row that exists
  // keeps its Item), and a save that fails ends the Item, so no token is lost on this path.
  let saved: { id: string } | null = null;
  try {
    saved = await db.plaidItems.findFirst({
      where: { plaidItemId: data.item_id },
      select: { id: true },
    });
  } catch (error) {
    log.error("Couldn't look up a new bank link", { error });
  }
  if (slot && (saved || isDemoItemId(data.item_id))) await releaseItemSlot(slot, { client });
  if (saved) return saved.id;
  // Every account Plaid shares from this link is one already linked from the same bank: the new
  // Item goes again at Plaid, and nothing is saved, so nothing is counted twice.
  if (
    institutionName &&
    !isDemoItemId(data.item_id) &&
    (await sameAccountsLinked(db, api, data.access_token, institutionName))
  ) {
    await plaidCall(api.itemRemove({ access_token: data.access_token })).catch((error) =>
      log.error("Couldn't remove a bank linked twice", { error }),
    );
    if (slot) await releaseItemClaim(slot, { client }).catch(() => undefined);
    await track(userId, "link_refused", { reason: "already_linked", at: "exchange" });
    throw new AlreadyLinkedError(institutionName);
  }
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
  // The Item is saved and in use: a record or event that fails to write must not make the link
  // look failed (Link's public token works once, so the person could not try it again).
  try {
    await logAudit(
      { type: "user", id: userId },
      "item_linked",
      { type: "plaid_item", id: item.id },
      { institution: institutionName },
    );
    await track(userId, "link_succeeded", { institution: institutionName });
  } catch (error) {
    log.error("Couldn't record a saved bank link", { error: String(error) });
  }
  return item.id;
}
