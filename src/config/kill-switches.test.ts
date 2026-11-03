import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KILL_SWITCH_VARS, killed } from "@/config/kill-switches";

// The doors these switches close. The chat, sign-in and scheduled jobs each have their own tests;
// these prove each switch reaches the one place everything goes through.
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(), getCurrentUser: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
});

describe("killed", () => {
  it("is off unless the variable is exactly 1", () => {
    expect(killed("site")).toBe(false);
    for (const value of ["0", "true", "yes", "11", ""]) {
      vi.stubEnv("KILL_SITE", value);
      expect(killed("site"), value).toBe(false);
    }
    vi.stubEnv("KILL_SITE", " 1 ");
    expect(killed("site")).toBe(true);
    expect(killed("claude")).toBe(false);
  });
});

describe("KILL_SITE", () => {
  const request = (path: string) => {
    const url = new URL(path, "https://jane.test");
    return {
      url: url.href,
      nextUrl: url,
      method: "GET",
      headers: new Headers(),
      cookies: { get: () => undefined },
    };
  };

  it("answers 503 on everything, before the database", async () => {
    vi.stubEnv("KILL_SITE", "1");
    const limit = vi.fn();
    vi.doMock("@/lib/edge-limits", () => ({ edgeLimit: limit }));
    const { proxy } = await import("@/proxy");
    for (const path of [
      "/",
      "/home",
      "/admin",
      "/api/export",
      "/api/plaid/webhook",
      "/api/cron/digest",
    ]) {
      const response = await proxy(request(path) as never, {} as never);
      expect(response.status, path).toBe(503);
    }
    expect(limit).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/edge-limits");
  });
});

describe("KILL_CLAUDE", () => {
  it("makes every caller see Claude as off, and fails one that didn't look", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test-value");
    const { anthropic, llmEnabled, resetAnthropicForTests } = await import("@/lib/anthropic");
    resetAnthropicForTests();
    expect(llmEnabled()).toBe(true);
    expect(() => anthropic()).not.toThrow();
    vi.stubEnv("KILL_CLAUDE", "1");
    expect(llmEnabled()).toBe(false);
    expect(() => anthropic()).toThrow("paused");
    resetAnthropicForTests();
  });
});

describe("KILL_CLAUDE, every door", () => {
  it("stops categorizing merchants, which has its own client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test-value");
    vi.stubEnv("KILL_CLAUDE", "1");
    const { classifyMerchants } = await import("@/categorize/llm");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn(async () => ({ stop_reason: "refusal", content: [] }));
    const claude = () => ({ messages: { create } }) as never;
    expect(await classifyMerchants(["netflix"], { claude })).toEqual(new Map());
    expect(create).not.toHaveBeenCalled();
    vi.stubEnv("KILL_CLAUDE", "");
    await classifyMerchants(["netflix"], { claude });
    expect(create).toHaveBeenCalledOnce();
  });

  it("has no other way to build a Claude client", () => {
    const builders = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => !file.startsWith("generated/") && !file.startsWith("test-setup/"))
      .filter((file) => readFileSync(`src/${file}`, "utf8").includes("new Anthropic("));
    expect(builders.sort()).toEqual(["categorize/llm.ts", "lib/anthropic.ts"]);
  });
});

describe("KILL_BANKS", () => {
  it("closes bank linking and the scheduled sync", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "a");
    vi.stubEnv("PLAID_SECRET", "b");
    const { plaidEnabled, plaid } = await import("@/lib/plaid/client");
    expect(plaidEnabled()).toBe(true);
    vi.stubEnv("KILL_BANKS", "1");
    expect(plaidEnabled()).toBe(false);
    // Deleting an account still removes the bank at Plaid.
    expect(() => plaid()).not.toThrow();
  });
});

describe("KILL_UPLOADS", () => {
  const form = () => {
    const data = new FormData();
    data.append("files", new File(["date,amount\n"], "statement.csv", { type: "text/csv" }));
    return data;
  };

  it("refuses statements before reading them", async () => {
    const { readUploadFiles } = await import("@/lib/import/upload");
    expect(Array.isArray(await readUploadFiles(form()))).toBe(true);
    vi.stubEnv("KILL_UPLOADS", "1");
    expect(await readUploadFiles(form())).toMatchObject({ reason: "paused" });
  });

  it("refuses documents", async () => {
    const { checkUpload } = await import("@/lib/documents/validate");
    vi.stubEnv("KILL_UPLOADS", "1");
    const file = { name: "a.pdf", size: 4, type: "application/pdf" };
    expect(checkUpload(file, new Uint8Array(4), 0)).toMatchObject({ ok: false });
  });
});

describe("KILL_EMAIL", () => {
  it("fails before anything leaves, and sends normally when off", async () => {
    vi.stubEnv("RESEND_API_KEY", "a-test-value");
    vi.stubEnv("EMAIL_FROM", "Jane <hello@example.com>");
    const fetcher = vi.fn(async () => new Response('{"id":"1"}'));
    vi.stubGlobal("fetch", fetcher);
    const { sendEmail } = await import("@/lib/email");
    const email = { to: "sam@example.com", subject: "s", text: "t", html: "<p>t</p>" };
    vi.stubEnv("KILL_EMAIL", "1");
    await expect(sendEmail(email)).rejects.toThrow("paused");
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("KILL_EMAIL", "");
    await sendEmail(email);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("switches that already exist", () => {
  it("every scheduled job refuses without CRON_SECRET", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string }[];
    };
    for (const { path } of crons) {
      expect(readFileSync(`src/app${path}/route.ts`, "utf8"), path).toMatch(
        /const secret = process\.env\.CRON_SECRET;\s+if \(!secret \|\|/,
      );
    }
  });
});
