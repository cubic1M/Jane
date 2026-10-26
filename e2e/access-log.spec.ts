import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The access log (docs/security/edge.md): every admin page view is recorded by the proxy, the
// team can filter the log, and a signed-in person sees their own activity on /security.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("admin page views land on the access log, which the team can filter", async ({
  context,
  page,
  baseURL,
}) => {
  const admin = await signedInUser("admin");
  userId = admin.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/admin/errors?token=not-kept");
  await expect(page.getByRole("heading", { name: "Server errors" })).toBeVisible();

  const rows = page.getByRole("table", { name: "Access log entries" }).getByRole("row");
  const view = rows.filter({ hasText: "/admin/errors" });
  // The proxy writes the entry just after the response.
  await expect(async () => {
    await page.goto(`/admin/access-log?actor=${admin.userId}&event=admin_page_viewed`);
    await expect(view.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(view.first()).toContainText("success");
  // The path is kept, never its query string.
  await expect(page.getByRole("table", { name: "Access log entries" })).not.toContainText(
    "not-kept",
  );

  // A filter that matches nothing says so.
  await page.goto(`/admin/access-log?actor=${admin.userId}&outcome=failure`);
  await expect(page.getByText("No entries match.")).toBeVisible();
});

test("/security shows a signed-in person their recent activity, and nothing to others", async ({
  context,
  page,
  baseURL,
}) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "How we keep your data safe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your recent activity" })).toHaveCount(0);

  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Your recent activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out other devices" })).toHaveAttribute(
    "href",
    "/settings#sessions",
  );
});
