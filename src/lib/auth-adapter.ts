import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { PrismaClient, User } from "@/generated/prisma/client";

// A small Auth.js adapter over our own tables. We don't use @auth/prisma-adapter because
// our "accounts" table holds bank accounts; sign-in providers live in auth_accounts.

function toAdapterUser(user: User): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
    role: user.role,
  };
}

function toAdapterSession(session: AdapterSession): AdapterSession {
  return { sessionToken: session.sessionToken, userId: session.userId, expires: session.expires };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export function createAuthAdapter(client: PrismaClient): Adapter {
  return {
    async createUser({ email, emailVerified, name, image }) {
      return toAdapterUser(
        await client.user.create({ data: { email, emailVerified, name, image } }),
      );
    },

    async getUser(id) {
      const user = await client.user.findUnique({ where: { id } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await client.user.findUnique({ where: { email } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await client.authAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser({ id, email, emailVerified, name, image }) {
      // Only profile fields; role is never set through Auth.js.
      const user = await client.user.update({
        where: { id },
        data: { email, emailVerified, name, image },
      });
      return toAdapterUser(user);
    },

    async deleteUser(id) {
      await client.user.delete({ where: { id } });
    },

    async linkAccount(account) {
      // OAuth tokens are deliberately dropped: we only need to know who signed in.
      await client.authAccount.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
      return account;
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await client.authAccount.delete({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      });
    },

    async createSession({ sessionToken, userId, expires }) {
      return toAdapterSession(
        await client.session.create({ data: { sessionToken, userId, expires } }),
      );
    },

    async getSessionAndUser(sessionToken) {
      const session = await client.session.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!session) return null;
      return { session: toAdapterSession(session), user: toAdapterUser(session.user) };
    },

    async updateSession({ sessionToken, expires }) {
      try {
        return toAdapterSession(
          await client.session.update({ where: { sessionToken }, data: { expires } }),
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async deleteSession(sessionToken) {
      // deleteMany so signing out twice (two tabs) doesn't throw.
      await client.session.deleteMany({ where: { sessionToken } });
    },

    async createVerificationToken({ identifier, token, expires }) {
      await client.verificationToken.create({ data: { identifier, token, expires } });
      return { identifier, token, expires };
    },

    async useVerificationToken({ identifier, token }) {
      // Delete-and-return makes each magic link single use, even under concurrent clicks.
      try {
        return await client.verificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}
