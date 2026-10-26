import { expect, test, type Page } from "@playwright/test";
import { landInChat } from "./chat-page";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The security headers (docs/security/edge.md): every page's Content-Security-Policy carries a
// fresh nonce, every script on the page carries it (so nothing Jane runs is blocked, and an
// injected script would be), and the pages that matter still work under it: the landing
// column and fonts, sign-in, the chat with its microphone, charts, and the admin pages.

// Every violation the browser reports, from before the page's own scripts run.
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction("__cspViolation", (v: string) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __cspViolation(v: string): void }).__cspViolation(
        `${e.effectiveDirective} blocked ${e.blockedURI} on ${location.pathname}`,
      ),
    );
  });
  page.on("request", (r) => {
    if (r.url().includes("/api/csp-report")) seen.push(`report sent from ${page.url()}`);
  });
  return seen;
}

// The nonce in the page's policy, and whether every script carries it.
async function scriptsCarryTheNonce(page: Page, csp: string) {
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  const scripts = await page.evaluate(() =>
    Array.from(document.scripts).map((s) => ({ src: s.src, nonce: s.nonce })),
  );
  expect(scripts.length).toBeGreaterThan(0);
  // Scripts added later by Jane's own (Plaid Link) need none: 'strict-dynamic' trusts them.
  const parserInserted = scripts.filter((s) => !s.src.startsWith("https://cdn.plaid.com"));
  expect(parserInserted.filter((s) => s.nonce !== nonce)).toEqual([]);
}

test("every page has the security headers, a fresh nonce, and nothing blocked", async ({
  page,
  request,
}) => {
  const violations = await watchViolations(page);
  const nonces = new Set<string>();
  for (const path of ["/", "/login", "/signup", "/security", "/privacy", "/try"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const headers = response!.headers();
    const csp = headers["content-security-policy"];
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).not.toContain("'unsafe-inline' https://cdn.plaid.com");
    expect(headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("microphone=(self)");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    await scriptsCarryTheNonce(page, csp);
    nonces.add(/'nonce-([^']+)'/.exec(csp)![1]);
  }
  // A new nonce on every request.
  expect(nonces.size).toBe(6);

  // The landing column still draws (it reads its image's pixels) under the policy.
  await page.goto("/");
  const column = page.getByTestId("landing-column");
  await expect
    .poll(async () => Number(await column.getAttribute("data-height")))
    .toBeGreaterThan(0);
  // And the page's scripts run: a link tap moves on without a full reload.
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL("/signup");
  expect(violations).toEqual([]);

  // API responses: data only, never framed or loaded as a page.
  const api = await request.get("/api/health");
  expect(api.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

test.describe("signed in", () => {
  test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
  test.setTimeout(120_000);

  let userId: string | undefined;
  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
  });

  test("home, charts, the chat and its microphone work under the policy", async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await signedInUser("user");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    const violations = await watchViolations(page);

    await page.goto("/connect");
    await page.getByRole("button", { name: "Link a demo bank" }).click();
    await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 60_000 });
    await scriptsCarryTheNonce(page, (await page.reload())!.headers()["content-security-policy"]);

    // The chat's own page may be framed by ours (the side chat), and may use the microphone.
    await landInChat(page);
    const chat = await page.reload();
    expect(chat!.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(chat!.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    const allowed = await page.evaluate(() => {
      const policy = (
        document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }
      ).featurePolicy;
      return (
        policy && {
          mic: policy.allowsFeature("microphone"),
          camera: policy.allowsFeature("camera"),
        }
      );
    });
    if (allowed) expect(allowed).toEqual({ mic: true, camera: false });
    await expect(page.getByRole("button", { name: "Speak your message" })).toBeVisible();

    // A page with charts and the docked side chat, whose frame passes the microphone on.
    await page.goto("/net-worth");
    const frame = page.locator('iframe[title="Chat with Jane"]');
    if (await frame.count()) expect(await frame.first().getAttribute("allow")).toBe("microphone");
    expect(violations).toEqual([]);
  });

  test("the admin pages work under the policy", async ({ context, page, baseURL }) => {
    const admin = await signedInUser("admin");
    userId = admin.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" },
    ]);
    const violations = await watchViolations(page);
    const response = await page.goto("/admin/errors");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Server errors" })).toBeVisible();
    await scriptsCarryTheNonce(page, response!.headers()["content-security-policy"]);
    expect(violations).toEqual([]);
  });
});
