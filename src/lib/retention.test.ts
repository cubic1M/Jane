import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import PrivacyPage from "@/app/privacy/page";
import { RATE_LIMIT_RETENTION_HOURS } from "@/config/rate-limits";
import { INACTIVE_ITEM_DAYS, RETENTION_PERIODS } from "@/config/retention";
import { retentionPolicy, runRetention } from "./retention";

const decode = (html: string) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

describe("the privacy policy and the retention config", () => {
  it("names every period in the config", () => {
    const policy = retentionPolicy().join("\n");
    for (const p of Object.values(RETENTION_PERIODS)) expect(policy).toContain(p.policy);
    expect(policy).toContain(`${INACTIVE_ITEM_DAYS} days`);
  });

  it("is what the privacy page shows, word for word", () => {
    const page = decode(renderToStaticMarkup(PrivacyPage()));
    for (const line of retentionPolicy()) expect(page).toContain(line);
  });

  it("keeps the rate-limit cleanup in step with the policy", () => {
    expect(RATE_LIMIT_RETENTION_HOURS).toBe(RETENTION_PERIODS.rateLimits.days * 24);
  });

  it("has a cleanup for every kind of record in the config", async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const client = new Proxy({}, { get: () => ({ deleteMany }) }) as never;
    const removed = await runRetention({ client });
    expect(Object.keys(removed).sort()).toEqual(Object.keys(RETENTION_PERIODS).sort());
  });

  it("deletes trial people only once the other deletes are done, so they can't deadlock", async () => {
    const pending = new Set<string>();
    let overlapped = false;
    const client = new Proxy(
      {},
      {
        get: (_, table: string) => ({
          deleteMany: async () => {
            if (table === "user" && pending.size > 0) overlapped = true;
            pending.add(table);
            await new Promise((resolve) => setTimeout(resolve, 5));
            pending.delete(table);
            return { count: 0 };
          },
        }),
      },
    ) as never;
    await runRetention({ client });
    expect(overlapped).toBe(false);
  });
});
