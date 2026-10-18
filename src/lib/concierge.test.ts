import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { checkChange, workload, type StatusChange } from "./concierge";

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

describe("workload", () => {
  // Monday Oct 19 2026, 6pm UTC. The queue's rule: still queued after one business day.
  const NOW = new Date("2026-10-19T18:00:00Z");
  const a = (assignee: string | null, status: StatusChange["status"], createdAt: string) => ({
    assignee,
    status,
    createdAt: new Date(createdAt),
  });

  it("counts each person's open actions and the overdue ones, unassigned last", () => {
    expect(
      workload(
        [
          a("sam@example.com", "queued", "2026-10-14T10:00:00Z"), // overdue
          a("sam@example.com", "in_progress", "2026-10-01T10:00:00Z"), // started, so not overdue
          a("sam@example.com", "done", "2026-10-01T10:00:00Z"), // closed: not counted
          a("ana@example.com", "queued", "2026-10-19T09:00:00Z"), // today
          a(null, "queued", "2026-10-12T10:00:00Z"), // overdue
          a(null, "waiting_on_user", "2026-10-01T10:00:00Z"),
        ],
        NOW,
      ),
    ).toEqual([
      { assignee: "ana@example.com", open: 1, overdue: 0 },
      { assignee: "sam@example.com", open: 2, overdue: 1 },
      { assignee: null, open: 2, overdue: 1 },
    ]);
  });
});
