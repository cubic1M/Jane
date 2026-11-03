import { appendFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { DOORS, TEST_CODE } from "@/config/deny-by-default";
import type { PrismaClient } from "@/generated/prisma/client";

// The tests' database client when the suite runs on a login role with no bypass
// (src/test-setup/no-bypass.ts). Test files make their rows, and look at the result, through the
// same client they hand to the code under test. So each call looks at who made it: test code goes
// to the database's owner, as a person with the console would, and the app's code stays on the
// no-bypass login, where a call that went through neither scopedFor nor systemDb fails.

const SKIP = /node_modules|no-bypass-client|^node:|generated\/prisma/;

// The file of the nearest frame that isn't Prisma or this one.
function callerFile(): string {
  const holder: { stack?: unknown } = {};
  const prepare = Error.prepareStackTrace;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;
  Error.prepareStackTrace = (_, sites) => sites;
  Error.captureStackTrace(holder, callerFile);
  const sites = holder.stack as NodeJS.CallSite[];
  Error.prepareStackTrace = prepare;
  Error.stackTraceLimit = limit;
  for (const site of sites) {
    const file = site.getFileName();
    if (file && !SKIP.test(file)) return file.replace(/^file:\/\//, "");
  }
  return "";
}

// With NO_BYPASS_LOG set, every raw call the app's code makes, whichever login it's on.
function note(file: string, what: string) {
  const log = process.env.NO_BYPASS_LOG;
  if (!log || DOORS.test(file)) return;
  appendFileSync(log, `${file.replace(/^.*?\/src\//, "src/")} ${what}\n`);
}

type Client = PrismaClient & Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;

function routed(app: Client, owner: () => Client, path: string[]): Fn {
  const at = (root: Client) =>
    path.slice(0, -1).reduce((o, k) => (o as never)[k], root as unknown) as Record<string, Fn>;
  const name = path[path.length - 1];
  return (...args) => {
    const file = callerFile();
    if (TEST_CODE.test(file)) {
      const on = at(owner());
      return on[name](...args);
    }
    note(file, path.join("."));
    const on = at(app);
    return on[name](...args);
  };
}

export function fixtureClient<T extends new (...args: never[]) => object>(Real: T): T {
  const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
  return function Wrapped(options: unknown) {
    const app = new (Real as unknown as new (o: unknown) => Client)(options);
    let ownerClient: Client | undefined;
    const owner = () =>
      (ownerClient ??= new (Real as unknown as new (o: unknown) => Client)({
        adapter: new PrismaPg({ connectionString: ownerUrl }),
      }));
    return new Proxy(app, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof prop !== "string") return value;
        if (prop === "$disconnect") {
          return async () => {
            await ownerClient?.$disconnect();
            await target.$disconnect();
          };
        }
        if (prop === "$queryRaw" || prop === "$executeRaw" || prop === "$queryRawUnsafe") {
          return routed(target, owner, [prop]);
        }
        if (prop === "$executeRawUnsafe" || prop === "$transaction") {
          return routed(target, owner, [prop]);
        }
        if (prop.startsWith("$") || prop.startsWith("_")) {
          return typeof value === "function" ? (value as Fn).bind(target) : value;
        }
        if (typeof value !== "object" || value === null) return value;
        // A table: each of its operations.
        return new Proxy(value, {
          get(delegate, op) {
            const member = Reflect.get(delegate, op) as unknown;
            if (typeof member !== "function" || typeof op !== "string") return member;
            return routed(target, owner, [prop, op]);
          },
        });
      },
    });
  } as unknown as T;
}
