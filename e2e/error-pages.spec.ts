import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// A broken or missing page is never blank: it says what happened, with Home and Report a problem.
// A page that broke in the browser reaches /admin/errors without anything typed in it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

test("a missing page says so, with the way home and a report", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  users.push(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  const screen = page.locator("[data-error-screen]");
  await expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/home");
  await expect(screen.getByRole("link", { name: "Report a problem" })).toHaveAttribute(
    "href",
    "/report-a-problem?from=%2Fno-such-page",
  );
});

test("a page that broke in the browser reaches /admin/errors, typed values gone", async ({
  page,
  baseURL,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  // Its own made-up IP (like e2e/rate-limits.spec.ts), so the shard's other browsers, which share
  // one address in CI, can't use up the /api limit first and get this a 429.
  const ip = `198.51.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
  const sent = await page.request.post(`${baseURL}/api/client-error`, {
    headers: { "x-forwarded-for": ip },
    data: {
      name: "RangeError",
      message: `Invalid amount '1,240.50' for rent ${tag}`,
      stack: null,
      path: "/import",
    },
  });
  expect(sent.status()).toBe(200);

  const admin = await signedInUser("admin");
  users.push(admin.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/admin/errors");
  const row = page.getByText(`RangeError: Invalid amount [text] for rent ${tag}`);
  await expect(row).toBeVisible();
  await expect(page.getByText("1,240.50")).toHaveCount(0);
});
