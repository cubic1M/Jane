import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test("every page links to the legal pages", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
});

for (const [path, heading] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/security", "How we keep your data safe"],
]) {
  test(`${path} shows its content, marked as a draft`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(
      "Draft for the closed beta, to be reviewed by a lawyer",
    );
  });
}

// What the pages say matches what Jane does today (the unit test, src/app/legal-pages.test.tsx,
// checks each claim against the code): the parts a person most needs, as they read them.
test("the Terms say read-only, no money moved, no advice, simulated paper money", async ({
  page,
}) => {
  await page.goto("/terms");
  const main = page.getByRole("main");
  await expect(main.getByText(/^Version \d{4}-\d{2}-\d{2}$/)).toBeVisible();
  await expect(main.getByRole("heading", { name: "A closed beta" })).toBeVisible();
  await expect(main.getByText(/Creating an account needs an invite code/)).toBeVisible();
  await expect(main.getByText(/Jane never moves money/)).toBeVisible();
  await expect(main.getByText(/Jane and our team don't contact companies for you/)).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "No financial advice for your real accounts" }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: "Practice and paper accounts" })).toBeVisible();
  await expect(main.getByText(/use simulated money only/)).toBeVisible();
  await expect(main.getByText(/Questions, or to report a problem: .+@|to be added/)).toBeVisible();
});

test("the Privacy Policy says what is shared, kept, deleted, and which cookies", async ({
  page,
}) => {
  await page.goto("/privacy");
  const main = page.getByRole("main");
  for (const heading of [
    "In short",
    "What we collect",
    "Who else sees it",
    "Practice and paper accounts",
    "How long we keep it",
    "Deleting your data",
    "Cookies and your browser",
    "Contact",
  ])
    await expect(main.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(main.getByText(/never stored as a file/)).toBeVisible();
  await expect(main.getByText(/encrypted \(AES-256-GCM\) and never shown or logged/)).toBeVisible();
  await expect(
    main.getByText(/It never receives your password, your bank sign-in, your Plaid connection/),
  ).toBeVisible();
  await expect(main.getByText(/A random id cookie \(kept for a year\)/)).toBeVisible();
  await expect(main.getByText(/deleted after \d+ hours/)).toBeVisible();
  await expect(main.getByText(/she\b|\bher\b/i)).toHaveCount(0);
});

test("sign-up asks for agreement to the Terms", async ({ page }) => {
  await page.goto("/signup");
  const consent = page.getByRole("checkbox", { name: /I agree to the Terms/ });
  await expect(consent).toBeVisible();
  expect(await consent.getAttribute("required")).not.toBeNull();
});

test.describe("existing users on an older Terms version", () => {
  test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
  test.setTimeout(120_000);
  let userId: string | undefined;
  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
  });

  test("accept the new version once, then carry on", async ({ context, page, baseURL }) => {
    const user = await signedInUser("user", { termsVersion: "2020-01-01" });
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);

    await page.goto("/report");
    await expect(page).toHaveURL("/terms/accept");
    await expect(page.getByRole("heading", { name: "We've updated our Terms" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL("/connect");

    await page.goto("/report");
    await expect(page).toHaveURL("/report");
  });
});
