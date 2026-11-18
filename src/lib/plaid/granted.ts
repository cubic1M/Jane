import type { PlaidApi } from "plaid";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";
import { plaid, plaidCall, plaidErrorCode } from "./client";
import { isDemoItemId } from "./demo-ids";

// What Plaid actually granted each real bank link, for the founder on /admin/costs. Link asks the
// person to consent to Liabilities and Investments (additional consented products, ./link.ts), and
// Jane reads each only for a link with that kind of account, so our own rows only say what we
// asked for. Each Item's /item/get says what the person consented to (consented_products), what's
// been added to it (products: a consented product joins at Jane's first read) and what's billed
// (billed_products). Liabilities and Investments are monthly subscriptions per Item from that first
// read until /item/remove (plaid.com/docs/account/billing). Counts only: no token, no item id, no
// person, no institution leaves this module or reaches the log.

const WHY = "Founder cost meter: Plaid's granted products per bank link, counted";

// /item/get is free; a few at a time keeps the page quick without bursting Plaid's rate limit.
const AT_ONCE = 5;

export type ProductCount = {
  product: string;
  asked: number;
  consented: number;
  granted: number;
  billed: number;
};

export type GrantedProducts = {
  // Real bank links read, and those Plaid wouldn't answer for (a sign-in needed, an error).
  checked: number;
  unreadable: number;
  products: ProductCount[];
};

type ItemRow = { accessTokenEncrypted: string; liabilities: boolean; investments: boolean };

// What we asked Link for on each Item (src/lib/plaid/link.ts): Transactions always, the optional
// products as the row says.
const askedFor = (row: ItemRow) => [
  "transactions",
  ...(row.liabilities ? ["liabilities"] : []),
  ...(row.investments ? ["investments"] : []),
];

export async function countGranted(
  rows: readonly ItemRow[],
  api: Pick<PlaidApi, "itemGet">,
): Promise<GrantedProducts> {
  const counts = new Map<string, ProductCount>();
  const bump = (product: string, key: "asked" | "consented" | "granted" | "billed") => {
    const c = counts.get(product) ?? { product, asked: 0, consented: 0, granted: 0, billed: 0 };
    c[key] += 1;
    counts.set(product, c);
  };
  let unreadable = 0;
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    await Promise.all(
      rows.slice(i, i + AT_ONCE).map(async (row) => {
        askedFor(row).forEach((p) => bump(p, "asked"));
        try {
          const { item } = await plaidCall(
            api.itemGet({ access_token: decrypt(row.accessTokenEncrypted) }),
          );
          new Set((item.consented_products ?? []).map(String)).forEach((p) => bump(p, "consented"));
          new Set((item.products ?? []).map(String)).forEach((p) => bump(p, "granted"));
          new Set((item.billed_products ?? []).map(String)).forEach((p) => bump(p, "billed"));
        } catch (error) {
          unreadable += 1;
          // The code alone: never the error, which can carry the request.
          log.warn("Couldn't read a bank link's products", { code: plaidErrorCode(error) });
        }
      }),
    );
  }
  return {
    checked: rows.length,
    unreadable,
    products: [...counts.values()].sort((a, b) => a.product.localeCompare(b.product)),
  };
}

// Real bank links only, as on the rest of /admin/costs: not the demo bank, not tries.
export async function plaidGranted({
  client = defaultClient,
  api,
  userIds,
}: {
  client?: PrismaClient;
  api?: Pick<PlaidApi, "itemGet">;
  // Tests only: these people's links (the test database is shared).
  userIds?: readonly string[];
} = {}): Promise<GrantedProducts> {
  const items = await systemDb(WHY, client).plaidItem.findMany({
    where: {
      userId: userIds ? { in: [...userIds] } : { not: { startsWith: TRIAL_ID_PREFIX } },
    },
    select: {
      plaidItemId: true,
      accessTokenEncrypted: true,
      liabilities: true,
      investments: true,
    },
  });
  const real = items.filter((i) => !isDemoItemId(i.plaidItemId));
  return countGranted(real, api ?? (await plaid()));
}
