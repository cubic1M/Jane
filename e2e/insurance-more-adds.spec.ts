import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { landInChat } from "./chat-page";
import { signInWith } from "./session";

// Debugger 11-15: a student who pays rent opened "Renters insurance, Missing" and tapped More.
// It said "Your payments show rent, and there's no renters policy on your profile. Your
// landlord's insurance covers the building…", the summary just above it, word for word. A
// question about how they live did the same. More says only what the summary leaves out.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a missing cover's More doesn't say its summary again", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);

  await page.goto("/insurance");
  await page.getByText("Your household details").click();
  await page.getByLabel("Your home").selectOption("rent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Jane checks your cover against it.")).toBeVisible();

  const gap = await pickItem(page, "Insurance", "Cover that looks missing", "Renters insurance");
  await expect(gap.getByText("No renters insurance on file")).toBeVisible();
  await expect(gap.getByText(/Your landlord's insurance covers the building/)).toHaveCount(1);
});

test("a question's More adds to it, not repeats it", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/insurance");
  const uber = await pickItem(
    page,
    "Insurance",
    "Questions about how you live",
    "Driving for pay?",
  );
  await expect(uber.getByText(/I saw \$412\.00 come in from Uber/)).toHaveCount(1);
  await uber.getByText("More", { exact: true }).click();
  await expect(uber.getByText(/A personal car policy may not cover you/)).toBeVisible();
});
