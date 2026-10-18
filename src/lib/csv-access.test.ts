import { describe, expect, it, vi } from "vitest";
import { canImportCsv } from "./csv-access";

const db = (csvAccounts: number) => ({
  accounts: { count: vi.fn().mockResolvedValue(csvAccounts) },
});

describe("canImportCsv", () => {
  it("lets admins import", async () => {
    expect(await canImportCsv({ id: "u", role: "admin" } as never, db(0) as never)).toBe(true);
  });

  it("lets people who already have CSV accounts keep importing", async () => {
    const accounts = db(1);
    expect(await canImportCsv({ id: "u", role: "user" } as never, accounts as never)).toBe(true);
    expect(accounts.accounts.count).toHaveBeenCalledWith({ where: { source: "csv" } });
  });

  it("sends everyone else to Plaid", async () => {
    expect(await canImportCsv({ id: "u", role: "user" } as never, db(0) as never)).toBe(false);
  });
});
