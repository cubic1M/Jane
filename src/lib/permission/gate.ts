import { AsyncLocalStorage } from "node:async_hooks";
import type { SpecialistKey } from "@/config/specialists";

// What makes the permission check (./check.ts) impossible to skip: a connector's acting methods work
// only inside a grant, and only the check hands one out. A connector wraps itself in `gated` where
// it's defined, keeping its sector's own interface.

export type Grant = { specialist: SpecialistKey; userId: string };

const grants = new AsyncLocalStorage<Grant>();

export class NoPermission extends Error {
  constructor(specialist: SpecialistKey) {
    super(`${specialist} tried to act without passing the permission check.`);
    this.name = "NoPermission";
  }
}

// Only ./check.ts calls this (src/lib/permission/permission.test.ts holds it to that).
export const withGrant = <T>(grant: Grant, run: () => Promise<T>): Promise<T> =>
  grants.run(grant, run);

export function requireGrant(specialist: SpecialistKey): void {
  if (grants.getStore()?.specialist !== specialist) throw new NoPermission(specialist);
}

export function gated<T extends object>(
  specialist: SpecialistKey,
  partner: T,
  acts: readonly (keyof T & string)[],
): T {
  return new Proxy(partner, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      if (!(acts as readonly (string | symbol)[]).includes(prop)) return value.bind(target);
      return (...args: unknown[]) => {
        requireGrant(specialist);
        return value.apply(target, args);
      };
    },
  });
}
