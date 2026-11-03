import { describe, expect, it } from "vitest";
import {
  migrationChanges,
  migrationProblems,
  unsafeWords,
} from "../../scripts/migration-gate-core.mjs";

const OLD = "20270423000000_plaid_item_counter";
const NEW = "20270424000000_add_nickname";
const file = (name: string) => `prisma/migrations/${name}/migration.sql`;
const finding = (rule_name: string, name = NEW) => ({ file: file(name), rule_name, line: 4 });

const problems = (over: Record<string, unknown> = {}): string[] =>
  migrationProblems({
    baseNames: [OLD],
    headNames: [OLD, NEW],
    added: [NEW],
    altered: [],
    headFile: `${NEW}\n`,
    sqlOf: () => 'ALTER TABLE "users" ADD COLUMN "nickname" TEXT;',
    findings: [],
    ...over,
  } as never);

describe("what the migration gate lets through", () => {
  it("passes a new migration that adds a column and sorts last", () => {
    expect(problems()).toEqual([]);
  });

  it("passes a change with no new migration", () => {
    expect(problems({ headNames: [OLD], added: [], headFile: OLD })).toEqual([]);
  });

  it.each([
    "ban-drop-column",
    "ban-drop-table",
    "renaming-column",
    "renaming-table",
    "changing-column-type",
    "adding-required-field",
    "adding-not-nullable-field",
  ])("fails %s and says where and how to fix it", (rule) => {
    const [problem, ...rest] = problems({ findings: [finding(rule)] });
    expect(rest).toEqual([]);
    expect(problem).toContain(rule);
    expect(problem).toContain("line 5");
    expect(problem).toContain("docs/migrations.md");
  });

  it("ignores Squawk's lock and style rules, which flag every new table", () => {
    const findings = ["prefer-robust-stmts", "require-concurrent-index-creation"].map((r) =>
      finding(r),
    );
    expect(problems({ findings })).toEqual([]);
  });

  it("reads only the new migration's findings", () => {
    expect(problems({ findings: [finding("ban-drop-table", OLD)] })).toEqual([]);
  });

  it("fails what Squawk misses: deletes, and drops inside a block", () => {
    expect(unsafeWords('TRUNCATE "t";')).toEqual(["truncate"]);
    expect(unsafeWords('DELETE FROM "t";')).toEqual(["delete-rows"]);
    expect(unsafeWords('DO $$ BEGIN DROP TABLE "y"; END $$;')).toEqual(["drop-in-block"]);
    expect(unsafeWords('DO $$ BEGIN ALTER TABLE "y" RENAME TO "z"; END $$;')).toEqual([
      "rename-in-block",
    ]);
    expect(problems({ sqlOf: () => 'DELETE FROM "merchants";' })[0]).toContain("delete-rows");
  });

  it("doesn't read the words in a comment", () => {
    expect(unsafeWords("-- we used to DROP TABLE here\nSELECT 1;")).toEqual([]);
  });

  it("lets a reviewed contract step through, only if it names the PR", () => {
    const findings = [finding("ban-drop-column")];
    const sql = (mark: string) => `${mark}\nALTER TABLE "users" DROP COLUMN "nickname";`;
    expect(
      problems({
        findings,
        sqlOf: () => sql("-- reviewed-contract-step: users.nickname, unused since #1300"),
      }),
    ).toEqual([]);
    expect(
      problems({ findings, sqlOf: () => sql("-- reviewed-contract-step: trust me") }),
    ).toHaveLength(1);
  });
});

describe("the order of migrations", () => {
  it("fails a new name that sorts before one already on main, and gives one that works", () => {
    const early = "20261103120000_add_nickname";
    const [problem, ...rest] = problems({ added: [early], headNames: [early, OLD], headFile: OLD });
    expect(rest).toEqual([]);
    expect(problem).toContain(`sorts before ${OLD}`);
    expect(problem).toContain("20270424000000_add_nickname");
  });

  it("names the next day across a month's end", () => {
    const newest = "20270430000000_x";
    const early = "20261103120000_y";
    const [problem] = problems({
      baseNames: [newest],
      added: [early],
      headNames: [early, newest],
      headFile: newest,
    });
    expect(problem).toContain("20270501000000_y");
  });

  it("fails a change to, or removal of, an applied migration, even with a review mark", () => {
    const [problem] = problems({
      added: [],
      altered: [OLD],
      headNames: [OLD],
      headFile: OLD,
      sqlOf: () => "-- reviewed-contract-step: x #1",
    });
    expect(problem).toContain("an applied migration was changed or removed");
  });

  it("fails when the head file isn't updated, so two migration PRs have to conflict", () => {
    const [problem] = problems({ headFile: `${OLD}\n` });
    expect(problem).toContain("prisma/migrations-head.txt");
    expect(problem).toContain(NEW);
  });

  it("fails a badly formed name", () => {
    const bad = "20270424_Add-Nickname";
    expect(problems({ added: [bad], headNames: [OLD, bad], headFile: bad })[0]).toContain(
      "14 digits",
    );
  });
});

describe("reading git's list of changed files", () => {
  it("tells new migrations from changed ones, and leaves out the lock file", () => {
    const diff = [
      `A\t${file(NEW)}`,
      `M\t${file(OLD)}`,
      "D\tprisma/migrations/20261018030927_init/migration.sql",
      "M\tprisma/migrations/migration_lock.toml",
    ].join("\n");
    expect(migrationChanges(diff)).toEqual({
      added: [NEW],
      altered: ["20261018030927_init", OLD],
    });
  });

  it("counts a file added beside an applied migration as changing it", () => {
    const diff = `A\tprisma/migrations/${OLD}/notes.md`;
    expect(migrationChanges(diff)).toEqual({ added: [], altered: [OLD] });
  });

  it("gives nothing for an empty diff", () => {
    expect(migrationChanges("")).toEqual({ added: [], altered: [] });
  });
});
