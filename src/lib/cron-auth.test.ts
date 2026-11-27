import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

const asking = (authorization?: string) =>
  new Request("http://x/api/cron/digest", { headers: authorization ? { authorization } : {} });

describe("cronAuthorized", () => {
  it("lets only the exact secret through", () => {
    expect(cronAuthorized(asking("Bearer right"), "right")).toBe(true);
    for (const wrong of ["Bearer wrong", "Bearer righ", "Bearer rightt", "right", undefined]) {
      expect(cronAuthorized(asking(wrong), "right")).toBe(false);
    }
  });

  it("lets nobody through when no secret is set", () => {
    for (const secret of [undefined, ""]) {
      expect(cronAuthorized(asking("Bearer "), secret)).toBe(false);
      expect(cronAuthorized(asking(), secret)).toBe(false);
    }
  });
});

// A new cron route that forgets the secret would let anyone run the job: every route under
// /api/cron and the read-only ops routes ask before they do any work (before their first await).
describe("every cron route asks for the secret first", () => {
  const dirs = ["src/app/api/cron", "src/app/api/ops/evidence", "src/app/api/ops/invariants"];
  const routes = dirs.flatMap((dir) =>
    (dir.endsWith("cron")
      ? readdirSync(dir).map((name) => `${dir}/${name}/route.ts`)
      : [`${dir}/route.ts`]
    ).filter((file) => existsSync(file)),
  );

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  it.each(routes)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    const handler = /export async function GET\b/.exec(source);
    expect(handler).not.toBeNull();
    const body = source.slice(handler!.index);
    const asks = body.indexOf("cronAuthorized(");
    const firstWork = body.indexOf("await ");
    expect(asks).toBeGreaterThan(-1);
    expect(firstWork === -1 || asks < firstWork).toBe(true);
  });
});
