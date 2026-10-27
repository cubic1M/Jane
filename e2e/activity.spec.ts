import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The beta's activity log (src/lib/activity/): typing in a field records that something was
// typed and how long it is, never the words, in what the browser sends or what we store. An
// admin's typing isn't recorded at all.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const TYPED = "my secret plan 4111";

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

async function activityOf(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT kind, path, role, label, data FROM activity_events WHERE user_id = $1 ORDER BY created_at`,
      [id],
    );
    return rows as {
      kind: string;
      path: string;
      label: string | null;
      data: Record<string, unknown>;
    }[];
  } finally {
    await client.end();
  }
}

for (const role of ["user", "admin"] as const) {
  test(`typing in a field records no value (${role})`, async ({ context, page, baseURL }) => {
    const user = await signedInUser(role);
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/activity")) sent.push(request.postData() ?? "");
    });

    // The recorder is running once the page has sent its first view.
    const first = page.waitForRequest((r) => r.url().endsWith("/api/activity"));
    await page.goto("/settings");
    await first;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    // Two fields on a real page: a plain one, and one marked private (as money fields are).
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.innerHTML =
        '<label>Note <input name="note"></label><label>Amount <input name="target" data-private></label>';
      document.body.append(form);
    });
    for (const name of ["Note", "Amount"]) {
      const box = page.getByRole("textbox", { name });
      await box.click();
      await box.pressSequentially(TYPED);
      await box.blur();
    }
    // Hide the page so the batch goes at once.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

    if (role === "user") {
      await expect
        .poll(async () => (await activityOf(user.userId)).filter((r) => r.kind === "blur").length, {
          timeout: 30_000,
        })
        .toBe(2);
      const rows = await activityOf(user.userId);
      expect(rows.filter((r) => r.kind === "blur").map((r) => [r.label, r.data])).toEqual([
        ["note", { typed: true, private: false, length: TYPED.length }],
        ["target", { typed: true, private: true }],
      ]);
      expect(rows.some((r) => r.kind === "page_view")).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("secret");
      expect(JSON.stringify(rows)).not.toContain("4111");
    } else {
      // Give the browser time to send whatever it would.
      await page.waitForTimeout(7_000);
      expect(await activityOf(user.userId)).toEqual([]);
    }
    expect(sent.join("\n")).not.toContain("secret");
    expect(sent.join("\n")).not.toContain("4111");
  });
}
