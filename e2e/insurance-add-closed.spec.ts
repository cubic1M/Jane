import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Debugger 11-13: a person with no policies opened Insurance on a phone and found a long
// "Add a policy" form open under the tree. It's closed until they or a link open it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the add-a-policy form waits to be asked for", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "Insurance", level: 1 })).toBeVisible();
  const add = page.locator("#add");
  await expect(add).not.toHaveAttribute("open");
  await expect(add.getByLabel("What it insures")).toBeHidden();

  // The chat's "Add a policy" link, which names no kind, still lands on the open form.
  await page.goto("/insurance?add=new#add");
  await expect(add.getByLabel("What it insures")).toBeVisible();
  await expect(add.getByLabel("What it insures")).toHaveValue("auto");
});
