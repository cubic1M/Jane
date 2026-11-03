import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import PrivacyPage from "@/app/privacy/page";
import { RATE_LIMIT_RETENTION_HOURS } from "@/config/rate-limits";
import { INACTIVE_ITEM_DAYS, RETENTION_PERIODS } from "@/config/retention";
import { retentionPolicy, runRetention } from "./retention";
import { deleteExpiredTrials, deleteTrialsPastTheirTime } from "./trial-delete";

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
    const client = new Proxy(
      {},
      {
        get: (_, key: string) =>
          key === "$executeRaw" ? async () => 0 : { deleteMany, findMany: async () => [] },
      },
    ) as never;
    const removed = await runRetention({ client });
    expect(Object.keys(removed).sort()).toEqual(Object.keys(RETENTION_PERIODS).sort());
  });

  it("deletes trial people only once the other deletes are done, so they can't deadlock", async () => {
    const pending = new Set<string>();
    let overlapped = false;
    const client = new Proxy(
      {},
      {
        get: (_, table: string) =>
          table === "$executeRaw"
            ? async () => 0
            : {
                findMany: async () => [],
                deleteMany: async () => {
                  if (table === "user" && pending.size > 0) overlapped = true;
                  pending.add(table);
                  await new Promise((resolve) => setTimeout(resolve, 5));
                  pending.delete(table);
                  return { count: 0 };
                },
              },
      },
    ) as never;
    await runRetention({ client });
    expect(overlapped).toBe(false);
  });

  // Someone who can't be deleted is the clean-up's to report, first thing in the cron. What runs
  // after retention is everyone else's night.
  describe("with a temporary person who can't be deleted", () => {
    const stuck = (ids: string[]) => {
      const count = { count: 0 };
      const transactions = vi.fn(async () => {
        throw new Error("P2028 transaction timed out");
      });
      const client = new Proxy(
        {},
        {
          get: (_, key: string) => {
            if (key === "$executeRaw") return async () => 0;
            if (key === "$transaction") return transactions;
            return {
              deleteMany: async () => count,
              findMany: async () => ids.map((id) => ({ id })),
              findFirst: async () => null,
            };
          },
        },
      ) as never;
      return { client, transactions };
    };

    it("still finishes, and says so in the log", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { client } = stuck(["trial_own_a"]);
      await expect(runRetention({ client })).resolves.toMatchObject({ trialPeople: 0 });
      expect(error).toHaveBeenCalledWith("Some trial people couldn't be deleted", { failed: 1 });
      warn.mockRestore();
    });

    it("doesn't try at all when the cron has just done it", async () => {
      const { client, transactions } = stuck(["trial_own_a"]);
      await runRetention({ client, skipTrials: true });
      expect(transactions).not.toHaveBeenCalled();
    });

    it("spends no more than its budget, and counts the rest for next time", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client, transactions } = stuck(["trial_own_a", "trial_own_b", "trial_own_c"]);
      let time = 0;
      // Each try takes 40 seconds, what a transaction can wait for and run.
      transactions.mockImplementation(async () => {
        time += 40_000;
        throw new Error("P2028 transaction timed out");
      });
      const result = await deleteExpiredTrials(new Date(), { client, clock: () => time });
      expect(result).toEqual({ deleted: 0, failed: 3 });
      // Two tries on the first person, and past 60 seconds nobody else is started.
      expect(transactions).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it("reports it from the cron's own step, once the sweep has had its turn", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = stuck(["trial_own_a"]);
      await expect(deleteTrialsPastTheirTime({ client })).rejects.toThrow(/1 temporary people/);
      warn.mockRestore();
    });
  });
});
