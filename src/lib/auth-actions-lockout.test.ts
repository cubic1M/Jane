import { beforeEach, describe, expect, it, vi } from "vitest";

const subjects = new Map<string, number>();
vi.mock("@/lib/rate-limit", () => ({
  ipKey: () => (globalThis as { testIp?: string }).testIp ?? "ip",
  hit: vi.fn(async (_kind: string, subject: string) => {
    const count = (subjects.get(subject) ?? 0) + 1;
    subjects.set(subject, count);
    return { ok: count <= 10, remaining: 0, retryAfterSeconds: 60 };
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/auth-events", () => ({ recordFailedSignIn: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ HOME_PATH: "/import" }));
vi.mock("@/lib/trial-delete", () => ({ deleteTrialPerson: vi.fn(async () => true) }));

import { signIn } from "@/auth";
import { signInWithEmail } from "./auth-actions";

const form = () => {
  const data = new FormData();
  data.set("email", "person@example.com");
  data.set("consent", "on");
  return data;
};
const asFrom = async (ip: string) => {
  (globalThis as { testIp?: string }).testIp = ip;
  await signInWithEmail(form()).catch((error: Error) => {
    if (error.message.includes("TooManyRequests")) throw error;
  });
};

// Anyone can ask for anyone's sign-in link. A stranger asking for it from many addresses must not
// be able to keep the person off their own sign-in form.
describe("a stranger asking for someone's sign-in link", () => {
  beforeEach(() => {
    subjects.clear();
    vi.mocked(signIn).mockClear();
  });

  it("doesn't stop the person from their own connection", async () => {
    for (let i = 0; i < 50; i++) await asFrom(`stranger-${i}`);
    await expect(asFrom("the-person")).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(51);
  });

  it("still stops one connection asking too often", async () => {
    for (let i = 0; i < 10; i++) await asFrom("one-place");
    await expect(asFrom("one-place")).rejects.toThrow("TooManyRequests");
  });
});
