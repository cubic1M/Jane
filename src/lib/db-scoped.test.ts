import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopeArgs } from "./db-scoped";

const ME = "user_me";
const OTHER = "user_other";

describe("scopeArgs", () => {
  it.each(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy", "deleteMany"])(
    "adds the user to the filter for %s",
    (operation) => {
      expect(scopeArgs(operation, { where: { id: "f_1" } }, ME)).toEqual({
        where: { id: "f_1", userId: ME },
      });
    },
  );

  it("scopes a query with no filter at all", () => {
    expect(scopeArgs("findMany", undefined, ME)).toEqual({ where: { userId: ME } });
  });

  it("keeps the caller's other arguments", () => {
    expect(
      scopeArgs(
        "findMany",
        { where: { status: "new" }, orderBy: { createdAt: "desc" }, take: 5 },
        ME,
      ),
    ).toEqual({ where: { status: "new", userId: ME }, orderBy: { createdAt: "desc" }, take: 5 });
  });

  it("does not let the caller filter by another user's id", () => {
    expect(scopeArgs("findMany", { where: { userId: OTHER } }, ME)).toEqual({
      where: { userId: ME },
    });
  });

  it("keeps OR filters inside the user's rows", () => {
    // Top-level keys are ANDed, so OR can't reach outside the user's rows.
    expect(scopeArgs("findMany", { where: { OR: [{ userId: OTHER }, { id: "x" }] } }, ME)).toEqual({
      where: { OR: [{ userId: OTHER }, { id: "x" }], userId: ME },
    });
  });

  it("sets the user on created rows", () => {
    expect(scopeArgs("create", { data: { title: "t", userId: OTHER } }, ME)).toEqual({
      data: { title: "t", userId: ME },
    });
  });

  it("sets the user on every row of createMany", () => {
    expect(
      scopeArgs("createMany", { data: [{ title: "a" }, { title: "b", userId: OTHER }] }, ME),
    ).toEqual({
      data: [
        { title: "a", userId: ME },
        { title: "b", userId: ME },
      ],
    });
  });

  it("scopes updates and stops them moving rows to another user", () => {
    expect(scopeArgs("update", { where: { id: "f_1" }, data: { userId: OTHER } }, ME)).toEqual({
      where: { id: "f_1", userId: ME },
      data: { userId: ME },
    });
    expect(scopeArgs("updateMany", { where: {}, data: { status: "shown" } }, ME)).toEqual({
      where: { userId: ME },
      data: { status: "shown", userId: ME },
    });
  });

  it("scopes all three parts of an upsert", () => {
    expect(
      scopeArgs(
        "upsert",
        { where: { id: "f_1" }, create: { title: "t" }, update: { title: "u" } },
        ME,
      ),
    ).toEqual({
      where: { id: "f_1", userId: ME },
      create: { title: "t", userId: ME },
      update: { title: "u", userId: ME },
    });
  });

  it("does not modify the caller's arguments", () => {
    const args = { where: { id: "f_1" } };
    scopeArgs("findMany", args, ME);

    expect(args).toEqual({ where: { id: "f_1" } });
  });

  it("rejects operations it does not know how to scope", () => {
    expect(() => scopeArgs("aggregateRaw", {}, ME)).toThrow("not supported");
  });
});
