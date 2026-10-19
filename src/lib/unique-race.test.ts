import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { upsertOnce } from "./unique-race";

const race = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("an upsert two requests run at once", () => {
  it("runs again once when the other request created the row first", async () => {
    const save = vi.fn().mockRejectedValueOnce(race()).mockResolvedValueOnce("saved");
    await expect(upsertOnce(save)).resolves.toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("passes any other error on", async () => {
    const save = vi.fn().mockRejectedValue(new Error("down"));
    await expect(upsertOnce(save)).rejects.toThrow("down");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
