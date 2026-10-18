import { describe, expect, it } from "vitest";
import { checkChange, type StatusChange } from "./concierge";

const change = (overrides: Partial<StatusChange> = {}): StatusChange => ({
  status: "in_progress",
  assignee: null,
  notes: null,
  minutesSpent: null,
  userTodo: null,
  failureReason: null,
  ...overrides,
});

describe("checkChange (queue rules)", () => {
  it("allows starting an action", () => {
    expect(checkChange("queued", change())).toBeNull();
  });

  it("blocks closing without minutes spent", () => {
    expect(checkChange("in_progress", change({ status: "done" }))).toMatch(/minutes/);
    expect(checkChange("in_progress", change({ status: "done", minutesSpent: 0 }))).toMatch(
      /minutes/,
    );
    expect(checkChange("in_progress", change({ status: "done", minutesSpent: 1.5 }))).toMatch(
      /minutes/,
    );
    expect(checkChange("in_progress", change({ status: "done", minutesSpent: 601 }))).toMatch(
      /minutes/,
    );
    expect(checkChange("in_progress", change({ status: "done", minutesSpent: 15 }))).toBeNull();
  });

  it("blocks failing without a reason", () => {
    expect(checkChange("in_progress", change({ status: "failed", minutesSpent: 10 }))).toMatch(
      /why it failed/,
    );
    expect(
      checkChange(
        "in_progress",
        change({
          status: "failed",
          minutesSpent: 10,
          failureReason: "Merchant needs the account holder",
        }),
      ),
    ).toBeNull();
  });

  it("requires what the person must do when waiting on them", () => {
    expect(checkChange("in_progress", change({ status: "waiting_on_user" }))).toMatch(
      /needs to do/,
    );
    expect(
      checkChange(
        "in_progress",
        change({ status: "waiting_on_user", userTodo: "Forward the email" }),
      ),
    ).toBeNull();
  });

  it("never reopens a closed action", () => {
    expect(checkChange("done", change())).toMatch(/closed/);
    expect(checkChange("failed", change())).toMatch(/closed/);
  });

  it("caps text length", () => {
    expect(checkChange("queued", change({ notes: "x".repeat(2001) }))).toMatch(/under/);
  });
});
