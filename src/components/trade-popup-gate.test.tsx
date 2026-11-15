import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const adviceMode = vi.fn();
vi.mock("@/lib/advice-mode", () => ({ adviceMode: (id: string) => adviceMode(id) }));

import { PaperMark } from "./paper-mark";
import { sideChatStore } from "./side-chat/store";
import { PaperUser } from "./trade-popup-gate";

// The trade pop-up runs only for a person in demo advice mode (speed round, 11-15): nobody else
// loads its code or asks /api/paper/signals on every page.
describe("the trade pop-up's gate", () => {
  it("is marked by the header only in demo advice mode", async () => {
    adviceMode.mockResolvedValueOnce(true);
    const on = await PaperMark({ userId: "u1" });
    expect(on?.type).toBe(PaperUser);
    expect(on?.props).toEqual({ userId: "u1" });

    adviceMode.mockResolvedValueOnce(false);
    expect(await PaperMark({ userId: "u1" })).toBeNull();

    // A failed read never breaks the header: no pop-up, as for anyone else.
    adviceMode.mockRejectedValueOnce(new Error("gone"));
    expect(await PaperMark({ userId: "u1" })).toBeNull();
  });

  it("belongs to the person it was said for", () => {
    sideChatStore.setPaperFor("u1");
    expect(sideChatStore.get().paperFor).toBe("u1");
    // Another person signing in on the same tab isn't in advice mode until their page says so.
    expect(sideChatStore.get().paperFor === "u2").toBe(false);
  });

  it("loads the pop-up's code only through import()", () => {
    const src = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
    expect(src("app/layout.tsx")).not.toMatch(/from ["']@\/components\/trade-popup["']/);
    const gate = src("components/trade-popup-gate.tsx");
    expect(gate).not.toMatch(/from ["']\.\/trade-popup["']/);
    expect(gate).toMatch(/import\(["']\.\/trade-popup["']\)/);
  });
});
