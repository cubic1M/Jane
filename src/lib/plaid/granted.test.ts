import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { encrypt } from "@/lib/crypto";
import { log } from "@/lib/log";
import { countGranted } from "./granted";

// The founder's view of what Plaid granted each bank link (connectors lane, read connectors step
// 2). Plaid sandbox, 11-17: Tattersall Federal Credit Union has neither Liabilities nor
// Investments, so a link that asked for both got Transactions alone, while our row still said
// both.

beforeEach(stubTestKeys);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const row = (token: string, investments = true) => ({
  accessTokenEncrypted: encrypt(token),
  liabilities: true,
  investments,
});

// What each sandbox bank's /item/get said on the walk, with what the person consented to.
const ITEMS: Record<
  string,
  { products: string[]; billed_products: string[]; consented_products?: string[] }
> = {
  "tok-platypus": {
    consented_products: ["investments", "liabilities", "transactions"],
    products: ["investments", "liabilities", "transactions"],
    billed_products: ["investments", "liabilities", "recurring_transactions", "transactions"],
  },
  "tok-tattersall": {
    products: ["transactions"],
    billed_products: ["recurring_transactions", "transactions"],
  },
};

const api = {
  itemGet: vi.fn(async ({ access_token }: { access_token: string }) => {
    const item = ITEMS[access_token];
    if (!item) throw { response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED" } } };
    return { data: { item } };
  }),
} as never;

describe("what Plaid granted each bank link", () => {
  it("counts asked, granted and billed per product, apart", async () => {
    const counts = await countGranted(
      [row("tok-platypus"), row("tok-tattersall"), row("tok-tattersall", false)],
      api,
    );
    expect(counts.checked).toBe(3);
    expect(counts.unreadable).toBe(0);
    expect(counts.products).toEqual([
      { product: "investments", asked: 2, consented: 1, granted: 1, billed: 1 },
      { product: "liabilities", asked: 3, consented: 1, granted: 1, billed: 1 },
      // Not asked for in Link: Plaid bills it once the recurring endpoint is called.
      { product: "recurring_transactions", asked: 0, consented: 0, granted: 0, billed: 3 },
      { product: "transactions", asked: 3, consented: 1, granted: 3, billed: 3 },
    ]);
  });

  it("counts a link Plaid won't answer for, and logs its code alone", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const counts = await countGranted([row("tok-platypus"), row("tok-signed-out")], api);
    expect(counts).toMatchObject({ checked: 2, unreadable: 1 });
    expect(counts.products.find((p) => p.product === "investments")).toEqual({
      product: "investments",
      asked: 2,
      consented: 1,
      granted: 1,
      billed: 1,
    });
    expect(warn).toHaveBeenCalledWith("Couldn't read a bank link's products", {
      code: "ITEM_LOGIN_REQUIRED",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("tok-");
  });

  it("says nothing that names a link: counts and product names only", async () => {
    const counts = await countGranted([row("tok-platypus")], api);
    const said = JSON.stringify(counts);
    expect(said).not.toContain("tok-");
    expect(Object.keys(counts).sort()).toEqual(["checked", "products", "unreadable"]);
    for (const p of counts.products) {
      expect(Object.keys(p).sort()).toEqual(["asked", "billed", "consented", "granted", "product"]);
    }
  });

  it("asks Plaid a few at a time", async () => {
    let now = 0;
    let most = 0;
    const slow = {
      itemGet: async () => {
        most = Math.max(most, ++now);
        await new Promise((r) => setTimeout(r, 5));
        now -= 1;
        return { data: { item: ITEMS["tok-tattersall"] } };
      },
    } as never;
    const counts = await countGranted(
      Array.from({ length: 12 }, () => row("tok-tattersall")),
      slow,
    );
    expect(counts.checked).toBe(12);
    expect(most).toBeLessThanOrEqual(5);
  });
});
