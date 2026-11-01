import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/rent-question", () => ({
  answerRentQuestion: vi.fn(async () => ({ updated: 3 })),
  answerRentInQuestion: vi.fn(async () => ({ updated: 3 })),
}));

import { answerRentInQuestion, answerRentQuestion } from "@/lib/rent-question";
import type { ChatMessage } from "../types";
import { ChatActionError } from "./handler";
import { ACTION_HANDLERS } from "./index";

// CSV bench round 24: "Is this your rent?" answers become the person's rule for that payee.
const message = (refs: object): ChatMessage =>
  ({ id: "m", refs, actions: [] }) as unknown as ChatMessage;
const tap = (id: "rent.yes" | "rent.no" | "rent_in.yes" | "rent_in.no", refs: object) =>
  ACTION_HANDLERS[id].run({
    userId: "u",
    message: message(refs),
    action: { id, label: id, kind: "secondary" },
    client: {} as never,
    now: new Date("2026-10-28T12:00:00Z"),
  });

describe("Is this your rent?", () => {
  it("files the payee's payments as rent on a yes", async () => {
    const out = await tap("rent.yes", { rentKey: "lucia gomez" });
    expect(answerRentQuestion).toHaveBeenCalledWith("u", "lucia gomez", true, expect.anything());
    expect(out).toMatchObject({ answeredWith: "Yes, it's rent" });
    expect(String((out as { note: string }).note)).toMatch(/3 payments are now rent/);
  });

  it("keeps them as transfers on a no, and never asks again", async () => {
    const out = await tap("rent.no", { rentKey: "lucia gomez" });
    expect(answerRentQuestion).toHaveBeenCalledWith("u", "lucia gomez", false, expect.anything());
    expect(String((out as { note: string }).note)).toMatch(/won't ask again/);
  });

  it("refuses a tap on a message that doesn't ask", async () => {
    await expect(tap("rent.yes", {})).rejects.toBeInstanceOf(ChatActionError);
  });
});

// Debugger 11-01: rent a person collects by Zelle, as rental income or not.
describe("Is it rent you collect?", () => {
  it("files the payer's money as rental income on a yes", async () => {
    const out = await tap("rent_in.yes", { rentKey: "from jordan tenant" });
    expect(answerRentInQuestion).toHaveBeenCalledWith(
      "u",
      "from jordan tenant",
      true,
      expect.anything(),
    );
    expect(out).toMatchObject({ answeredWith: "Yes, rent I collect" });
    expect(String((out as { note: string }).note)).toMatch(/3 payments are now rental income/);
  });

  it("keeps it as a transfer on a no, and never asks again", async () => {
    const out = await tap("rent_in.no", { rentKey: "from jordan tenant" });
    expect(answerRentInQuestion).toHaveBeenCalledWith(
      "u",
      "from jordan tenant",
      false,
      expect.anything(),
    );
    expect(String((out as { note: string }).note)).toMatch(/won't ask again/);
  });

  it("refuses a tap on a message that doesn't ask", async () => {
    await expect(tap("rent_in.yes", {})).rejects.toBeInstanceOf(ChatActionError);
  });
});
