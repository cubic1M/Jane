import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// What Jane knows about you, for a new student (debugger 11-13): what Jane can't tell yet folds
// away under "Not known yet", closed, instead of a long run of boxes reading "My guess · not known
// yet" ("The year the person you inherited an IRA from died"). Each is still one tap away to tell.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("what Jane doesn't know yet is folded away, and says no guess", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "What Jane knows about you" })).toBeVisible();

  const fold = page.locator("details[data-not-known]");
  await expect(fold).toHaveCount(1);
  await expect(fold).not.toHaveAttribute("open", /.*/);
  await expect(fold.locator("summary")).toHaveText(/^Not known yet \(\d+\)$/);
  // Folded, the niche questions aren't on the page to read past.
  await expect(page.getByText("The year the person you inherited an IRA from died")).toBeHidden();
  await expect(page.getByText(/not known yet$/)).toHaveCount(0);

  // Opened, each can still be told, in its own words.
  await fold.locator("summary").click();
  const filing = fold.locator("li").filter({ hasText: "How you file taxes" });
  await expect(filing.getByRole("combobox")).toBeVisible();
  await expect(filing.locator("option", { hasText: /^single$/ })).toHaveCount(1);
  await expect(page.getByText(/My guess · not known yet/)).toHaveCount(0);

  // Told, it leaves the fold, said in its own words, and its box starts on the answer given
  // (not on the box's first choice, "single").
  await filing.getByRole("combobox").selectOption("head_of_household");
  await filing.getByRole("button", { name: "Correct" }).click();
  await expect(filing.getByRole("status")).toBeVisible();
  await page.reload();
  await expect(fold.locator("li").filter({ hasText: "How you file taxes" })).toHaveCount(0);
  const told = page.locator("li").filter({ hasText: "How you file taxes" });
  await expect(told).toHaveCount(1);
  await expect(told).toContainText("head of household");
  await expect(told).toContainText("You told me");
  await expect(told.getByRole("combobox")).toHaveValue("head_of_household");
});
