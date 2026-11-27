import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stepMessage } from "./student-replies";
import { shownFields, tapPayload } from "./tap";
import { toView } from "./view";

// Hotfix (#2305 regression): a tap carries what the card showed, from every place that taps.

const viewOf = (m: ReturnType<typeof stepMessage>) =>
  toView(
    {
      id: "m1",
      kind: "decision",
      body: m.body,
      refs: m.refs,
      actions: m.actions,
      status: "open",
      answeredWith: null,
      answeredAt: null,
      createdAt: new Date("2026-11-26T12:00:00Z"),
    },
    new Date("2026-11-26T12:00:00Z"),
    null,
  );

describe("the tap payload", () => {
  it("carries the message, the button and what a student step showed", () => {
    const data = tapPayload(viewOf(stepMessage(2)), "student.next");
    expect(data.get("messageId")).toBe("m1");
    expect(data.get("actionId")).toBe("student.next");
    expect(data.get("shown")).toBe("student:2");
  });

  it("carries a choice, the flow's showing and the saving's terms when there are any", () => {
    expect(shownFields({ flowShown: "abc", shown: "saving:s1:t" })).toEqual({
      flowShown: "abc",
      shown: "saving:s1:t",
    });
    expect(tapPayload({ id: "m", shown: "saving:s1:t" }, "option.pick", "o1").get("choice")).toBe(
      "o1",
    );
    expect(tapPayload({ id: "m" }, "snooze").has("shown")).toBe(false);
  });
});

// A new tap path that builds its own FormData would forget the next token as the dock forgot
// `shown`: every caller of tapButton goes through the shared builder.
describe("every caller of tapButton uses the shared builder", () => {
  const files = [
    "src/app/chat/suggestion-cards.tsx",
    "src/app/chat/chat-cards.tsx",
    "src/app/chat/message.tsx",
  ];
  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/@\/lib\/jane-agent\/tap/);
    expect(source).not.toMatch(/data\.set\("actionId"/);
  });

  it("no other file calls tapButton", async () => {
    const { execSync } = await import("node:child_process");
    // (tap.ts only names it in a comment; debt-review-replies.ts has an unrelated local function.)
    const own = new Set([
      "src/app/chat/actions.ts",
      "src/lib/jane-agent/tap.ts",
      "src/lib/jane-agent/debt-review-replies.ts",
    ]);
    const callers = execSync("grep -rlE 'tapButton' src --include=*.tsx --include=*.ts", {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !own.has(f));
    expect(callers.sort()).toEqual([...files].sort());
  });
});
