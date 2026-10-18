import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter } from "next-auth/adapters";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAuthAdapter } from "./auth-adapter";

const DB_USER = {
  id: "user_1",
  email: "ada@example.com",
  emailVerified: null,
  name: "Ada",
  image: null,
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const ADAPTER_USER = {
  id: "user_1",
  email: "ada@example.com",
  emailVerified: null,
  name: "Ada",
  image: null,
  role: "user",
};

const EXPIRES = new Date("2099-01-01T00:00:00Z");

function notFound() {
  return Object.assign(new Error("Record not found"), { code: "P2025" });
}

const client = {
  user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  authAccount: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  verificationToken: { create: vi.fn(), delete: vi.fn() },
};

const adapter = createAuthAdapter(client as unknown as PrismaClient) as Required<Adapter>;

describe("createAuthAdapter", () => {
  beforeEach(() => {
    for (const model of Object.values(client)) {
      for (const method of Object.values(model)) method.mockReset();
    }
  });

  it("creates users without letting Auth.js set the id or role", async () => {
    client.user.create.mockResolvedValue(DB_USER);

    const user = await adapter.createUser({
      id: "ignored",
      email: "ada@example.com",
      emailVerified: null,
      name: "Ada",
      role: "admin",
    });

    expect(client.user.create).toHaveBeenCalledWith({
      data: { email: "ada@example.com", emailVerified: null, name: "Ada", image: undefined },
    });
    expect(user).toEqual(ADAPTER_USER);
  });

  it("includes the role when loading a session, without extra columns", async () => {
    client.session.findUnique.mockResolvedValue({
      id: "s_1",
      sessionToken: "token",
      userId: "user_1",
      expires: EXPIRES,
      createdAt: new Date(),
      user: { ...DB_USER, role: "admin" },
    });

    expect(await adapter.getSessionAndUser("token")).toEqual({
      session: { sessionToken: "token", userId: "user_1", expires: EXPIRES },
      user: { ...ADAPTER_USER, role: "admin" },
    });
  });

  it("returns null for an unknown session", async () => {
    client.session.findUnique.mockResolvedValue(null);

    expect(await adapter.getSessionAndUser("missing")).toBeNull();
  });

  it("finds a user by provider account", async () => {
    client.authAccount.findUnique.mockResolvedValue({ user: DB_USER });

    expect(
      await adapter.getUserByAccount({ provider: "google", providerAccountId: "g_1" }),
    ).toEqual(ADAPTER_USER);
    expect(client.authAccount.findUnique).toHaveBeenCalledWith({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: "g_1" } },
      include: { user: true },
    });
  });

  it("never stores OAuth tokens when linking an account", async () => {
    client.authAccount.create.mockResolvedValue({});

    await adapter.linkAccount({
      userId: "user_1",
      type: "oidc",
      provider: "google",
      providerAccountId: "g_1",
      access_token: "ya29.secret",
      refresh_token: "1//secret",
      id_token: "eyJ.secret",
    });

    expect(client.authAccount.create).toHaveBeenCalledWith({
      data: { userId: "user_1", type: "oidc", provider: "google", providerAccountId: "g_1" },
    });
  });

  it("only updates profile fields", async () => {
    client.user.update.mockResolvedValue(DB_USER);

    await adapter.updateUser({ id: "user_1", name: "Ada L", role: "admin" });

    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { email: undefined, emailVerified: undefined, name: "Ada L", image: undefined },
    });
  });

  it("signs out idempotently", async () => {
    client.session.deleteMany.mockResolvedValue({ count: 0 });

    await expect(adapter.deleteSession("gone")).resolves.toBeUndefined();
    expect(client.session.deleteMany).toHaveBeenCalledWith({ where: { sessionToken: "gone" } });
  });

  it("returns null when updating a session that no longer exists", async () => {
    client.session.update.mockRejectedValue(notFound());

    expect(await adapter.updateSession({ sessionToken: "gone", expires: EXPIRES })).toBeNull();
  });

  it("uses a magic-link token once", async () => {
    const token = { identifier: "ada@example.com", token: "hashed", expires: EXPIRES };
    client.verificationToken.delete.mockResolvedValueOnce(token).mockRejectedValueOnce(notFound());

    expect(await adapter.useVerificationToken(token)).toEqual(token);
    expect(await adapter.useVerificationToken(token)).toBeNull();
    expect(client.verificationToken.delete).toHaveBeenCalledWith({
      where: { identifier_token: { identifier: "ada@example.com", token: "hashed" } },
    });
  });

  it("rethrows unexpected database errors", async () => {
    client.verificationToken.delete.mockRejectedValue(new Error("db down"));

    await expect(
      adapter.useVerificationToken({ identifier: "ada@example.com", token: "hashed" }),
    ).rejects.toThrow("db down");
  });
});
