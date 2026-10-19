import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Investments (spec steps 128–137) on the demo bank: what the person owns, with sources,
// and Jane answering about it in the chat.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the demo bank's holdings show with their sources, and Jane answers about them", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  // Step 128: what they own, adding up to net worth, every holding with its source.
  await page.goto("/investments");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Investments");
  await expect(page.getByText("$96,730.55").first()).toBeVisible();
  await expect(page.getByText("Northstar Target 2055 Fund")).toBeVisible();
  await expect(
    page.getByText(/Source: Demo Bank \(fake data\), Demo 401\(k\), price as of/).first(),
  ).toBeVisible();
  // The filled-in page has no serious accessibility problems (e2e/accessibility.spec.ts
  // checks it empty).
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Message Jane" }).fill("what's in my 401k");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Your Demo 401\(k\) has \$84,250\.40 in 5 holdings/)).toBeVisible();

  // Step 129: the investor profile, answered in the chat a tap at a time.
  await page.getByRole("textbox", { name: "Message Jane" }).fill("what's my risk profile");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("1 of 4: How old are you?")).toBeVisible();
  await page.getByRole("button", { name: "40s" }).click();
  await expect(page.getByText("2 of 4: When will you need most of this money?")).toBeVisible();
  await page.getByRole("button", { name: "In 20 years or more" }).click();
  await page.getByRole("button", { name: "I'd worry, but wait it out" }).click();
  await page.getByRole("button", { name: "Retirement" }).click();
  await expect(page.getByText(/Thanks\. Your profile: Moderate/)).toBeVisible();

  // And changed on its page.
  await page.goto("/investments/profile");
  await expect(page.getByText("Moderate", { exact: true })).toBeVisible();
  await page.getByLabel("I'd put more in").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText("Aggressive", { exact: true })).toBeVisible();
});
