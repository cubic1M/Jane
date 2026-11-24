import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { booksNoticeClosed, booksNoticeKey, closeBooksNotice } from "./books-notice";

// Closing Home's "figures rely on data I'm still checking" box is remembered per person, and only
// for the problems it named (founder 11-24).

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the books box, closed", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const person = async (tag: string) => {
    const user = await client.user.create({
      data: { email: `books-notice-${tag}-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    return user.id;
  };
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("stays closed for the same problems, and comes back when they change", async () => {
    const me = await person("me");
    const key = booksNoticeKey(["a", "b"]);
    expect(await booksNoticeClosed(me, key, { client })).toBe(false);
    await closeBooksNotice(me, key, { client });
    expect(await booksNoticeClosed(me, key, { client })).toBe(true);
    // Closing twice is fine.
    await closeBooksNotice(me, key, { client });
    // A new problem: a different set, so it shows again.
    expect(await booksNoticeClosed(me, booksNoticeKey(["a", "b", "c"]), { client })).toBe(false);
  });

  it("keeps one closing at a time: closing the new set forgets the old one", async () => {
    const me = await person("one");
    const old = booksNoticeKey(["a"]);
    const next = booksNoticeKey(["a", "b"]);
    await closeBooksNotice(me, old, { client });
    await closeBooksNotice(me, next, { client });
    expect(await booksNoticeClosed(me, old, { client })).toBe(false);
    expect(await booksNoticeClosed(me, next, { client })).toBe(true);
    expect(await client.changeAck.count({ where: { userId: me, kind: "books_notice" } })).toBe(1);
  });

  it("is one person's, never another's", async () => {
    const [a, b] = [await person("a"), await person("b")];
    const key = booksNoticeKey(["x"]);
    await closeBooksNotice(a, key, { client });
    expect(await booksNoticeClosed(b, key, { client })).toBe(false);
  });

  it("refuses a key that isn't one of its own", async () => {
    const me = await person("bad");
    await expect(closeBooksNotice(me, "anything", { client })).rejects.toThrow();
    await expect(closeBooksNotice(me, "books_notice:short", { client })).rejects.toThrow();
  });
});
