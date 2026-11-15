import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Debugger 11-15: Yes on "Drop your mortgage insurance" opened Loans & credit on that item, whose
// first link, "See if PMI can go ›", went to the same item again: its page is hidden in the beta, so
// the link had been turned into the item's own. A suggestion's button isn't drawn where it would
// only reopen its item; the page that's there (PMI, escrow and extra payments) is.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("a loans suggestion's item has no link back to itself", async ({ context, page, baseURL }) => {
  userId = await demoPerson(context, page, baseURL);
  const here = "/loans?focus=cheaper:pmi_removal";
  await page.goto(here);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: /See PMI, escrow and extra payments/ }),
  ).toBeVisible();
  const hrefs = await main
    .locator("a[href]")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(hrefs).not.toContain(here);
});
