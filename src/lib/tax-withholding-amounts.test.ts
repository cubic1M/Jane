import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { WithholdingError, recordW4Change } from "./tax-withholding";

// A W-4 amount past what the column holds used to reach the database and fail with a server error.
describe("a W-4 change's amount", () => {
  it("is refused in words when it's too large for a W-4 line", async () => {
    const client = new Proxy(
      {},
      {
        get: () => {
          throw new Error("the database was reached");
        },
      },
    ) as never;
    await expect(
      recordW4Change("u1", { step: "4c", amountCents: 9_000_000_000 }, { client, via: "page" }),
    ).rejects.toBeInstanceOf(WithholdingError);
  });
});
